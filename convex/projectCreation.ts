import { query } from "./_generated/server";
import { userDisplayLabel } from "./lib/teamRoster";
import { requireCapability } from "./lib/roleCapabilities";
import { isTeamRosterMember } from "./lib/teamRoster";

export const getOwnerOptions = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireCapability(ctx, "project.create");
    if (user.role === "writer" || user.role === "manager") {
      return {
        requiresSelection: false,
        defaultOwnerId: user._id,
        candidates: [{ userId: user._id, label: userDisplayLabel(user), role: user.role }],
        truncated: false,
      };
    }
    const page = await ctx.db.query("users").take(201);
    const candidates = page
      .slice(0, 200)
      .filter(
        (candidate): candidate is typeof candidate & { role: "writer" | "manager" } =>
          isTeamRosterMember(candidate) && (candidate.role === "writer" || candidate.role === "manager")
      )
      .map((candidate) => ({ userId: candidate._id, label: userDisplayLabel(candidate), role: candidate.role }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.userId.localeCompare(b.userId));
    return { requiresSelection: true, defaultOwnerId: null, candidates, truncated: page.length > 200 };
  },
});
