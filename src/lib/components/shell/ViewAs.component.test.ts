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
    await expect.poll(() => getComputedStyle(selected).backgroundColor).toBe("rgb(241, 250, 249)");
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
    await page.getByRole("button", { name: "Viewing as Consultant. Switch role" }).click();
    await page.getByRole("menuitemradio", { name: "Manager" }).click();
    expect(viewAs.role).toBe("manager");
    await page.getByRole("button", { name: "Exit" }).click();
    expect(viewAs.role).toBeNull();
    await expect.element(page.getByText("Back to Developer view")).toBeVisible();
    await clearToasts();
  });
});
