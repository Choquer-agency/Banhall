import { useQuery } from "convex-svelte";
import type {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server";

/**
 * useQuery that keeps the previous result while a new subscription loads.
 *
 * When a filter changes a query's args, convex-svelte re-subscribes and
 * `data` drops to `undefined` for a beat — which flashes spinners/empty
 * states. This wrapper holds the last result so filtered views swap in place.
 *
 * `isRefreshing` is true during that beat (dim the stale content with it);
 * `isLoading` is true only before the FIRST result ever arrives.
 */
export function useStableQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: () => FunctionArgs<Query> | "skip"
) {
  const q = useQuery(query, args);
  let last = $state<FunctionReturnType<Query> | undefined>(undefined);
  $effect(() => {
    if (q.data !== undefined) last = q.data;
  });
  return {
    get data(): FunctionReturnType<Query> | undefined {
      return q.data ?? last;
    },
    get isRefreshing(): boolean {
      return q.data === undefined && last !== undefined;
    },
    get isLoading(): boolean {
      return q.data === undefined && last === undefined;
    },
    get error() {
      return q.error;
    },
  };
}
