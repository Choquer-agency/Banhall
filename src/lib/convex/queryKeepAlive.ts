import type { ConvexClient } from "convex/browser";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { convexToJson, type Value } from "convex/values";

const DEFAULT_TTL_MS = 3 * 60 * 1000;
const DEFAULT_MAX_HELD = 50;

type Query = FunctionReference<"query">;
type Unsubscribe<T> = (() => void) & {
  unsubscribe: () => void;
  getCurrentValue: () => T | undefined;
};
type Held = { release: () => void; timer: ReturnType<typeof setTimeout> };
type Pool = {
  clear: () => void;
  prefetchQuery: <QueryRef extends Query>(query: QueryRef, args: FunctionArgs<QueryRef>) => void;
};
const pools = new WeakMap<ConvexClient, Pool>();
let sharedPool: Pool | null = null;

function keyOf(query: Query, args: object): string {
  return JSON.stringify([getFunctionName(query), convexToJson(args as Value)]);
}

/** Keep one underlying listener per recently released query so Convex retains its local result. */
export function installQueryKeepAlive(
  client: ConvexClient,
  { ttlMs = DEFAULT_TTL_MS, maxHeld = DEFAULT_MAX_HELD } = {}
) {
  const existing = pools.get(client);
  if (existing) {
    if (typeof window !== "undefined") sharedPool = existing;
    return existing;
  }
  const originalOnUpdate = client.onUpdate.bind(client);
  const active = new Map<string, number>();
  const held = new Map<string, Held>();

  function releaseHeld(key: string) {
    const entry = held.get(key);
    if (!entry) return;
    held.delete(key);
    clearTimeout(entry.timer);
    entry.release();
  }

  function clear() {
    for (const key of held.keys()) releaseHeld(key);
  }

  function hold<QueryRef extends Query>(key: string, query: QueryRef, args: FunctionArgs<QueryRef>) {
    if (maxHeld <= 0 || ttlMs <= 0 || client.disabled || client.closed) return;
    // Register the holder before the old listener goes away. Convex then keeps
    // the same query token and local result without a network unsubscribe.
    const holder = originalOnUpdate(query, args, () => {}, () => {});
    const timer = setTimeout(() => releaseHeld(key), ttlMs);
    held.set(key, { release: holder, timer });
    while (held.size > maxHeld) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      releaseHeld(oldest);
    }
  }

  client.onUpdate = function onUpdate<QueryRef extends Query>(
    query: QueryRef,
    args: FunctionArgs<QueryRef>,
    callback: (result: FunctionReturnType<QueryRef>) => unknown,
    onError?: (error: Error) => unknown
  ): Unsubscribe<QueryRef["_returnType"]> {
    const key = keyOf(query, args);
    // A query whose latest answer was an error is not held: a retry must run
    // it again instead of reading the cached error.
    let lastWasError = false;
    // Attach the new listener before dropping the holder so the local result
    // remains available to useQuery's synchronous localQueryResult read.
    const subscription = originalOnUpdate(
      query,
      args,
      (result) => {
        lastWasError = false;
        return callback(result);
      },
      (error) => {
        lastWasError = true;
        return onError?.(error);
      }
    );
    releaseHeld(key);
    active.set(key, (active.get(key) ?? 0) + 1);
    let released = false;
    const unsubscribe = (() => {
      if (released) return;
      released = true;
      const remaining = (active.get(key) ?? 1) - 1;
      if (remaining > 0) active.set(key, remaining);
      else {
        active.delete(key);
        if (!lastWasError) hold(key, query, args);
      }
      subscription();
    }) as Unsubscribe<QueryRef["_returnType"]>;
    unsubscribe.unsubscribe = unsubscribe;
    unsubscribe.getCurrentValue = subscription.getCurrentValue;
    return unsubscribe;
  };

  // One-shot client.query() calls go straight to the original listener, so
  // they are never held. A held subscription still answers them from its
  // live local result.
  client.query = function query<QueryRef extends Query>(
    query: QueryRef,
    args: FunctionArgs<QueryRef>
  ): Promise<FunctionReturnType<QueryRef>> {
    if (client.disabled) throw new Error("ConvexClient is disabled");
    const local = client.client.localQueryResult(getFunctionName(query), args);
    if (local !== undefined) return Promise.resolve(local as FunctionReturnType<QueryRef>);
    return new Promise((resolve, reject) => {
      const unsubscribe = originalOnUpdate(
        query,
        args,
        (value) => {
          unsubscribe();
          resolve(value);
        },
        (error) => {
          unsubscribe();
          reject(error);
        }
      );
    });
  };

  function prefetchQuery<QueryRef extends Query>(query: QueryRef, args: FunctionArgs<QueryRef>) {
    const unsubscribe = client.onUpdate(query, args, () => {}, () => {});
    unsubscribe();
  }

  const pool = { clear, prefetchQuery };
  pools.set(client, pool);
  if (typeof window !== "undefined") sharedPool = pool;
  return pool;
}

/** Warm a query for navigation. Its held subscription receives the first result. */
export function prefetchQuery<QueryRef extends Query>(query: QueryRef, args: FunctionArgs<QueryRef>) {
  sharedPool?.prefetchQuery(query, args);
}
