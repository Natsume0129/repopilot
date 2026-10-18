import { eq } from "drizzle-orm";
import type { DB } from "@karakeep/db";
import {
  researchRuns,
  researchEvidence,
  researchEvents,
} from "@karakeep/db/schema";
import { GitHubClient, ResearchError } from "./github";
import { fixtureFetch } from "./fixtures";
import { runResearch } from "./graph";
import type { ResearchState } from "./graph";
import { claimResearchJob, leaseFilter } from "./jobs";
import { LiveProvider, MockProvider, PROMPT_VERSION } from "./provider";
import type { ModelProvider } from "./provider";

function budget(value: string | undefined, fallback: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : fallback;
}
export async function processNextResearch(
  db: DB,
  options: {
    provider?: ModelProvider;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const timeoutMs =
    options.timeoutMs ??
    budget(process.env.REPOPILOT_MAX_RUN_SECONDS, 180, 180) * 1000;
  const job = claimResearchJob(db, Date.now(), timeoutMs + 15000);
  if (!job) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const provider =
    options.provider ??
    (job.mode === "mock"
      ? new MockProvider()
      : new LiveProvider(
          controller.signal,
          budget(process.env.REPOPILOT_MAX_LLM_CALLS, 5, 5),
        ));
  const client = new GitHubClient({
    fetcher: job.mode === "mock" ? fixtureFetch : options.fetcher,
    token: job.mode === "live" ? process.env.GITHUB_TOKEN : undefined,
    maxCalls: budget(process.env.REPOPILOT_MAX_GITHUB_CALLS, 24, 24),
    deadline: Date.now() + timeoutMs,
    signal: controller.signal,
  });
  let latest: ResearchState | undefined;
  try {
    const state = await runResearch({
      runId: job.id,
      repository: job.repoFullName,
      profile: JSON.parse(job.userProfileJson),
      mode: job.mode,
      client,
      provider,
      signal: controller.signal,
      onState: async (s, stage, progress) => {
        latest = s;
        const updated = await db
          .update(researchRuns)
          .set({
            stage,
            progress,
            traceJson: JSON.stringify(s.trace),
            updatedAt: Date.now(),
          })
          .where(leaseFilter(job.id, job.leaseToken!));
        if (updated.changes === 0) {
          controller.abort();
          throw new ResearchError(
            "LEASE_LOST",
            "任务已删除或被其他 worker 接管",
          );
        }
      },
    });
    if (controller.signal.aborted)
      throw new ResearchError("TIMEOUT", "研究已超时，请重试");
    const report = state.finalReport!;
    db.transaction((tx) => {
      const status =
        report.opportunities.length < 3 || state.warnings.length > 0
          ? "partial"
          : "completed";
      const changed = tx
        .update(researchRuns)
        .set({
          status,
          stage: "done",
          progress: 100,
          reportJson: JSON.stringify(report),
          repoSnapshotJson: JSON.stringify(state.repositoryContext),
          traceJson: JSON.stringify(state.trace),
          modelName: provider.modelName,
          promptVersion: PROMPT_VERSION,
          inputTokens: provider.inputTokens,
          outputTokens: provider.outputTokens,
          completedAt: Date.now(),
          updatedAt: Date.now(),
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(leaseFilter(job.id, job.leaseToken!))
        .run();
      if (!changed.changes) return;
      tx.delete(researchEvidence)
        .where(eq(researchEvidence.runId, job.id))
        .run();
      for (const e of state.evidence)
        tx.insert(researchEvidence)
          .values({
            id: `${job.id}:${e.id}`,
            runId: job.id,
            sourceType: e.sourceType,
            sourceUrl: e.sourceUrl,
            sourceTitle: e.sourceTitle,
            excerpt: e.excerpt,
            fetchedAt: e.fetchedAt,
            externalId: e.externalId,
            repoFullName: e.repoFullName,
            metadataJson: JSON.stringify(e.metadata),
          })
          .run();
      tx.insert(researchEvents)
        .values({ runId: job.id, name: "repopilot_run_completed" })
        .run();
    });
  } catch (error) {
    const safe = controller.signal.aborted
      ? new ResearchError("TIMEOUT", "研究超过执行时限或已取消，请重试")
      : error instanceof ResearchError
        ? error
        : new ResearchError(
            "RESEARCH_FAILED",
            "研究失败，来源或模型输出未通过校验，请重试",
          );
    db.transaction((tx) => {
      const changed = tx
        .update(researchRuns)
        .set({
          status: "failed",
          errorCode: safe.code,
          errorMessage: safe.message,
          traceJson: JSON.stringify(latest?.trace ?? []),
          repoSnapshotJson: latest?.repositoryContext
            ? JSON.stringify(latest.repositoryContext)
            : null,
          inputTokens: provider.inputTokens,
          outputTokens: provider.outputTokens,
          modelName: provider.modelName,
          completedAt: Date.now(),
          updatedAt: Date.now(),
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(leaseFilter(job.id, job.leaseToken!))
        .run();
      if (changed.changes)
        tx.insert(researchEvents)
          .values({ runId: job.id, name: "repopilot_run_failed" })
          .run();
    });
  } finally {
    clearTimeout(timer);
  }
  return true;
}
