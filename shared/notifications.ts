/**
 * Round 2 in-app notifications (WS1 spec section 7): the kinds, the per-user
 * settings keys and the copy every emitter uses, so the toaster, the
 * Settings page and each backend emitter say the same thing.
 *
 * Runtime-free: no Convex imports, so both `convex/` and `src/` can load it.
 * The schema (`convex/schema.ts`, `notifications.kind`) spells the same
 * kinds out as literals; `convex/notifications.ts` checks the two agree.
 *
 * Copy rules: plain hyphen only, no em or en dashes (AGENTS.md, dashfix).
 */

export const NOTIFICATION_KINDS = [
  "ideas_ready",
  "draft_ready",
  "qa_finished",
  "handoff",
  "invite_accepted",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Kinds an AI run emits; the toaster shows the Aurora mark on these. */
export const AI_NOTIFICATION_KINDS = [
  "ideas_ready",
  "draft_ready",
  "qa_finished",
] as const satisfies readonly NotificationKind[];

export type AiNotificationKind = (typeof AI_NOTIFICATION_KINDS)[number];

export function isAiNotificationKind(kind: NotificationKind): kind is AiNotificationKind {
  return (AI_NOTIFICATION_KINDS as readonly NotificationKind[]).includes(kind);
}

/** Field names on `notificationSettings`, one per kind. */
export const NOTIFICATION_SETTING_KEYS = [
  "ideasReady",
  "draftReady",
  "qaFinished",
  "handoff",
  "inviteAccepted",
] as const;

export type NotificationSettingKey = (typeof NOTIFICATION_SETTING_KEYS)[number];

export type NotificationSettings = Record<NotificationSettingKey, boolean>;

/** Absent means on: a person with no settings row gets every kind. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  ideasReady: true,
  draftReady: true,
  qaFinished: true,
  handoff: true,
  inviteAccepted: true,
};

const SETTING_KEY_BY_KIND: Record<NotificationKind, NotificationSettingKey> = {
  ideas_ready: "ideasReady",
  draft_ready: "draftReady",
  qa_finished: "qaFinished",
  handoff: "handoff",
  invite_accepted: "inviteAccepted",
};

export function settingKeyForKind(kind: NotificationKind): NotificationSettingKey {
  return SETTING_KEY_BY_KIND[kind];
}

export type NotificationCopy = { title: string; body: string };

/**
 * Title and body for each kind. Proposed copy (not designed) except
 * ideas_ready, which is board F6.
 */
export const notificationCopy = {
  ideasReady({ step, project }: { step: string; project: string }): NotificationCopy {
    return {
      title: `Ideas are ready for ${step}`,
      body: `${project}. Opens the Plan tab on that step.`,
    };
  },
  draftReady({ project }: { project: string }): NotificationCopy {
    return { title: "Your draft is ready", body: `${project}. QA is checking it.` };
  },
  qaFinished({ project, score }: { project: string; score: number }): NotificationCopy {
    return { title: "QA finished", body: `${project}, score ${score}.` };
  },
  handoff({ project, stage, name }: { project: string; stage: string; name: string }): NotificationCopy {
    return { title: `${project} is with you`, body: `${stage}. Handed off by ${name}.` };
  },
  inviteAccepted({ name, role }: { name: string; role: string }): NotificationCopy {
    return {
      title: `${name} joined Banhall`,
      body: `They accepted your invite as ${role}.`,
    };
  },
} as const;
