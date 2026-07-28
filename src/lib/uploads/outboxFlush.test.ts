import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendOutbox, takeOutboxFor, type OutboxEntry } from "./attemptOutbox";
import {
  ATTEMPT_BATCH_LIMIT,
  UploadTimeoutError,
  attemptsPayload,
  flushOutboxFor,
  shouldDropOutboxEntry,
  withUploadTimeout,
} from "./outboxFlush";

const USER = "user-a";
const PROJECT = "project-1";
const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    userId: USER,
    projectId: PROJECT,
    attemptKey: KEY_A,
    fileName: "notes.docx",
    origin: "chat_upload",
    failureCode: "upload_failed",
    at: Date.now(),
    ...overrides,
  };
}

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

describe("shouldDropOutboxEntry", () => {
  it("drops when the server refused the request with a typed domain error", () => {
    expect(
      shouldDropOutboxEntry({ data: { code: "NOT_FOUND", message: "Project not found" } })
    ).toBe(true);
    expect(
      shouldDropOutboxEntry(
        new Error(
          'Uncaught ConvexError: {"code":"NOT_AUTHORIZED","message":"no"}\n  at handler'
        )
      )
    ).toBe(true);
  });

  it("keeps the entry when the request may never have arrived", () => {
    // The whole point of the outbox: a network failure is exactly the case it
    // exists to record, so it must never discard itself on one.
    expect(shouldDropOutboxEntry(new TypeError("Failed to fetch"))).toBe(false);
    expect(shouldDropOutboxEntry(new Error("Server Error"))).toBe(false);
    expect(shouldDropOutboxEntry(new Error("[CONVEX M(uploadAttempts)] timeout"))).toBe(
      false
    );
  });

  it("keeps the entry for anything it cannot interpret", () => {
    for (const value of [undefined, null, "a string", 42, {}]) {
      expect(shouldDropOutboxEntry(value), String(value)).toBe(false);
    }
  });
});

describe("attemptsPayload", () => {
  it("sends only the fields the mutation accepts", () => {
    const [payload] = attemptsPayload([entry({ fileSizeBytes: 99 })]);
    expect(Object.keys(payload).sort()).toEqual([
      "attemptKey",
      "failureCode",
      "fileName",
      "fileSizeBytes",
      "origin",
    ]);
  });

  it("omits an absent file size rather than sending undefined", () => {
    const [payload] = attemptsPayload([entry()]);
    expect("fileSizeBytes" in payload).toBe(false);
  });

  it("never forwards identity or anything error-shaped", () => {
    const poisoned = {
      ...entry(),
      message: "TypeError: failed to fetch",
      stack: "at uploadFiles",
    } as OutboxEntry;
    const [payload] = attemptsPayload([poisoned]);
    expect(JSON.stringify(payload)).not.toMatch(/TypeError|stack|user-a|project-1/);
  });
});

describe("flushOutboxFor", () => {
  it("does nothing when there is nothing queued", async () => {
    const record = vi.fn();
    expect(await flushOutboxFor(USER, PROJECT, record)).toBe("empty");
    expect(record).not.toHaveBeenCalled();
  });

  it("sends queued entries and clears them once accepted", async () => {
    appendOutbox(USER, entry());
    appendOutbox(USER, entry({ attemptKey: KEY_B }));
    const record = vi.fn().mockResolvedValue(undefined);

    expect(await flushOutboxFor(USER, PROJECT, record)).toBe("flushed");
    expect(record.mock.calls[0][0]).toHaveLength(2);
    expect(takeOutboxFor(USER, PROJECT)).toEqual([]);
  });

  it("keeps entries when the network failed, so nothing is lost", async () => {
    appendOutbox(USER, entry());
    const record = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await flushOutboxFor(USER, PROJECT, record)).toBe("kept");
    expect(takeOutboxFor(USER, PROJECT)).toHaveLength(1);
  });

  it("drops entries the server will never accept, instead of retrying forever", async () => {
    appendOutbox(USER, entry());
    const record = vi
      .fn()
      .mockRejectedValue({ data: { code: "NOT_FOUND", message: "Project not found" } });

    expect(await flushOutboxFor(USER, PROJECT, record)).toBe("dropped");
    expect(takeOutboxFor(USER, PROJECT)).toEqual([]);
  });

  it("leaves other projects' entries alone", async () => {
    appendOutbox(USER, entry());
    appendOutbox(USER, entry({ projectId: "project-2", attemptKey: KEY_B }));
    const record = vi.fn().mockResolvedValue(undefined);

    await flushOutboxFor(USER, PROJECT, record);

    expect(record.mock.calls[0][0].map((a: { attemptKey: string }) => a.attemptKey)).toEqual([
      KEY_A,
    ]);
    expect(takeOutboxFor(USER, "project-2")).toHaveLength(1);
  });

  it("never exceeds the server's batch limit in one call", async () => {
    for (let i = 0; i < ATTEMPT_BATCH_LIMIT + 5; i++) {
      appendOutbox(
        USER,
        entry({
          attemptKey: `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
        })
      );
    }
    const record = vi.fn().mockResolvedValue(undefined);
    await flushOutboxFor(USER, PROJECT, record);

    expect(record.mock.calls[0][0].length).toBeLessThanOrEqual(ATTEMPT_BATCH_LIMIT);
  });

  it("does not throw when the flush fails", async () => {
    appendOutbox(USER, entry());
    const record = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(flushOutboxFor(USER, PROJECT, record)).resolves.toBe("kept");
  });

  it("keeps entries queued during a flush instead of clearing them unsent", async () => {
    // The chat panel flushes opportunistically while uploads are failing, so an
    // entry can arrive mid-flush. Clearing by key rather than wholesale is what
    // stops that entry being dropped without ever being sent.
    appendOutbox(USER, entry());
    const record = vi.fn().mockImplementation(async () => {
      appendOutbox(USER, entry({ attemptKey: KEY_B }));
    });

    expect(await flushOutboxFor(USER, PROJECT, record)).toBe("flushed");
    expect(takeOutboxFor(USER, PROJECT).map((e) => e.attemptKey)).toEqual([KEY_B]);
  });

  it("never sends or clears another user's entries", async () => {
    appendOutbox(USER, entry());
    appendOutbox("user-b", entry({ userId: "user-b", attemptKey: KEY_B }));
    const record = vi.fn().mockResolvedValue(undefined);

    await flushOutboxFor(USER, PROJECT, record);

    expect(record.mock.calls[0][0].map((a: { attemptKey: string }) => a.attemptKey)).toEqual([
      KEY_A,
    ]);
    expect(takeOutboxFor("user-b", PROJECT)).toHaveLength(1);
  });

  it("keeps entries when the flush itself never settles", async () => {
    // Offline, a Convex mutation neither resolves nor rejects, so without an
    // internal deadline the flush would hang and the caller would never learn
    // the entries are still queued.
    appendOutbox(USER, entry());
    const record = vi.fn().mockImplementation(() => new Promise(() => {}));

    expect(await flushOutboxFor(USER, PROJECT, record, 10)).toBe("kept");
    expect(takeOutboxFor(USER, PROJECT)).toHaveLength(1);
  });

  it("round-trips a rejected-type failure, not just a failed upload", async () => {
    appendOutbox(USER, entry({ failureCode: "rejected_unsupported" }));
    const record = vi.fn().mockResolvedValue(undefined);

    await flushOutboxFor(USER, PROJECT, record);

    expect(record.mock.calls[0][0][0].failureCode).toBe("rejected_unsupported");
  });
});

describe("withUploadTimeout", () => {
  it("passes through a mutation that resolves in time", async () => {
    await expect(withUploadTimeout(Promise.resolve("doc-1"), 50)).resolves.toBe("doc-1");
  });

  it("passes through a real rejection unchanged", async () => {
    const failure = { data: { code: "NOT_FOUND", message: "gone" } };
    await expect(withUploadTimeout(Promise.reject(failure), 50)).rejects.toBe(failure);
  });

  it("rejects a mutation that never settles", async () => {
    // Convex's WebSocket client queues mutations while offline and never
    // rejects them, so without this the upload would hang forever and the
    // failure would never be recorded.
    await expect(withUploadTimeout(new Promise(() => {}), 10)).rejects.toBeInstanceOf(
      UploadTimeoutError
    );
  });

  it("produces a timeout the flush treats as keep, never as drop", async () => {
    // A timeout means we do not know what the server did, so the queued entry
    // must survive for a later flush.
    expect(shouldDropOutboxEntry(new UploadTimeoutError())).toBe(false);
  });

  it("carries no server or provider text", async () => {
    const error = new UploadTimeoutError();
    expect(error.message).toBe("Upload timed out");
  });
});
