import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./lib/auth";
import { domainError } from "./lib/contracts";
import {
  STALE_ATTEMPT_MS,
  capFileName,
  findAttempt,
  pruneUploadAttempts,
  requireAttemptKey,
} from "./lib/uploadAttempts";

/**
 * PSOS-04: the durable record of uploads that never produced a document row.
 *
 * Note what these functions do NOT accept: there is no argument anywhere here
 * that carries a message. Failures are literal codes, the attempt key is
 * format-gated, and the only free string is the user's own file name. A
 * provider or internal error string has no route into this table.
 */

const originValidator = v.union(
  v.literal("chat_upload"),
  v.literal("context_input"),
  v.literal("review_pd")
);

const failureCodeValidator = v.union(
  v.literal("rejected_unsupported"),
  v.literal("upload_failed")
);

const MAX_BATCH = 50;

/**
 * Upsert one batch of attempts by `(projectId, attemptKey)`. Used to open an
 * attempt before an upload starts, to record a client-side type rejection that
 * never reaches storage, and to flush the offline outbox — all the same call,
 * because they differ only in whether a `failureCode` is already known.
 *
 * Idempotent by design: a retry reuses its key and flips the row back to
 * `in_progress`, while a `succeeded` row is terminal so a late duplicate flush
 * can never resurrect a file that actually made it.
 */
export const recordUploadAttempts = mutation({
  args: {
    projectId: v.id("projects"),
    attempts: v.array(
      v.object({
        attemptKey: v.string(),
        fileName: v.string(),
        fileSizeBytes: v.optional(v.number()),
        origin: originValidator,
        failureCode: v.optional(failureCodeValidator),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireInternalProjectAccess(ctx, args.projectId);
    if (args.attempts.length > MAX_BATCH) {
      domainError("INVALID_INPUT", "Too many files in one upload batch");
    }
    const now = Date.now();

    for (const entry of args.attempts) {
      const attemptKey = requireAttemptKey(entry.attemptKey);
      const status = entry.failureCode ? ("failed" as const) : ("in_progress" as const);
      const existing = await findAttempt(ctx, args.projectId, attemptKey);

      if (existing) {
        if (existing.status === "succeeded") continue;
        await ctx.db.patch(existing._id, {
          status,
          ...(entry.failureCode ? { failureCode: entry.failureCode } : {}),
          updatedAt: now,
        });
        continue;
      }

      await ctx.db.insert("documentUploadAttempts", {
        projectId: args.projectId,
        attemptKey,
        fileName: capFileName(entry.fileName),
        ...(entry.fileSizeBytes !== undefined
          ? { fileSizeBytes: entry.fileSizeBytes }
          : {}),
        origin: entry.origin,
        status,
        ...(entry.failureCode ? { failureCode: entry.failureCode } : {}),
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
    }

    await pruneUploadAttempts(ctx, args.projectId);
  },
});

/** Record that an in-flight attempt failed. Converges on repeated calls. */
export const failUploadAttempt = mutation({
  args: {
    projectId: v.id("projects"),
    attemptKey: v.string(),
    failureCode: failureCodeValidator,
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const attemptKey = requireAttemptKey(args.attemptKey);
    const attempt = await findAttempt(ctx, args.projectId, attemptKey);
    // The upload can win a race against its own failure report; a resolved
    // attempt is terminal.
    if (!attempt || attempt.status === "succeeded") return;
    await ctx.db.patch(attempt._id, {
      status: "failed",
      failureCode: args.failureCode,
      updatedAt: Date.now(),
    });
  },
});

/**
 * "Remove" on a failed row. The row is marked, never deleted: it is audit
 * history until retention prunes it.
 */
export const dismissUploadAttempt = mutation({
  args: { projectId: v.id("projects"), attemptKey: v.string() },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const attemptKey = requireAttemptKey(args.attemptKey);
    const attempt = await findAttempt(ctx, args.projectId, attemptKey);
    if (!attempt || attempt.status === "succeeded") return;
    await ctx.db.patch(attempt._id, { status: "dismissed", updatedAt: Date.now() });
  },
});

/**
 * Unresolved attempts for the receipt. Resolved and dismissed rows are excluded
 * here rather than filtered in the UI, so the "a file never shows twice"
 * invariant holds at the data layer.
 */
export const listUploadAttempts = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    // Null, not []: "you may not look" and "there is nothing here" are
    // different facts, and rendering a denial as an empty list hides a
    // permissions problem from the person who needs to see it.
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;
    const attempts = await ctx.db
      .query("documentUploadAttempts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(200);
    const now = Date.now();

    return attempts
      .filter(
        // A type predicate, not a plain boolean: without it the narrowing is
        // lost and `displayStatus` below widens back to all four stored
        // statuses, which the receipt's row type does not accept.
        (a): a is typeof a & { status: "in_progress" | "failed" } =>
          a.status === "in_progress" || a.status === "failed"
      )
      .map((a) => ({
        attemptKey: a.attemptKey,
        fileName: a.fileName,
        fileSizeBytes: a.fileSizeBytes ?? null,
        origin: a.origin,
        failureCode: a.failureCode ?? null,
        createdAt: a.createdAt,
        // A tab closed mid-upload leaves `in_progress` forever. Presenting it
        // as failed is a read-time decision: no cron rewrites stored status
        // merely because time passed.
        displayStatus:
          a.status === "in_progress" && now - a.updatedAt > STALE_ATTEMPT_MS
            ? ("failed" as const)
            : a.status,
      }));
  },
});
