import { afterEach, describe, expect, it } from "vitest";
import {
  __resetQaSeenMemory,
  markQaDismissed,
  markQaSeen,
  qaSeenKey,
  readQaSeen,
  type QaSeenStorage,
} from "./qaSeen";

function memoryStorage(): QaSeenStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing: QaSeenStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

afterEach(() => __resetQaSeenMemory());

describe("qaSeen", () => {
  it("keys by generation and QA completion time", () => {
    expect(qaSeenKey("gen1", 1700)).toBe("banhall_qa_seen:gen1:1700");
  });

  it("starts unseen, then records dismissed and seen", () => {
    const storage = memoryStorage();
    expect(readQaSeen("gen1", 1700, storage)).toBe("unseen");
    markQaDismissed("gen1", 1700, storage);
    expect(readQaSeen("gen1", 1700, storage)).toBe("dismissed");
    expect(storage.data.get("banhall_qa_seen:gen1:1700")).toBe("dismissed");
    markQaSeen("gen1", 1700, storage);
    expect(readQaSeen("gen1", 1700, storage)).toBe("seen");
  });

  it("never downgrades seen to dismissed", () => {
    const storage = memoryStorage();
    markQaSeen("gen1", 1700, storage);
    markQaDismissed("gen1", 1700, storage);
    expect(readQaSeen("gen1", 1700, storage)).toBe("seen");
  });

  it("treats a new QA completion as a new result", () => {
    const storage = memoryStorage();
    markQaSeen("gen1", 1700, storage);
    expect(readQaSeen("gen1", 1800, storage)).toBe("unseen");
    expect(readQaSeen("gen2", 1700, storage)).toBe("unseen");
  });

  it("ignores unknown stored values", () => {
    const storage = memoryStorage();
    storage.data.set(qaSeenKey("gen1", 1700), "maybe");
    expect(readQaSeen("gen1", 1700, storage)).toBe("unseen");
  });

  it("keeps working in memory when storage throws", () => {
    expect(readQaSeen("gen1", 1700, throwing)).toBe("unseen");
    expect(() => markQaDismissed("gen1", 1700, throwing)).not.toThrow();
    expect(readQaSeen("gen1", 1700, throwing)).toBe("dismissed");
    markQaSeen("gen1", 1700, throwing);
    expect(readQaSeen("gen1", 1700, throwing)).toBe("seen");
  });

  it("keeps working without any storage (SSR or blocked)", () => {
    expect(readQaSeen("gen1", 1700, null)).toBe("unseen");
    markQaSeen("gen1", 1700, null);
    expect(readQaSeen("gen1", 1700, null)).toBe("seen");
  });

  it("falls back safely when window is absent", () => {
    // The node test environment has no window: the default resolver must not throw.
    expect(readQaSeen("gen3", 1)).toBe("unseen");
    markQaSeen("gen3", 1);
    expect(readQaSeen("gen3", 1)).toBe("seen");
  });
});
