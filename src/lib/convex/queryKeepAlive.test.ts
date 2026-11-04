import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { installQueryKeepAlive } from "./queryKeepAlive";

const query = makeFunctionReference<"query", { id: number }, string>("test:read");

function fakeClient() {
  const subscriptions = new Map<number, number>();
  const cache = new Map<number, string>();
  const client = {
    disabled: false,
    closed: false,
    client: {
      localQueryResult(_name: string, args: { id: number }) {
        return cache.get(args.id);
      },
    },
    onUpdate(_query: typeof query, args: { id: number }, _callback: (result: string) => unknown) {
      const id = args.id;
      subscriptions.set(id, (subscriptions.get(id) ?? 0) + 1);
      const unsubscribe = Object.assign(() => {
        const remaining = (subscriptions.get(id) ?? 1) - 1;
        if (remaining) subscriptions.set(id, remaining);
        else {
          subscriptions.delete(id);
          cache.delete(id);
        }
      }, {
        unsubscribe() { unsubscribe(); },
        getCurrentValue() { return cache.get(id); },
      });
      return unsubscribe;
    },
  };
  return {
    client: client as unknown as ConvexClient,
    subscriptions,
    setResult(id: number, value: string) {
      if (subscriptions.has(id)) cache.set(id, value);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("query keep alive", () => {
  it("keeps a released query and serves its cached result synchronously on remount", () => {
    const fake = fakeClient();
    const pool = installQueryKeepAlive(fake.client, { ttlMs: 1000 });
    const release = fake.client.onUpdate(query, { id: 1 }, () => {});
    fake.setResult(1, "cached");
    release();
    expect(fake.subscriptions.get(1)).toBe(1);

    const remount = fake.client.onUpdate(query, { id: 1 }, () => {});
    expect(fake.client.client.localQueryResult("test:read", { id: 1 })).toBe("cached");
    expect(remount.getCurrentValue()).toBe("cached");
    expect(fake.subscriptions.get(1)).toBe(1);
    remount();
    pool.clear();
  });

  it("unsubscribes after the idle window", () => {
    const fake = fakeClient();
    installQueryKeepAlive(fake.client, { ttlMs: 1000 });
    const release = fake.client.onUpdate(query, { id: 1 }, () => {});
    fake.setResult(1, "cached");
    release();
    vi.advanceTimersByTime(1000);
    expect(fake.subscriptions.size).toBe(0);
    expect(fake.client.client.localQueryResult("test:read", { id: 1 })).toBeUndefined();
  });

  it("evicts the oldest held query at the LRU cap", () => {
    const fake = fakeClient();
    const pool = installQueryKeepAlive(fake.client, { maxHeld: 2 });
    for (const id of [1, 2, 3]) {
      fake.client.onUpdate(query, { id }, () => {})();
    }
    expect([...fake.subscriptions.keys()]).toEqual([2, 3]);
    pool.clear();
  });

  it("clears all held results on an auth identity change", () => {
    const fake = fakeClient();
    const pool = installQueryKeepAlive(fake.client);
    fake.client.onUpdate(query, { id: 1 }, () => {})();
    fake.client.onUpdate(query, { id: 2 }, () => {})();
    pool.clear();
    expect(fake.subscriptions.size).toBe(0);
  });

  it("prefetches into the pool without a mounted component", () => {
    const fake = fakeClient();
    const pool = installQueryKeepAlive(fake.client);
    pool.prefetchQuery(query, { id: 1 });
    fake.setResult(1, "prefetched");
    expect(fake.client.client.localQueryResult("test:read", { id: 1 })).toBe("prefetched");
    pool.clear();
  });
});
