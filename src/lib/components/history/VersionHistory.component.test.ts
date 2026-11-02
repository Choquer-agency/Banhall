// 2026-11-02 (client request): the version history says how long each AI
// draft took, and nothing for any other version or an old draft.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import VersionHistory from "./VersionHistory.svelte";

const reportId = "report-history" as Id<"reports">;
const MIN = 60_000;

function snapshot(id: string, reason: string, draftTiming: { draftMs: number | null; stepByStepMs: number | null } | null, createdAt: number) {
  return {
    _id: id,
    reportId,
    reportVersion: 1,
    isCurrentReport: true,
    reason,
    label: reason === "generated" ? "AI draft (Model A)" : undefined,
    createdByRole: reason === "generated" ? "system" : "writer",
    createdAt,
    provenanceStatus: "unavailable_legacy",
    researchSessionId: null,
    researchSourceCount: 0,
    draftTiming,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  __resetConvexStub();
});

describe("Version history draft timing", () => {
  it("shows how long each AI draft took and nothing for other versions or old drafts", async () => {
    __setQueryData("snapshots:listSnapshots", [
      snapshot("snap-manual", "manual", null, 1_800_000_300_000),
      snapshot("snap-seeds", "generated", { draftMs: 9 * MIN, stepByStepMs: 65 * MIN }, 1_800_000_200_000),
      snapshot("snap-single", "generated", { draftMs: 12 * MIN, stepByStepMs: null }, 1_800_000_100_000),
      snapshot("snap-old", "generated", null, 1_800_000_000_000),
    ]);
    __setQueryData("snapshots:getSnapshot", null);
    await render(VersionHistory, { reportId, beforeSnapshot: vi.fn(async () => 1), onClose: vi.fn() });
    await expect.element(page.getByText("Version history", { exact: true })).toBeVisible();
    const lines = () => [...document.querySelectorAll<HTMLElement>("[data-history-draft-timing]")].map((line) => line.textContent);
    await expect.poll(lines).toEqual([
      "Step by step took 1 h 5 min, then 9 min to draft",
      "Drafted in 12 min",
    ]);
  });
});
