import { query, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { listTeamRoster, userDisplayLabel } from "./lib/teamRoster";

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

// BNH-22: team roster for the interviewer picker on the report creation form.
export const listTeam = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const users = await listTeamRoster(ctx);
    return users
      .map((user) => ({
        id: user._id,
        name: userDisplayLabel(user),
        email: user.email?.trim() || null,
      }))
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
        });
        return byName || a.id.localeCompare(b.id);
      });
  },
});

// Run from the CLI to grant a role, e.g.:
//   npx convex run users:setRole '{"email":"demo@banhall.ca","role":"admin"}'
export const setRole = internalMutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("writer"),
      v.literal("manager"),
      v.literal("admin")
    ),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) throw new Error(`No user with email ${args.email}`);
    await ctx.db.patch(user._id, { role: args.role });
    return user._id;
  },
});
