import { draftSchema } from "@karakeep/shared/repopilot/report";
import type { Opportunity } from "@karakeep/shared/repopilot/report";
import type { Evidence } from "@karakeep/shared/repopilot/types";
import { safeSourceUrl } from "./github";

export function duplicateIdeas(ideas: Opportunity[]) {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "")
        .match(/.{1,2}/g) ?? [],
    );
  return ideas.some((a, i) =>
    ideas.slice(0, i).some((b) => {
      if (
        a.id === b.id ||
        a.painPointId === b.painPointId ||
        a.title === b.title
      )
        return true;
      const x = words(a.title + a.solution),
        y = words(b.title + b.solution);
      return (
        [...x].filter((w) => y.has(w)).length /
          Math.max(1, new Set([...x, ...y]).size) >
        0.8
      );
    }),
  );
}
export function verifyIdeas(
  raw: unknown,
  evidence: Evidence[],
  profile: { weeks: number; skills: string[] },
) {
  const draft = draftSchema.parse(raw);
  const sources = new Map(evidence.map((e) => [e.id, e]));
  const warnings: string[] = [];
  const ideas: Opportunity[] = [];
  for (const candidate of draft.opportunities) {
    const ids = [...new Set(candidate.evidenceIds)].filter((id) => {
      const e = sources.get(id);
      if (!e) return false;
      try {
        safeSourceUrl(e.sourceUrl);
        return true;
      } catch {
        return false;
      }
    });
    const rejected = ids.length !== new Set(candidate.evidenceIds).size;
    const issueCount = ids.filter(
      (id) => sources.get(id)?.sourceType === "issue",
    ).length;
    const tech = ids.some(
      (id) =>
        sources.get(id)?.repoFullName !==
          evidence.find((e) => e.sourceType === "issue")?.repoFullName &&
        ["repo_readme", "tech_repo", "release"].includes(
          sources.get(id)!.sourceType,
        ),
    );
    const o = {
      ...candidate,
      evidenceIds: ids,
      scores: { ...candidate.scores },
      risks: [...candidate.risks],
      assumptions: [...candidate.assumptions],
    };
    if (rejected) {
      warnings.push(`已移除 ${o.title} 中无法对应采集记录的引用`);
      o.assumptions.push("部分引用未通过校验，相关结论仅为待验证假设");
    }
    if (issueCount < 2 || rejected) {
      o.confidence = "low";
      o.scores.userPain = Math.min(o.scores.userPain, issueCount ? 15 : 5);
      o.scores.unmetNeed = Math.min(o.scores.unmetNeed, 8);
      o.assumptions.push("样本有限，需求强度及未满足程度待验证");
    }
    if (!tech) {
      o.scores.technologyFit = Math.min(o.scores.technologyFit, 5);
      o.confidence = "low";
      o.assumptions.push("AI 技术匹配缺少外部来源，待验证");
    }
    const skillFit = profile.skills.some((s) =>
      ["typescript", "python", "react", "next.js"].includes(s.toLowerCase()),
    );
    if (
      o.estimatedEffort === "large" ||
      (profile.weeks === 1 && o.estimatedEffort !== "small") ||
      !skillFit
    ) {
      o.scores.personalFeasibility = Math.min(o.scores.personalFeasibility, 5);
      o.risks.push("可能超出技能或时间预算，先缩小为单一验证原型");
    }
    if (!issueCount) {
      o.confidence = "low";
      o.assumptions.push("待验证假设：尚无 issue 证据支撑该用户痛点");
    }
    o.scores.total =
      o.scores.userPain +
      o.scores.unmetNeed +
      o.scores.technologyFit +
      o.scores.personalFeasibility +
      o.scores.differentiation;
    if (duplicateIdeas([...ideas, o])) {
      warnings.push("移除了目标痛点或用户流程重复的创意，未补造第三项");
      continue;
    }
    ideas.push(o);
  }
  if (ideas.length < 3) warnings.push("证据或差异不足：本次未形成三个可信方向");
  return {
    draft,
    ideas: ideas.sort((a, b) => b.scores.total - a.scores.total),
    warnings,
  };
}
