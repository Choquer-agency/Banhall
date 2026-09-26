import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ShortcutsPage from "./shortcuts/+page.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const rows = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-shortcut-row]")).map((row) =>
    [
      row.firstElementChild?.textContent?.trim(),
      ...Array.from(row.querySelectorAll("[data-key-hint] > *")).map((key) => key.textContent?.trim()),
    ].join(" ")
  );

describe("Settings Keyboard shortcuts (I4, I5)", () => {
  beforeEach(() => {
    __resetPage();
    __resetConvexStub();
    sessionStorage.clear();
    viewAs.clear();
  });

  it("names the detected computer and lists the keys; the switch changes the list only", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u", role: "admin", isDeveloper: true });
    await render(ShortcutsPage, {});
    const strip = document.querySelector<HTMLElement>("[data-shortcuts-detected]")!;
    // Chromium in the suite reports this machine's platform.
    expect(strip.textContent).toMatch(
      /We detected (macOS|Windows), so these are the keys for your computer\.|We could not detect your computer, so these are the Windows keys\./
    );
    await page.getByRole("button", { name: "Mac" }).click();
    await expect.poll(rows).toEqual([
      "Search ⌘ K",
      "New project C",
      "Collapse the rail ⌘ \\",
      "Go to Admin G then A",
      "Approve and continue ⌘ Enter",
      "View as (developers) ⇧ V",
    ]);
    await page.getByRole("button", { name: "Windows" }).click();
    await expect.poll(rows).toEqual([
      "Search Ctrl K",
      "New project C",
      "Collapse the rail Ctrl \\",
      "Go to Admin G then A",
      "Approve and continue Ctrl Enter",
      "View as (developers) Shift V",
    ]);
    expect(page.getByRole("button", { name: "Windows" }).element().getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toContain(
      "Menus and tooltips show the same keys. Press ? anywhere to see this list."
    );
    const chip = document.querySelector<HTMLElement>("[data-shortcut-row] kbd")!;
    expect(chip.getBoundingClientRect().height).toBe(24);
    expect(getComputedStyle(chip).borderRadius).toBe("5px");
  });

  it("hides Go to Admin and View as from a Consultant", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u", role: "writer" });
    await render(ShortcutsPage, {});
    await page.getByRole("button", { name: "Windows" }).click();
    await expect.poll(rows).toEqual([
      "Search Ctrl K",
      "New project C",
      "Collapse the rail Ctrl \\",
      "Approve and continue Ctrl Enter",
    ]);
  });
});
