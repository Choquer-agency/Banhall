import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import { ROLE_DESCRIPTION_NOTE, ROLE_DESCRIPTIONS } from "$lib/roles/roleDescriptions";
import RoleGuideSheet from "./RoleGuideSheet.svelte";
// Accepted noise: `svelte.dev/e/derived_inert` console.warn lines here come
// from bits-ui overlay internals after teardown (attributed 2026-08-06 by
// per-file bisection; AssignmentComposer/OwnerTransfer/ViewModeToggle suites
// emit a few for the same reason) — not a product-code teardown leak.

describe("RoleGuideSheet", () => {
  it("renders one role guide dialog and the rollout note once", async () => {
    await render(RoleGuideSheet, { open: true, role: "writer" });
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain(ROLE_DESCRIPTIONS.writer.summary);
    expect(document.body.textContent?.split(ROLE_DESCRIPTION_NOTE)).toHaveLength(2);
  });

  it("shows only the selected role detail", async () => {
    await render(RoleGuideSheet, { open: true, role: "manager" });
    expect(document.body.textContent).toContain(ROLE_DESCRIPTIONS.manager.summary);
    const activePanel = document.body.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
    expect(activePanel?.textContent).toContain(ROLE_DESCRIPTIONS.manager.summary);
    expect(document.body.querySelectorAll('[role="tabpanel"]')).toHaveLength(3);
  });

  it("switches roles through the accessible tab controls", async () => {
    await render(RoleGuideSheet, { open: true, role: "writer" });
    const adminTab = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent?.trim() === "Admin"
    );
    expect(adminTab).toBeDefined();
    await userEvent.click(adminTab!);
    expect(adminTab?.getAttribute("aria-selected")).toBe("true");
    expect(document.body.textContent).toContain(ROLE_DESCRIPTIONS.admin.summary);
    expect(document.body.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
  });

  it("supports arrow, Home, and End keyboard navigation", async () => {
    await render(RoleGuideSheet, { open: true, role: "writer" });
    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("provides an explicit accessible close control", async () => {
    await render(RoleGuideSheet, { open: true, role: "writer" });
    expect(document.body.querySelector('button[aria-label="Close role guide"]')).not.toBeNull();
  });
});
