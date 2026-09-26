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
    expect(getComputedStyle(chip).borderRadius).toBe("6px");
    expect(getComputedStyle(chip).paddingLeft).toBe("7px");
    expect(getComputedStyle(chip).boxShadow).toContain("rgb(218, 229, 227) 0px 1px 0px 0px");
    expect(getComputedStyle(document.querySelector<HTMLElement>("[data-key-then]")!).color).toBe("rgb(107, 127, 123)");
  });

  it("matches I4 and I5: the detected note on canvas, the white active segment and settings rows", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u", role: "admin", isDeveloper: true });
    await render(ShortcutsPage, {});
    const strip = document.querySelector<HTMLElement>("[data-shortcuts-detected]")!;
    expect(getComputedStyle(strip).backgroundColor).toBe("rgb(249, 252, 251)");
    expect(getComputedStyle(strip).borderRadius).toBe("12px");
    expect([getComputedStyle(strip).paddingTop, getComputedStyle(strip).paddingLeft]).toEqual(["12px", "14px"]);
    const check = strip.querySelector("svg")!;
    expect(check.querySelector("path")?.getAttribute("d")).toBe("M20 6 9 17l-5-5");
    expect([check.getAttribute("width"), check.getAttribute("stroke-width")]).toEqual(["15", "2"]);
    expect(getComputedStyle(check).color).toBe("rgb(8, 122, 117)");

    const group = document.querySelector<HTMLElement>("[data-shortcuts-platforms]")!;
    expect(getComputedStyle(group).backgroundColor).toBe("rgb(234, 242, 241)");
    expect(getComputedStyle(group).borderRadius).toBe("9px");
    expect(getComputedStyle(group).paddingTop).toBe("3px");
    await page.getByRole("button", { name: "Mac" }).click();
    const mac = page.getByRole("button", { name: "Mac" }).element() as HTMLElement;
    const windows = page.getByRole("button", { name: "Windows" }).element() as HTMLElement;
    await expect.poll(() => getComputedStyle(mac).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(mac).color).toBe("rgb(22, 33, 31)");
    expect(getComputedStyle(mac).boxShadow).toContain("rgba(5, 42, 40, 0.08) 0px 1px 2px 0px");
    expect(mac.getBoundingClientRect().height).toBe(28);
    expect(getComputedStyle(mac).borderRadius).toBe("6px");
    // Windows was the active segment before the click and fades its colour
    // (transition-colors), so wait for it to settle like the Mac background.
    await expect.poll(() => getComputedStyle(windows).color).toBe("rgb(79, 97, 93)");

    const rowEls = Array.from(document.querySelectorAll<HTMLElement>("[data-shortcut-row]"));
    const label = rowEls[0].firstElementChild as HTMLElement;
    expect(getComputedStyle(label).fontWeight).toBe("500");
    expect(getComputedStyle(rowEls[0]).paddingTop).toBe("16px");
    expect(getComputedStyle(rowEls[0]).borderBottomWidth).toBe("1px");
    expect(getComputedStyle(rowEls.at(-1)!).borderBottomWidth).toBe("0px");
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
