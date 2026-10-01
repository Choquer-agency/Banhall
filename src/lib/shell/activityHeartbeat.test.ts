import { describe, expect, it, vi } from "vitest";
import { ACTIVITY_HEARTBEAT_MS, createActivityHeartbeat } from "./activityHeartbeat";

describe("createActivityHeartbeat", () => {
  it("sends at most once per 5 minutes per tab", async () => {
    const send = vi.fn(async () => null);
    const heartbeat = createActivityHeartbeat(send);
    expect(heartbeat.ping(0)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(heartbeat.ping(1_000)).toBe(false);
    expect(heartbeat.ping(ACTIVITY_HEARTBEAT_MS - 1)).toBe(false);
    expect(heartbeat.ping(ACTIVITY_HEARTBEAT_MS)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("never overlaps calls and swallows a failed call", async () => {
    let fail: ((error: Error) => void) | undefined;
    const send = vi.fn(
      () => new Promise<null>((_, reject) => { fail = reject; })
    );
    const heartbeat = createActivityHeartbeat(send, 10);
    expect(heartbeat.ping(0)).toBe(true);
    expect(heartbeat.ping(100)).toBe(false);
    fail?.(new Error("offline"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(heartbeat.ping(200)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
