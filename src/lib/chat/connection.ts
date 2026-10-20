/**
 * The report chat's view of the Convex connection (Phase A, task 10).
 *
 * Offline means the client connected once and its WebSocket is down now.
 * Before the first connection the panel is still loading, so it says nothing.
 * Convex queues a mutation sent while offline and sends it on reconnect,
 * which is what the banner promises.
 */
export type ConnectionSnapshot = { isWebSocketConnected: boolean; hasEverConnected: boolean };
export type ConnectionSource = {
  connectionState?: () => ConnectionSnapshot;
  subscribeToConnectionState?: (callback: (state: ConnectionSnapshot) => void) => () => void;
};

export const OFFLINE_MESSAGE = "Connection lost. Your message will send when you're back online.";

export function isOffline(state: ConnectionSnapshot | null | undefined): boolean {
  return !!state && state.hasEverConnected && !state.isWebSocketConnected;
}

/** Subscribe to a client's connection state; `onChange` gets true while offline. */
export function watchConnection(
  source: ConnectionSource | null | undefined,
  onChange: (offline: boolean) => void
): () => void {
  if (!source || typeof source.subscribeToConnectionState !== "function") return () => {};
  try {
    if (typeof source.connectionState === "function") onChange(isOffline(source.connectionState()));
  } catch {
    /* a disabled client has no state; treat it as online */
  }
  return source.subscribeToConnectionState((state) => onChange(isOffline(state)));
}
