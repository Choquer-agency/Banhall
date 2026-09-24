import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import StopDraftingDialog from "./StopDraftingDialog.svelte";

const dialog = () => document.querySelector<HTMLElement>("[data-stop-drafting-dialog]");
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;

async function settle() {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 350));
}

describe("StopDraftingDialog", () => {
  it("explains what Stop keeps, what it skips and how to draft the rest", async () => {
    await render(StopDraftingDialog, { open: true, currentSectionNumber: "244", onConfirm: vi.fn() });
    const node = dialog()!;
    expect(node.getAttribute("role")).toBe("dialog");
    const text = node.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("Stop writing the draft?");
    expect(text).toContain("Section 244 finishes first, then writing stops.");
    expect(text).toContain("Sections already drafted stay in the report and you can edit them.");
    expect(text).toContain("The rest are marked Not drafted, and QA does not run on this draft.");
    expect(text).toContain("Draft the rest fills in only the missing sections in this same report and keeps your edits.");
    expect(text).not.toMatch(/[\u2010-\u2015\u00B7]/);

    const keep = button("[data-stop-cancel]");
    const stop = button("[data-stop-confirm]");
    expect(keep.textContent?.trim()).toBe("Keep writing");
    expect(stop.textContent?.trim()).toBe("Stop");
    expect(getComputedStyle(keep).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(stop).backgroundColor).toBe("rgb(8, 122, 117)");
  });

  it("does nothing until Stop is pressed, and Keep writing cancels", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await render(StopDraftingDialog, { open: true, onConfirm, onCancel });
    expect(dialog()!.textContent).not.toContain("finishes first");
    button("[data-stop-cancel]").click();
    await settle();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("confirms with Stop and closes", async () => {
    const onConfirm = vi.fn(async () => {});
    const onCancel = vi.fn();
    await render(StopDraftingDialog, { open: true, onConfirm, onCancel });
    button("[data-stop-confirm]").click();
    await settle();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("stays open and shows the error when stopping fails", async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error("offline");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await render(StopDraftingDialog, { open: true, onConfirm });
    button("[data-stop-confirm]").click();
    await settle();
    expect(dialog()).not.toBeNull();
    await view.rerender({ errorMessage: "Could not stop the draft. Try again." });
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain("Could not stop the draft. Try again.");
    errorSpy.mockRestore();
  });

  it("disables Stop while busy", async () => {
    await render(StopDraftingDialog, { open: true, busy: true, onConfirm: vi.fn() });
    const stop = button("[data-stop-confirm]");
    expect(stop.disabled).toBe(true);
    expect(stop.textContent?.trim()).toBe("Stopping…");
  });
});
