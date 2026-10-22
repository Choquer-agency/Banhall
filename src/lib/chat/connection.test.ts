import { describe, expect, it, vi } from "vitest";
import { isOffline, watchConnection, type ConnectionSnapshot } from "./connection";

describe("connection state", () => {
  it("is offline only after a connection was made and then lost", () => {
    expect(isOffline({ hasEverConnected: false, isWebSocketConnected: false })).toBe(false);
    expect(isOffline({ hasEverConnected: true, isWebSocketConnected: true })).toBe(false);
    expect(isOffline({ hasEverConnected: true, isWebSocketConnected: false })).toBe(true);
    expect(isOffline(null)).toBe(false);
  });

  it("reports the current state, then every change, until unsubscribed", () => {
    let listener: ((state: ConnectionSnapshot) => void) | null = null;
    const unsubscribe = vi.fn();
    const source = {
      connectionState: () => ({ hasEverConnected: true, isWebSocketConnected: true }),
      subscribeToConnectionState: (callback: (state: ConnectionSnapshot) => void) => {
        listener = callback;
        return unsubscribe;
      },
    };
    const seen: boolean[] = [];
    const stop = watchConnection(source, (offline) => seen.push(offline));
    listener!({ hasEverConnected: true, isWebSocketConnected: false });
    listener!({ hasEverConnected: true, isWebSocketConnected: true });
    expect(seen).toEqual([false, true, false]);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("treats a client without connection state as online", () => {
    const seen: boolean[] = [];
    expect(() => watchConnection({}, (offline) => seen.push(offline))()).not.toThrow();
    expect(() => watchConnection(null, (offline) => seen.push(offline))()).not.toThrow();
    expect(seen).toEqual([]);
  });
});
