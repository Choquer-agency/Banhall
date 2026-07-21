import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { listTeamRoster, userDisplayLabel } from "./lib/teamRoster";
import {
  getCurrentUserOrNull,
  requireCurrentUser,
  requireRole,
} from "./lib/auth";
import { domainError } from "./lib/contracts";
import { authComponent, createAuth } from "./auth";

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
        v.union(v.literal("writer"), v.literal("manager"), v.literal("admin")),
      ),
      createdAt: v.optional(v.number()),
      hasAuthAccount: v.boolean(),
    }),
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
      hasAuthAccount: Boolean(user.authId),
    }));
  },
});

/** Self-service credential update from /settings. Better Auth verifies the current password. */
export const changeMyPassword = mutation({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    if (args.newPassword.length < 8 || args.newPassword.length > 128) {
      domainError(
        "INVALID_INPUT",
        "Password must be between 8 and 128 characters",
      );
    }
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    await auth.api.changePassword({
      body: {
        currentPassword: args.currentPassword,
        newPassword: args.newPassword,
        revokeOtherSessions: true,
      },
      headers,
    });
    return null;
  },
});

/**
 * Admin-assisted account recovery. The target is resolved from our app user
 * document, never from a client-provided Better Auth id. Existing sessions are
 * revoked so the temporary credential becomes the only way back in.
 */
export const setTemporaryPassword = mutation({
  args: {
    userId: v.id("users"),
    temporaryPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await requireRole(ctx, ["admin"]);
    if (caller._id === args.userId) {
      domainError(
        "INVALID_INPUT",
        "Use Settings to change your own password with current-password verification",
      );
    }
    if (
      args.temporaryPassword.length < 8 ||
      args.temporaryPassword.length > 128
    ) {
      domainError(
        "INVALID_INPUT",
        "Password must be between 8 and 128 characters",
      );
    }

    const target = await ctx.db.get(args.userId);
    if (!target) domainError("NOT_FOUND", "User not found");
    if (!target.authId) {
      domainError(
        "INVALID_INPUT",
        "This user has not activated their account yet",
      );
    }

    // Use the password implementation configured by Better Auth, then write
    // only through the component's adapter API.
    const authContext = await createAuth(ctx).$context;
    const password = await authContext.password.hash(args.temporaryPassword);
    const credentialAccount = (
      await authContext.internalAdapter.findAccounts(target.authId)
    ).find((account) => account.providerId === "credential");

    if (credentialAccount) {
      await authContext.internalAdapter.updatePassword(target.authId, password);
    } else {
      await authContext.internalAdapter.createAccount({
        accountId: target.authId,
        providerId: "credential",
        userId: target.authId,
        password,
      });
    }

    await authContext.internalAdapter.deleteUserSessions(target.authId);
    return null;
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
      v.literal("admin"),
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
      v.literal("admin"),
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
