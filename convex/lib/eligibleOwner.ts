import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { domainError } from "./contracts";
import { getTeamRosterMemberOrNull } from "./teamRoster";

type Ctx = QueryCtx | MutationCtx;

export async function requireEligibleProjectOwner(ctx: Ctx, userId: Id<"users">) {
  const user = await getTeamRosterMemberOrNull(ctx, userId);
  if (!user || (user.role !== "writer" && user.role !== "manager")) {
    domainError("INVALID_INPUT", "Choose an active Consultant or Manager");
  }
  return user;
}
