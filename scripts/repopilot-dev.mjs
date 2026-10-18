import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const live = process.argv.includes("--live");
if (
  live &&
  (!process.env.REPOPILOT_LLM_API_KEY ||
    !process.env.REPOPILOT_LLM_BASE_URL ||
    !process.env.REPOPILOT_LLM_MODEL)
)
  throw new Error(
    "Live requires REPOPILOT_LLM_API_KEY, REPOPILOT_LLM_BASE_URL and REPOPILOT_LLM_MODEL in root .env",
  );
const env = {
  ...process.env,
  REPOPILOT_MODE: live ? "live" : "mock",
  NEXT_TELEMETRY_DISABLED: "1",
};
const web = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev"],
  { cwd: resolve(root, "apps/web"), env, stdio: "inherit", windowsHide: true },
);
// Offline demo keeps normal bookmark jobs queued; live runs all upstream workers.
const workers = spawn(
  process.execPath,
  [require.resolve("tsx/cli"), "watch", "index.ts"],
  {
    cwd: resolve(root, "apps/workers"),
    env: { ...env, ...(!live ? { WORKERS_ENABLED_WORKERS: "repopilot" } : {}) },
    stdio: "inherit",
    windowsHide: true,
  },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  web.kill();
  workers.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of [web, workers]) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
console.log(
  `RepoPilot ${live ? "LIVE" : "OFFLINE MOCK"}: http://localhost:3000/repopilot — Ctrl+C stops services.`,
);
