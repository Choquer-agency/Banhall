import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import MyWorkView from "./MyWorkView.svelte";
import {
  __resetConvexStub,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

function seedUser() {
  __setQueryData("users:getCurrentUser", {
    firstName: "Olivia",
    lastName: "Owner",
    email: "olivia@example.test",
  });
}

describe("MyWorkView as Home", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("greets restrainedly with the user's first name and a time-of-day phrase", async () => {
    seedUser();
    await render(MyWorkView, {});

    const welcome = document.querySelector("[data-home-welcome]");
    await expect
      .poll(() => welcome?.textContent)
      .toMatch(/^(Good morning|Good afternoon|Good evening), Olivia/);
    expect(welcome?.textContent).toContain("What are we writing today?");
  });

  it("omits the name when identity has not loaded", async () => {
    await render(MyWorkView, {});

    const welcome = document.querySelector("[data-home-welcome]");
    await expect
      .poll(() => welcome?.textContent?.trim())
      .toMatch(/^(Good morning|Good afternoon|Good evening)\.\s*What are we writing/);
    expect(welcome?.textContent).not.toContain("@");
    // No dangling "Good morning, ." artifact when the name is absent.
    expect(welcome?.textContent).not.toMatch(/Good (morning|afternoon|evening),/);
  });

  it("keeps Home focused on project intake and optional device-local recents", async () => {
    seedUser();
    await render(MyWorkView, {
      recentProjects: [{ id: "proj-r1", title: "Recent thermal narrative" }],
    });

    expect(document.querySelector("[data-home-start-form]")).not.toBeNull();
    expect(document.querySelector("[data-home-recents]")?.textContent).toContain(
      "Recent thermal narrative"
    );
  });

  it("removes the loaded summary and work-accountability sections from Home", async () => {
    seedUser();
    await render(MyWorkView, {});

    expect(document.querySelector("[data-home-insights]")).toBeNull();
    expect(document.getElementById("my-work-group-queue")).toBeNull();
    expect(document.getElementById("my-work-group-owned")).toBeNull();
    expect(document.getElementById("my-work-group-waiting")).toBeNull();
    expect(document.body.textContent).not.toContain("Loaded now");
    expect(document.body.textContent).not.toContain("Next actions");
    expect(document.body.textContent).not.toContain("Owned by me");
    expect(document.body.textContent).not.toContain("Waiting on others");
  });
});
