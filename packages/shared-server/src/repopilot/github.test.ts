import { expect, test, vi } from "vitest";
import { GitHubClient, safeSourceUrl } from "./github";
import { fixtureFetch, fixtureResponses } from "./fixtures";

test("recorded public repository, readme, issues, releases, directory and cache", async () => {
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("network forbidden"));
  try {
    const client = new GitHubClient({ fetcher: fixtureFetch });
    expect(
      (await client.getRepositoryMetadata("langgenius", "dify")).fullName,
    ).toBe("langgenius/dify");
    expect((await client.getReadme("langgenius", "dify"))?.excerpt).toContain(
      "Dify",
    );
    const issues = await client.getIssues("langgenius", "dify");
    expect(issues.length).toBeGreaterThan(0);
    expect(
      issues.every(
        (e) => e.excerpt.length <= 1200 && e.metadata.state && e.fetchedAt,
      ),
    ).toBe(true);
    expect(
      (await client.getReleases("langgenius", "dify")).length,
    ).toBeGreaterThan(0);
    expect(
      (await client.getDirectorySummary("langgenius", "dify")).length,
    ).toBeGreaterThan(0);
    const calls = client.calls;
    await client.getReadme("langgenius", "dify");
    expect(client.calls).toBe(calls);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
test("PR filtering, pagination, dedup and empty issues", async () => {
  const issue = {
    id: 1,
    number: 1,
    title: "Issue",
    body: "x".repeat(1500),
    state: "closed",
    updated_at: "2026-10-01",
  };
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const u = new URL(String(input));
    if (!u.pathname.endsWith("issues")) return fixtureFetch(input);
    return Response.json(
      u.searchParams.get("page") === "1"
        ? [
            ...Array.from({ length: 29 }, (_, i) => ({
              ...issue,
              id: i + 1,
              number: i + 1,
            })),
            { ...issue, id: 30, pull_request: {} },
          ]
        : [
            { ...issue, id: 1 },
            { ...issue, id: 31, number: 31 },
          ],
    );
  });
  const result = await new GitHubClient({ fetcher }).getIssues(
    "langgenius",
    "dify",
  );
  expect(result).toHaveLength(30);
  expect(
    result.every(
      (e) => e.metadata.state === "closed" && e.excerpt.length === 1200,
    ),
  ).toBe(true);
  expect(
    await new GitHubClient({
      fetcher: async (input) =>
        String(input).includes("/issues?")
          ? Response.json([])
          : fixtureFetch(input),
    }).getIssues("langgenius", "dify"),
  ).toEqual([]);
});
test("missing README, private repositories, redirect failures and host whitelist", async () => {
  const client = new GitHubClient({
    fetcher: async (input) =>
      String(input).endsWith("/readme")
        ? new Response(null, { status: 404 })
        : fixtureFetch(input),
  });
  expect(await client.getReadme("langgenius", "dify")).toBeNull();
  const privateClient = new GitHubClient({
    fetcher: async () =>
      Response.json({
        ...(fixtureResponses["/repos/langgenius/dify"] as object),
        private: true,
      }),
  });
  await expect(
    privateClient.getReadme("langgenius", "dify"),
  ).rejects.toMatchObject({ code: "PRIVATE_REPO" });
  expect(privateClient.calls).toBe(1);
  await expect(client.request("//evil.com/x")).rejects.toThrow();
  expect(() => safeSourceUrl("https://github.com.evil.com/a/b")).toThrow();
  const redirect = new GitHubClient({
    fetcher: async (_input, options) => {
      expect(options?.redirect).toBe("error");
      throw new Error("redirect");
    },
  });
  await expect(redirect.getRepositoryMetadata("a", "b")).rejects.toMatchObject({
    code: "GITHUB_NETWORK",
  });
});
test("bounded retries honor Retry-After, budget and deadline", async () => {
  let calls = 0;
  const sleep = vi.fn(async () => {
    return undefined;
  });
  const client = new GitHubClient({
    sleep,
    fetcher: async (input) =>
      ++calls === 1
        ? new Response(null, { status: 429, headers: { "Retry-After": "2" } })
        : fixtureFetch(input),
  });
  await client.getRepositoryMetadata("langgenius", "dify");
  expect(sleep).toHaveBeenCalledWith(2000);
  const limited = new GitHubClient({
    sleep,
    fetcher: async () => new Response(null, { status: 429 }),
    maxCalls: 2,
  });
  await expect(limited.getRepositoryMetadata("a", "b")).rejects.toMatchObject({
    code: "GITHUB_BUDGET",
  });
  expect(limited.calls).toBe(2);
  await expect(
    new GitHubClient({ deadline: Date.now() - 1 }).getRepositoryMetadata(
      "a",
      "b",
    ),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
});
