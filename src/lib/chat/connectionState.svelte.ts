import { useConvexClient } from "convex-svelte";
import { watchConnection, type ConnectionSource } from "./connection";

export { OFFLINE_MESSAGE } from "./connection";

/**
 * Reactive Convex connection state for the report chat (Phase A, task 10).
 * Call during component init. A client without connection state (the
 * component-test stub, a disabled client) reads as online.
 */
export function useChatConnection(): { readonly offline: boolean } {
  let source: ConnectionSource | null = null;
  try {
    source = useConvexClient() as unknown as ConnectionSource;
  } catch {
    source = null;
  }
  let offline = $state(false);
  $effect(() => watchConnection(source, (next) => (offline = next)));
  return {
    get offline() {
      return offline;
    },
  };
}
