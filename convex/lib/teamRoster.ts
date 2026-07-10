import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;
type UserLabelSource = Pick<Doc<"users">, "name" | "email">;

const TEAM_ROSTER_LIMIT = 200;

/** Anonymous auth records are not Banhall team members. */
export function isTeamRosterMember(
  user: Doc<"users"> | null
): user is Doc<"users"> {
  return user !== null && user.isAnonymous !== true;
}

/** Stable label snapshotted onto project records at creation time. */
export function userDisplayLabel(user: UserLabelSource): string {
  return user.name?.trim() || user.email?.trim() || "Unknown team member";
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
