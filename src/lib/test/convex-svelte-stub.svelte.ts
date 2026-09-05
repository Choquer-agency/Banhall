/**
 * Component-test stub for `convex-svelte`. Queries resolve from a reactive
 * registry keyed by Convex function name (e.g. "dashboard:listFlatProjects"),
 * so workspace shell components can mount with real data flow but no client.
 * Unseeded queries stay in their loading state, matching a fresh subscription.
 *
 * The stub honours the `"skip"` args sentinel like the real client
 * (2026-08-06): a skipped query has no results and no live subscription, so
 * suites can assert genuine query-gating contracts (scope chips swapping the
 * subscribed query; collapsed client lanes holding zero subscriptions).
 */
import { getFunctionName, type FunctionReference } from "convex/server";

const registry = $state<{
  queries: Record<string, unknown>;
  pages: Record<string, unknown[]>;
  queryVariants: Record<string, Record<string, unknown>>;
}>({ queries: {}, pages: {}, queryVariants: {} });

// Mutation/action calls a suite can assert on, plus the value each one
// resolves with — a wizard that destructures its mutation result needs one.
const calls: Array<{ name: string; args: unknown }> = [];
// One-shot `client.query(...)` calls, kept apart from subscriptions: a fetch
// on click is not a live subscription and must not count against a budget.
const clientQueries: Array<{ name: string; args: unknown }> = [];
const results: Record<string, unknown> = {};
const mutationErrors = new Map<string, unknown>();

// Args getters per function name (one per mounted hook instance) — lets
// tests observe which subscriptions are live (args !== "skip") and HOW MANY
// are live at once (subscription-budget assertions, H1).
const argsGetters = new Map<string, Array<(() => unknown) | undefined>>();

function registerGetter(name: string, getArgs: (() => unknown) | undefined) {
  const list = argsGetters.get(name) ?? [];
  list.push(getArgs);
  argsGetters.set(name, list);
}

export function __setQueryData(name: string, data: unknown) {
  registry.queries[name] = data;
}

/** Seed an exact argument variant; unseeded variants retain the name-only fallback. */
export function __setQueryDataForArgs(name: string, args: unknown, data: unknown) {
  registry.queryVariants[name] ??= {};
  registry.queryVariants[name][JSON.stringify(args) ?? ""] = data;
}

function queryData(name: string, args: unknown) {
  const variants = registry.queryVariants[name];
  if (!variants) return registry.queries[name];
  const key = JSON.stringify(args) ?? "";
  return Object.hasOwn(variants, key) ? variants[key] : registry.queries[name];
}

export function __setPaginatedRows(name: string, rows: unknown[]) {
  registry.pages[name] = rows;
}

export function __setMutationResult(name: string, value: unknown) {
  mutationErrors.delete(name);
  results[name] = value;
}

export function __setMutationError(name: string, error: unknown) {
  mutationErrors.set(name, error);
}

/** Args of every call to `name`, in call order. */
export function __mutationCalls(name: string) {
  return calls.filter((call) => call.name === name).map((call) => call.args);
}

/** Args of every one-shot `client.query(name, ...)`, in call order. */
export function __clientQueryCalls(name: string) {
  return clientQueries.filter((call) => call.name === name).map((call) => call.args);
}

export function __resetConvexStub() {
  registry.queries = {};
  registry.queryVariants = {};
  registry.pages = {};
  argsGetters.clear();
  calls.length = 0;
  mutationErrors.clear();
  clientQueries.length = 0;
  for (const key of Object.keys(results)) delete results[key];
}

/** True when any registered getter for `name` is not skipped. */
export function __isQueryActive(name: string) {
  return __activeQueryCount(name) > 0;
}

/**
 * Number of live (non-skipped) hook instances for `name` — the stub's view
 * of concurrent subscriptions. Used to pin subscription budgets (e.g. the
 * expanded-client-sections cap) regardless of how many rows are rendered.
 */
export function __activeQueryCount(name: string) {
  const getters = argsGetters.get(name);
  if (!getters) return 0;
  return getters.filter((getArgs) => getArgs !== undefined && getArgs() !== "skip").length;
}

/** Current non-skipped arguments for every mounted hook of `name`. */
export function __activeQueryArgs(name: string) {
  return (argsGetters.get(name) ?? [])
    .map((getArgs) => getArgs?.())
    .filter((args) => args !== undefined && args !== "skip");
}

function skipped(getArgs: (() => unknown) | undefined) {
  return getArgs !== undefined && getArgs() === "skip";
}

export function setupConvex(_url?: string) {
  return {};
}

export function useConvexClient() {
  return {
    async query(query: FunctionReference<"query">, args?: unknown) {
      const name = getFunctionName(query);
      clientQueries.push({ name, args });
      return queryData(name, args);
    },
  };
}

export function useQuery(query: FunctionReference<"query">, ...rest: unknown[]) {
  const name = getFunctionName(query);
  const getArgs = typeof rest[0] === "function" ? (rest[0] as () => unknown) : undefined;
  registerGetter(name, getArgs);
  return {
    get data() {
      if (skipped(getArgs)) return undefined;
      return queryData(name, getArgs?.());
    },
    get error() {
      return undefined;
    },
    get isLoading() {
      if (skipped(getArgs)) return true;
      return queryData(name, getArgs?.()) === undefined;
    },
    get isStale() {
      return false;
    },
  };
}

export function usePaginatedQuery(query: FunctionReference<"query">, ...rest: unknown[]) {
  const name = getFunctionName(query);
  const getArgs = typeof rest[0] === "function" ? (rest[0] as () => unknown) : undefined;
  registerGetter(name, getArgs);
  return {
    get results() {
      if (skipped(getArgs)) return [];
      return registry.pages[name] ?? [];
    },
    get status() {
      if (skipped(getArgs)) return "LoadingFirstPage";
      return registry.pages[name] === undefined ? "LoadingFirstPage" : "Exhausted";
    },
    get error() {
      return undefined;
    },
    get isLoading() {
      if (skipped(getArgs)) return true;
      return registry.pages[name] === undefined;
    },
    loadMore(_numItems: number) {},
  };
}

function recordingCall(fn: unknown) {
  const name = getFunctionName(fn as FunctionReference<"mutation">);
  return async (args?: unknown) => {
    calls.push({ name, args });
    if (mutationErrors.has(name)) throw mutationErrors.get(name);
    return results[name];
  };
}

export function useMutation(mutation: unknown) {
  return recordingCall(mutation);
}

export function useAction(action: unknown) {
  return recordingCall(action);
}
