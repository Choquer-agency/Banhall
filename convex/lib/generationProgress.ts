import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isProjectDeleting } from "./projectDeletion";

/**
 * The generation progress narration ("thinking" log), stored one row per line
 * in `generationProgress` (2026-09-25). It used to be the `progressLog` array
 * on the live-subscribed generation row, which grew without bound and was
 * rewritten on every append.
 *
 * Writes: every new line is a child row; the generation row is not touched.
 * Reads (dual read): lines from before the move are still on the row's
 * `progressLog`. Until `generations.backfillGenerationProgress` has copied a
 * row's array into child rows (it then stamps `progressLogCopiedAt`), a read
 * returns the array followed by the child rows; afterwards the child rows
 * alone. Old arrays are never removed.
 */

/** The most lines a reader returns: the newest ones. */
export const PROGRESS_READ_LIMIT = 50;

export type ProgressKind = "info" | "success" | "failure";

/** Authored narration marks outcomes with a leading check or cross. */
export function progressKind(message: string): ProgressKind {
  if (message.startsWith("✓")) return "success";
  if (message.startsWith("✗")) return "failure";
  return "info";
}

/**
 * Append lines, in order, to a generation's progress. Skipped for a project in
 * deletion (the purge may already have passed this table).
 */
export async function appendGenerationProgress(
  ctx: MutationCtx,
  generation: Pick<Doc<"generations">, "_id" | "projectId">,
  lines: readonly string[],
  at: number = Date.now()
): Promise<void> {
  if (lines.length === 0) return;
  if (await isProjectDeleting(ctx, generation.projectId)) return;
  for (const message of lines) {
    await ctx.db.insert("generationProgress", {
      generationId: generation._id,
      projectId: generation.projectId,
      at,
      message,
      kind: progressKind(message),
    });
  }
}

async function newestChildLines(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  limit: number
): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await ctx.db
    .query("generationProgress")
    .withIndex("by_generationId_and_at", (q) => q.eq("generationId", generationId))
    .order("desc")
    .take(limit);
  return rows.reverse().map((row) => row.message);
}

/**
 * A generation's newest progress lines, oldest first: the legacy array (until
 * it is copied) followed by the child rows, at most `limit` lines.
 */
export async function readGenerationProgress(
  ctx: { db: QueryCtx["db"] },
  generation: Pick<Doc<"generations">, "_id" | "progressLog" | "progressLogCopiedAt">,
  limit: number = PROGRESS_READ_LIMIT
): Promise<string[]> {
  const children = await newestChildLines(ctx, generation._id, limit);
  if (generation.progressLogCopiedAt !== undefined) return children;
  const legacy = generation.progressLog ?? [];
  return [...legacy, ...children].slice(-limit);
}

/** Every progress line of a generation, oldest first (legacy array until it
 * is copied, then child rows). For tests and ops tooling; readers that serve
 * a page use `readGenerationProgress` and its bound. */
export async function allGenerationProgress(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
): Promise<string[]> {
  const generation = await ctx.db.get(generationId);
  if (!generation) return [];
  return await readGenerationProgress(ctx, generation, 10_000);
}
