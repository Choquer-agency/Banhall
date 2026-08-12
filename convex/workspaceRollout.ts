/**
 * Workspace dashboard preview rollout (dashboard shell + dense projects
 * table). Remote controlled and fail-closed: the preview is available to a
 * caller only when BOTH the global master switch appSettings row
 * ("workspace.dashboard.v1.enabled" = "on") AND that caller's own enabled
 * `workspaceDashboardAccess` row exist. Missing/malformed/off — and duplicate
 * or ambiguous config rows — always mean disabled, and the global switch
 * always wins. Kept deliberately separate from the My Work rollout keys in
 * appSettings.ts.
 *
 * Concurrency + audit model:
 * - Config rows carry a `version`. Public admin mutations require
 *   `expectedVersion` (0 = no row yet) and fail with STALE_REVISION on
 *   conflict; `getAdminState` provides the current versions.
 * - Internal operational mutations (the emergency escape hatch) intentionally
 *   skip expectedVersion so an emergency master-off is never blocked; every
 *   change is still recorded.
 * - Every successful change appends an immutable
 *   `workspaceDashboardRolloutEvents` row in the same transaction. Events are
 *   never patched or deleted, including during duplicate-row repair.
 */
import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./lib/auth";
import { requireCapability } from "./lib/roleCapabilities";
import { domainError } from "./lib/contracts";
import { userDisplayLabel } from "./lib/teamRoster";

const MASTER_KEY = "workspace.dashboard.v1.enabled";
// Duplicate rows can only appear through races or manual writes, so a small
// defensive bound keeps every read/repair far inside transaction limits.
const DUPLICATE_ROW_BOUND = 8;
// Admin read-model bounds. The access table holds at most one admin-managed
// row per internal user (duplicates are anomalies), so a generous scan bound
// stays far inside transaction limits without a schema/index change.
const ACCESS_SCAN_BOUND = 200;
const EVENTS_DEFAULT_LIMIT = 20;
const EVENTS_MAX_LIMIT = 50;

async function masterRows(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", MASTER_KEY))
    .take(DUPLICATE_ROW_BOUND);
}

async function accessRows(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("workspaceDashboardAccess")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(DUPLICATE_ROW_BOUND);
}

/** Fail-closed read: exactly one well-formed "on" row enables the master. */
async function masterEnabled(ctx: QueryCtx | MutationCtx) {
  const rows = await masterRows(ctx);
  // Zero rows, duplicate rows, or anything other than an exact "on" fails
  // closed until a setter repairs the duplicates.
  return rows.length === 1 && rows[0]?.value === "on";
}

function assertActiveInternalAdmin(admin: Doc<"users"> | null) {
  if (
    !admin ||
    admin.role !== "admin" ||
    admin.isAnonymous === true ||
    !admin.authId
  ) {
    throw new Error("An active administrator with a linked sign-in is required");
  }
  return admin;
}

/** Enabling requires an active, auth-linked internal target. */
function assertEnableEligibleTarget(target: Doc<"users"> | null) {
  if (!target) domainError("NOT_FOUND", "User not found");
  if (target.isAnonymous === true || !target.role || !target.authId) {
    domainError(
      "INVALID_INPUT",
      "The workspace dashboard preview can only be granted to an active internal user with a role and a linked sign-in"
    );
  }
  return target;
}

function assertExpectedVersion(expected: number, current: number) {
  if (!Number.isInteger(expected) || expected < 0) {
    domainError("INVALID_INPUT", "expectedVersion must be a non-negative integer");
  }
  if (expected !== current) {
    domainError(
      "STALE_REVISION",
      "The rollout configuration changed since it was read. Reload and retry.",
      { expected: String(expected), current: String(current) }
    );
  }
}

/**
 * Converge duplicate master rows to one canonical row (keep the oldest,
 * delete extras) and apply the new value. Works even when duplicates exist so
 * the emergency master-off is never blocked.
 */
async function setMaster(ctx: MutationCtx, enabled: boolean, adminId: Id<"users">) {
  const rows = await masterRows(ctx);
  const [canonical, ...extras] = rows;
  for (const extra of extras) await ctx.db.delete(extra._id);
  const previousEnabled = rows.length === 1 && canonical ? canonical.value === "on" : undefined;
  const patch = {
    value: enabled ? "on" : "off",
    updatedBy: adminId,
    updatedAt: Date.now(),
    version: (canonical?.version ?? 0) + 1,
  };
  if (canonical) await ctx.db.patch(canonical._id, patch);
  else await ctx.db.insert("appSettings", { key: MASTER_KEY, ...patch });
  return { previousEnabled };
}

/**
 * Converge duplicate access rows to one canonical row and apply the new
 * enabled state. Disabling never requires an eligible target — only an
 * addressable user id — so stale/anonymous/roleless/auth-unlinked targets can
 * always be cleaned up. A disabled row is kept (not deleted) so a later
 * reactivated account never silently inherits enabled access.
 */
async function upsertUserAccess(
  ctx: MutationCtx,
  userId: Id<"users">,
  enabled: boolean,
  adminId: Id<"users">
) {
  const rows = await accessRows(ctx, userId);
  const [canonical, ...extras] = rows;
  for (const extra of extras) await ctx.db.delete(extra._id);
  const previousEnabled = rows.length === 1 ? canonical?.enabled : undefined;
  const patch = {
    enabled,
    updatedBy: adminId,
    updatedAt: Date.now(),
    version: (canonical?.version ?? 0) + 1,
  };
  if (canonical) await ctx.db.patch(canonical._id, patch);
  else await ctx.db.insert("workspaceDashboardAccess", { userId, ...patch });
  return { previousEnabled };
}

async function recordEvent(
  ctx: MutationCtx,
  event: {
    actorId: Id<"users">;
    scope: "master" | "user_access";
    targetUserId?: Id<"users">;
    enabled: boolean;
    previousEnabled?: boolean;
    via: "public" | "internal";
  }
) {
  await ctx.db.insert("workspaceDashboardRolloutEvents", {
    ...event,
    occurredAt: Date.now(),
  });
}

/**
 * Caller-scoped availability decision. Identity is derived server-side and
 * only the small decision is returned — allowlist details are never exposed
 * to normal users.
 */
export const getAccess = query({
  args: {},
  returns: v.object({ available: v.boolean() }),
  handler: async (ctx) => {
    const { user } = await requireCapability(ctx, "project.readInternal");
    // Owner direction 2026-08-11: administrators always see the preview
    // workspace; the master switch + per-user allowlist govern everyone else.
    if (user.role === "admin") return { available: true };
    if (!(await masterEnabled(ctx))) return { available: false };
    const rows = await accessRows(ctx, user._id);
    // Zero or duplicate rows fail closed until a setter repairs them.
    return { available: rows.length === 1 && rows[0]?.enabled === true };
  },
});

/**
 * Admin read model for the rollout config: current values plus the versions
 * that public mutations must echo back as `expectedVersion`. `duplicates`
 * flags rows needing repair (any setter call converges them).
 */
export const getAdminState = query({
  args: { userId: v.optional(v.id("users")) },
  returns: v.object({
    master: v.object({
      enabled: v.boolean(),
      version: v.number(),
      duplicates: v.boolean(),
    }),
    userAccess: v.optional(
      v.object({
        enabled: v.boolean(),
        version: v.number(),
        duplicates: v.boolean(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const master = await masterRows(ctx);
    const result: {
      master: { enabled: boolean; version: number; duplicates: boolean };
      userAccess?: { enabled: boolean; version: number; duplicates: boolean };
    } = {
      master: {
        enabled: master.length === 1 && master[0]?.value === "on",
        version: master[0]?.version ?? 0,
        duplicates: master.length > 1,
      },
    };
    if (args.userId) {
      const rows = await accessRows(ctx, args.userId);
      if (rows.length > 0) {
        result.userAccess = {
          enabled: rows.length === 1 && rows[0]?.enabled === true,
          version: rows[0]?.version ?? 0,
          duplicates: rows.length > 1,
        };
      }
    }
    return result;
  },
});

export const setMasterSwitch = mutation({
  args: { enabled: v.boolean(), expectedVersion: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const rows = await masterRows(ctx);
    if (rows.length > 1) {
      domainError(
        "INVALID_STATE",
        "The master rollout setting has duplicate rows. Use the internal emergency-off operation, then reload."
      );
    }
    assertExpectedVersion(args.expectedVersion, rows[0]?.version ?? 0);
    const { previousEnabled } = await setMaster(ctx, args.enabled, admin._id);
    await recordEvent(ctx, {
      actorId: admin._id,
      scope: "master",
      enabled: args.enabled,
      previousEnabled,
      via: "public",
    });
    return null;
  },
});

// Operational escape hatch — no expectedVersion so an emergency master-off is
// never blocked by a concurrent edit or duplicate rows, e.g.:
//   npx convex run workspaceRollout:setMasterSwitchInternal '{"enabled":false,"adminId":"..."}'
export const setMasterSwitchInternal = internalMutation({
  args: { enabled: v.boolean(), adminId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = assertActiveInternalAdmin(await ctx.db.get(args.adminId));
    if (args.enabled) {
      domainError(
        "INVALID_INPUT",
        "The non-versioned internal operation is rollback-only. Enable the rollout through the versioned Admin mutation."
      );
    }
    const { previousEnabled } = await setMaster(ctx, false, admin._id);
    await recordEvent(ctx, {
      actorId: admin._id,
      scope: "master",
      enabled: false,
      previousEnabled,
      via: "internal",
    });
    return null;
  },
});

export const setUserAccess = mutation({
  args: { userId: v.id("users"), enabled: v.boolean(), expectedVersion: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    if (args.enabled) assertEnableEligibleTarget(await ctx.db.get(args.userId));
    const rows = await accessRows(ctx, args.userId);
    if (rows.length > 1) {
      domainError(
        "INVALID_STATE",
        "This user has duplicate rollout access rows. Disable access through the internal cleanup operation, then reload."
      );
    }
    assertExpectedVersion(args.expectedVersion, rows[0]?.version ?? 0);
    const { previousEnabled } = await upsertUserAccess(ctx, args.userId, args.enabled, admin._id);
    await recordEvent(ctx, {
      actorId: admin._id,
      scope: "user_access",
      targetUserId: args.userId,
      enabled: args.enabled,
      previousEnabled,
      via: "public",
    });
    return null;
  },
});

/**
 * Admin read model: every user who currently has at least one ENABLED access
 * row, with the data the rollout card needs (label, version for OCC disable,
 * duplicate warning). Duplicate rows fail closed in `getAccess`, but they are
 * listed here so the admin can see and repair them. Bounded scan — the table
 * is a tiny admin-managed allowlist and has no index on `enabled` (additive
 * read model; no schema change). `truncated` flags a scan that hit the bound.
 */
export const listEnabledAccess = query({
  args: {},
  returns: v.object({
    entries: v.array(
      v.object({
        userId: v.id("users"),
        displayName: v.string(),
        email: v.optional(v.string()),
        version: v.number(),
        updatedAt: v.number(),
        duplicates: v.boolean(),
      })
    ),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const rows = await ctx.db.query("workspaceDashboardAccess").take(ACCESS_SCAN_BOUND);
    const byUser = new Map<Id<"users">, Doc<"workspaceDashboardAccess">[]>();
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }
    const entries: Array<{
      userId: Id<"users">;
      displayName: string;
      email?: string;
      version: number;
      updatedAt: number;
      duplicates: boolean;
    }> = [];
    for (const [userId, userRows] of byUser) {
      if (!userRows.some((row) => row.enabled === true)) continue;
      const user = await ctx.db.get(userId);
      entries.push({
        userId,
        displayName: user ? userDisplayLabel(user) : "Unknown user",
        ...(user?.email ? { email: user.email } : {}),
        version: Math.max(...userRows.map((row) => row.version ?? 0)),
        updatedAt: Math.max(...userRows.map((row) => row.updatedAt)),
        duplicates: userRows.length > 1,
      });
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    return { entries, truncated: rows.length === ACCESS_SCAN_BOUND };
  },
});

/**
 * Admin read model: most recent rollout audit events, newest first,
 * index-backed (`by_occurredAt`) and bounded. Display labels are resolved
 * server-side so the card never needs the full user list.
 */
export const listRolloutEvents = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      id: v.id("workspaceDashboardRolloutEvents"),
      scope: v.union(v.literal("master"), v.literal("user_access")),
      enabled: v.boolean(),
      previousEnabled: v.optional(v.boolean()),
      via: v.union(v.literal("public"), v.literal("internal")),
      occurredAt: v.number(),
      actorId: v.id("users"),
      actorName: v.string(),
      targetUserId: v.optional(v.id("users")),
      targetName: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const requested = Number.isFinite(args.limit) ? Math.floor(args.limit as number) : EVENTS_DEFAULT_LIMIT;
    const limit = Math.min(Math.max(requested, 1), EVENTS_MAX_LIMIT);
    const events = await ctx.db
      .query("workspaceDashboardRolloutEvents")
      .withIndex("by_occurredAt")
      .order("desc")
      .take(limit);
    const labelCache = new Map<Id<"users">, string>();
    const labelFor = async (userId: Id<"users">) => {
      const cached = labelCache.get(userId);
      if (cached !== undefined) return cached;
      const user = await ctx.db.get(userId);
      const label = user ? userDisplayLabel(user) : "Unknown user";
      labelCache.set(userId, label);
      return label;
    };
    const result = [];
    for (const event of events) {
      result.push({
        id: event._id,
        scope: event.scope,
        enabled: event.enabled,
        ...(event.previousEnabled !== undefined ? { previousEnabled: event.previousEnabled } : {}),
        via: event.via,
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        actorName: await labelFor(event.actorId),
        ...(event.targetUserId
          ? { targetUserId: event.targetUserId, targetName: await labelFor(event.targetUserId) }
          : {}),
      });
    }
    return result;
  },
});

export const setUserAccessInternal = internalMutation({
  args: { userId: v.id("users"), enabled: v.boolean(), adminId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = assertActiveInternalAdmin(await ctx.db.get(args.adminId));
    if (args.enabled) {
      domainError(
        "INVALID_INPUT",
        "The non-versioned internal operation is cleanup-only. Enable user access through the versioned Admin mutation."
      );
    }
    const { previousEnabled } = await upsertUserAccess(ctx, args.userId, false, admin._id);
    await recordEvent(ctx, {
      actorId: admin._id,
      scope: "user_access",
      targetUserId: args.userId,
      enabled: false,
      previousEnabled,
      via: "internal",
    });
    return null;
  },
});

