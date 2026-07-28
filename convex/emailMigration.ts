import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { isNormalizedEmail, normalizeEmail } from "./lib/email";

const migrationResult = v.object({
  scanned: v.number(),
  patched: v.number(),
  skippedCollisions: v.number(),
  skippedInvalid: v.number(),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

/** Read-only preflight and postflight report. Internal because email addresses
 * are account data and should never be exposed by a public query. */
export const report = internalQuery({
  args: {},
  returns: v.object({
    nonNormalizedUsers: v.array(
      v.object({ id: v.id("users"), email: v.string(), normalized: v.string() }),
    ),
    nonNormalizedInvites: v.array(
      v.object({ id: v.id("invites"), email: v.string(), normalized: v.string() }),
    ),
    userCollisions: v.array(
      v.object({
        normalized: v.string(),
        users: v.array(
          v.object({
            id: v.id("users"),
            email: v.string(),
            hasAuthAccount: v.boolean(),
            role: v.optional(
              v.union(
                v.literal("writer"),
                v.literal("manager"),
                v.literal("admin"),
              ),
            ),
          }),
        ),
      }),
    ),
    duplicatePendingInvites: v.array(
      v.object({
        normalized: v.string(),
        inviteIds: v.array(v.id("invites")),
      }),
    ),
    missingOrInvalidUserEmails: v.number(),
    usersTruncated: v.boolean(),
    invitesTruncated: v.boolean(),
  }),
  handler: async (ctx) => {
    // Firm rosters are currently small. Keep this diagnostic bounded and say
    // explicitly if the cap is reached instead of silently reporting "clean".
    const [userRows, inviteRows] = await Promise.all([
      ctx.db.query("users").take(1_001),
      ctx.db.query("invites").take(1_001),
    ]);
    const users = userRows.slice(0, 1_000);
    const invites = inviteRows.slice(0, 1_000);

    const usersByNormalized = new Map<string, typeof users>();
    let missingOrInvalidUserEmails = 0;
    const nonNormalizedUsers = [];
    for (const user of users) {
      const normalized = normalizeEmail(user.email);
      if (!normalized) {
        missingOrInvalidUserEmails += 1;
        continue;
      }
      const group = usersByNormalized.get(normalized) ?? [];
      group.push(user);
      usersByNormalized.set(normalized, group);
      if (!isNormalizedEmail(user.email!)) {
        nonNormalizedUsers.push({ id: user._id, email: user.email!, normalized });
      }
    }

    const pendingByNormalized = new Map<string, typeof invites>();
    const nonNormalizedInvites = [];
    const now = Date.now();
    for (const invite of invites) {
      const normalized = normalizeEmail(invite.email);
      if (!normalized) continue;
      if (!isNormalizedEmail(invite.email)) {
        nonNormalizedInvites.push({
          id: invite._id,
          email: invite.email,
          normalized,
        });
      }
      if (invite.status === "pending" && invite.expiresAt > now) {
        const group = pendingByNormalized.get(normalized) ?? [];
        group.push(invite);
        pendingByNormalized.set(normalized, group);
      }
    }

    return {
      nonNormalizedUsers,
      nonNormalizedInvites,
      userCollisions: [...usersByNormalized.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([normalized, group]) => ({
          normalized,
          users: group.map((user) => ({
            id: user._id,
            email: user.email!,
            hasAuthAccount: Boolean(user.authId),
            role: user.role,
          })),
        })),
      duplicatePendingInvites: [...pendingByNormalized.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([normalized, group]) => ({
          normalized,
          inviteIds: group.map((invite) => invite._id),
        })),
      missingOrInvalidUserEmails,
      usersTruncated: userRows.length > 1_000,
      invitesTruncated: inviteRows.length > 1_000,
    };
  },
});

/** Invoke live mode once with a null cursor; it self-schedules subsequent
 * pages. Dry-run mode never schedules, so callers may inspect each returned
 * cursor manually. */
export const normalizeInviteEmails = internalMutation({
  args: {
    paginationOpts: paginationOptsValidator,
    dryRun: v.optional(v.boolean()),
  },
  returns: migrationResult,
  handler: async (ctx, args) => {
    const page = await ctx.db.query("invites").paginate(args.paginationOpts);
    let patched = 0;
    let skippedInvalid = 0;
    for (const invite of page.page) {
      const normalized = normalizeEmail(invite.email);
      if (!normalized) {
        skippedInvalid += 1;
      } else if (normalized !== invite.email) {
        if (!args.dryRun) await ctx.db.patch(invite._id, { email: normalized });
        patched += 1;
      }
    }
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, internal.emailMigration.normalizeInviteEmails, {
        paginationOpts: {
          numItems: args.paginationOpts.numItems,
          cursor: page.continueCursor,
        },
        dryRun: false,
      });
    }
    return {
      scanned: page.page.length,
      patched,
      skippedCollisions: 0,
      skippedInvalid,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** Invoke live mode once with a null cursor; it self-schedules subsequent
 * pages. Dry-run mode never schedules, so callers may inspect each returned
 * cursor manually. Collision groups are skipped in their entirety. */
export const normalizeUserEmails = internalMutation({
  args: {
    paginationOpts: paginationOptsValidator,
    dryRun: v.optional(v.boolean()),
  },
  returns: migrationResult,
  handler: async (ctx, args) => {
    const [page, allRows] = await Promise.all([
      ctx.db.query("users").paginate(args.paginationOpts),
      ctx.db.query("users").take(1_001),
    ]);
    if (allRows.length > 1_000) {
      throw new Error(
        "User email normalization stopped: the collision preflight cap was reached. Increase the bounded migration design before continuing.",
      );
    }
    const counts = new Map<string, number>();
    for (const user of allRows) {
      const normalized = normalizeEmail(user.email);
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    let patched = 0;
    let skippedCollisions = 0;
    let skippedInvalid = 0;
    for (const user of page.page) {
      const normalized = normalizeEmail(user.email);
      if (!normalized) {
        skippedInvalid += 1;
      } else if ((counts.get(normalized) ?? 0) > 1) {
        skippedCollisions += 1;
      } else if (normalized !== user.email) {
        if (!args.dryRun) await ctx.db.patch(user._id, { email: normalized });
        patched += 1;
      }
    }
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, internal.emailMigration.normalizeUserEmails, {
        paginationOpts: {
          numItems: args.paginationOpts.numItems,
          cursor: page.continueCursor,
        },
        dryRun: false,
      });
    }
    return {
      scanned: page.page.length,
      patched,
      skippedCollisions,
      skippedInvalid,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
