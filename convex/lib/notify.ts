/**
 * The one writer of `notifications` rows (WS1 spec section 7). Other streams
 * call `notify` from mutation context; it never throws for a recipient who
 * should not get the row, it just returns null.
 *
 * Skipped (returns null), in this order:
 * 1. the recipient is not an active internal user: the `users` row is
 *    missing, is an anonymous auth record (`isAnonymous === true`), or has no
 *    `role`. The codebase has no separate "deactivated" flag; removing a
 *    person's role is how access ends, and `requireInternalActor` /
 *    `getInternalProjectAccessOrNull` use exactly this rule, so a person who
 *    could not open the notification never receives one;
 * 2. the recipient switched this kind off (`notificationSettings`, absent
 *    means on);
 * 3. a row with the same `dedupeKey` already exists (a retried mutation or a
 *    second emitter for the same event).
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTING_KEYS,
  settingKeyForKind,
  type NotificationKind,
  type NotificationSettings,
} from "../../shared/notifications";

export type NotifyInput = {
  userId: Id<"users">;
  kind: NotificationKind;
  projectId?: Id<"projects">;
  generationId?: Id<"generations">;
  title: string;
  body?: string;
  href: string;
  dedupeKey: string;
};

/** Longest stored title and body; longer copy is cut, never refused. */
export const MAX_NOTIFICATION_TITLE_CHARS = 200;
export const MAX_NOTIFICATION_BODY_CHARS = 500;
export const MAX_NOTIFICATION_DEDUPE_KEY_CHARS = 300;

/** Same eligibility as `requireInternalActor` in convex/lib/auth.ts. */
export function isActiveInternalUser(
  user: Doc<"users"> | null
): user is Doc<"users"> {
  return user !== null && user.isAnonymous !== true && Boolean(user.role);
}

export async function getNotificationSettingsRow(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
): Promise<Doc<"notificationSettings"> | null> {
  return await ctx.db
    .query("notificationSettings")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** The five switches with absent fields read as on. */
export function resolveNotificationSettings(
  row: Doc<"notificationSettings"> | null
): NotificationSettings {
  const settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  if (!row) return settings;
  for (const key of NOTIFICATION_SETTING_KEYS) {
    if (row[key] === false) settings[key] = false;
  }
  return settings;
}

function cut(value: string, limit: number) {
  const trimmed = value.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

/**
 * Inserts one notification for `input.userId`, or returns null when it is
 * skipped (see the module comment). `href` must be an app path (`/...`, not
 * `//host`): the toaster navigates to it.
 */
export async function notify(
  ctx: MutationCtx,
  input: NotifyInput
): Promise<Id<"notifications"> | null> {
  if (!input.href.startsWith("/") || input.href.startsWith("//")) {
    throw new Error("notify: href must be an app path starting with a single /");
  }
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey || dedupeKey.length > MAX_NOTIFICATION_DEDUPE_KEY_CHARS) {
    throw new Error("notify: dedupeKey must be 1 to 300 characters");
  }

  const user = await ctx.db.get(input.userId);
  if (!isActiveInternalUser(user)) return null;

  const settings = resolveNotificationSettings(
    await getNotificationSettingsRow(ctx, user._id)
  );
  if (!settings[settingKeyForKind(input.kind)]) return null;

  const existing = await ctx.db
    .query("notifications")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .first();
  if (existing) return null;

  const body = input.body === undefined ? "" : cut(input.body, MAX_NOTIFICATION_BODY_CHARS);
  return await ctx.db.insert("notifications", {
    userId: user._id,
    kind: input.kind,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.generationId ? { generationId: input.generationId } : {}),
    title: cut(input.title, MAX_NOTIFICATION_TITLE_CHARS),
    ...(body ? { body } : {}),
    href: input.href,
    dedupeKey,
    createdAt: Date.now(),
  });
}
