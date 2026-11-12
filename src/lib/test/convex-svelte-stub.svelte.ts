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
// Bypass the component config's package alias for opt-in lifecycle tests.
import { useQuery as realUseQuery } from "../../../node_modules/convex-svelte/dist/client.svelte.js";

const realQueryNames = new Set<string>();
export function __useRealQuery(name: string) {
  realQueryNames.add(name);
}

const registry = $state<{
  queries: Record<string, unknown>;
  errors: Record<string, unknown>;
  stale: Record<string, boolean>;
  pages: Record<string, unknown[]>;
  /** Paginated reads seeded as having more pages ("CanLoadMore"). */
  morePages: Record<string, boolean>;
  queryVariants: Record<string, Record<string, unknown>>;
  /** Paginated rows seeded for exact arguments (without paginationOpts). */
  pageVariants: Record<string, Record<string, { rows: unknown[]; more: boolean }>>;
}>({ queries: {}, errors: {}, stale: {}, pages: {}, morePages: {}, queryVariants: {}, pageVariants: {} });

// `loadMore(n)` calls on paginated hooks, with the hook's arguments then.
const loadMoreCalls: Array<{ name: string; args: unknown; numItems: number }> = [];
// The `initialNumItems` each mounted paginated hook asked for.
const paginatedInitialSizes: Array<{ name: string; args: unknown; initialNumItems: number | undefined }> = [];
// The `initialNumItems` a paginated hook asked for when its arguments moved
// from one read to another (the real hook reads its options again then).
const paginatedReloadSizes: Array<{ name: string; args: unknown; initialNumItems: number | undefined }> = [];

/** Every `loadMore(n)` on paginated hooks of `name`, in call order. */
export function __loadMoreCalls(name: string) {
  return loadMoreCalls.filter((call) => call.name === name).map(({ args, numItems }) => ({ args, numItems }));
}

/** The first page size each mounted paginated hook of `name` asked for, with its arguments. */
export function __paginatedInitialSizes(name: string) {
  return paginatedInitialSizes
    .filter((entry) => entry.name === name)
    .map(({ args, initialNumItems }) => ({ args, initialNumItems }));
}

/** The first page size paginated hooks of `name` asked for on each argument change, with the new arguments. */
export function __paginatedReloadSizes(name: string) {
  return paginatedReloadSizes
    .filter((entry) => entry.name === name)
    .map(({ args, initialNumItems }) => ({ args, initialNumItems }));
}

// Mutation/action calls a suite can assert on, plus the value each one
// resolves with — a wizard that destructures its mutation result needs one.
const calls: Array<{ name: string; args: unknown }> = [];
// One-shot `client.query(...)` calls, kept apart from subscriptions: a fetch
// on click is not a live subscription and must not count against a budget.
const clientQueries: Array<{ name: string; args: unknown }> = [];
const results: Record<string, unknown> = {};
const mutationErrors = new Map<string, unknown>();
// Per-call answers for a suite that needs one call of several to fail.
const mutationHandlers = new Map<string, (args: unknown) => unknown>();

// Args getters per function name (one per mounted hook instance) — lets
// tests observe which subscriptions are live (args !== "skip") and HOW MANY
// are live at once (subscription-budget assertions, H1).
const argsGetters = new Map<string, Array<(() => unknown) | undefined>>();
// Distinct consecutive argument values rendered hooks read, per function name,
// so a suite can observe a subscription being dropped ("skip") and re-created.
const argsHistory = new Map<string, unknown[]>();

function recordArgs(name: string, args: unknown) {
  const history = argsHistory.get(name) ?? [];
  const last = history[history.length - 1];
  if (history.length === 0 || JSON.stringify(last ?? null) !== JSON.stringify(args ?? null)) {
    history.push(args);
  }
  argsHistory.set(name, history);
}

/** Every distinct consecutive argument value read by mounted hooks of `name`. */
export function __queryArgsHistory(name: string) {
  return [...(argsHistory.get(name) ?? [])];
}

function registerGetter(name: string, getArgs: (() => unknown) | undefined) {
  const list = argsGetters.get(name) ?? [];
  list.push(getArgs);
  argsGetters.set(name, list);
}

export function __setQueryData(name: string, data: unknown) {
  registry.queries[name] = data;
  delete registry.errors[name];
}

/** The name-only data seeded for `name` (undefined when unseeded). */
export function __getQueryData(name: string): unknown {
  return registry.queries[name];
}

export function __setQueryError(name: string, error: unknown) {
  registry.errors[name] = error;
}

export function __setQueryStale(name: string, stale: boolean) {
  registry.stale[name] = stale;
}

/** Seed an exact argument variant; unseeded variants retain the name-only fallback. */
export function __setQueryDataForArgs(name: string, args: unknown, data: unknown) {
  // Replace the variant registry so a previously missing exact key also
  // invalidates readers (Object.hasOwn on a missing key is not reactive).
  registry.queryVariants[name] = { ...registry.queryVariants[name], [JSON.stringify(args) ?? ""]: data };
}

function queryData(name: string, args: unknown) {
  const variants = registry.queryVariants[name];
  if (!variants) return registry.queries[name];
  const key = JSON.stringify(args) ?? "";
  return Object.hasOwn(variants, key) ? variants[key] : registry.queries[name];
}

/** Seed a paginated read's rows for any arguments ("name-only"); see usePaginatedQuery. */
export function __setPaginatedRows(name: string, rows: unknown[], options: { more?: boolean } = {}) {
  registry.pages[name] = rows;
  registry.morePages[name] = options.more ?? false;
}

/**
 * Seed a paginated read for exact arguments (without paginationOpts): the
 * server's answer for them. Other arguments keep the name-only rows, or stay
 * loading when there are none (see usePaginatedQuery for an argument change).
 */
export function __setPaginatedRowsForArgs(
  name: string,
  args: unknown,
  rows: unknown[],
  options: { more?: boolean } = {}
) {
  registry.pageVariants[name] = {
    ...registry.pageVariants[name],
    [JSON.stringify(args) ?? ""]: { rows, more: options.more ?? false },
  };
}

function exactPageData(name: string, key: string): { rows: unknown[]; more: boolean } | undefined {
  const variants = registry.pageVariants[name];
  return variants && Object.hasOwn(variants, key) ? variants[key] : undefined;
}

function nameOnlyPageData(name: string): { rows: unknown[]; more: boolean } | undefined {
  const rows = registry.pages[name];
  return rows === undefined ? undefined : { rows, more: registry.morePages[name] ?? false };
}

export function __setMutationResult(name: string, value: unknown) {
  mutationErrors.delete(name);
  results[name] = value;
}

export function __setMutationError(name: string, error: unknown) {
  mutationErrors.set(name, error);
}

/**
 * Answer each call to `name` with `handler(args)`: its return value, or the
 * error it throws. Recorded like any call; wins over a seeded result or error.
 */
export function __setMutationHandler(name: string, handler: (args: unknown) => unknown) {
  mutationHandlers.set(name, handler);
}

/** Args of every call to `name`, in call order. */
export function __mutationCalls(name: string) {
  return calls.filter((call) => call.name === name).map((call) => call.args);
}

/** Names of every mutation and action call, in call order (across names). */
export function __callOrder() {
  return calls.map((call) => call.name);
}

/** Args of every one-shot `client.query(name, ...)`, in call order. */
export function __clientQueryCalls(name: string) {
  return clientQueries.filter((call) => call.name === name).map((call) => call.args);
}

export function __resetConvexStub() {
  realQueryNames.clear();
  registry.queries = {};
  registry.errors = {};
  registry.stale = {};
  registry.queryVariants = {};
  registry.pages = {};
  registry.morePages = {};
  registry.pageVariants = {};
  loadMoreCalls.length = 0;
  paginatedInitialSizes.length = 0;
  paginatedReloadSizes.length = 0;
  argsGetters.clear();
  argsHistory.clear();
  calls.length = 0;
  mutationErrors.clear();
  mutationHandlers.clear();
  clientQueries.length = 0;
  clientSubscriptions.length = 0;
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

// Live `client.onUpdate(...)` subscriptions (early loads), kept apart from
// hook subscriptions so hook budgets stay exact.
const clientSubscriptions: Array<{ name: string; args: unknown; live: boolean }> = [];

/** Arguments of the live `client.onUpdate` subscriptions for `name`. */
export function __clientSubscriptions(name: string) {
  return clientSubscriptions.filter((sub) => sub.name === name && sub.live).map((sub) => sub.args);
}

export function useConvexClient() {
  return {
    onUpdate(query: FunctionReference<"query">, args: unknown, callback: (data: never) => void) {
      const name = getFunctionName(query);
      const sub = { name, args, live: true };
      clientSubscriptions.push(sub);
      const data = queryData(name, args);
      if (data !== undefined) queueMicrotask(() => sub.live && callback(data as never));
      return () => {
        sub.live = false;
      };
    },
    async query(query: FunctionReference<"query">, args?: unknown) {
      const name = getFunctionName(query);
      clientQueries.push({ name, args });
      return queryData(name, args);
    },
    // One-shot `client.action(...)`: recorded and answered like useAction.
    action(action: FunctionReference<"action">, args?: unknown) {
      return recordingCall(action)(args);
    },
  };
}

export function useQuery(query: FunctionReference<"query">, ...rest: unknown[]) {
  const name = getFunctionName(query);
  const getArgs = typeof rest[0] === "function" ? (rest[0] as () => unknown) : undefined;
  registerGetter(name, getArgs);
  if (realQueryNames.has(name)) {
    return realUseQuery(query, () => {
      const args = getArgs?.();
      if (args === "skip") return "skip";
      return typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
    });
  }
  return {
    get data() {
      recordArgs(name, getArgs?.());
      if (skipped(getArgs)) return undefined;
      return queryData(name, getArgs?.());
    },
    get error() {
      return skipped(getArgs) ? undefined : registry.errors[name];
    },
    get isLoading() {
      if (skipped(getArgs)) return true;
      return queryData(name, getArgs?.()) === undefined;
    },
    get isStale() {
      return !skipped(getArgs) && (registry.stale[name] ?? false);
    },
  };
}

type PaginatedOptions = { initialNumItems?: number; keepPreviousData?: boolean } | undefined;

/**
 * The paginated hook. A read is answered by rows seeded for its exact
 * arguments, else by the name-only rows, else it is loading. For reads
 * seeded by exact arguments it is faithful to convex-svelte 0.14 on an
 * argument change: until the new arguments have an answer, the rows clear
 * and the status is "LoadingFirstPage" (loading), unless `keepPreviousData`
 * is set, in which case the last rows answered stay on screen (still
 * "LoadingFirstPage" and loading) until then. "skip" clears them, as it does
 * in the real hook. Name-only rows answer any arguments at once, as they
 * always have here: suites that switch a hook's arguments with name-only
 * rows (the chat's thread switches) rely on that, so a suite that tests what
 * an argument change shows seeds by exact arguments instead.
 */
export function usePaginatedQuery(query: FunctionReference<"query">, ...rest: unknown[]) {
  const name = getFunctionName(query);
  const getArgs = typeof rest[0] === "function" ? (rest[0] as () => unknown) : undefined;
  registerGetter(name, getArgs);
  // Like the real hook, options may be a getter, read again for each new read.
  const readOptions = () => (typeof rest[1] === "function" ? (rest[1] as () => unknown)() : rest[1]) as PaginatedOptions;
  const options = readOptions();
  paginatedInitialSizes.push({ name, args: getArgs?.(), initialNumItems: options?.initialNumItems });

  // What this hook shows. Plain variables: they change only while a getter
  // runs, and every getter reads the reactive registry it depends on.
  let shownKey: string | null | undefined; // undefined: nothing read yet; null: skipped
  let lastRows: unknown[] = [];

  function view(): { rows: unknown[]; status: string; loading: boolean } {
    const args = getArgs?.();
    if (args === "skip") {
      shownKey = null;
      lastRows = [];
      return { rows: [], status: "LoadingFirstPage", loading: true };
    }
    const key = JSON.stringify(args) ?? "";
    if (key !== shownKey) {
      // From one read to another: the real hook subscribes again with its options read anew.
      if (typeof shownKey === "string") {
        paginatedReloadSizes.push({ name, args, initialNumItems: readOptions()?.initialNumItems });
      }
      shownKey = key;
    }
    const data = exactPageData(name, key) ?? nameOnlyPageData(name);
    if (data === undefined) {
      return { rows: options?.keepPreviousData === true ? lastRows : [], status: "LoadingFirstPage", loading: true };
    }
    lastRows = data.rows;
    return { rows: data.rows, status: data.more ? "CanLoadMore" : "Exhausted", loading: false };
  }

  return {
    get results() {
      return view().rows;
    },
    get status() {
      return view().status;
    },
    // Like the real client, a failed read leaves the status where it was.
    get error() {
      return skipped(getArgs) ? undefined : registry.errors[name];
    },
    get isLoading() {
      return view().loading;
    },
    loadMore(numItems: number) {
      loadMoreCalls.push({ name, args: getArgs?.(), numItems });
    },
  };
}

function recordingCall(fn: unknown) {
  const name = getFunctionName(fn as FunctionReference<"mutation">);
  return async (args?: unknown) => {
    calls.push({ name, args });
    const handler = mutationHandlers.get(name);
    if (handler) return handler(args);
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
