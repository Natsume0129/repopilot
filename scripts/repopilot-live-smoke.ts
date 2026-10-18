import "dotenv/config";
import { GitHubClient } from "../packages/shared-server/src/repopilot/github";
import { runResearch } from "../packages/shared-server/src/repopilot/graph";
import { LiveProvider } from "../packages/shared-server/src/repopilot/provider";

async function main() {
  const signal = AbortSignal.timeout(180000);
  const client = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
    signal,
    deadline: Date.now() + 180000,
  });
  if (process.argv.includes("--live")) {
    if (
      !process.env.REPOPILOT_LLM_API_KEY ||
      !process.env.REPOPILOT_LLM_BASE_URL ||
      !process.env.REPOPILOT_LLM_MODEL
    ) {
      console.log(
        "SKIPPED: live LLM smoke requires explicit provider configuration.",
      );
    } else {
      const state = await runResearch({
        runId: "live-smoke",
        repository: "langgenius/dify",
        profile: {
          skills: ["TypeScript", "Python"],
          weeks: 2,
          goal: "portfolio",
        },
        mode: "live",
        client,
        provider: new LiveProvider(signal),
        signal,
      });
      console.log(
        JSON.stringify(
          {
            status: state.finalReport ? "PASS" : "FAIL",
            opportunities: state.finalReport?.opportunities.length,
            githubCalls: client.calls,
            warnings: state.finalReport?.warnings,
          },
          null,
          2,
        ),
      );
    }
  } else {
    const repo = await client.getRepositoryMetadata("langgenius", "dify");
    const readme = await client.getReadme("langgenius", "dify");
    const issues = await client.getIssues("langgenius", "dify", {
      maxItems: 3,
    });
    if (!readme || issues.length < 3)
      throw new Error("Insufficient sources for three-reference smoke");
    for (const e of issues) {
      const detail = await client.getSpecificIssue(
        "langgenius",
        "dify",
        e.metadata.number!,
      );
      if (
        !detail ||
        detail.sourceTitle !== e.sourceTitle ||
        detail.sourceUrl !== e.sourceUrl
      )
        throw new Error("Reference mismatch");
      console.log(
        `PASS public issue ${detail.sourceUrl} — ${detail.sourceTitle}`,
      );
    }
    console.log(
      `PASS public repository ${repo.fullName}, README and ${issues.length} issue references; ${client.calls} GitHub requests. LLM NOT tested.`,
    );
  }
}
main().catch((error) => {
  console.error(
    `FAIL: ${error instanceof Error ? error.message : "Smoke test failed"}`,
  );
  process.exitCode = 1;
});
