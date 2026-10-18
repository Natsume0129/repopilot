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

## Phase 1

- Added authenticated /repopilot and /repopilot/runs/[id], reusing the dashboard layout/session and existing UI controls. No fictional history; explicit empty preview until persistence exists.
- Added shared bounded repository/profile validation. 13 URL normalization and rejection cases PASS: `npx --yes pnpm@11.2.1 exec vitest run repopilot/input.test.ts` (packages/shared).
- `node scripts/repopilot-baseline.mjs --repopilot` PASS: navigation, reload, 1280/390 viewport overflow checks, anonymous redirect, plus existing signup/login/bookmark flow.

## Phase 2

- Added Drizzle-generated migration 0095, research/evidence/feedback and minimal local event tables; protected session-only tRPC procedures with per-owner filtering and a partial unique index for one active task per user.
- Durable queue decision: runs are themselves SQLite jobs. The existing Liteque adapter stores jobs in a separate queue.db, so insertion and enqueue cannot share a transaction. A small DB-backed worker in the existing workers app avoids the dual-write gap. Claims use immediate transactions, bounded attempts and fencing tokens; Phase 4 attaches execution/polling. No background work inside HTTP requests.
- Added lease recovery primitive; expired work is reclaimed and stale attempts cannot save. Retry makes a separate run.
- Bookmark integration calls the actual existing bookmarks router, preserving its validation and side effects.
- `npx --yes pnpm@11.2.1 db:generate --name repopilot_research`, then `db:migrate`: PASS.
- `npx --yes pnpm@11.2.1 exec vitest run routers/repopilot.test.ts` (packages/trpc): PASS 2 integration scenarios, including fresh migrated test databases, all owner checks, creation/list/deletion, dedup, lease recovery/fencing, retry, bookmark reuse and feedback validation.

## Phase 3

- Fixed-host GitHub REST client: public-repository gate, redirects rejected, bounded requests/time, per-run cache, issue pagination/dedup/PR exclusion, README base64 decoding, limited releases and directory summaries, optional README handling and readable failures.
- Rate limits respect Retry-After/reset within deadline and bounded retries. Reference URLs are validated and issue links assembled only from fetched issue numbers.
- Consulted GitHub official Issues and REST rate-limit documentation on 2026-10-19.
- `node scripts/repopilot-record-fixture.mjs`: PASS, actually recorded 8 public endpoints from Dify and LangGraph, 5 non-PR issues; only allowlisted fields, no authors/credentials. Fixtures preserve recordedAt; explicit mock adapter never falls back to network.
- Direct unauthenticated GitHub metadata smoke for langgenius/dify: HTTP 200. LLM/live end-to-end still unverified.
- `npx --yes pnpm@11.2.1 exec vitest run src/repopilot/github.test.ts` (packages/shared-server): PASS 4 scenarios covering cache, no-network mock, pagination, dedup, PR exclusion, empty issues, missing README, private rejection, redirect handling, rate limit, budget and timeout.

## Phase 4

- Installed LangGraph.js 1.5.1; verified StateSchema/StateGraph API against official graph documentation and installed declarations. The real graph executes collection, pain extraction, model-selected search, deterministic gap check, a single bounded supplement, generation, reference verification/scoring and save preparation. Existing workers process durable jobs separately from HTTP.
- JSON/Zod report contract, deterministic recorded Mock Provider, configurable HTTPS OpenAI-compatible Chat Completions provider. Provider uses JSON mode plus local schema validation, at most one invalid-output retry, 5 requests, 5,000 completion tokens/request and a cumulative 300,000 UTF-8-byte input bound. No hardcoded model or costs; actual usage only.
- References rebuilt from collected sources; fabricated IDs removed, confidence/score caps for sparse evidence, duplicate directions removed (one regeneration opportunity), feasibility warnings for constrained profiles.
- Added local event records, fenced final saves and safe failure messages. Mock for other repositories explicitly fails rather than relabelling Dify data.
- Dependency compatibility: shared uses locked Zod 4.3.6 while liteque originally resolved 4.6.5. Pin shared-server to 4.3.6 and override only liteque>zod to 4.3.6; this fixes cross-package schema type incompatibility without casts. Removed stale TypeScript incremental caches after dependency change.
- `vitest run src/repopilot/graph.test.ts` in shared-server: PASS 3 scenarios (actual supplement branch, counts, schema, references, duplicate/feasibility checks, abort and AI scope).
- `vitest run routers/repopilot.test.ts` in trpc: PASS 3 scenarios including completed persisted mock report and safe missing-live-config failure.
- `pnpm typecheck --filter=@karakeep/shared-server --filter=@karakeep/trpc --filter=@karakeep/workers`: initially FAIL (Zod mismatch and bookmark enum), fixed; final PASS all 3 packages.
- Scoped oxlint and oxfmt: PASS after style corrections. Real paid LLM has not been invoked.

## Phase 5

- Connected authenticated form and paginated history to tRPC; async status polling survives refresh, bounded custom skills, actual traces and detailed reports, citations/excerpts, confirmed bookmark creation, persisted feedback/adoption, Markdown clipboard/download, retry/delete and explicit mock/live/partial/error labels.
- `pnpm typecheck --filter=@karakeep/web`: PASS.
- `node scripts/repopilot-e2e.mjs`: final PASS signup, research with page refresh, 3 cited opportunities, real supplement trace, bookmark idempotency (one original bookmark), feedback/adoption, clipboard/download, persistent history, second-user denial, deletion and anonymous redirect. Desktop 1280 and mobile 390 report widths do not overflow.
- Initial E2E failures: Windows clipboard changes LF to CRLF (test now normalizes EOL only); query retries delayed NOT_FOUND display (UI no longer retries authorization/not-found/invalid-input errors, keeps bounded retries for transient failures).
- Screenshot actually generated at data/repopilot-demo/report.png (ignored local artifact). Scoped oxlint/oxfmt PASS.
- Baseline crawler detail: actual original bookmark crawl jobs encounter DNS resolution errors in upstream network helper; bookmark creation/persistence and RepoPilot native-fetch GitHub requests work. Search remains unconfigured. These are not claimed as successful crawl/search tests.

## Phase 6

- Hardened streaming response size limits, wall-clock timeout even for non-settling providers, mock/live global model call budget, complete-only usage totals, recorded timestamps, unknown pain-point rejection, unsupported factual claims marked hypotheses and URL whitelist in exported report schema.
- Stable history cursor now includes createdAt + id so tied timestamps cannot drop records.
- `pnpm test --filter=@karakeep/shared --filter=@karakeep/shared-server --filter=@karakeep/trpc -- --run repopilot`: PASS 29 tests across 5 files (13 input + 11 collector/graph/security + 5 integration).
- Additional integration checks: hard timeout persisted as failed, bounded crash recovery, stable tied timestamp pagination, evidence/feedback cascading deletion.
- `pnpm typecheck` with filters shared/db/shared-server/trpc/workers/web: PASS all 6; after final schema/usage hardening the affected shared-server/trpc/web checks also PASS.
- `pnpm lint` with the same 6 filters: PASS, 0 errors. Web has 23 warnings in unchanged upstream files; no RepoPilot paths in lint warnings.
- `pnpm format` with those filters: FAIL because untouched checkout files use CRLF (git ls-files --eol confirms index LF / worktree CRLF, e.g. shared/assetdb.ts, db/drizzle.ts, web/server/auth.ts; no diffs in these files). Avoid unrelated mass formatting. Direct oxfmt --check on all 33 added/modified TS/TSX/MJS files: PASS.
- Mock research never fetches externally. Saving a bookmark deliberately reuses upstream lifecycle and may enqueue normal crawler jobs; for a strictly offline demo start workers with WORKERS_ENABLED_WORKERS=repopilot. This preserves the bookmark business logic instead of silently disabling global crawl protections.
- Prompt-injection tests verify data separation and fixed tool bounds, not a claim of perfect LLM semantic resistance. Reference existence is mechanically verified; relevance and actual unresolved demand still require human review.
