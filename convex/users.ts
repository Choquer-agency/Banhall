import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { listTeamRoster, userDisplayLabel } from "./lib/teamRoster";
import { getCurrentUserOrNull, requireCurrentUser, requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentUserOrNull(ctx);
  },
});

// BNH-22: team roster for the interviewer picker on the report creation form.
export const listTeam = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getCurrentUserOrNull(ctx);
    if (!viewer) return [];
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

// Admin roster for the Users & roles page.
export const listUsers = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.optional(v.string()),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      displayName: v.string(),
      email: v.optional(v.string()),
      role: v.optional(
        v.union(v.literal("writer"), v.literal("manager"), v.literal("admin"))
      ),
      createdAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const users = await ctx.db.query("users").take(500);
    return users.map((user) => ({
      _id: user._id,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: userDisplayLabel(user),
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    }));
  },
});

/** Self-service name editing (/settings). */
export const updateMyProfile = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName || !lastName) {
      domainError("INVALID_INPUT", "First and last name are required");
    }
    await ctx.db.patch(user._id, { firstName, lastName });
  },
});

// Admin-only role assignment from the Users & roles page.
export const setUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(
      v.literal("writer"),
      v.literal("manager"),
      v.literal("admin")
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin"]);
    if (caller._id === args.userId && args.role !== "admin") {
      domainError("INVALID_INPUT", "You cannot remove your own admin role");
    }
    const target = await ctx.db.get(args.userId);
    if (!target) domainError("NOT_FOUND", "User not found");
    await ctx.db.patch(args.userId, { role: args.role });
    return null;
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
