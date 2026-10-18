"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="space-y-4 p-6">
      <p>暂时无法加载研究任务。</p>
      <Button onClick={reset}>重试</Button>
    </div>
  );
}
