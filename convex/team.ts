import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserOrNull, requireInternalActor } from "./lib/auth";
import { hasCapability } from "./lib/roleCapabilities";
import {
  memberPdCount,
  memberWriterStaffRole,
  memberWriterWeight,
  userDisplayLabel,
  writerLabelFor,
  writersOfUser,
} from "./lib/teamRoster";
import { writerStaffRoleValidator } from "./lib/ingestionSheetValidators";

/**
 * Round 2 Team page (C1, C2; decisions 47 and 54). Members are read by
 * Managers and Admins (`team.view`); everyone else gets an empty list, the
 * silent-read policy `users.listTeam` already follows.
 */

// Bounded like `users.listUsers`: the firm has tens of people, not hundreds.
const MEMBER_LIMIT = 500;
export const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;

const roleValidator = v.union(
  v.literal("writer"),
  v.literal("manager"),
  v.literal("admin"),
);

export const listMembers = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      firstName: v.union(v.string(), v.null()),
      lastName: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      role: roleValidator,
      isOwner: v.boolean(),
      isDeveloper: v.boolean(),
      lastActiveAt: v.union(v.number(), v.null()),
      isSelf: v.boolean(),
      // 2026-11-16: the saved initials Import matches file names against
      // (null: none saved), and the past writer an Admin linked to this
      // account, if any.
      initials: v.union(v.string(), v.null()),
      linkedWriter: v.union(
        v.object({
          writerId: v.id("pdWriters"),
          label: v.string(),
          initials: v.union(v.string(), v.null()),
          fileCount: v.number(),
        }),
        v.null(),
      ),
      // 2026-11-23: Banhall PD staff role (supplies default weight when no
      // custom weight is set) and total imported PD count across own + linked.
      staffRole: v.union(writerStaffRoleValidator, v.null()),
      pdCount: v.number(),
      // 2026-11-18 (second): the person's writer weight an Admin set on
      // Team (0 to 1), or null when they use the role/global default.
      // Admin-only (roles.manage): omitted for Managers and other roles.
      weight: v.optional(v.union(v.number(), v.null())),
    }),
  ),
  handler: async (ctx) => {
    const viewer = await getCurrentUserOrNull(ctx);
    if (
      !viewer ||
      viewer.isAnonymous === true ||
      !hasCapability(viewer.role, "team.view")
    ) {
      return [];
    }
    const canSeeWeight = hasCapability(viewer.role, "roles.manage");
    const users = await ctx.db.query("users").take(MEMBER_LIMIT);
    const members = users.filter(
      (user) => user.isAnonymous !== true && user.role !== undefined,
    );
    const rows = await Promise.all(
      members.map(async (user) => {
        const activity = await ctx.db
          .query("userActivity")
          .withIndex("by_userId", (q) => q.eq("userId", user._id))
          .unique();
        const writers = await writersOfUser(ctx, user._id);
        const linked = writers.find((row) => row.linkedAt !== undefined) ?? null;
        return {
          _id: user._id,
          name: userDisplayLabel(user),
          firstName: user.firstName?.trim() || null,
          lastName: user.lastName?.trim() || null,
          email: user.email?.trim() || null,
          role: user.role!,
          isOwner: user.isOwner === true,
          isDeveloper: user.isDeveloper === true,
          lastActiveAt: activity?.lastActiveAt ?? null,
          isSelf: user._id === viewer._id,
          initials: user.initials || null,
          linkedWriter: linked
            ? {
                writerId: linked._id,
                // Its own name or initials: the member's name is already on the row.
                label: writerLabelFor({ ...linked, userId: undefined }, null),
                initials: linked.initials ?? null,
                fileCount: linked.fileCount,
              }
            : null,
          staffRole: memberWriterStaffRole(writers),
          pdCount: memberPdCount(writers),
          ...(canSeeWeight ? { weight: memberWriterWeight(writers) } : {}),
        };
      }),
    );
    return rows.sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
      });
      return byName || a._id.localeCompare(b._id);
    });
  },
});

/**
 * Heartbeat for Team's "Last active", mounted by the workspace shell (WS1).
 * Writes at most once per 5 minutes per user, so an open tab costs one small
 * write every few minutes and never touches the `users` row.
 */
export const markActive = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireInternalActor(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("userActivity")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!existing) {
      await ctx.db.insert("userActivity", { userId: user._id, lastActiveAt: now });
    } else if (now - existing.lastActiveAt >= ACTIVITY_THROTTLE_MS) {
      await ctx.db.patch(existing._id, { lastActiveAt: now });
    }
    return null;
  },
});
