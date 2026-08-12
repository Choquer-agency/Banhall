import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import MyWorkView from "./MyWorkView.svelte";
import {
  __isQueryActive,
  __resetConvexStub,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Home no longer owns the operational My Work queues. These assertions guard
 * both the presentation removal and the released subscription budget.
 */
describe("Home work-query removal", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetConvexStub();
    __setQueryData("users:getCurrentUser", {
      firstName: "Olivia",
      lastName: "Owner",
      email: "olivia@example.test",
    });
    document.body.innerHTML = "";
  });

  it("does not subscribe to queue or accountability queries", async () => {
    await render(MyWorkView, {});

    expect(__isQueryActive("myWork:listAssignedToMe")).toBe(false);
    expect(__isQueryActive("myWork:listReviews")).toBe(false);
    expect(__isQueryActive("myWork:listDueSoon")).toBe(false);
    expect(__isQueryActive("myWork:listOwnedByMe")).toBe(false);
    expect(__isQueryActive("myWork:listWaitingOnOthers")).toBe(false);
    expect(__isQueryActive("myWork:getWaitingLaneState")).toBe(false);
  });

  it("does not render queue controls, work rows, or action controls", async () => {
    await render(MyWorkView, {});

    expect(document.querySelector("[data-scope-chip]")).toBeNull();
    expect(document.querySelector("[data-my-work-row]")).toBeNull();
    expect(document.querySelector('select[title="Sorts loaded items only."]')).toBeNull();
    expect(
      [...document.querySelectorAll("button")].some((button) =>
        ["Complete", "Reassign"].includes(button.textContent?.trim() ?? "")
      )
    ).toBe(false);
  });
});
