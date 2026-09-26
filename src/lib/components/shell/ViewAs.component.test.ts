import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "svelte-sonner";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ViewAsDialog from "./ViewAsDialog.svelte";
import ViewAsPill from "./ViewAsPill.svelte";
import ToastHarness from "$lib/test/ToastHarness.svelte";
import { viewAs, VIEW_AS_STORAGE_KEY } from "$lib/shell/viewAs.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

describe("View as (D2, D3, D5)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    viewAs.clear();
  });

  // Let svelte-sonner finish removing toasts while its Toaster is still
  // mounted, or its own delete timer reads a toast that is gone.
  async function clearToasts() {
    toast.dismiss();
    await expect.poll(() => document.querySelectorAll("[data-sonner-toast]").length, { timeout: 3000 }).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  it("D2: four role cards, Consultant selected by default, the confirm label follows the selection", async () => {
    await render(ViewAsDialog, { open: true });
    await expect.element(page.getByRole("dialog", { name: "View Banhall as another role" })).toBeVisible();
    expect(document.body.textContent).toContain(
      "See exactly what they see. Anything you do still uses your Developer access."
    );
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-view-as-card]"));
    expect(cards.map((card) => card.dataset.viewAsCard)).toEqual(["owner", "manager", "consultant", "admin"]);
    expect(cards.map((card) => card.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Owner Team and invites Admin",
      "Manager Team and invites Not Admin",
      "Consultant Home, Projects, Companies Not Team and Admin",
      "Admin Team and roles Admin",
    ]);
    expect(cards[2].getAttribute("aria-checked")).toBe("true");
    const confirm = page.getByRole("button", { name: "View as Consultant" });
    await expect.element(confirm).toBeVisible();

    // Arrow keys move the selection (radio group).
    await userEvent.click(cards[2]);
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("button", { name: "View as Admin" })).toBeVisible();
    await page.getByRole("radio", { name: /Manager/ }).click();
    await expect.element(page.getByRole("button", { name: "View as Manager" })).toBeVisible();
    const selected = document.querySelector<HTMLElement>('[data-view-as-card="manager"]')!;
    await expect.poll(() => getComputedStyle(selected).borderTopColor).toBe("rgb(10, 58, 56)");
    // D2: the selected card is a 1.5px fir border on #F7FCFB.
    await expect.poll(() => getComputedStyle(selected).backgroundColor).toBe("rgb(247, 252, 251)");
    // Chromium snaps a 1.5px border to whole device pixels, so check the rule itself.
    expect(selected.className).toContain("data-[state=checked]:border-[1.5px]");
    expect(getComputedStyle(cards[0]).borderTopWidth).toBe("1px");
    expect(getComputedStyle(cards[0]).borderRadius).toBe("12px");
    // Ticks in each role's colour (11px, stroke 2.4); a faint dash for what the role cannot open.
    const tickColour = (role: string) =>
      getComputedStyle(document.querySelector(`[data-view-as-card="${role}"] [data-view-as-tick]`)!).color;
    expect(tickColour("owner")).toBe("rgb(8, 122, 117)");
    expect(tickColour("manager")).toBe("rgb(14, 116, 144)");
    expect(tickColour("consultant")).toBe("rgb(79, 97, 93)");
    expect(tickColour("admin")).toBe("rgb(20, 71, 230)");
    const tick = document.querySelector<SVGElement>('[data-view-as-card="owner"] [data-view-as-tick]')!;
    expect(tick.getAttribute("width")).toBe("11");
    expect(tick.getAttribute("stroke-width")).toBe("2.4");
    expect(tick.querySelector("path")?.getAttribute("d")).toBe("M20 6 9 17l-5-5");
    const dash = document.querySelector<SVGElement>('[data-view-as-card="manager"] [data-view-as-dash]')!;
    expect(dash.querySelector("path")?.getAttribute("d")).toBe("M6 12h12");
    expect(getComputedStyle(dash).color).toBe("rgb(147, 165, 161)");
    // Footer buttons: 36px tall, radius 8; the scrim is #010505 at 35%.
    const cancel = document.querySelector<HTMLElement>("[data-view-as-cancel]")!;
    expect(getComputedStyle(cancel).borderRadius).toBe("8px");
    expect(getComputedStyle(cancel).backgroundColor).toBe("rgb(254, 226, 226)");
    expect(getComputedStyle(cancel).color).toBe("rgb(185, 28, 28)");
    const confirmButton = document.querySelector<HTMLElement>("[data-view-as-confirm]")!;
    expect(getComputedStyle(confirmButton).borderRadius).toBe("8px");
    expect(confirmButton.getBoundingClientRect().height).toBe(36);
    const close = document.querySelector<SVGElement>('[data-view-as-dialog] button[aria-label="Close"] svg')!;
    expect(close.getAttribute("width")).toBe("18");
    expect(close.getAttribute("stroke-width")).toBe("2");
    const scrim = Array.from(document.querySelectorAll<HTMLElement>("div.fixed.inset-0")).find(
      (element) => getComputedStyle(element).backgroundColor !== "rgba(0, 0, 0, 0)"
    )!;
    expect(getComputedStyle(scrim).backgroundColor).toBe("rgba(1, 5, 5, 0.35)");
  });

  it("D2: Cancel closes without entering; confirm enters, stores the role and toasts with Undo", async () => {
    await render(ToastHarness, {});
    const view = await render(ViewAsDialog, { open: true });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => document.querySelector("[data-view-as-dialog]")).toBeNull();
    expect(viewAs.role).toBeNull();
    view.unmount();

    await render(ViewAsDialog, { open: true });
    await page.getByRole("button", { name: "View as Consultant" }).click();
    expect(viewAs.role).toBe("consultant");
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBe("consultant");
    await expect
      .element(page.getByText("Now viewing as Consultant. Your own access is unchanged."))
      .toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    expect(viewAs.role).toBeNull();
    await clearToasts();
  });

  it("D3: the pill switches role directly and Exit returns to the Developer view with a toast (D5)", async () => {
    await render(ToastHarness, {});
    viewAs.enter("consultant");
    await render(ViewAsPill, { role: "consultant" });
    const pill = document.querySelector<HTMLElement>("[data-view-as-pill]")!;
    expect(pill.getBoundingClientRect().height).toBe(36);
    expect(getComputedStyle(pill).backgroundColor).toBe("rgb(255, 251, 235)");
    expect(pill.textContent).toContain("Viewing as");
    // D3: the board's eye (14 / 1.7) and chevron (12 / 2) in warning ink,
    // and Exit underlined from the font's own position.
    const svgs = Array.from(pill.querySelectorAll<SVGElement>("svg"));
    expect(svgs[0].getAttribute("width")).toBe("14");
    expect(svgs[0].getAttribute("stroke-width")).toBe("1.7");
    expect(svgs[0].querySelector("path")?.getAttribute("d")).toContain("M2.5 12S6 5.5 12 5.5");
    expect(getComputedStyle(svgs[0]).color).toBe("rgb(146, 64, 14)");
    expect(svgs[1].getAttribute("width")).toBe("12");
    expect(svgs[1].getAttribute("stroke-width")).toBe("2");
    expect(svgs[1].querySelector("path")?.getAttribute("d")).toBe("m6 9 6 6 6-6");
    const exit = pill.querySelector<HTMLElement>("[data-view-as-pill-exit]")!;
    expect(getComputedStyle(exit).textUnderlinePosition).toBe("from-font");
    expect(getComputedStyle(exit).textDecorationLine).toBe("underline");
    await page.getByRole("button", { name: "Viewing as Consultant. Switch role" }).click();
    await page.getByRole("menuitemradio", { name: "Manager" }).click();
    expect(viewAs.role).toBe("manager");
    await page.getByRole("button", { name: "Exit" }).click();
    expect(viewAs.role).toBeNull();
    await expect.element(page.getByText("Back to Developer view")).toBeVisible();
    await clearToasts();
  });
});
