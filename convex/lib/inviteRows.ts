import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Most waiting ("pending") invite rows one call reads for an email. An
 * expired invite stays pending until it is resent or revoked, so an email can
 * hold many; past this many, a check could miss a live one.
 */
export const PENDING_INVITES_READ = 50;

/** The message when an email holds more waiting invites than one call reads. */
export const TOO_MANY_PENDING_INVITES =
  "This email has too many old invites waiting. Ask an admin to revoke the old ones, then send one invite.";

/**
 * The live (pending and unexpired) invites for an email (2026-11-19, from
 * code review): every check that keeps one live invite per email reads them
 * here, and `complete` is false when the email holds more pending rows than
 * one call reads, so a caller refuses instead of missing a live one.
 */
export async function liveInvitesForEmail(
  ctx: QueryCtx,
  email: string,
  now: number,
): Promise<{ live: Doc<"invites">[]; complete: boolean }> {
  const pending = await ctx.db
    .query("invites")
    .withIndex("by_email_and_status", (q) => q.eq("email", email).eq("status", "pending"))
    .take(PENDING_INVITES_READ + 1);
  const complete = pending.length <= PENDING_INVITES_READ;
  return { live: pending.slice(0, PENDING_INVITES_READ).filter((invite) => invite.expiresAt > now), complete };
}
