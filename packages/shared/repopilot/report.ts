import { z } from "zod";
const text = z.string().min(1).max(1800);
const list = z.array(text).max(12);
const ids = z.array(z.string().max(200)).max(20);
const sourceUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    );
  }, "Only collected official GitHub sources are supported");
export const confidenceSchema = z.enum(["high", "medium", "low"]);
export const painSchema = z.object({
  id: z.string().max(80),
  title: text,
  summary: text,
  evidenceIds: ids,
  sampleSize: z.number().int().min(0).max(100),
  confidence: confidenceSchema,
});
export const scoresSchema = z.object({
  userPain: z.number().min(0).max(30),
  unmetNeed: z.number().min(0).max(20),
  technologyFit: z.number().min(0).max(20),
  personalFeasibility: z.number().min(0).max(15),
  differentiation: z.number().min(0).max(15),
  total: z.number().min(0).max(100),
});
export const opportunitySchema = z.object({
  id: z.string().min(1).max(80),
  painPointId: z.string().max(80),
  title: text,
  targetUser: text,
  problem: text,
  solution: text,
  aiTechnology: text,
  whyNow: text,
  whatExistsAlready: text,
  differentiator: text,
  mvpFeatures: list.min(1),
  validationExperiment: text,
  successMetric: text,
  estimatedEffort: z.enum(["small", "medium", "large"]),
  risks: list,
  evidenceIds: ids,
  assumptions: list,
  scores: scoresSchema,
  scoreExplanation: text,
  confidence: confidenceSchema,
});
export const draftSchema = z.object({
  executiveSummary: text,
  existingCapabilities: list,
  opportunities: z.array(opportunitySchema).max(3),
});
export const painOutputSchema = z.object({
  painPoints: z.array(painSchema).max(8),
});
export const toolSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("issue"), number: z.number().int().positive() }),
  z.object({ tool: z.literal("readme") }),
  z.object({ tool: z.literal("releases") }),
  z.object({ tool: z.literal("search"), query: z.string().min(1).max(160) }),
]);
export const planSchema = z.object({
  searchQueries: z.array(z.string().min(1).max(160)).min(1).max(2),
  supplement: toolSchema,
  reason: text,
});
export const reportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  mode: z.enum(["mock", "live"]),
  fixtureRecordedAt: z.string().optional(),
  repository: z.object({
    fullName: z.string(),
    url: sourceUrl,
    description: z.string(),
    stars: z.number(),
    language: z.string(),
    archived: z.boolean(),
    fetchedAt: z.string(),
  }),
  executiveSummary: text,
  existingCapabilities: list,
  painPoints: z.array(painSchema).max(8),
  technologySignals: z
    .array(
      z.object({
        name: text,
        reasonRelevant: text,
        sourceEvidenceIds: ids,
        freshnessDate: z.string().optional(),
      }),
    )
    .max(3),
  opportunities: z.array(opportunitySchema).max(3),
  references: z
    .array(
      z.object({
        evidenceId: z.string(),
        type: z.string(),
        title: z.string(),
        url: sourceUrl,
        fetchedAt: z.string(),
        excerpt: z.string().max(20000),
        state: z.string().optional(),
        date: z.string().optional(),
      }),
    )
    .max(160),
  sampling: z.object({
    issueCount: z.number().int(),
    rule: text,
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  warnings: z.array(z.string()).max(100),
  generatedAt: z.string(),
  promptVersion: z.string(),
});
export type ResearchReport = z.infer<typeof reportSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;

const escapeMarkdown = (value: string) =>
  value.replace(/[\\`*_{}[\]<>#!|]/g, "\\$&");
export function reportMarkdown(report: ResearchReport) {
  const p = reportSchema.parse(report);
  const lines = [
    `# RepoPilot — ${escapeMarkdown(p.repository.fullName)}`,
    `模式：${p.mode}${p.fixtureRecordedAt ? `；夹具录制：${p.fixtureRecordedAt}` : ""}`,
    `仓库：${p.repository.url}`,
    "来源事实见引用；方案和评分属于模型推断；假设须用户验证。",
    escapeMarkdown(p.executiveSummary),
    `Issue 样本：${p.sampling.issueCount}；${escapeMarkdown(p.sampling.rule)}`,
    ...p.warnings.map((w) => `> ${escapeMarkdown(w)}`),
  ];
  for (const o of p.opportunities)
    lines.push(
      `\n## ${escapeMarkdown(o.title)}`,
      `目标用户：${escapeMarkdown(o.targetUser)}`,
      `痛点：${escapeMarkdown(o.problem)}`,
      `方案：${escapeMarkdown(o.solution)}`,
      `AI 技术：${escapeMarkdown(o.aiTechnology)}`,
      `已有能力及待核实差距：${escapeMarkdown(o.whatExistsAlready)}`,
      `差异：${escapeMarkdown(o.differentiator)}`,
      `时机：${escapeMarkdown(o.whyNow)}`,
      `MVP：${o.mvpFeatures.map(escapeMarkdown).join("；")}`,
      `验证：${escapeMarkdown(o.validationExperiment)}`,
      `目标指标（未实测）：${escapeMarkdown(o.successMetric)}`,
      `工作量：${o.estimatedEffort}（估算）`,
      `评分（启发式）：${o.scores.total}/100；置信度：${o.confidence}`,
      `分项：痛点 ${o.scores.userPain}/30；未满足 ${o.scores.unmetNeed}/20；技术匹配 ${o.scores.technologyFit}/20；可行性 ${o.scores.personalFeasibility}/15；差异 ${o.scores.differentiation}/15`,
      escapeMarkdown(o.scoreExplanation),
      `风险：${o.risks.map(escapeMarkdown).join("；")}`,
      `假设：${o.assumptions.map(escapeMarkdown).join("；")}`,
      ...o.evidenceIds.map((id) => {
        const r = p.references.find((r) => r.evidenceId === id);
        return r ? `- [${escapeMarkdown(r.title)}](${r.url})` : "";
      }),
    );
  lines.push(
    "\n## 来源记录",
    ...p.references.map(
      (r) =>
        `- [${escapeMarkdown(r.title)}](${r.url}) — ${r.fetchedAt}${r.state ? `；${r.state}` : ""}\n  ${escapeMarkdown(r.excerpt.slice(0, 600))}`,
    ),
  );
  return lines.join("\n\n");
}
