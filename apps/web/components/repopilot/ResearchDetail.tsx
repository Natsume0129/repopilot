"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  reportSchema,
  reportMarkdown,
} from "@karakeep/shared/repopilot/report";
import type { Trace } from "@karakeep/shared/repopilot/types";
import { Button } from "@/components/ui/button";
import { statusLabels } from "./ResearchHome";

const stages: Record<string, string> = {
  queued: "等待 worker",
  validate_input: "验证输入",
  fetch_repo_context: "采集仓库",
  extract_pain_points: "分析痛点",
  discover_ai_technologies: "检索相关技术",
  evidence_gap_check: "检查证据缺口",
  targeted_supplement: "定向补充检索",
  generate_ideas: "生成创新方向",
  verify_and_score: "校验引用与评分",
  persist_report: "准备保存报告",
  done: "完成",
};
export default function ResearchDetail({ id }: { id: string }) {
  const api = useTRPC(),
    router = useRouter();
  const [notice, setNotice] = useState("");
  const run = useQuery(
    api.repopilot.getRun.queryOptions(
      { id },
      {
        retry: (attempt, error) =>
          !["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN", "BAD_REQUEST"].includes(
            error.data?.code ?? "",
          ) && attempt < 2,
        refetchInterval: (q) =>
          q.state.data && ["queued", "running"].includes(q.state.data.status)
            ? 2000
            : false,
      },
    ),
  );
  const save = useMutation(
    api.repopilot.saveBookmark.mutationOptions({
      onSuccess: () => {
        setNotice("已保存到 Karakeep");
        void run.refetch();
      },
      onError: (e) => setNotice(e.message),
    }),
  );
  const feedback = useMutation(
    api.repopilot.submitFeedback.mutationOptions({
      onSuccess: () => {
        setNotice("反馈已保存");
        void run.refetch();
      },
      onError: (e) => setNotice(e.message),
    }),
  );
  const retry = useMutation(
    api.repopilot.retryRun.mutationOptions({
      onSuccess: ({ runId }) => router.push(`/repopilot/runs/${runId}`),
      onError: (e) => setNotice(e.message),
    }),
  );
  const track = useMutation(api.repopilot.trackEvent.mutationOptions());
  const reportResult = reportSchema.safeParse(
    run.data?.reportJson ? JSON.parse(run.data.reportJson) : null,
  );
  const report = reportResult.success ? reportResult.data : null;
  const recordEvent = track.mutate;
  useEffect(() => {
    if (run.data?.reportJson)
      recordEvent({ id, name: "repopilot_opportunity_viewed" });
  }, [id, run.data?.reportJson, recordEvent]);
  if (run.isPending)
    return (
      <p role="status" className="p-6">
        正在加载研究…
      </p>
    );
  if (run.error || !run.data)
    return (
      <div className="space-y-4 p-6">
        <p role="alert">{run.error?.message ?? "研究不存在"}</p>
        <Link href="/repopilot">返回研究列表</Link>
      </div>
    );
  const data = run.data,
    trace = JSON.parse(data.traceJson) as Trace[];
  const exportReport = async (copy: boolean) => {
    if (!report) return;
    try {
      const markdown = reportMarkdown(report);
      if (copy) await navigator.clipboard.writeText(markdown);
      else {
        const url = URL.createObjectURL(
          new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `repopilot-${data.repoFullName.replace("/", "-")}.md`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      track.mutate({ id, name: "repopilot_report_exported" });
      setNotice(copy ? "Markdown 已复制" : "Markdown 已下载");
    } catch {
      setNotice("导出失败，请尝试下载 Markdown");
    }
  };
  const references = (ids: string[]) =>
    ids.map((e) => {
      const r = report?.references.find((r) => r.evidenceId === e);
      return r ? (
        <details key={e}>
          <summary>
            <a
              className="underline"
              href={r.url}
              target="_blank"
              rel="noreferrer"
              onClick={() =>
                track.mutate({ id, name: "repopilot_evidence_clicked" })
              }
            >
              {r.title}
            </a>{" "}
            · {r.state ?? r.type}
          </summary>
          <p className="whitespace-pre-wrap">{r.excerpt.slice(0, 1200)}</p>
          <p>
            采集：{r.fetchedAt} · 更新时间：{r.date ?? "未知"}
          </p>
        </details>
      ) : null;
    });
  return (
    <main className="mx-auto max-w-5xl space-y-6 break-words p-4 sm:p-8">
      <Link href="/repopilot" className="underline">
        返回研究列表
      </Link>
      <h1 className="text-2xl font-bold">{data.repoFullName} · 研究报告</h1>
      <p className="rounded border bg-muted p-3">
        {data.mode === "mock"
          ? `演示模式 · 录制夹具 ${report?.fixtureRecordedAt ?? ""} · 非实时研究`
          : "Live 模式"}
      </p>
      <div role="status" className="space-y-2">
        <p>
          {statusLabels[data.status]} · {stages[data.stage] ?? data.stage} ·{" "}
          {data.progress}%（阶段进度）
        </p>
        <progress
          className="w-full"
          value={data.progress}
          max={100}
          aria-label="研究阶段进度"
        />
      </div>
      {data.status === "queued" && (
        <p>等待后台 worker；若长时间未开始，请确认 workers 正在运行。</p>
      )}
      {data.errorMessage && (
        <p role="alert" className="rounded border p-3 text-destructive">
          {data.errorMessage}（{data.errorCode}）
        </p>
      )}
      {data.status === "partial" && (
        <p role="alert">部分完成：请查看下方采集限制和证据警告。</p>
      )}
      {["failed", "partial"].includes(data.status) && (
        <Button disabled={retry.isPending} onClick={() => retry.mutate({ id })}>
          重新研究
        </Button>
      )}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Agent 执行轨迹</h2>
        <p className="text-sm text-muted-foreground">
          实际节点、耗时及请求数；不展示模型内部推理。
        </p>
        <ol className="space-y-2">
          {trace.map((t, i) => (
            <li key={i} className="rounded border p-2">
              {stages[t.node] ?? t.node} ·{" "}
              {t.outcome === "ok" ? "成功" : "失败"} · {t.durationMs}ms · GitHub{" "}
              {t.githubCalls} / 模型 {t.llmCalls}
            </li>
          ))}
        </ol>
      </section>
      {report && (
        <>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">仓库概览</h2>
            <a
              href={report.repository.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              在 GitHub 查看原项目
            </a>
            <p>{report.repository.description}</p>
            <p>
              {report.repository.language} · Stars {report.repository.stars}
              （仅作元数据）
            </p>
            <p>{report.executiveSummary}</p>
            <p>
              已有能力（项目自述 / 模型整理）：
              {report.existingCapabilities.join("；")}
            </p>
            <p>
              采样：{report.sampling.issueCount} 条 issue；
              {report.sampling.rule}
            </p>
            <p>
              样本更新时间：{report.sampling.from ?? "未知"} —{" "}
              {report.sampling.to ?? "未知"}
            </p>
          </section>
          <section className="space-y-2 rounded border p-4">
            <h2 className="font-semibold">证据与使用边界</h2>
            <p>AI 生成建议，仅供进一步研究；部分判断需要用户验证。</p>
            <ul className="list-inside list-disc">
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </section>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">用户痛点</h2>
            {report.painPoints.map((p) => (
              <article key={p.id} className="rounded border p-4">
                <h3 className="font-semibold">{p.title}</h3>
                <p>{p.summary}</p>
                <p>
                  样本 {p.sampleSize} · 置信度 {p.confidence}
                </p>
                {references(p.evidenceIds)}
              </article>
            ))}
          </section>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">相关技术来源</h2>
            {report.technologySignals.map((s) => (
              <div key={s.name}>
                <h3 className="font-semibold">{s.name}</h3>
                <p>{s.reasonRelevant}</p>
                <p>发布日期：{s.freshnessDate ?? "未知，仅视为相关方向"}</p>
                {references(s.sourceEvidenceIds)}
              </div>
            ))}
          </section>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              创新机会（{report.opportunities.length}）
            </h2>
            {report.opportunities.map((o) => (
              <article
                key={o.id}
                data-testid="opportunity"
                className="space-y-3 rounded-lg border p-4 sm:p-6"
              >
                <h3 className="text-lg font-semibold">{o.title}</h3>
                <p>目标用户：{o.targetUser}</p>
                <p>痛点：{o.problem}</p>
                <p>方案：{o.solution}</p>
                <p>AI 技术：{o.aiTechnology}</p>
                <p>已有方案：{o.whatExistsAlready}</p>
                <p>差异：{o.differentiator}</p>
                <p>时机：{o.whyNow}</p>
                <h4 className="font-semibold">最小 MVP</h4>
                <ul className="list-inside list-disc">
                  {o.mvpFeatures.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
                <p>验证实验：{o.validationExperiment}</p>
                <p>目标指标（未实测）：{o.successMetric}</p>
                <p>工作量估算：{o.estimatedEffort}</p>
                <p className="font-semibold">
                  启发式评分 {o.scores.total}/100 · 置信度 {o.confidence}
                </p>
                <p>
                  痛点 {o.scores.userPain}/30 · 未满足 {o.scores.unmetNeed}/20 ·
                  AI 匹配 {o.scores.technologyFit}/20 · 可行性{" "}
                  {o.scores.personalFeasibility}/15 · 差异{" "}
                  {o.scores.differentiation}/15
                </p>
                <p>{o.scoreExplanation}</p>
                <p>风险：{o.risks.join("；")}</p>
                <p>待验证假设：{o.assumptions.join("；")}</p>
                <h4 className="font-semibold">证据链接</h4>
                {references(o.evidenceIds)}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={feedback.isPending}
                    onClick={() =>
                      feedback.mutate({
                        runId: id,
                        opportunityId: o.id,
                        rating: "helpful",
                      })
                    }
                  >
                    有帮助
                  </Button>
                  <Button
                    variant="outline"
                    disabled={feedback.isPending}
                    onClick={() =>
                      feedback.mutate({
                        runId: id,
                        opportunityId: o.id,
                        rating: "unhelpful",
                      })
                    }
                  >
                    没帮助
                  </Button>
                  <Button
                    variant="outline"
                    disabled={feedback.isPending}
                    onClick={() =>
                      feedback.mutate({
                        runId: id,
                        opportunityId: o.id,
                        adopted: true,
                      })
                    }
                  >
                    标记采纳
                  </Button>
                </div>
                {data.feedback
                  .filter((f) => f.opportunityId === o.id)
                  .map((f) => (
                    <p key={f.id}>
                      已记录：
                      {f.rating === "helpful"
                        ? "有帮助"
                        : f.rating === "unhelpful"
                          ? "没帮助"
                          : ""}{" "}
                      {f.adopted ? "已采纳" : ""}
                    </p>
                  ))}
              </article>
            ))}
          </section>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (window.confirm("将原 GitHub 仓库保存到 Karakeep？"))
                  save.mutate({ id });
              }}
            >
              {data.bookmarkId
                ? "已收藏 · 再次确认"
                : "保存 GitHub 项目到 Karakeep"}
            </Button>
            <Button variant="outline" onClick={() => void exportReport(true)}>
              复制 Markdown
            </Button>
            <Button variant="outline" onClick={() => void exportReport(false)}>
              下载 Markdown
            </Button>
          </div>
          {data.inputTokens !== null && (
            <p>
              模型用量：输入 {data.inputTokens} / 输出{" "}
              {data.outputTokens ?? "未知"} tokens；费用未估算。
            </p>
          )}
          {data.startedAt && data.completedAt && (
            <p>
              实际任务耗时：
              {((data.completedAt - data.startedAt) / 1000).toFixed(1)} 秒
            </p>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </main>
  );
}
