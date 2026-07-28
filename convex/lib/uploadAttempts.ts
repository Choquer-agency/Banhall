import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { domainError } from "./contracts";

/**
 * PSOS-04 shared helpers for `documentUploadAttempts`. Kept separate from the
 * public functions so `uploadDocument` can resolve an attempt inside the same
 * transaction as the document insert, and so the retention decision is a pure
 * function that can be unit-tested on its own (mirroring `snapshotIdsToDelete`).
 */

/** The client generates this with `crypto.randomUUID()`. */
const ATTEMPT_KEY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Format-gating the key is what stops it being a prose channel: it is the only
 * client-supplied string on this table besides the user's own file name.
 */
export function requireAttemptKey(attemptKey: string): string {
  if (!ATTEMPT_KEY_RE.test(attemptKey)) {
    domainError("INVALID_INPUT", "Invalid upload attempt key");
  }
  return attemptKey.toLowerCase();
}

export const MAX_FILE_NAME_CHARS = 200;

export function capFileName(fileName: string): string {
  return fileName.slice(0, MAX_FILE_NAME_CHARS);
}

/** Per-project retention cap for attempt rows. */
export const ATTEMPT_CAP = 100;

/**
 * An `in_progress` attempt older than this was almost certainly abandoned (tab
 * closed mid-upload). It is *displayed* as failed at read time; the stored
 * status is never rewritten, because nothing actually happened — the same
 * read-time derivation the invite expiry uses.
 */
export const STALE_ATTEMPT_MS = 10 * 60 * 1000;

type RetentionAttempt<TId extends string> = {
  _id: TId;
  status: "in_progress" | "failed" | "succeeded" | "dismissed";
  createdAt: number;
};

/**
 * Decide which attempts to prune once a project is over cap. Failures are the
 * audit trail this table exists for, so resolved and dismissed rows are given
 * up first; within each group the oldest go first.
 */
export function attemptIdsToPrune<TId extends string>(
  attempts: ReadonlyArray<RetentionAttempt<TId>>
): TId[] {
  const overflow = attempts.length - ATTEMPT_CAP;
  if (overflow <= 0) return [];

  const expendable = attempts
    .filter((a) => a.status === "succeeded" || a.status === "dismissed")
    .sort((a, b) => a.createdAt - b.createdAt);
  const audit = attempts
    .filter((a) => a.status !== "succeeded" && a.status !== "dismissed")
    .sort((a, b) => a.createdAt - b.createdAt);

  return [...expendable, ...audit].slice(0, overflow).map((a) => a._id);
}

export async function pruneUploadAttempts(
  ctx: MutationCtx,
  projectId: Id<"projects">
) {
  const attempts = await ctx.db
    .query("documentUploadAttempts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(1_000);

  for (const attemptId of attemptIdsToPrune(attempts)) {
    await ctx.db.delete(attemptId);
  }
}

export async function findAttempt(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  attemptKey: string
) {
  return await ctx.db
    .query("documentUploadAttempts")
    .withIndex("by_projectId_attemptKey", (q) =>
      q.eq("projectId", projectId).eq("attemptKey", attemptKey)
    )
    .unique();
}

/**
 * Mark an attempt as resolved, in the same transaction as the document insert
 * that resolved it. This correlation is the invariant that keeps a file from
 * appearing twice on the receipt: `listUploadAttempts` excludes `succeeded`
 * rows, so a resolved attempt and its document row can never both render.
 *
 * A missing row is not an error — an old client sends no key, and a `begin`
 * call can be lost to the network while the upload itself succeeds.
 */
export async function resolveUploadAttempt(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  attemptKey: string,
  documentId: Id<"projectDocuments">
) {
  const attempt = await findAttempt(ctx, projectId, attemptKey);
  if (!attempt) return;
  await ctx.db.patch(attempt._id, {
    status: "succeeded",
    documentId,
    updatedAt: Date.now(),
  });
}
