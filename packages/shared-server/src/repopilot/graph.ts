import { StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { z } from "zod";
import {
  normalizeGitHubRepo,
  profileSchema,
} from "@karakeep/shared/repopilot/input";
import {
  draftSchema,
  painOutputSchema,
  planSchema,
  reportSchema,
} from "@karakeep/shared/repopilot/report";
import type { ResearchReport } from "@karakeep/shared/repopilot/report";
import type {
  Evidence,
  RepoMetadata,
  Trace,
} from "@karakeep/shared/repopilot/types";
import { GitHubClient, ResearchError } from "./github";
import { fixtureRecordedAt } from "./fixtures";
import { PROMPT_VERSION } from "./provider";
import type { ModelProvider } from "./provider";
import { duplicateIdeas, verifyIdeas } from "./validation";

export interface ResearchState {
  runId: string;
  repo: ReturnType<typeof normalizeGitHubRepo>;
  profile: z.infer<typeof profileSchema>;
  repositoryContext: RepoMetadata | null;
  directory: unknown[];
  painPointClusters: z.infer<typeof painOutputSchema>["painPoints"];
  relatedRepositories: RepoMetadata[];
  evidence: Evidence[];
  candidateIdeas: z.infer<typeof draftSchema> | null;
  finalReport: ResearchReport | null;
  missingEvidence: string[];
  requestedTools: z.infer<typeof planSchema> | null;
  toolCallsCount: number;
  supplementalRounds: number;
  warnings: string[];
  trace: Trace[];
}
const GraphState = new StateSchema({ context: z.custom<ResearchState>() });
const progress: Record<string, number> = {
  validate_input: 2,
  fetch_repo_context: 10,
  extract_pain_points: 30,
  discover_ai_technologies: 45,
  evidence_gap_check: 55,
  targeted_supplement: 60,
  generate_ideas: 70,
  verify_and_score: 90,
  persist_report: 98,
};
export function aiScope(
  repo: RepoMetadata,
  readme: string,
): "yes" | "uncertain" | "no" {
  const text = `${repo.description} ${repo.topics.join(" ")} ${readme.slice(0, 4000)}`;
  if (
    /\b(llm|rag|artificial intelligence|machine learning|langchain|langgraph|generative ai|agentic|deep learning)\b/i.test(
      text,
    )
  )
    return "yes";
  if (/\b(ai|agent|model|neural|chatbot)\b/i.test(text)) return "uncertain";
  return readme.length > 100 || repo.description.length > 30
    ? "no"
    : "uncertain";
}

export async function runResearch(options: {
  runId: string;
  repository: string;
  profile: unknown;
  mode: "mock" | "live";
  client: GitHubClient;
  provider: ModelProvider;
  signal: AbortSignal;
  maxLlmCalls?: number;
  onState?: (
    state: ResearchState,
    stage: string,
    progress: number,
  ) => Promise<void>;
}) {
  const { client, provider, signal } = options;
  const generate: ModelProvider["generate"] = async (task, schema, data) => {
    if (provider.calls >= Math.min(5, options.maxLlmCalls ?? 5))
      throw new ResearchError("LLM_BUDGET", "已达到模型请求上限");
    return provider.generate(task, schema, data);
  };
  const initial: ResearchState = {
    runId: options.runId,
    repo: normalizeGitHubRepo(options.repository),
    profile: profileSchema.parse(options.profile),
    repositoryContext: null,
    directory: [],
    painPointClusters: [],
    relatedRepositories: [],
    evidence: [],
    candidateIdeas: null,
    finalReport: null,
    missingEvidence: [],
    requestedTools: null,
    toolCallsCount: 0,
    supplementalRounds: 0,
    warnings: [],
    trace: [],
  };
  const add = (s: ResearchState, items: (Evidence | null)[]) => {
    const map = new Map(s.evidence.map((e) => [e.id, e]));
    for (const item of items)
      if (item)
        map.set(
          item.id,
          options.mode === "mock"
            ? { ...item, fetchedAt: fixtureRecordedAt }
            : item,
        );
    s.evidence = [...map.values()];
  };
  const optional = async <T>(
    s: ResearchState,
    fn: () => Promise<T>,
    fallback: T,
  ) => {
    try {
      return await fn();
    } catch (error) {
      if (signal.aborted) throw error;
      s.warnings.push(
        error instanceof ResearchError ? error.message : "部分来源无法解析",
      );
      return fallback;
    }
  };
  const node =
    (name: string, fn: (s: ResearchState) => Promise<void>) =>
    async ({ context }: typeof GraphState.State) => {
      if (signal.aborted)
        throw new ResearchError("TIMEOUT", "研究超过执行时间上限");
      const state = structuredClone(context),
        start = Date.now(),
        gh = client.calls,
        llm = provider.calls;
      await options.onState?.(state, name, progress[name]);
      let outcome: "ok" | "error" = "ok";
      try {
        await fn(state);
      } catch (error) {
        outcome = "error";
        throw error;
      } finally {
        state.toolCallsCount = client.calls;
        state.trace.push({
          node: name,
          durationMs: Date.now() - start,
          outcome,
          githubCalls: client.calls - gh,
          llmCalls: provider.calls - llm,
        });
        await options.onState?.(state, name, progress[name]);
      }
      return { context: state };
    };
  const modelData = (s: ResearchState) => ({
    repository: s.repositoryContext,
    profile: s.profile,
    directory: s.directory,
    evidence: s.evidence.map((e) => ({
      ...e,
      excerpt: e.excerpt.slice(0, e.sourceType === "repo_readme" ? 6000 : 1200),
    })),
    painPoints: s.painPointClusters,
    warnings: s.warnings,
  });
  const search = async (s: ResearchState, query: string) => {
    if (s.relatedRepositories.length >= 3) return;
    const repos = await client.searchRelatedRepositories(query, {
      maxItems: 2,
    });
    for (const repo of repos) {
      if (
        repo.fullName === s.repo.fullName ||
        s.relatedRepositories.some((r) => r.fullName === repo.fullName) ||
        s.relatedRepositories.length >= 3
      )
        continue;
      const r = normalizeGitHubRepo(repo.fullName);
      const metadata = await client.getRepositoryMetadata(r.owner, r.repo);
      s.relatedRepositories.push(metadata);
      if (options.mode === "mock") metadata.fetchedAt = fixtureRecordedAt;
      add(s, [
        {
          id: `${r.fullName}:tech_repo:metadata`,
          sourceType: "tech_repo",
          sourceUrl: metadata.url,
          sourceTitle: r.fullName,
          excerpt: metadata.description,
          fetchedAt: metadata.fetchedAt,
          externalId: r.fullName,
          repoFullName: r.fullName,
          metadata: {},
        },
      ]);
      add(s, [
        await optional(s, () => client.getReadme(r.owner, r.repo), null),
      ]);
      add(
        s,
        await optional(s, () => client.getReleases(r.owner, r.repo, 5), []),
      );
    }
  };
  const graph = new StateGraph(GraphState)
    .addNode(
      "validate_input",
      node("validate_input", async (s) => {
        if (options.mode === "mock" && s.repo.fullName !== "langgenius/dify")
          throw new ResearchError(
            "MOCK_REPO",
            "演示模式仅包含 langgenius/dify 的录制数据，请使用该仓库或配置 Live 模式",
          );
      }),
    )
    .addNode(
      "fetch_repo_context",
      node("fetch_repo_context", async (s) => {
        s.repositoryContext = await client.getRepositoryMetadata(
          s.repo.owner,
          s.repo.repo,
        );
        if (options.mode === "mock")
          s.repositoryContext.fetchedAt = fixtureRecordedAt;
        const readme = await optional(
          s,
          () => client.getReadme(s.repo.owner, s.repo.repo),
          null,
        );
        add(s, [readme]);
        const scope = aiScope(s.repositoryContext, readme?.excerpt ?? "");
        if (scope === "no")
          throw new ResearchError(
            "NOT_AI_REPO",
            "该项目不属于当前支持的 AI 软件仓库范围",
          );
        if (scope === "uncertain") s.warnings.push("AI 类型待确认");
        if (s.repositoryContext.archived)
          s.warnings.push("该仓库已归档，维护风险需单独评估");
        if (!readme) s.warnings.push("README 缺失，能力判断不完整");
        add(
          s,
          await optional(
            s,
            () => client.getIssues(s.repo.owner, s.repo.repo),
            [],
          ),
        );
        add(
          s,
          await optional(
            s,
            () => client.getReleases(s.repo.owner, s.repo.repo),
            [],
          ),
        );
        s.directory = await optional(
          s,
          () => client.getDirectorySummary(s.repo.owner, s.repo.repo),
          [],
        );
        if (!s.evidence.some((e) => e.sourceType === "issue"))
          s.warnings.push("没有采集到 issue，不能推断用户没有痛点");
      }),
    )
    .addNode(
      "extract_pain_points",
      node("extract_pain_points", async (s) => {
        s.painPointClusters = (
          await generate("pain_points", painOutputSchema, modelData(s))
        ).painPoints;
      }),
    )
    .addNode(
      "discover_ai_technologies",
      node("discover_ai_technologies", async (s) => {
        s.requestedTools = await generate(
          "technology_plan",
          planSchema,
          modelData(s),
        );
        for (const query of s.requestedTools.searchQueries)
          await optional(s, () => search(s, query), undefined);
      }),
    )
    .addNode(
      "evidence_gap_check",
      node("evidence_gap_check", async (s) => {
        s.missingEvidence = [];
        if (
          s.painPointClusters.some(
            (p) =>
              p.evidenceIds.filter((id) =>
                s.evidence.some((e) => e.id === id && e.sourceType === "issue"),
              ).length < 2,
          )
        )
          s.missingEvidence.push("痛点缺少独立 issue 交叉支持");
        if (!s.painPointClusters.length)
          s.missingEvidence.push("未识别有证据的痛点");
        if (!s.relatedRepositories.length)
          s.missingEvidence.push("缺少相关技术来源");
        if (
          s.evidence.some(
            (e) => e.sourceType === "issue" && e.excerpt.length >= 1200,
          )
        )
          s.missingEvidence.push("部分 issue 正文已截断");
      }),
    )
    .addNode(
      "targeted_supplement",
      node("targeted_supplement", async (s) => {
        s.supplementalRounds++;
        const tool = s.requestedTools!.supplement;
        if (tool.tool === "issue")
          add(s, [
            await optional(
              s,
              () =>
                client.getSpecificIssue(s.repo.owner, s.repo.repo, tool.number),
              null,
            ),
          ]);
        if (tool.tool === "readme")
          add(s, [
            await optional(
              s,
              () => client.getReadme(s.repo.owner, s.repo.repo),
              null,
            ),
          ]);
        if (tool.tool === "releases")
          add(
            s,
            await optional(
              s,
              () => client.getReleases(s.repo.owner, s.repo.repo),
              [],
            ),
          );
        if (tool.tool === "search")
          await optional(s, () => search(s, tool.query), undefined);
      }),
    )
    .addNode(
      "generate_ideas",
      node("generate_ideas", async (s) => {
        s.candidateIdeas = await generate("ideas", draftSchema, modelData(s));
        if (
          duplicateIdeas(s.candidateIdeas.opportunities) &&
          provider.calls < 5
        )
          s.candidateIdeas = await generate("ideas", draftSchema, {
            ...modelData(s),
            instruction:
              "Previous proposals duplicated pain points or flows. Return distinct directions, or fewer opportunities.",
          });
      }),
    )
    .addNode(
      "verify_and_score",
      node("verify_and_score", async (s) => {
        const verified = verifyIdeas(s.candidateIdeas, s.evidence, s.profile);
        s.warnings.push(...verified.warnings);
        const painPoints = s.painPointClusters.map((p) => {
          const evidenceIds = [...new Set(p.evidenceIds)].filter((id) =>
            s.evidence.some((e) => e.id === id && e.sourceType === "issue"),
          );
          return {
            ...p,
            summary: evidenceIds.length
              ? p.summary
              : `待验证假设（无有效 issue 引用）：${p.summary.slice(0, 1600)}`,
            evidenceIds,
            sampleSize: evidenceIds.length,
            confidence:
              evidenceIds.length < 2 ? ("low" as const) : p.confidence,
          };
        });
        verified.ideas = verified.ideas.filter((idea) => {
          if (painPoints.some((p) => p.id === idea.painPointId)) return true;
          s.warnings.push("已移除无法关联已分析痛点的创意");
          return false;
        });
        const dates = s.evidence
          .filter((e) => e.sourceType === "issue")
          .map((e) => e.metadata.updatedAt!)
          .filter(Boolean)
          .sort();
        s.finalReport = reportSchema.parse({
          schemaVersion: "1.0",
          mode: options.mode,
          ...(options.mode === "mock" ? { fixtureRecordedAt } : {}),
          repository: s.repositoryContext,
          executiveSummary: verified.draft.executiveSummary,
          existingCapabilities: verified.draft.existingCapabilities,
          painPoints,
          technologySignals: s.relatedRepositories.map((r) => ({
            name: r.fullName,
            reasonRelevant: `相关技术候选：${r.description.slice(0, 500)}（项目自述；适配性需验证）`,
            sourceEvidenceIds: s.evidence
              .filter((e) => e.repoFullName === r.fullName)
              .map((e) => e.id),
            freshnessDate: s.evidence.find(
              (e) => e.repoFullName === r.fullName && e.metadata.publishedAt,
            )?.metadata.publishedAt,
          })),
          opportunities: verified.ideas,
          references: s.evidence.map((e) => ({
            evidenceId: e.id,
            type: e.sourceType,
            title: e.sourceTitle,
            url: e.sourceUrl,
            fetchedAt: e.fetchedAt,
            excerpt: e.excerpt,
            state: e.metadata.state,
            date: e.metadata.updatedAt ?? e.metadata.publishedAt,
          })),
          sampling: {
            issueCount: dates.length,
            rule:
              options.mode === "mock"
                ? "静态录制样本，非实时查询；摘录最多 1200 字符"
                : "按最近更新时间降序采样 open/closed，排除 PR，最多 100 条、5 页；正文最多 1200 字符",
            from: dates[0] ?? null,
            to: dates.at(-1) ?? null,
          },
          warnings: [
            ...s.warnings,
            ...s.missingEvidence,
            ...verified.warnings,
            "技术机会来自有限样本，不能证明市场趋势；关闭 issue 不等于需求已实现。",
            "来源事实见引用；方案为模型推断；假设须用户验证。",
          ],
          generatedAt: new Date().toISOString(),
          promptVersion: PROMPT_VERSION,
        });
      }),
    )
    .addNode(
      "persist_report",
      node("persist_report", async (state) => {
        reportSchema.parse(state.finalReport);
      }),
    )
    .addEdge(START, "validate_input")
    .addEdge("validate_input", "fetch_repo_context")
    .addEdge("fetch_repo_context", "extract_pain_points")
    .addEdge("extract_pain_points", "discover_ai_technologies")
    .addEdge("discover_ai_technologies", "evidence_gap_check")
    .addConditionalEdges("evidence_gap_check", ({ context }) =>
      context.missingEvidence.length > 0 && context.supplementalRounds < 1
        ? "targeted_supplement"
        : "generate_ideas",
    )
    .addEdge("targeted_supplement", "evidence_gap_check")
    .addEdge("generate_ideas", "verify_and_score")
    .addEdge("verify_and_score", "persist_report")
    .addEdge("persist_report", END)
    .compile();
  return (
    await graph.invoke({ context: initial }, { recursionLimit: 16, signal })
  ).context;
}
