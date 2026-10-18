// Explicit maintainer tool: only public GitHub data, no credentials are used.
import { mkdir, writeFile } from "node:fs/promises";
const paths = [
  "/repos/langgenius/dify",
  "/repos/langgenius/dify/readme",
  "/repos/langgenius/dify/issues?state=all&sort=updated&direction=desc&per_page=30&page=1",
  "/repos/langgenius/dify/releases?per_page=10",
  "/repos/langgenius/dify/contents",
  "/repos/langchain-ai/langgraph",
  "/repos/langchain-ai/langgraph/readme",
  "/repos/langchain-ai/langgraph/releases?per_page=5",
];
const responses = {};
for (const path of paths) {
  const response = await fetch(`https://api.github.com${path}`, {
    redirect: "error",
    headers: { "User-Agent": "RepoPilot-fixture-recorder" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${path}`);
  const data = await response.json();
  const clean = (value) => {
    const allowed = [
      "id",
      "number",
      "title",
      "body",
      "state",
      "updated_at",
      "pull_request",
      "full_name",
      "private",
      "description",
      "stargazers_count",
      "language",
      "archived",
      "topics",
      "content",
      "encoding",
      "html_url",
      "name",
      "type",
      "size",
      "tag_name",
      "published_at",
    ];
    const item = Object.fromEntries(
      Object.entries(value).filter(([key]) => allowed.includes(key)),
    );
    if (typeof item.body === "string") item.body = item.body.slice(0, 1200);
    if (item.content)
      item.content = Buffer.from(
        Buffer.from(item.content, "base64").toString("utf8").slice(0, 20000),
      ).toString("base64");
    if (item.pull_request) item.pull_request = {};
    return item;
  };
  responses[path] = Array.isArray(data) ? data.map(clean) : clean(data);
}
const issues = responses[paths[2]].filter((x) => !x.pull_request).slice(0, 6);
responses[paths[2]] = issues;
for (const issue of issues)
  responses[`/repos/langgenius/dify/issues/${issue.number}`] = issue;
await mkdir("packages/shared-server/src/repopilot/fixtures", {
  recursive: true,
});
await writeFile(
  "packages/shared-server/src/repopilot/fixtures/github.json",
  JSON.stringify({ recordedAt: new Date().toISOString(), responses }, null, 2),
);
console.log(
  `Recorded ${paths.length} public endpoints; ${issues.length} issue fixtures; personal author data excluded.`,
);
