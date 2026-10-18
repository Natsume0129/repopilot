"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRunSchema } from "@karakeep/shared/repopilot/input";

export const statusLabels: Record<string, string> = {
  queued: "排队中",
  running: "研究中",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};
export default function ResearchHome({ mode }: { mode: "mock" | "live" }) {
  const api = useTRPC(),
    router = useRouter();
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<number | undefined>();
  const runs = useQuery(
    api.repopilot.listRuns.queryOptions(
      { limit: 20, cursor },
      {
        refetchInterval: (query) =>
          query.state.data?.items.some((r) =>
            ["queued", "running"].includes(r.status),
          )
            ? 2500
            : false,
      },
    ),
  );
  const create = useMutation(
    api.repopilot.createRun.mutationOptions({
      onSuccess: ({ runId }) => router.push(`/repopilot/runs/${runId}`),
      onError: (e) => setError(e.message),
    }),
  );
  const remove = useMutation(
    api.repopilot.deleteRun.mutationOptions({
      onSuccess: () => {
        void runs.refetch();
      },
      onError: (e) => setError(e.message),
    }),
  );
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <h1 className="text-2xl font-bold">RepoPilot / AI 产品创新</h1>
      <p>从真实用户痛点与相关 AI 技术中，寻找适合你的开源创新机会。</p>
      <p className="rounded border bg-muted p-3">
        {mode === "mock"
          ? "演示模式：使用录制的 Dify 静态数据和确定性模型，不调用外部 API。仅支持 langgenius/dify。"
          : "Live 模式：从 GitHub 采集公开数据，并调用服务端配置的模型。"}
      </p>
      <form
        className="space-y-4 rounded border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          const form = new FormData(event.currentTarget);
          const raw = {
            repository: String(form.get("repository")),
            profile: {
              skills: [
                ...form.getAll("skills").map(String),
                ...String(form.get("extraSkills") ?? "")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              ],
              weeks: Number(form.get("weeks")),
              goal: String(form.get("goal")),
            },
          };
          const valid = createRunSchema.safeParse(raw);
          if (!valid.success) {
            setError(valid.error.issues[0].message);
            return;
          }
          create.mutate({
            repository: raw.repository,
            profile: valid.data.profile,
          });
        }}
      >
        <label className="block">
          公开 GitHub 仓库
          <Input
            name="repository"
            placeholder="https://github.com/langgenius/dify"
            required
            maxLength={200}
          />
        </label>
        <fieldset>
          <legend>个人技术栈（至少一项）</legend>
          <div className="flex flex-wrap gap-4">
            {[
              "Python",
              "TypeScript",
              "React",
              "Next.js",
              "FastAPI",
              "LangChain",
            ].map((skill) => (
              <label key={skill}>
                <input
                  type="checkbox"
                  name="skills"
                  value={skill}
                  defaultChecked={skill === "TypeScript"}
                />{" "}
                {skill}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          其他技能（逗号分隔）
          <Input name="extraSkills" maxLength={200} />
        </label>
        <div className="flex flex-wrap gap-6">
          <label>
            开发周期{" "}
            <select
              name="weeks"
              defaultValue="2"
              className="rounded border bg-background p-2"
            >
              {[1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 周
                </option>
              ))}
            </select>
          </label>
          <label>
            目标{" "}
            <select name="goal" className="rounded border bg-background p-2">
              <option value="portfolio">作品集</option>
              <option value="learning">学习</option>
              <option value="utility">实用工具</option>
            </select>
          </label>
        </div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "正在创建任务…" : "开始研究"}
        </Button>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </form>
      <h2 className="text-xl font-semibold">最近研究</h2>
      {runs.isPending && <p role="status">正在加载历史…</p>}
      {runs.error && <p role="alert">无法加载历史：{runs.error.message}</p>}
      {runs.data?.items.length === 0 && <p>暂无研究任务。</p>}
      <ul className="space-y-3">
        {runs.data?.items.map((run) => (
          <li
            key={run.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
          >
            <div className="min-w-0 break-words">
              <Link className="underline" href={`/repopilot/runs/${run.id}`}>
                {run.repoFullName}
              </Link>
              <p className="text-sm text-muted-foreground">
                {statusLabels[run.status]} · {run.progress}% ·{" "}
                {run.mode === "mock" ? "演示" : "Live"} ·{" "}
                {new Date(run.createdAt).toLocaleString()}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm("删除此研究及其证据、反馈？"))
                  remove.mutate({ id: run.id });
              }}
            >
              删除
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-3">
        {cursor && (
          <Button variant="outline" onClick={() => setCursor(undefined)}>
            返回最新
          </Button>
        )}
        {runs.data?.nextCursor && (
          <Button
            variant="outline"
            onClick={() => setCursor(runs.data!.nextCursor)}
          >
            下一页
          </Button>
        )}
      </div>
    </main>
  );
}
