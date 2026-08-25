import { describe, expect, test, vi } from "vitest";
import { runFencedProposalMark, type FencedMarkDeps } from "./fencedProposalMark";

type Overrides = Partial<FencedMarkDeps>;

function makeDeps(overrides: Overrides = {}) {
  const events: string[] = [];
  let revision = 7;
  let chain: Promise<unknown> = Promise.resolve();
  const deps: FencedMarkDeps = {
    flushEditor: vi.fn(async () => {
      events.push("flush");
    }),
    getChain: () => chain,
    setChain: (c) => {
      chain = c;
    },
    getRevision: () => revision,
    setRevision: vi.fn((r: number) => {
      revision = r;
    }),
    mark: vi.fn(async (expected: number) => {
      events.push(`mark:${expected}`);
      return { revisionNumber: expected + 1 };
    }),
    onError: vi.fn(),
    ...overrides,
  };
  return {
    deps,
    events,
    getRevision: () => revision,
    setChain: (c: Promise<unknown>) => {
      chain = c;
    },
  };
}

describe("runFencedProposalMark", () => {
  test("flushes the editor before invoking mark", async () => {
    const { deps, events } = makeDeps();
    await runFencedProposalMark(deps);
    expect(events).toEqual(["flush", "mark:7"]);
  });

  test("mark receives the post-flush revision", async () => {
    let revision = 7;
    const { deps } = makeDeps({
      flushEditor: async () => {
        // Simulates an autosave landing during flush and bumping the revision.
        revision = 9;
      },
      getRevision: () => revision,
      setRevision: (r) => {
        revision = r;
      },
    });
    await runFencedProposalMark(deps);
    expect(deps.mark).toHaveBeenCalledWith(9);
  });

  test("adopts the returned revision via setRevision", async () => {
    const { deps, getRevision } = makeDeps({
      mark: async () => ({ revisionNumber: 42 }),
    });
    await runFencedProposalMark(deps);
    expect(deps.setRevision).toHaveBeenCalledWith(42);
    expect(getRevision()).toBe(42);
    expect(deps.onError).not.toHaveBeenCalled();
  });

  test("a rejected prior chain still runs the mark (then(fn, fn))", async () => {
    const { deps, setChain } = makeDeps();
    const rejected = Promise.reject(new Error("earlier save failed"));
    rejected.catch(() => {});
    setChain(rejected);
    await runFencedProposalMark(deps);
    expect(deps.mark).toHaveBeenCalledWith(7);
    expect(deps.setRevision).toHaveBeenCalledWith(8);
    expect(deps.onError).not.toHaveBeenCalled();
  });

  test("a flush failure short-circuits through onError without calling mark", async () => {
    const failure = new Error("flush failed");
    const { deps } = makeDeps({
      flushEditor: async () => {
        throw failure;
      },
    });
    await runFencedProposalMark(deps);
    expect(deps.mark).not.toHaveBeenCalled();
    expect(deps.setRevision).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalledWith(failure);
  });

  test("a mark rejection reports through onError and leaves the revision alone", async () => {
    const failure = new Error("STALE_REVISION");
    const { deps, getRevision } = makeDeps({
      mark: async () => {
        throw failure;
      },
    });
    await runFencedProposalMark(deps);
    expect(deps.onError).toHaveBeenCalledWith(failure);
    expect(deps.setRevision).not.toHaveBeenCalled();
    expect(getRevision()).toBe(7);
  });

  test("the mark is installed as the new save chain", async () => {
    const { deps } = makeDeps();
    const setChain = vi.fn(deps.setChain);
    await runFencedProposalMark({ ...deps, setChain });
    expect(setChain).toHaveBeenCalledTimes(1);
    await expect(setChain.mock.calls[0][0]).resolves.toBeUndefined();
  });

  test("a rejected mark leaves a settled chain so a later bare await of the chain succeeds", async () => {
    const failure = new Error("STALE_REVISION");
    const { deps } = makeDeps({
      mark: async () => {
        throw failure;
      },
    });
    const setChain = vi.fn(deps.setChain);
    await runFencedProposalMark({ ...deps, setChain });
    expect(deps.onError).toHaveBeenCalledTimes(1);
    expect(deps.onError).toHaveBeenCalledWith(failure);
    // flushEditor() does `await saveChain` bare; it must not rethrow the
    // already-reported mark error.
    await expect(setChain.mock.calls[0][0]).resolves.toBeUndefined();
  });

  test("an autosave queued after the flush but before the mark lands first and the mark fences on its revision", async () => {
    let revision = 7;
    let chain: Promise<unknown> = Promise.resolve();
    const events: string[] = [];
    const deps: FencedMarkDeps = {
      flushEditor: async () => {
        events.push("flush");
        // A keystroke autosave enqueued on the chain right after the flush.
        chain = chain.then(async () => {
          events.push("autosave");
          revision = 8;
        });
      },
      getChain: () => chain,
      setChain: (c) => {
        chain = c;
      },
      getRevision: () => revision,
      setRevision: (r) => {
        revision = r;
      },
      mark: async (expected) => {
        events.push(`mark:${expected}`);
        return { revisionNumber: expected + 1 };
      },
      onError: vi.fn(),
    };
    await runFencedProposalMark(deps);
    expect(events).toEqual(["flush", "autosave", "mark:8"]);
    expect(revision).toBe(9);
    expect(deps.onError).not.toHaveBeenCalled();
  });
});
