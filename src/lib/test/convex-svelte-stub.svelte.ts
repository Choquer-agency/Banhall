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
}>({ queries: {}, pages: {} });

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

export function __setPaginatedRows(name: string, rows: unknown[]) {
  registry.pages[name] = rows;
}

export function __resetConvexStub() {
  registry.queries = {};
  registry.pages = {};
  argsGetters.clear();
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

function skipped(getArgs: (() => unknown) | undefined) {
  return getArgs !== undefined && getArgs() === "skip";
}

export function setupConvex(_url?: string) {
  return {};
}

export function useConvexClient() {
  return {};
}

export function useQuery(query: FunctionReference<"query">, ...rest: unknown[]) {
  const name = getFunctionName(query);
  const getArgs = typeof rest[0] === "function" ? (rest[0] as () => unknown) : undefined;
  registerGetter(name, getArgs);
  return {
    get data() {
      if (skipped(getArgs)) return undefined;
      return registry.queries[name];
    },
    get error() {
      return undefined;
    },
    get isLoading() {
      if (skipped(getArgs)) return true;
      return registry.queries[name] === undefined;
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

export function useMutation(_mutation: unknown) {
  return async (_args?: unknown) => undefined;
}

export function useAction(_action: unknown) {
  return async (_args?: unknown) => undefined;
}
