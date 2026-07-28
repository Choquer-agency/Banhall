import { beforeEach, describe, expect, it } from "vitest";
import {
  OUTBOX_CAP,
  OUTBOX_KEY_PREFIX,
  OUTBOX_TTL_MS,
  appendOutbox,
  clearAllOutboxes,
  clearOutboxFor,
  outboxKey,
  parseOutbox,
  sanitizeEntry,
  serializeOutbox,
  takeOutboxFor,
  type OutboxEntry,
} from "./attemptOutbox";

const USER_A = "user-a";
const USER_B = "user-b";
const PROJECT = "project-1";
const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    userId: USER_A,
    projectId: PROJECT,
    attemptKey: KEY_A,
    fileName: "notes.docx",
    origin: "chat_upload",
    failureCode: "upload_failed",
    at: Date.now(),
    ...overrides,
  };
}

/** Minimal localStorage so the storage shell can be exercised under node. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe("sanitizeEntry", () => {
  it("keeps only whitelisted fields, dropping anything error-shaped", () => {
    const poisoned = {
      ...entry(),
      message: "TypeError: failed to fetch",
      stack: "at uploadFiles (chunk.js:1)",
      error: new Error("boom"),
      file: { name: "notes.docx" },
    };
    const clean = sanitizeEntry(poisoned)!;

    expect(Object.keys(clean).sort()).toEqual([
      "at",
      "attemptKey",
      "failureCode",
      "fileName",
      "origin",
      "projectId",
      "userId",
    ]);
    expect(JSON.stringify(clean)).not.toMatch(/TypeError|stack|boom/);
  });

  it("rejects an attempt key that is not a UUID", () => {
    expect(sanitizeEntry(entry({ attemptKey: "TypeError: failed to fetch" }))).toBeNull();
    expect(sanitizeEntry(entry({ attemptKey: "not-a-uuid" }))).toBeNull();
  });

  it("rejects unknown origins and failure codes", () => {
    expect(
      sanitizeEntry({ ...entry(), origin: "smuggled" as never })
    ).toBeNull();
    expect(
      sanitizeEntry({ ...entry(), failureCode: "provider said no" as never })
    ).toBeNull();
  });

  it("caps a very long file name", () => {
    const clean = sanitizeEntry(entry({ fileName: "x".repeat(500) }))!;
    expect(clean.fileName.length).toBe(200);
  });

  it("rejects entries missing required identity", () => {
    expect(sanitizeEntry(entry({ userId: "" }))).toBeNull();
    expect(sanitizeEntry(entry({ projectId: "" }))).toBeNull();
    expect(sanitizeEntry(null)).toBeNull();
    expect(sanitizeEntry("a string")).toBeNull();
  });

  it("keeps a numeric size but drops a non-finite one", () => {
    expect(sanitizeEntry(entry({ fileSizeBytes: 1234 }))?.fileSizeBytes).toBe(1234);
    expect(
      sanitizeEntry(entry({ fileSizeBytes: Number.NaN }))?.fileSizeBytes
    ).toBeUndefined();
  });
});

describe("parseOutbox", () => {
  const now = Date.now();

  it("returns nothing for malformed or absent data instead of throwing", () => {
    expect(parseOutbox(null, now)).toEqual([]);
    expect(parseOutbox("{not json", now)).toEqual([]);
    expect(parseOutbox('{"not":"an array"}', now)).toEqual([]);
  });

  it("drops entries past the TTL and keeps fresh ones", () => {
    const raw = JSON.stringify([
      entry({ attemptKey: KEY_A, at: now - OUTBOX_TTL_MS - 1 }),
      entry({ attemptKey: KEY_B, at: now - 1_000 }),
    ]);
    const parsed = parseOutbox(raw, now);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].attemptKey).toBe(KEY_B);
  });

  it("skips unreadable entries without discarding the readable ones", () => {
    const raw = JSON.stringify([entry(), { junk: true }, entry({ attemptKey: KEY_B })]);
    expect(parseOutbox(raw, now)).toHaveLength(2);
  });
});

describe("serializeOutbox", () => {
  it("keeps the newest entries when over the cap", () => {
    const entries = Array.from({ length: OUTBOX_CAP + 10 }, (_, i) =>
      entry({ attemptKey: `3333333${i}`.padEnd(8, "0").slice(0, 8) + "-3333-4333-8333-333333333333", at: i })
    );
    const parsed = JSON.parse(serializeOutbox(entries)) as OutboxEntry[];
    expect(parsed).toHaveLength(OUTBOX_CAP);
    expect(parsed[parsed.length - 1].at).toBe(OUTBOX_CAP + 9);
  });

  it("produces identical payloads for repeated flushes", () => {
    const entries = [entry(), entry({ attemptKey: KEY_B })];
    expect(serializeOutbox(entries)).toBe(serializeOutbox(entries));
  });
});

describe("storage shell", () => {
  it("round-trips an entry for the right user and project", () => {
    appendOutbox(USER_A, entry());
    expect(takeOutboxFor(USER_A, PROJECT).map((e) => e.attemptKey)).toEqual([KEY_A]);
  });

  it("never returns one user's entries to another", () => {
    appendOutbox(USER_A, entry());
    appendOutbox(USER_B, entry({ userId: USER_B, attemptKey: KEY_B }));

    expect(takeOutboxFor(USER_B, PROJECT).map((e) => e.attemptKey)).toEqual([KEY_B]);
    expect(takeOutboxFor(USER_A, PROJECT).map((e) => e.attemptKey)).toEqual([KEY_A]);
  });

  it("refuses to file an entry under a user it does not belong to", () => {
    appendOutbox(USER_A, entry({ userId: USER_B }));
    expect(takeOutboxFor(USER_A, PROJECT)).toEqual([]);
  });

  it("keeps projects separate", () => {
    appendOutbox(USER_A, entry());
    appendOutbox(USER_A, entry({ projectId: "project-2", attemptKey: KEY_B }));
    expect(takeOutboxFor(USER_A, PROJECT).map((e) => e.attemptKey)).toEqual([KEY_A]);
  });

  it("re-queuing the same attempt key does not duplicate it", () => {
    appendOutbox(USER_A, entry());
    appendOutbox(USER_A, entry({ fileName: "renamed.docx" }));
    const queued = takeOutboxFor(USER_A, PROJECT);
    expect(queued).toHaveLength(1);
    expect(queued[0].fileName).toBe("renamed.docx");
  });

  it("clears only the flushed keys and leaves other work queued", () => {
    appendOutbox(USER_A, entry());
    appendOutbox(USER_A, entry({ attemptKey: KEY_B }));
    appendOutbox(USER_A, entry({ projectId: "project-2", attemptKey: KEY_B }));

    clearOutboxFor(USER_A, PROJECT, [KEY_A]);

    expect(takeOutboxFor(USER_A, PROJECT).map((e) => e.attemptKey)).toEqual([KEY_B]);
    expect(takeOutboxFor(USER_A, "project-2")).toHaveLength(1);
  });

  it("sign-out clears every user's queue, including legacy keys", () => {
    appendOutbox(USER_A, entry());
    appendOutbox(USER_B, entry({ userId: USER_B, attemptKey: KEY_B }));
    localStorage.setItem(`${OUTBOX_KEY_PREFIX}v1`, JSON.stringify([entry()]));

    clearAllOutboxes();

    expect(localStorage.getItem(outboxKey(USER_A))).toBeNull();
    expect(localStorage.getItem(outboxKey(USER_B))).toBeNull();
    expect(localStorage.getItem(`${OUTBOX_KEY_PREFIX}v1`)).toBeNull();
  });

  it("is inert without localStorage, so importing during SSR is safe", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => appendOutbox(USER_A, entry())).not.toThrow();
    expect(takeOutboxFor(USER_A, PROJECT)).toEqual([]);
    expect(() => clearAllOutboxes()).not.toThrow();
  });
});
