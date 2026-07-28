import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail } from "./email";

type Ctx = QueryCtx | MutationCtx;
type UserLabelSource = Pick<
  Doc<"users">,
  "name" | "email" | "firstName" | "lastName"
>;

const TEAM_ROSTER_LIMIT = 200;

/** Anonymous auth records are not Banhall team members. */
export function isTeamRosterMember(
  user: Doc<"users"> | null
): user is Doc<"users"> {
  return user !== null && user.isAnonymous !== true;
}

/** Stable label snapshotted onto project records at creation time.
 * Precedence: "First Last" → legacy single-field name → email. */
export function userDisplayLabel(user: UserLabelSource): string {
  const full = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
  return full || user.name?.trim() || user.email?.trim() || "Unknown team member";
}

export async function listTeamRoster(ctx: Ctx): Promise<Doc<"users">[]> {
  const users = await ctx.db.query("users").take(TEAM_ROSTER_LIMIT);
  return users.filter(isTeamRosterMember);
}

export async function getTeamRosterMemberOrNull(
  ctx: Ctx,
  userId: Id<"users">
): Promise<Doc<"users"> | null> {
  const user = await ctx.db.get(userId);
  return isTeamRosterMember(user) ? user : null;
}

/**
 * Legacy project/report metadata may contain an account email. Resolve it at
 * read time so profile name changes appear immediately while the stored audit
 * snapshot remains untouched. Non-email labels and accounts without a human
 * name pass through unchanged.
 */
export async function resolveLiveUserLabel(
  ctx: Ctx,
  storedLabel: string | null | undefined,
  userId?: Id<"users"> | string
): Promise<string | undefined> {
  const label = storedLabel?.trim();
  if (!label) return undefined;
  const email = normalizeEmail(label);
  if (!email) return label;

  const matches = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(2);
  let user = matches.length === 1 ? matches[0] : null;
  if (userId) {
    const normalizedUserId = ctx.db.normalizeId("users", userId);
    const candidate = normalizedUserId ? await ctx.db.get(normalizedUserId) : null;
    if (isTeamRosterMember(candidate)) user = candidate;
  }
  if (!isTeamRosterMember(user)) return label;

  const fullName = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
  return fullName || user.name?.trim() || label;
}
