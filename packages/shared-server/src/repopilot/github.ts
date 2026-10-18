import { z } from "zod";
import { readBoundedResponse } from "./transport";
import { normalizeGitHubRepo } from "@karakeep/shared/repopilot/input";
import type { Evidence, RepoMetadata } from "@karakeep/shared/repopilot/types";

import { ResearchError } from "./errors";
export { ResearchError } from "./errors";
const repositorySchema = z.object({
  full_name: z.string(),
  private: z.boolean(),
  description: z.string().nullable(),
  stargazers_count: z.number(),
  language: z.string().nullable(),
  archived: z.boolean(),
  topics: z.array(z.string()).default([]),
});
const issueSchema = z.object({
  id: z.number(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
});
const releaseSchema = z.object({
  id: z.number(),
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable(),
  published_at: z.string().nullable(),
  html_url: z.string(),
});

export function safeSourceUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new ResearchError("INVALID_SOURCE", "来源链接不符合 GitHub 白名单");
  return url.href;
}

export class GitHubClient {
  calls = 0;
  private cache = new Map<string, unknown>();
  private publicRepos = new Set<string>();
  constructor(
    private options: {
      fetcher?: typeof fetch;
      maxCalls?: number;
      deadline?: number;
      signal?: AbortSignal;
      token?: string;
      sleep?: (ms: number) => Promise<void>;
      onCall?: (path: string) => void;
    } = {},
  ) {}

  async request(path: string, optional = false): Promise<unknown> {
    if (
      !/^\/(repos\/|search\/repositories\?)/.test(path) ||
      path.includes("..") ||
      path.includes("\\")
    )
      throw new ResearchError("INVALID_TOOL", "不允许的 GitHub API 路径");
    if (this.cache.has(path)) return this.cache.get(path);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (
        this.options.signal?.aborted ||
        Date.now() >= (this.options.deadline ?? Infinity)
      )
        throw new ResearchError("TIMEOUT", "研究已超时，请重试");
      if (this.calls >= Math.min(24, this.options.maxCalls ?? 24))
        throw new ResearchError("GITHUB_BUDGET", "已达到 GitHub 请求上限");
      this.calls++;
      this.options.onCall?.(path);
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(
          Math.max(
            1,
            Math.min(15000, (this.options.deadline ?? Infinity) - Date.now()),
          ),
        );
        response = await (this.options.fetcher ?? fetch)(
          `https://api.github.com${path}`,
          {
            redirect: "error",
            signal: this.options.signal
              ? AbortSignal.any([this.options.signal, timeout])
              : timeout,
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "RepoPilot",
              "X-GitHub-Api-Version": "2022-11-28",
              ...(this.options.token
                ? { Authorization: `Bearer ${this.options.token}` }
                : {}),
            },
          },
        );
      } catch {
        throw new ResearchError(
          "GITHUB_NETWORK",
          "GitHub 连接失败或超时，请稍后重试",
        );
      }
      if (response.status === 404 && optional) {
        this.cache.set(path, null);
        return null;
      }
      if (response.status === 403 || response.status === 429) {
        const retry = response.headers.get("retry-after");
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        const wait = Math.max(
          1000 * 2 ** attempt,
          retry
            ? Number.isFinite(Number(retry))
              ? Number(retry) * 1000
              : Date.parse(retry) - Date.now()
            : 0,
          reset > Date.now() ? reset - Date.now() : 0,
        );
        if (
          attempt === 2 ||
          !Number.isFinite(wait) ||
          Date.now() + wait >= (this.options.deadline ?? Date.now() + 30000)
        )
          throw new ResearchError(
            "GITHUB_RATE_LIMIT",
            `GitHub 限流，请在 ${Math.ceil(wait / 1000) || 60} 秒后重试`,
          );
        await (
          this.options.sleep ??
          ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
        )(wait);
        continue;
      }
      if (!response.ok)
        throw new ResearchError(
          "GITHUB_HTTP",
          response.status === 404
            ? "公开仓库不存在或不可访问"
            : `GitHub 请求失败（${response.status}）`,
        );
      const body = await readBoundedResponse(response, 2_000_000);
      if (body.length > 2_000_000)
        throw new ResearchError("SOURCE_TOO_LARGE", "GitHub 响应超过采集上限");
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        throw new ResearchError("INVALID_SOURCE", "GitHub 响应格式错误");
      }
      this.cache.set(path, value);
      return value;
    }
    throw new ResearchError("GITHUB_RATE_LIMIT", "GitHub 限流，请稍后重试");
  }

  private full(owner: string, repo: string) {
    return normalizeGitHubRepo(`${owner}/${repo}`).fullName;
  }
  async getRepositoryMetadata(
    owner: string,
    repo: string,
  ): Promise<RepoMetadata> {
    const full = this.full(owner, repo);
    const data = repositorySchema.parse(await this.request(`/repos/${full}`));
    if (data.private) throw new ResearchError("PRIVATE_REPO", "仅支持公开仓库");
    this.publicRepos.add(full);
    return {
      fullName: full,
      url: `https://github.com/${full}`,
      description: data.description ?? "",
      stars: data.stargazers_count,
      language: data.language ?? "unknown",
      archived: data.archived,
      topics: data.topics,
      fetchedAt: new Date().toISOString(),
    };
  }
  private async ensurePublic(owner: string, repo: string) {
    if (!this.publicRepos.has(this.full(owner, repo)))
      await this.getRepositoryMetadata(owner, repo);
  }
  private evidence(
    full: string,
    type: Evidence["sourceType"],
    id: string,
    title: string,
    excerpt: string,
    url: string,
    metadata: Evidence["metadata"] = {},
  ): Evidence {
    return {
      id: `${full}:${type}:${id}`,
      sourceType: type,
      externalId: id,
      sourceTitle: title.slice(0, 300),
      excerpt: excerpt.slice(0, type === "repo_readme" ? 20000 : 1200),
      sourceUrl: safeSourceUrl(url),
      repoFullName: full,
      fetchedAt: new Date().toISOString(),
      metadata,
    };
  }
  async getReadme(owner: string, repo: string): Promise<Evidence | null> {
    await this.ensurePublic(owner, repo);
    const full = this.full(owner, repo);
    const raw = await this.request(`/repos/${full}/readme`, true);
    if (!raw) return null;
    const data = z
      .object({
        content: z.string(),
        encoding: z.literal("base64"),
        html_url: z.string(),
      })
      .parse(raw);
    return this.evidence(
      full,
      "repo_readme",
      "readme",
      "README",
      Buffer.from(data.content, "base64").toString("utf8"),
      data.html_url,
    );
  }
  async getIssues(
    owner: string,
    repo: string,
    options: { maxItems?: number } = {},
  ): Promise<Evidence[]> {
    await this.ensurePublic(owner, repo);
    const full = this.full(owner, repo),
      max = Math.min(100, Math.max(0, options.maxItems ?? 100));
    const result = new Map<string, Evidence>();
    for (let page = 1; page <= 5 && result.size < max; page++) {
      const items = z
        .array(issueSchema)
        .parse(
          await this.request(
            `/repos/${full}/issues?state=all&sort=updated&direction=desc&per_page=30&page=${page}`,
          ),
        );
      for (const item of items)
        if (!item.pull_request && result.size < max) {
          const e = this.issueEvidence(full, item);
          result.set(e.id, e);
        }
      if (items.length < 30) break;
    }
    return [...result.values()];
  }
  private issueEvidence(full: string, item: z.infer<typeof issueSchema>) {
    return this.evidence(
      full,
      "issue",
      String(item.id),
      item.title,
      item.body ?? "",
      `https://github.com/${full}/issues/${item.number}`,
      { state: item.state, updatedAt: item.updated_at, number: item.number },
    );
  }
  async getSpecificIssue(owner: string, repo: string, number: number) {
    if (!Number.isSafeInteger(number) || number <= 0)
      throw new ResearchError("INVALID_TOOL", "无效 issue 编号");
    await this.ensurePublic(owner, repo);
    const full = this.full(owner, repo),
      raw = await this.request(`/repos/${full}/issues/${number}`, true);
    if (!raw) return null;
    const item = issueSchema.parse(raw);
    return item.pull_request ? null : this.issueEvidence(full, item);
  }
  async getReleases(
    owner: string,
    repo: string,
    maxItems = 10,
  ): Promise<Evidence[]> {
    await this.ensurePublic(owner, repo);
    const full = this.full(owner, repo);
    const items = z
      .array(releaseSchema)
      .parse(
        (await this.request(
          `/repos/${full}/releases?per_page=${Math.min(10, Math.max(1, maxItems))}`,
          true,
        )) ?? [],
      );
    return items
      .slice(0, maxItems)
      .map((item) =>
        this.evidence(
          full,
          "release",
          String(item.id),
          item.name ?? item.tag_name,
          item.body ?? "",
          item.html_url,
          { publishedAt: item.published_at ?? undefined },
        ),
      );
  }
  async searchRelatedRepositories(
    query: string,
    options: { maxItems?: number } = {},
  ): Promise<RepoMetadata[]> {
    const max = Math.min(3, Math.max(1, options.maxItems ?? 2));
    const data = z
      .object({ items: z.array(repositorySchema) })
      .parse(
        await this.request(
          `/search/repositories?q=${encodeURIComponent(query.slice(0, 160) + " is:public")}&per_page=${max}`,
        ),
      );
    return data.items
      .filter((r) => !r.private)
      .slice(0, max)
      .map((r) => ({
        fullName: normalizeGitHubRepo(r.full_name).fullName,
        url: `https://github.com/${normalizeGitHubRepo(r.full_name).fullName}`,
        description: r.description ?? "",
        stars: r.stargazers_count,
        language: r.language ?? "unknown",
        archived: r.archived,
        topics: r.topics,
        fetchedAt: new Date().toISOString(),
      }));
  }
  async getDirectorySummary(owner: string, repo: string) {
    await this.ensurePublic(owner, repo);
    const data = z
      .array(z.object({ name: z.string(), type: z.string(), size: z.number() }))
      .parse(
        (await this.request(
          `/repos/${this.full(owner, repo)}/contents`,
          true,
        )) ?? [],
      );
    return data
      .slice(0, 50)
      .map((x) => ({ name: x.name.slice(0, 100), type: x.type, size: x.size }));
  }
}
