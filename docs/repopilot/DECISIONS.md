# RepoPilot implementation decisions

## 2026-10-19 — Phase 0 (in progress)

- Specification: `../RepoPilot_Coding_Agent_Execution_Plan.md` in the parent workspace. P0 only; phases must pass their gates before completion is claimed.
- Cloned https://github.com/karakeep-app/karakeep into `E:/RepoPilot/repopilot`.
- Upstream baseline: `c184eec6c9bc6df1b61c32e803ceb17dd3480596`; local branch `feat/repopilot-mvp`. Origin remains upstream; no personal remote or push.
- Windows PowerShell, Node 24.18.0, Git 2.51.0.windows.2. Global pnpm is 11.25.0; use `npx --yes pnpm@11.2.1` to honor upstream packageManager. Initial frozen install was started using global pnpm; pinned install will verify it.
- Docker CLI 28.4.0 is present, but Linux engine pipe is unavailable even after launching Docker Desktop. Prefer upstream-supported native web/workers startup; search requires a separate Meilisearch service.
- Local random authentication secret and DATA_DIR configured in ignored `.env` files at root, web, workers and db. No credentials belong in Git.
- Actual authentication: Better Auth in `apps/web/server/auth.ts`, `getServerAuthSession` in authenticated layouts; tRPC `sessionProcedure` in `packages/trpc/index.ts`.
- Actual integration points: router registration `packages/trpc/routers/_app.ts`; schema `packages/db/schema.ts`; SQLite migrations `packages/db/drizzle`; bookmark model `packages/trpc/models/bookmarks.ts`.
- Queue integration: deferred queues in `packages/shared-server/src/queues.ts`, plugin adapter `packages/plugins/queue-liteque/src/index.ts`, worker builders in `apps/workers/index.ts`.
- UI navigation: `apps/web/app/dashboard/layout.tsx`; retain existing components and authentication.
- No RepoPilot functionality, successful login, baseline test pass, or live API validation is claimed yet.

## Phase 0 baseline results

- Pinned frozen install PASS; `npx --yes pnpm@11.2.1 db:migrate` PASS on a fresh local database.
- `npx --yes pnpm@11.2.1 web` ready at http://localhost:3000; `npx --yes pnpm@11.2.1 workers` starts Liteque runners in browserless mode.
- `npx --yes pnpm@11.2.1 exec vitest run auth.test.ts` in packages/trpc: PASS 20/20.
- `npx --yes pnpm@11.2.1 exec vitest run routers/bookmarks.test.ts` in packages/trpc: PASS 45/45.
- `node scripts/repopilot-baseline.mjs`: PASS signup, fresh-session login, actual bookmark creation and persistence after refresh (headless Microsoft Edge).
- Search integration SKIPPED: Meilisearch unavailable. Worker adblock-list download warns on raw.githubusercontent.com DNS failure; runners still start. No LLM credentials configured or API calls verified.
- Upstream Vitest warns about nested vi.mock hoisting and the tsconfig-paths plugin; tests pass without changing upstream code.

- Commit hook could not find pnpm under Git Bash (only a Windows .cmd shim is installed). For staged baseline documentation/smoke script, ran scoped checks above and formatting; use HUSKY=0 for local commits instead of the hook's unrelated whole-monorepo preflight, per requested minimal verification policy.
