import { describe, expect, it, vi } from "vitest";
import { ACTION_REQUEST_WINDOW_MS } from "./actionDeadline";
import {
  CHAT_MIN_STEP_REMAINING_MS,
  CHAT_RECOVERY_MIN_REMAINING_MS,
  stopBeforeWindowEnds,
} from "./chatAgentV2";

// Review 2026-10-21: the recovery pass starts with as little as 150 seconds
// left, so the main pass's 300-second stop must not end it after one step.
describe("stopBeforeWindowEnds", () => {
  const startedAt = 1_000_000;
  const at = (remainingMs: number) => () => startedAt + ACTION_REQUEST_WINDOW_MS - remainingMs;

  it("stops the main pass with less than its 300 seconds left", () => {
    const onStop = vi.fn();
    expect(stopBeforeWindowEnds(startedAt, onStop, at(CHAT_MIN_STEP_REMAINING_MS + 1))()).toBe(false);
    expect(stopBeforeWindowEnds(startedAt, onStop, at(CHAT_MIN_STEP_REMAINING_MS - 1))()).toBe(true);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("lets the recovery pass take another step on its own 150 seconds", () => {
    const onStop = vi.fn();
    const twoHundredLeft = at(200_000);
    expect(stopBeforeWindowEnds(startedAt, onStop, twoHundredLeft, CHAT_RECOVERY_MIN_REMAINING_MS)()).toBe(false);
    expect(stopBeforeWindowEnds(startedAt, onStop, at(CHAT_RECOVERY_MIN_REMAINING_MS - 1), CHAT_RECOVERY_MIN_REMAINING_MS)()).toBe(true);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
