import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { researchRuns } from "@karakeep/db/schema";
import {
  claimResearchJob,
  leaseFilter,
} from "@karakeep/shared-server/repopilot/jobs";
import { defaultBeforeEach, type CustomTestContext } from "../testUtils";

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
