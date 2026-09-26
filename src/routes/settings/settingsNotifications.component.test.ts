import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import NotificationsPage from "./notifications/+page.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __mutationCalls, __resetConvexStub, __setMutationError, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const allOn = { ideasReady: true, draftReady: true, qaFinished: true, handoff: true, inviteAccepted: true };
const rowLabels = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-settings-row]")).map((row) =>
    row.textContent?.replace(/\s+/g, " ").trim()
  );

describe("Settings Notifications (I3)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("lists the in-app switches; the Email column is not built; Invite accepted is for inviters", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u", role: "writer" });
    __setQueryData("notifications:getSettings", { ...allOn, draftReady: false });
    await render(NotificationsPage, {});
    await expect.poll(rowLabels).toEqual([
      "Ideas are ready When step by step finishes reading.",
      "Draft is ready When the PD is written.",
      "QA finished With the score.",
      "Handed off to you When a project lands with you.",
    ]);
    expect(document.querySelector("[data-settings-notifications]")?.textContent).toContain("In the app");
    expect(document.querySelector("[data-settings-notifications]")?.textContent).not.toContain("Email");
    await expect.element(page.getByRole("switch", { name: "Draft is ready" })).toHaveAttribute("aria-checked", "false");
    await expect.element(page.getByRole("switch", { name: "Ideas are ready" })).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector("[data-settings-save-bar]")).toBeNull();
  });

  it.each(["manager", "admin"] as const)("%s also sees Invite accepted", async (role) => {
    __setQueryData("users:getCurrentUser", { _id: "u", role });
    __setQueryData("notifications:getSettings", allOn);
    await render(NotificationsPage, {});
    await expect.poll(() => rowLabels().at(-1)).toBe("Invite accepted Anyone who can invite.");
  });

  it("each switch saves at once", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u", role: "writer" });
    __setQueryData("notifications:getSettings", allOn);
    await render(NotificationsPage, {});
    const handoff = page.getByRole("switch", { name: "Handed off to you" });
    await handoff.click();
    await expect.poll(() => __mutationCalls("notifications:setSetting")).toEqual([{ key: "handoff", value: false }]);
    await expect.element(handoff).toHaveAttribute("aria-checked", "false");
  });

  it("a failed save goes back to the stored value", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u", role: "writer" });
    __setQueryData("notifications:getSettings", allOn);
    __setMutationError("notifications:setSetting", new Error("offline"));
    await render(NotificationsPage, {});
    const qa = page.getByRole("switch", { name: "QA finished" });
    await qa.click();
    await expect.poll(() => __mutationCalls("notifications:setSetting")).toHaveLength(1);
    await expect.element(qa).toHaveAttribute("aria-checked", "true");
  });
});
