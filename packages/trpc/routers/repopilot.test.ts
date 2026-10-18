import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { processNextResearch } from "@karakeep/shared-server/repopilot/runner";
import { researchRuns } from "@karakeep/db/schema";
import {
  claimResearchJob,
  leaseFilter,
} from "@karakeep/shared-server/repopilot/jobs";
import { defaultBeforeEach } from "../testUtils";
import type { CustomTestContext } from "../testUtils";

beforeEach<CustomTestContext>(defaultBeforeEach(true));
const input = {
  repository: "langgenius/dify",
  profile: {
    skills: ["TypeScript"],
    weeks: 2 as const,
    goal: "portfolio" as const,
  },
};

test<CustomTestContext>("durable create, dedup, per-user active limit, list and ownership on all operations", async ({
  apiCallers: [a, b],
  unauthedAPICaller,
  db,
}) => {
  await expect(
    unauthedAPICaller.repopilot.createRun(input),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const { runId } = await a.repopilot.createRun(input);
  expect(await a.repopilot.createRun(input)).toEqual({ runId });
  await expect(
    a.repopilot.createRun({ ...input, repository: "FlowiseAI/Flowise" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await a.repopilot.listRuns({})).items).toHaveLength(1);
  expect((await b.repopilot.listRuns({})).items).toHaveLength(0);
  for (const call of [
    () => b.repopilot.getRun({ id: runId }),
    () => b.repopilot.deleteRun({ id: runId }),
    () => b.repopilot.retryRun({ id: runId }),
    () => b.repopilot.saveBookmark({ id: runId }),
    () =>
      b.repopilot.submitFeedback({
        runId,
        opportunityId: "x",
        rating: "helpful",
      }),
    () =>
      b.repopilot.trackEvent({ id: runId, name: "repopilot_report_exported" }),
  ])
    await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await a.repopilot.getRun({ id: runId })).status).toBe("queued");
  const job = claimResearchJob(db, 1000, 100)!;
  expect(job.status).toBe("running");
  expect(claimResearchJob(db, 1050)).toBeNull();
  const recovered = claimResearchJob(db, 1101)!;
  expect(recovered.id).toBe(runId);
  expect(recovered.leaseToken).not.toBe(job.leaseToken);
  expect(
    db
      .update(researchRuns)
      .set({ status: "completed" })
      .where(leaseFilter(runId, job.leaseToken!))
      .run().changes,
  ).toBe(0);
  await a.repopilot.deleteRun({ id: runId });
  expect((await a.repopilot.listRuns({})).items).toHaveLength(0);
});

test<CustomTestContext>("retry creates separate run; bookmark reuse and valid feedback", async ({
  apiCallers: [a],
  db,
}) => {
  const { runId } = await a.repopilot.createRun(input);
  await expect(a.repopilot.retryRun({ id: runId })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await db
    .update(researchRuns)
    .set({
      status: "partial",
      reportJson: JSON.stringify({ opportunities: [{ id: "idea-1" }] }),
    })
    .where(eq(researchRuns.id, runId));
  expect((await a.repopilot.retryRun({ id: runId })).runId).not.toBe(runId);
  const first = await a.repopilot.saveBookmark({ id: runId });
  expect(await a.repopilot.saveBookmark({ id: runId })).toEqual(first);
  await expect(
    a.repopilot.submitFeedback({
      runId,
      opportunityId: "invented",
      rating: "helpful",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await a.repopilot.submitFeedback({
    runId,
    opportunityId: "idea-1",
    rating: "helpful",
  });
  await a.repopilot.submitFeedback({
    runId,
    opportunityId: "idea-1",
    adopted: true,
  });
  expect((await a.repopilot.getRun({ id: runId })).feedback).toHaveLength(1);
});

test<CustomTestContext>("worker persists completed graph, references and safe missing live configuration failure", async ({
  apiCallers: [a],
  db,
}) => {
  const { runId } = await a.repopilot.createRun(input);
  expect(await processNextResearch(db)).toBe(true);
  const run = await a.repopilot.getRun({ id: runId });
  expect(run.status).toBe("completed");
  expect(JSON.parse(run.reportJson!).opportunities).toHaveLength(3);
  expect(run.evidence.length).toBeGreaterThan(5);
  expect(run.inputTokens).toBeNull();
  const { runId: liveId } = await a.repopilot.createRun(input);
  await db
    .update(researchRuns)
    .set({ mode: "live" })
    .where(eq(researchRuns.id, liveId));
  const { fixtureFetch } =
    await import("@karakeep/shared-server/repopilot/fixtures");
  await processNextResearch(db, { fetcher: fixtureFetch });
  const failed = await a.repopilot.getRun({ id: liveId });
  expect(failed.status).toBe("failed");
  expect(failed.errorCode).toBe("LLM_NOT_CONFIGURED");
});

test<CustomTestContext>("hard timeout converges even if provider never settles; recovery exhausts safely", async ({
  apiCallers: [a],
  db,
}) => {
  const { runId } = await a.repopilot.createRun(input);
  const { MockProvider } =
    await import("@karakeep/shared-server/repopilot/provider");
  const provider = new MockProvider();
  provider.generate = () =>
    new Promise(() => {
      /* simulate a stalled remote request */
    });
  await processNextResearch(db, { provider, timeoutMs: 30 });
  expect((await a.repopilot.getRun({ id: runId })).errorCode).toBe("TIMEOUT");
  const { runId: retryId } = await a.repopilot.retryRun({ id: runId });
  await db
    .update(researchRuns)
    .set({
      status: "running",
      attempts: 3,
      leaseToken: "stale",
      leaseExpiresAt: 1,
    })
    .where(eq(researchRuns.id, retryId));
  expect(claimResearchJob(db, 2)).toBeNull();
  expect((await a.repopilot.getRun({ id: retryId })).errorCode).toBe(
    "WORKER_INTERRUPTED",
  );
});

test<CustomTestContext>("stable pagination at equal timestamps and cascade deletion", async ({
  apiCallers: [a],
  db,
}) => {
  const first = await a.repopilot.createRun(input);
  await processNextResearch(db);
  await a.repopilot.submitFeedback({
    runId: first.runId,
    opportunityId: "idea-1",
    rating: "helpful",
  });
  const second = await a.repopilot.createRun(input);
  await db.update(researchRuns).set({ createdAt: 123456 });
  const page1 = await a.repopilot.listRuns({ limit: 1 });
  const page2 = await a.repopilot.listRuns({
    limit: 1,
    cursor: page1.nextCursor,
  });
  expect(new Set([...page1.items, ...page2.items].map((x) => x.id))).toEqual(
    new Set([first.runId, second.runId]),
  );
  await a.repopilot.deleteRun({ id: first.runId });
  const { researchEvidence, researchFeedback } =
    await import("@karakeep/db/schema");
  expect(
    await db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.runId, first.runId)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(researchFeedback)
      .where(eq(researchFeedback.runId, first.runId)),
  ).toHaveLength(0);
});
