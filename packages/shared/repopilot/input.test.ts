import { expect, test } from "vitest";
import { normalizeGitHubRepo } from "./input";

test.each([
  "Owner/Repo",
  "https://github.com/Owner/Repo.git",
  "https://github.com/Owner/Repo/",
])("normalizes %s", (input) => {
  expect(normalizeGitHubRepo(input).fullName).toBe("owner/repo");
});
test.each([
  "",
  "https://evil.com/a/b",
  "https://github.com.evil.com/a/b",
  "a/b/issues",
  "a/..",
  "a/b?x=1",
  "a/b#x",
  "http://github.com/a/b",
  "a/%2e%2e",
  "https://user@github.com/a/b",
])("rejects %s", (input) => {
  expect(() => normalizeGitHubRepo(input)).toThrow();
});
