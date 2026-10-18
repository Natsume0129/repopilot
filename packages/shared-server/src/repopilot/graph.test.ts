import { expect, test, vi } from "vitest";
import { GitHubClient } from "./github";
import { fixtureFetch } from "./fixtures";
import { runResearch, aiScope } from "./graph";
import { MockProvider } from "./provider";
import { verifyIdeas } from "./validation";
import { reportSchema } from "@karakeep/shared/repopilot/report";

const profile = {
  skills: ["TypeScript", "Python"],
  weeks: 2,
  goal: "portfolio",
};
async function run() {
  return runResearch({
    runId: "test",
    repository: "langgenius/dify",
    profile,
    mode: "mock",
    client: new GitHubClient({ fetcher: fixtureFetch }),
    provider: new MockProvider(),
    signal: new AbortController().signal,
  });
}
test("real LangGraph mock execution supplements once and yields three distinct cited opportunities", async () => {
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("no network"));
  try {
    const result = await run();
    expect(result.supplementalRounds).toBe(1);
    expect(
      result.trace.filter((t) => t.node === "targeted_supplement"),
    ).toHaveLength(1);
    expect(
      result.trace.find((t) => t.node === "targeted_supplement")?.githubCalls,
    ).toBe(1);
    expect(
      result.trace.filter((t) => t.node === "evidence_gap_check"),
    ).toHaveLength(2);
    const report = reportSchema.parse(result.finalReport);
    expect(report.opportunities).toHaveLength(3);
    expect(new Set(report.opportunities.map((o) => o.painPointId)).size).toBe(
      3,
    );
    expect(result.toolCallsCount).toBeLessThanOrEqual(24);
    expect(result.trace.reduce((n, t) => n + t.llmCalls, 0)).toBe(3);
    for (const o of report.opportunities) {
      expect(
        o.evidenceIds.every((id) =>
          report.references.some((r) => r.evidenceId === id),
        ),
      ).toBe(true);
      expect(o.scores.total).toBe(
        o.scores.userPain +
          o.scores.unmetNeed +
          o.scores.technologyFit +
          o.scores.personalFeasibility +
          o.scores.differentiation,
      );
    }
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
test("invented citations removed, duplicates not padded, feasibility constrained and schemas bounded", async () => {
  const result = await run();
  const draft = structuredClone(result.candidateIdeas!);
  draft.opportunities[0].evidenceIds = ["invented:issue:999"];
  draft.opportunities[0].estimatedEffort = "large";
  draft.opportunities[1] = { ...draft.opportunities[0], id: "duplicate" };
  const verified = verifyIdeas(draft, result.evidence, {
    skills: ["CSS"],
    weeks: 1,
  });
  expect(verified.ideas).toHaveLength(2);
  const first = verified.ideas.find((x) => x.id === draft.opportunities[0].id)!;
  expect(first.evidenceIds).toEqual([]);
  expect(first.confidence).toBe("low");
  expect(first.scores.personalFeasibility).toBeLessThanOrEqual(5);
  expect(first.scores.userPain).toBeLessThanOrEqual(5);
  expect(
    reportSchema.safeParse({ ...result.finalReport, schemaVersion: "bogus" })
      .success,
  ).toBe(false);
});
test("aborted runs stop; obvious non-AI projects rejected", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    runResearch({
      runId: "x",
      repository: "a/b",
      profile,
      mode: "live",
      client: new GitHubClient(),
      provider: new MockProvider(),
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(
    aiScope(
      {
        fullName: "a/b",
        url: "https://github.com/a/b",
        description:
          "A simple collection of cooking recipes and meal preparation notes.",
        stars: 0,
        language: "Markdown",
        archived: false,
        topics: [],
        fetchedAt: "now",
      },
      "",
    ),
  ).toBe("no");
});
