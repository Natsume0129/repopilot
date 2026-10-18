"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeGitHubRepo } from "@karakeep/shared/repopilot/input";

export default function ResearchHome() {
  const [error, setError] = useState("");
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <h1 className="text-2xl font-bold">RepoPilot / AI 产品创新</h1>
      <p>从真实用户痛点与相关 AI 技术中，寻找适合你的开源创新机会。</p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            normalizeGitHubRepo(
              String(new FormData(event.currentTarget).get("repository")),
            );
            setError("研究服务尚未接入。当前为界面预览。");
          } catch (e) {
            setError((e as Error).message);
          }
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
          <legend>个人技术栈</legend>
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
        <label className="block">
          目标{" "}
          <select name="goal" className="rounded border bg-background p-2">
            <option value="portfolio">作品集</option>
            <option value="learning">学习</option>
            <option value="utility">实用工具</option>
          </select>
        </label>
        <Button type="submit">开始研究</Button>
        {error && <p role="alert">{error}</p>}
      </form>
      <h2 className="text-xl font-semibold">最近研究</h2>
      <p>暂无研究任务。界面预览不会创建真实任务。</p>
    </main>
  );
}
