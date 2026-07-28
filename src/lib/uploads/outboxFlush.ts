import { userErrorCode } from "$lib/errors";
import {
  clearOutboxFor,
  takeOutboxFor,
  type OutboxEntry,
  type OutboxFailureCode,
  type OutboxOrigin,
} from "./attemptOutbox";

/**
 * PSOS-04: the seam between the offline outbox and the two large upload
 * components. Those components import `convex-svelte` and cannot be
 * component-tested without mocks, so every decision worth testing is pulled
 * out here where it is pure.
 */

/** Mirrors MAX_BATCH in convex/uploadAttempts.ts (not exported server-side). */
export const ATTEMPT_BATCH_LIMIT = 50;

/**
 * How long to wait for an upload mutation before treating it as failed.
 *
 * Convex's WebSocket client never rejects a mutation for being offline: the
 * request is queued and replayed on reconnect (its promise is built with only a
 * `resolve`). Without a deadline an offline upload hangs forever, the user sees
 * a spinner with no explanation, and a reload loses the attempt with no trace —
 * exactly the case the durable audit trail exists to prevent.
 *
 * Timing out does not cancel the mutation, and it does not need to. If the
 * upload later lands, it resolves its attempt to `succeeded`, which is terminal
 * on both the record and fail paths — so the optimistic failure converges to
 * the truth rather than overriding it. 30s is far longer than this mutation
 * takes on a working connection; the file bytes travel separately.
 */
export const UPLOAD_MUTATION_TIMEOUT_MS = 30_000;

export class UploadTimeoutError extends Error {
  constructor() {
    super("Upload timed out");
    this.name = "UploadTimeoutError";
  }
}

/**
 * Resolve with the mutation, or reject once the deadline passes. Deliberately
 * carries no server text, so it stays safe to feed to the failure path.
 */
export function withUploadTimeout<T>(
  promise: Promise<T>,
  ms = UPLOAD_MUTATION_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UploadTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** The exact wire shape `recordUploadAttempts` accepts — nothing else survives. */
export type AttemptPayload = {
  attemptKey: string;
  fileName: string;
  fileSizeBytes?: number;
  origin: OutboxOrigin;
  failureCode: OutboxFailureCode;
};

/**
 * Whether a failed flush should discard the queued entry.
 *
 * A typed domain error means the server considered the request and refused it
 * — the project is gone, or this user may not touch it. Retrying forever would
 * be a poison loop, so the entry is dropped. A network error means the request
 * may never have arrived at all; that entry is still true and is kept for a
 * later flush. An untyped "Server Error" is also kept, bounded by the outbox
 * TTL rather than retried indefinitely.
 */
export function shouldDropOutboxEntry(error: unknown): boolean {
  return userErrorCode(error) !== null;
}

/**
 * Map queued entries to the mutation payload. Explicit field-by-field, so
 * `userId`, `projectId`, `at` — and anything a future edit adds to the entry —
 * cannot silently start crossing the wire.
 */
export function attemptsPayload(entries: OutboxEntry[]): AttemptPayload[] {
  return entries.map((entry) => ({
    attemptKey: entry.attemptKey,
    fileName: entry.fileName,
    ...(entry.fileSizeBytes !== undefined ? { fileSizeBytes: entry.fileSizeBytes } : {}),
    origin: entry.origin,
    failureCode: entry.failureCode,
  }));
}

export type FlushResult = "empty" | "flushed" | "dropped" | "kept";

/**
 * Send this user's queued failures for this project, clearing them only once
 * the server has accepted them. Crashing between the two is safe: the server
 * upserts by attempt key, so a re-flush converges.
 *
 * Never throws — a failed flush must not break the page that happens to be
 * mounting when it runs.
 */
export async function flushOutboxFor(
  userId: string,
  projectId: string,
  record: (attempts: AttemptPayload[]) => Promise<unknown>,
  timeoutMs = UPLOAD_MUTATION_TIMEOUT_MS
): Promise<FlushResult> {
  // Only ever clear what was actually sent: if the queue were ever larger than
  // one batch, clearing the rest would discard failures nobody recorded.
  const entries = takeOutboxFor(userId, projectId).slice(0, ATTEMPT_BATCH_LIMIT);
  if (entries.length === 0) return "empty";

  const keys = entries.map((entry) => entry.attemptKey);
  try {
    // Timed out here too, not just at the upload call sites: an offline flush
    // would otherwise hang forever instead of reporting that it kept the
    // entries for a later attempt.
    await withUploadTimeout(record(attemptsPayload(entries)), timeoutMs);
  } catch (error) {
    console.error("Outbox flush failed", error);
    if (shouldDropOutboxEntry(error)) {
      clearOutboxFor(userId, projectId, keys);
      return "dropped";
    }
    return "kept";
  }
  clearOutboxFor(userId, projectId, keys);
  return "flushed";
}
