import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import {
  researchRuns,
  researchEvidence,
  researchFeedback,
  researchEvents,
} from "@karakeep/db/schema";
import { createRunSchema } from "@karakeep/shared/repopilot/input";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";
import { createCallerFactory, router, sessionProcedure } from "../index";
import type { AuthedContext } from "../index";
import { bookmarksAppRouter } from "./bookmarks";

const idInput = z.object({ id: z.uuid() });
async function owned(ctx: AuthedContext, id: string) {
  const run = await ctx.db.query.researchRuns.findFirst({
    where: and(eq(researchRuns.id, id), eq(researchRuns.userId, ctx.user.id)),
  });
  if (!run)
    throw new TRPCError({ code: "NOT_FOUND", message: "研究任务不存在" });
  return run;
}
async function enqueue(
  ctx: AuthedContext,
  input: z.output<typeof createRunSchema>,
) {
  const profile = JSON.stringify(input.profile);
  return ctx.db.transaction(
    (tx) => {
      const active = tx
        .select()
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.userId, ctx.user.id),
            inArray(researchRuns.status, ["queued", "running"]),
          ),
        )
        .get();
      if (active) {
        if (
          active.repoFullName === input.repository.fullName &&
          active.userProfileJson === profile
        )
          return { runId: active.id };
        throw new TRPCError({
          code: "CONFLICT",
          message: "请等待当前研究任务完成后再开始新任务",
        });
      }
      const run = tx
        .insert(researchRuns)
        .values({
          userId: ctx.user.id,
          repoFullName: input.repository.fullName,
          repoUrl: `https://github.com/${input.repository.fullName}`,
          userProfileJson: profile,
          mode: process.env.REPOPILOT_MODE === "live" ? "live" : "mock",
        })
        .returning()
        .get();
      tx.insert(researchEvents)
        .values({ runId: run.id, name: "repopilot_run_started" })
        .run();
      return { runId: run.id };
    },
    { behavior: "immediate" },
  );
}

export const repopilotRouter = router({
  createRun: sessionProcedure
    .input(createRunSchema)
    .mutation(({ ctx, input }) => enqueue(ctx, input)),
  listRuns: sessionProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.number().int().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db
        .select({
          id: researchRuns.id,
          repoFullName: researchRuns.repoFullName,
          status: researchRuns.status,
          stage: researchRuns.stage,
          progress: researchRuns.progress,
          createdAt: researchRuns.createdAt,
          mode: researchRuns.mode,
        })
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.userId, ctx.user.id),
            input.cursor ? lt(researchRuns.createdAt, input.cursor) : undefined,
          ),
        )
        .orderBy(desc(researchRuns.createdAt))
        .limit(input.limit + 1);
      const hasMore = items.length > input.limit;
      if (hasMore) items.pop();
      return {
        items,
        nextCursor: hasMore ? items.at(-1)?.createdAt : undefined,
      };
    }),
  getRun: sessionProcedure.input(idInput).query(async ({ ctx, input }) => {
    const run = await owned(ctx, input.id);
    const { leaseToken: _token, leaseExpiresAt: _expiry, ...safe } = run;
    return {
      ...safe,
      evidence: await ctx.db
        .select()
        .from(researchEvidence)
        .where(eq(researchEvidence.runId, run.id)),
      feedback: await ctx.db
        .select()
        .from(researchFeedback)
        .where(
          and(
            eq(researchFeedback.runId, run.id),
            eq(researchFeedback.userId, ctx.user.id),
          ),
        ),
    };
  }),
  deleteRun: sessionProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      await owned(ctx, input.id);
      await ctx.db
        .delete(researchRuns)
        .where(
          and(
            eq(researchRuns.id, input.id),
            eq(researchRuns.userId, ctx.user.id),
          ),
        );
      return { deleted: true };
    }),
  retryRun: sessionProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const run = await owned(ctx, input.id);
    if (!["failed", "partial"].includes(run.status))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "仅失败或部分完成的任务可重试",
      });
    return enqueue(
      ctx,
      createRunSchema.parse({
        repository: run.repoFullName,
        profile: JSON.parse(run.userProfileJson),
      }),
    );
  }),
  saveBookmark: sessionProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      const run = await owned(ctx, input.id);
      if (run.bookmarkId) return { bookmarkId: run.bookmarkId };
      const bookmark = await createCallerFactory(bookmarksAppRouter)(
        ctx,
      ).createBookmark({ type: BookmarkTypes.LINK, url: run.repoUrl });
      await ctx.db
        .update(researchRuns)
        .set({ bookmarkId: bookmark.id })
        .where(
          and(
            eq(researchRuns.id, run.id),
            eq(researchRuns.userId, ctx.user.id),
          ),
        );
      await ctx.db
        .insert(researchEvents)
        .values({ runId: run.id, name: "repopilot_bookmark_saved" });
      return { bookmarkId: bookmark.id };
    }),
  submitFeedback: sessionProcedure
    .input(
      z.object({
        runId: z.uuid(),
        opportunityId: z.string().max(80),
        rating: z.enum(["helpful", "unhelpful"]).optional(),
        adopted: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await owned(ctx, input.runId);
      const report = z
        .object({ opportunities: z.array(z.object({ id: z.string() })) })
        .safeParse(run.reportJson ? JSON.parse(run.reportJson) : null);
      if (
        !report.success ||
        !report.data.opportunities.some((o) => o.id === input.opportunityId)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "报告中不存在该机会",
        });
      await ctx.db
        .insert(researchFeedback)
        .values({ ...input, userId: ctx.user.id })
        .onConflictDoUpdate({
          target: [
            researchFeedback.userId,
            researchFeedback.runId,
            researchFeedback.opportunityId,
          ],
          set: { rating: input.rating, adopted: input.adopted },
        });
      await ctx.db
        .insert(researchEvents)
        .values({ runId: run.id, name: "repopilot_feedback_submitted" });
      return { saved: true };
    }),
  trackEvent: sessionProcedure
    .input(
      z.object({
        id: z.uuid(),
        name: z.enum([
          "repopilot_opportunity_viewed",
          "repopilot_evidence_clicked",
          "repopilot_report_exported",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await owned(ctx, input.id);
      await ctx.db
        .insert(researchEvents)
        .values({ runId: input.id, name: input.name });
      return { saved: true };
    }),
});
