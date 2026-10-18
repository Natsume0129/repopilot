import { z } from "zod";

export function normalizeGitHubRepo(input: string) {
  const value = input
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  const match =
    /^(?:https:\/\/github\.com\/)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))\/([a-zA-Z0-9_.-]{1,100})$/i.exec(
      value,
    );
  if (!match || match[2] === "." || match[2] === "..") {
    throw new Error(
      "请输入 https://github.com/owner/repo 或 owner/repo，不含查询参数或额外路径。",
    );
  }
  const owner = match[1].toLowerCase();
  const repo = match[2].toLowerCase();
  return { owner, repo, fullName: `${owner}/${repo}` };
}

export const profileSchema = z.object({
  skills: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  weeks: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  goal: z.enum(["portfolio", "learning", "utility"]),
});
export const createRunSchema = z.object({
  repository: z
    .string()
    .max(200)
    .transform((value, ctx) => {
      try {
        return normalizeGitHubRepo(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "无效的公开 GitHub 仓库地址" });
        return z.NEVER;
      }
    }),
  profile: profileSchema,
});
