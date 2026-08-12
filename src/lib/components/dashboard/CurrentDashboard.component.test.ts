import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import CurrentDashboard from "./CurrentDashboard.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetConvexStub, __setPaginatedRows, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/** Pins the rollback dashboard to the original one-lane-at-a-time My Work contract. */
describe("CurrentDashboard My Work wiring", () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetPage();
    __resetConvexStub();
    __setPageUrl("/dashboard?view=my_work");
    __setQueryData("myWork:getViewConfig", {
      killSwitch: false,
      ready: true,
      configuredDefault: "my_work",
    });
    __setPaginatedRows("myWork:listAssignedToMe", []);
    __setQueryData("myWork:getWaitingLaneState", { syncing: false, failed: false });
  });

  it("renders the current tabbed ledger rather than the preview sort and layout controls", async () => {
    await render(CurrentDashboard, {});

    await expect.poll(() => document.querySelector('[role="tablist"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Assigned to me");
    expect(document.querySelector('select[title="Sorts loaded items only."]')).toBeNull();
    expect(document.querySelector('[aria-label="Board view"]')).toBeNull();
    expect(document.querySelector('[aria-label="List view"]')).toBeNull();
  });
});
