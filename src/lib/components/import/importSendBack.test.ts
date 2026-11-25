import { describe, expect, it, vi } from "vitest";

vi.mock("svelte-sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
// The toaster is a Svelte component; only its offset is read here.
vi.mock("$lib/components/shell/AppToaster.svelte", () => ({ TOAST_BOTTOM_OFFSET: "24px" }));

import { toast } from "svelte-sonner";
import { sendBackFiles } from "./importActions";
import type { SendBackResult } from "./importApproved";

type Id = SendBackResult["sentBack"][number];
const ids = (count: number, from = 0) => Array.from({ length: count }, (_, n) => `f${n + from}` as Id);
const result = (sentBack: Id[], notReached: Id[] = []): SendBackResult => ({
  sentBack,
  refused: [],
  companyFileGone: [],
  brainKept: [],
  brainRevoked: [],
  notReached,
});

/**
 * Send back in parts (2026-11-18): a call that spent its read budget hands
 * back the files it did not reach, and the page sends them first in its next
 * call, until every file is sent back or refused.
 */
describe("sending files back in parts", () => {
  it("sends the files a call did not reach again, first, until none is left", async () => {
    const calls: Id[][] = [];
    const call = vi.fn(async ({ ids: batch }: { ids: Id[] }) => {
      calls.push(batch);
      // Each call reaches its first eight files only.
      return result(batch.slice(0, 8), batch.slice(8));
    });
    const selected = ids(60);
    const { result: total, error } = await sendBackFiles(selected, call);
    expect(error).toBeNull();
    expect(total.sentBack).toEqual(selected);
    expect(total.notReached).toEqual([]);
    // 50 first, then the 42 not reached ahead of the last 10, and so on.
    expect(calls[0]).toEqual(selected.slice(0, 50));
    expect(calls[1]).toEqual([...selected.slice(8, 50), ...selected.slice(50, 58)]);
    expect(calls.every((batch) => batch.length <= 50)).toBe(true);
    expect(calls).toHaveLength(8);
    expect(vi.mocked(toast)).toHaveBeenLastCalledWith("60 files sent back to To review", expect.anything());
  });

  it("stops rather than loop when a call reaches none of its files", async () => {
    const call = vi.fn(async ({ ids: batch }: { ids: Id[] }) => result([], batch));
    const { result: total } = await sendBackFiles(ids(3), call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(total.sentBack).toEqual([]);
  });
});
