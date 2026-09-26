/**
 * Team "Last active" heartbeat (WS1 spec section 9). The shell calls `ping`
 * on mount and on window focus; this keeps it to one `team.markActive` call
 * per 5 minutes per tab. The server throttles again per user, so a second
 * tab costs at most one extra no-op mutation.
 */
export const ACTIVITY_HEARTBEAT_MS = 5 * 60 * 1000;

export function createActivityHeartbeat(
  send: () => Promise<unknown>,
  intervalMs = ACTIVITY_HEARTBEAT_MS
) {
  let lastSentAt: number | null = null;
  let inFlight = false;
  return {
    /** Returns true when a call was sent. Failures are dropped: it is a hint. */
    ping(now: number = Date.now()): boolean {
      if (inFlight) return false;
      if (lastSentAt !== null && now - lastSentAt < intervalMs) return false;
      lastSentAt = now;
      inFlight = true;
      void send()
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
      return true;
    },
  };
}
