import { query } from "./_generated/server";
import { userDisplayLabel } from "./lib/teamRoster";
import { requireCapability } from "./lib/roleCapabilities";

export const getOwnerOptions = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireCapability(ctx, "project.create");
    return {
      requiresSelection: false,
      defaultOwnerId: user._id,
      candidates: [{ userId: user._id, label: userDisplayLabel(user), role: user.role }],
      truncated: false,
    };
  },
});
