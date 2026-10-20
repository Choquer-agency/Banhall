import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDraft, draftKey, readDraft, readLastThread, writeDraft, writeLastThread } from "./chatDrafts";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("chat drafts", () => {
  it("keeps one draft per report and conversation, and forgets blank ones", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    const a = draftKey("report-1", "thread:a");
    const b = draftKey("report-1", "thread:b");
    expect(a).not.toBe(b);
    expect(draftKey("report-2", "thread:a")).not.toBe(a);
    writeDraft(a, "Tighten Line 242");
    writeDraft(b, "Check Line 246");
    expect(readDraft(a)).toBe("Tighten Line 242");
    expect(readDraft(b)).toBe("Check Line 246");
    writeDraft(a, "   ");
    expect(sessionStorage.getItem(a)).toBeNull();
    clearDraft(b);
    expect(readDraft(b)).toBe("");
  });

  it("remembers the last conversation per report", () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    expect(readLastThread("report-1")).toBeNull();
    writeLastThread("report-1", "thread-9");
    expect(readLastThread("report-1")).toBe("thread-9");
    expect(readLastThread("report-2")).toBeNull();
  });

  it("never throws when storage is missing or blocked", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(readDraft("k")).toBe("");
    expect(() => writeDraft("k", "text")).not.toThrow();
    const blocked = memoryStorage();
    blocked.setItem = () => { throw new Error("QuotaExceededError"); };
    blocked.getItem = () => { throw new Error("SecurityError"); };
    vi.stubGlobal("sessionStorage", blocked);
    expect(() => writeDraft("k", "text")).not.toThrow();
    expect(readDraft("k")).toBe("");
    expect(readLastThread("report-1")).toBeNull();
    expect(() => writeLastThread("report-1", "t")).not.toThrow();
  });
});
