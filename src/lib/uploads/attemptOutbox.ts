/**
 * PSOS-04: a localStorage queue for upload failures that never reached Convex.
 *
 * When the network is down at the very first mutation, no server table can know
 * the upload was ever attempted — the request does not exist. This is the only
 * honest way to make those failures survive a reload, and its limits are real:
 * an entry lives on one browser profile, so a different device or cleared
 * storage loses it.
 *
 * Two properties are load-bearing:
 *
 * 1. **No error text can enter.** `OutboxEntry` has no message, stack, or error
 *    field, and `sanitizeEntry` rebuilds every entry field by field from a
 *    whitelist. Anything else on the object is dropped rather than trusted.
 * 2. **Entries are scoped to the user who queued them.** Sign-out does not
 *    clear localStorage, and the attempts table stamps `createdBy` from the
 *    *current* session — so an unscoped queue would let one user's failures be
 *    recorded against whoever signs in next, on the table that exists to be an
 *    audit trail.
 */

export const OUTBOX_KEY_PREFIX = "banhall.uploadAttemptOutbox.";

export const outboxKey = (userId: string) => `${OUTBOX_KEY_PREFIX}v2:${userId}`;

/** Bounded so a long offline spell can't fill the user's storage quota. */
export const OUTBOX_CAP = 50;

/** An entry nobody has flushed in a week is not worth recording. */
export const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const MAX_FILE_NAME_CHARS = 200;

const ATTEMPT_KEY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORIGINS = ["chat_upload", "context_input", "review_pd"] as const;
const FAILURE_CODES = ["rejected_unsupported", "upload_failed"] as const;

export type OutboxOrigin = (typeof ORIGINS)[number];
export type OutboxFailureCode = (typeof FAILURE_CODES)[number];

export type OutboxEntry = {
  userId: string;
  projectId: string;
  attemptKey: string;
  fileName: string;
  fileSizeBytes?: number;
  origin: OutboxOrigin;
  failureCode: OutboxFailureCode;
  at: number;
};

/**
 * Rebuild an entry from whitelisted fields, or reject it. Never spread the
 * input: copying it wholesale is how a caught error object's `message` would
 * end up persisted and later sent to the server.
 */
export function sanitizeEntry(raw: unknown): OutboxEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const { userId, projectId, attemptKey, fileName } = value;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof projectId !== "string" || projectId.length === 0) return null;
  if (typeof attemptKey !== "string" || !ATTEMPT_KEY_RE.test(attemptKey)) return null;
  if (typeof fileName !== "string" || fileName.length === 0) return null;
  if (!ORIGINS.includes(value.origin as OutboxOrigin)) return null;
  if (!FAILURE_CODES.includes(value.failureCode as OutboxFailureCode)) return null;
  if (typeof value.at !== "number" || !Number.isFinite(value.at)) return null;

  const entry: OutboxEntry = {
    userId,
    projectId,
    attemptKey: attemptKey.toLowerCase(),
    fileName: fileName.slice(0, MAX_FILE_NAME_CHARS),
    origin: value.origin as OutboxOrigin,
    failureCode: value.failureCode as OutboxFailureCode,
    at: value.at,
  };
  if (typeof value.fileSizeBytes === "number" && Number.isFinite(value.fileSizeBytes)) {
    entry.fileSizeBytes = value.fileSizeBytes;
  }
  return entry;
}

/** Newest entries win when the cap is hit. */
export function serializeOutbox(entries: OutboxEntry[]): string {
  const clean = entries
    .map(sanitizeEntry)
    .filter((entry): entry is OutboxEntry => entry !== null);
  return JSON.stringify(clean.slice(-OUTBOX_CAP));
}

/**
 * Tolerant by design: this parses data that survived a reload, a deploy, and
 * possibly a different app version. Anything unreadable is dropped rather than
 * thrown, because a corrupt queue must never break the page that reads it.
 */
export function parseOutbox(raw: string | null, now: number): OutboxEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(sanitizeEntry)
    .filter((entry): entry is OutboxEntry => entry !== null && now - entry.at < OUTBOX_TTL_MS);
}

// ─── Storage shell ──────────────────────────────────────────────────────────
// Every function below is a no-op without localStorage, so importing this
// module during SSR is safe and callers need no guards of their own.

function available(): boolean {
  return typeof localStorage !== "undefined";
}

function read(userId: string, now: number): OutboxEntry[] {
  if (!available()) return [];
  try {
    return parseOutbox(localStorage.getItem(outboxKey(userId)), now);
  } catch {
    return [];
  }
}

function write(userId: string, entries: OutboxEntry[]): void {
  if (!available()) return;
  try {
    if (entries.length === 0) localStorage.removeItem(outboxKey(userId));
    else localStorage.setItem(outboxKey(userId), serializeOutbox(entries));
  } catch {
    // A full or disabled storage costs us a queued failure, never the upload.
  }
}

export function appendOutbox(
  userId: string,
  entry: OutboxEntry,
  now = Date.now()
): void {
  const sanitized = sanitizeEntry(entry);
  if (!sanitized || sanitized.userId !== userId) return;
  // Replace by the same compound key the server upserts on. Deduping on
  // attemptKey alone would let a queued entry evict an unrelated one that
  // happens to share it under a different project.
  const existing = read(userId, now).filter(
    (e) =>
      e.projectId !== sanitized.projectId || e.attemptKey !== sanitized.attemptKey
  );
  write(userId, [...existing, sanitized]);
}

/** Entries this user queued for this project, oldest first. */
export function takeOutboxFor(
  userId: string,
  projectId: string,
  now = Date.now()
): OutboxEntry[] {
  return read(userId, now).filter((entry) => entry.projectId === projectId);
}

/** Called only after the server has accepted the entries. */
export function clearOutboxFor(
  userId: string,
  projectId: string,
  attemptKeys: string[],
  now = Date.now()
): void {
  const flushed = new Set(attemptKeys);
  const remaining = read(userId, now).filter(
    (entry) => entry.projectId !== projectId || !flushed.has(entry.attemptKey)
  );
  write(userId, remaining);
}

/**
 * Sign-out sweep. Clears every user's queue on this browser, including any key
 * left by an older version — the next person to sign in must never inherit
 * someone else's pending audit rows.
 */
export function clearAllOutboxes(): void {
  if (!available()) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(OUTBOX_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* nothing safe to do, and never worth blocking sign-out */
  }
}
