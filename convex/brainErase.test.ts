/// <reference types="vite/client" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";

// `eraseBrainEntry` is THE invariant this story adds — every other suite mocks
// it, so its own getEntry → delete → getEntry sequence needs a direct test.
// The `rag` module is mocked rather than the component: convex-test has no
// registration for `rag`, and this file needs no Convex runtime at all.
const getEntry = vi.hoisted(() => vi.fn());
const deleteEntry = vi.hoisted(() => vi.fn());
vi.mock("./ai/brain/rag", () => ({
  brain: { getEntry, delete: deleteEntry },
}));

const { eraseBrainEntry } = await import("./ai/brain/erase");

const ctx = {} as ActionCtx;
const ENTRY_ID = "entry_erase_1";
const present = { entryId: ENTRY_ID, status: "ready" };

beforeEach(() => {
  getEntry.mockReset();
  deleteEntry.mockReset();
  deleteEntry.mockResolvedValue(undefined);
});

describe("eraseBrainEntry", () => {
  test("an absent entry is already_absent and is never deleted", async () => {
    getEntry.mockResolvedValue(null);

    await expect(eraseBrainEntry(ctx, ENTRY_ID)).resolves.toBe("already_absent");

    expect(deleteEntry).not.toHaveBeenCalled();
    expect(getEntry).toHaveBeenCalledTimes(1);
  });

  test("present, then absent after delete, is confirmed", async () => {
    getEntry.mockResolvedValueOnce(present).mockResolvedValueOnce(null);

    await expect(eraseBrainEntry(ctx, ENTRY_ID)).resolves.toBe("confirmed");

    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(deleteEntry).toHaveBeenCalledWith(ctx, { entryId: ENTRY_ID });
    // The post-delete read is the confirmation: without it nothing is proven.
    expect(getEntry).toHaveBeenCalledTimes(2);
  });

  test("still present after delete throws — an unconfirmed delete is a failure", async () => {
    getEntry.mockResolvedValue(present);

    await expect(eraseBrainEntry(ctx, ENTRY_ID)).rejects.toThrow(
      /still present after delete/
    );

    expect(deleteEntry).toHaveBeenCalledTimes(1);
    expect(getEntry).toHaveBeenCalledTimes(2);
  });
});
