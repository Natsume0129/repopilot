import { and, eq, lt, sql } from "drizzle-orm";
import type { DB } from "@karakeep/db";
import { researchRuns } from "@karakeep/db/schema";

// The run row is the durable queue: creating a run and enqueueing are atomic.
// A fenced lease prevents a late crashed worker from overwriting a new attempt.
export function claimResearchJob(
  db: DB,
  now = Date.now(),
  durationMs = 200_000,
) {
  return db.transaction(
    (tx) => {
      tx.update(researchRuns)
        .set({
          status: "queued",
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(researchRuns.status, "running"),
            lt(researchRuns.leaseExpiresAt, now),
          ),
        )
        .run();
      const run = tx
        .select()
        .from(researchRuns)
        .where(eq(researchRuns.status, "queued"))
        .orderBy(researchRuns.createdAt)
        .get();
      if (!run) return null;
      if (run.attempts >= 3) {
        tx.update(researchRuns)
          .set({
            status: "failed",
            errorCode: "WORKER_INTERRUPTED",
            errorMessage: "研究多次中断，请重试",
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(researchRuns.id, run.id))
          .run();
        return null;
      }
      return tx
        .update(researchRuns)
        .set({
          status: "running",
          startedAt: now,
          updatedAt: now,
          leaseToken: crypto.randomUUID(),
          leaseExpiresAt: now + durationMs,
          attempts: sql`${researchRuns.attempts} + 1`,
          traceJson: "[]",
        })
        .where(eq(researchRuns.id, run.id))
        .returning()
        .get();
    },
    { behavior: "immediate" },
  );
}

export function leaseFilter(id: string, token: string) {
  return and(
    eq(researchRuns.id, id),
    eq(researchRuns.leaseToken, token),
    eq(researchRuns.status, "running"),
  );
}
