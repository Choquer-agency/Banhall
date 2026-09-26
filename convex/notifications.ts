/**
 * Round 2 in-app notifications (WS1 spec section 7): the signed-in person's
 * own recent rows, marking them seen, and the per-kind switches on
 * /settings/notifications. Rows are written only by `convex/lib/notify.ts`.
 *
 * Reads never throw for a signed-out or roleless caller (the shell
 * subscribes before auth settles); writes require an active internal user.
 * No function reads or changes another person's rows.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUserOrNull, requireInternalActor } from "./lib/auth";
import { domainError } from "./lib/contracts";
import {
  getNotificationSettingsRow,
  isActiveInternalUser,
  resolveNotificationSettings,
} from "./lib/notify";
import { round2Internal } from "./lib/round2Api";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationKind,
  type NotificationSettingKey,
} from "../shared/notifications";

/** How far back `listRecent` looks. */
export const NOTIFICATION_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Most rows `listRecent` returns. */
export const NOTIFICATION_RECENT_LIMIT = 20;
/** Most ids one `markSeen` call accepts. */
export const MAX_MARK_SEEN_IDS = 50;
/** Rows older than this are deleted by `pruneOld`. */
export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Rows one `pruneOld` transaction deletes before it reschedules itself. */
export const NOTIFICATION_PRUNE_BATCH = 200;

// The schema spells the kinds out as literals; this fails to compile if it
// and shared/notifications.ts ever disagree.
type SchemaKind = Doc<"notifications">["kind"];
const kindsAgree: [SchemaKind] extends [NotificationKind]
  ? [NotificationKind] extends [SchemaKind]
    ? true
    : false
  : false = true;
void kindsAgree;

const notificationKindValidator = v.union(
  v.literal("ideas_ready"),
  v.literal("draft_ready"),
  v.literal("qa_finished"),
  v.literal("handoff"),
  v.literal("invite_accepted")
);

const settingKeyValidator = v.union(
  v.literal("ideasReady"),
  v.literal("draftReady"),
  v.literal("qaFinished"),
  v.literal("handoff"),
  v.literal("inviteAccepted")
);

const settingsValidator = v.object({
  ideasReady: v.boolean(),
  draftReady: v.boolean(),
  qaFinished: v.boolean(),
  handoff: v.boolean(),
  inviteAccepted: v.boolean(),
});

const notificationViewValidator = v.object({
  _id: v.id("notifications"),
  _creationTime: v.number(),
  kind: notificationKindValidator,
  projectId: v.optional(v.id("projects")),
  generationId: v.optional(v.id("generations")),
  title: v.string(),
  body: v.optional(v.string()),
  href: v.string(),
  createdAt: v.number(),
  seenAt: v.optional(v.number()),
});

function toView(row: Doc<"notifications">) {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    kind: row.kind,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.generationId ? { generationId: row.generationId } : {}),
    title: row.title,
    ...(row.body !== undefined ? { body: row.body } : {}),
    href: row.href,
    createdAt: row.createdAt,
    ...(row.seenAt !== undefined ? { seenAt: row.seenAt } : {}),
  };
}

/**
 * The caller's newest notifications from the last 7 days, newest first, at
 * most 20, seen and unseen. Empty for a signed-out, anonymous or roleless
 * caller, so the shell can subscribe without branching.
 */
export const listRecent = query({
  args: {},
  returns: v.array(notificationViewValidator),
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!isActiveInternalUser(user)) return [];
    const since = Date.now() - NOTIFICATION_RECENT_WINDOW_MS;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_userId_and_createdAt", (q) =>
        q.eq("userId", user._id).gte("createdAt", since)
      )
      .order("desc")
      .take(NOTIFICATION_RECENT_LIMIT);
    return rows.map(toView);
  },
});

/**
 * Marks the caller's own notifications seen. Refuses the whole call, before
 * any write, when an id belongs to someone else. Ids already seen keep their
 * first `seenAt`; ids that no longer exist (pruned, or erased with their
 * project) are skipped, so a retry is harmless.
 */
export const markSeen = mutation({
  args: { ids: v.array(v.id("notifications")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireInternalActor(ctx);
    if (args.ids.length > MAX_MARK_SEEN_IDS) {
      domainError("INVALID_INPUT", `Mark at most ${MAX_MARK_SEEN_IDS} notifications at a time`);
    }
    const unique = [...new Set(args.ids)] as Id<"notifications">[];
    const rows: Doc<"notifications">[] = [];
    for (const id of unique) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      if (row.userId !== user._id) {
        domainError("NOT_AUTHORIZED", "You can only mark your own notifications");
      }
      rows.push(row);
    }
    const now = Date.now();
    for (const row of rows) {
      if (row.seenAt === undefined) await ctx.db.patch(row._id, { seenAt: now });
    }
    return null;
  },
});

/** The caller's five switches (absent means on); all on when signed out. */
export const getSettings = query({
  args: {},
  returns: settingsValidator,
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!isActiveInternalUser(user)) return { ...DEFAULT_NOTIFICATION_SETTINGS };
    return resolveNotificationSettings(await getNotificationSettingsRow(ctx, user._id));
  },
});

/** Turns one kind on or off for the caller, creating their row when needed. */
export const setSetting = mutation({
  args: { key: settingKeyValidator, value: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireInternalActor(ctx);
    const key: NotificationSettingKey = args.key;
    const row = await getNotificationSettingsRow(ctx, user._id);
    if (row) {
      if (row[key] !== args.value) await ctx.db.patch(row._id, { [key]: args.value });
    } else {
      await ctx.db.insert("notificationSettings", { userId: user._id, [key]: args.value });
    }
    return null;
  },
});

/**
 * Daily cron "prune notifications": deletes rows older than 30 days, 200 per
 * transaction, and schedules itself again while more remain. Walks the
 * built-in `_creationTime` index (a row's `createdAt` is its insert time), so
 * the schema needs no extra index. Returns how many rows this run deleted.
 */
export const pruneOld = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - NOTIFICATION_RETENTION_MS;
    const old = await ctx.db
      .query("notifications")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(NOTIFICATION_PRUNE_BATCH + 1);
    const batch = old.slice(0, NOTIFICATION_PRUNE_BATCH);
    for (const row of batch) await ctx.db.delete(row._id);
    if (old.length > NOTIFICATION_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, round2Internal.notifications.pruneOld, {});
    }
    return batch.length;
  },
});
