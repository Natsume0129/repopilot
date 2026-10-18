export interface Evidence {
  id: string;
  sourceType:
    | "repo_readme"
    | "issue"
    | "release"
    | "tech_repo"
    | "competitor_repo";
  sourceUrl: string;
  sourceTitle: string;
  excerpt: string;
  fetchedAt: string;
  externalId: string;
  repoFullName: string;
  metadata: {
    state?: string;
    updatedAt?: string;
    publishedAt?: string;
    number?: number;
  };
}
export interface RepoMetadata {
  fullName: string;
  url: string;
  description: string;
  stars: number;
  language: string;
  archived: boolean;
  topics: string[];
  fetchedAt: string;
}
export interface Trace {
  node: string;
  durationMs: number;
  outcome: "ok" | "error";
  githubCalls: number;
  llmCalls: number;
}
