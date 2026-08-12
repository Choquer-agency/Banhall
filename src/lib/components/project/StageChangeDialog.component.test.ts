import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import StageChangeDialog from "./StageChangeDialog.svelte";
// Accepted noise: this suite emits `svelte.dev/e/derived_inert` console.warn
// lines from bits-ui's Dialog internals (forceMount + svelte transition reads
// a library $derived after teardown) — attributed 2026-08-06 by per-file
// bisection of the component suite; not a product-code teardown leak.
import type { WorkflowStageOption } from "../../../../shared/workflowLabels";

const options: WorkflowStageOption[] = [
  {
    to: "internal_review",
    label: "Internal review",
    description: "The report is undergoing internal review.",
    requiresNote: false,
    disabledReason: null,
  },
  {
    to: "ready_for_delivery",
    label: "Ready for delivery",
    description: "The exact deliverable is ready.",
    requiresNote: false,
    disabledReason: "Needs a promoted report branch before this stage is available.",
  },
  {
    to: "on_hold",
    label: "On hold",
    description: "Work is intentionally paused.",
    requiresNote: true,
    disabledReason: null,
  },
];

describe("StageChangeDialog", () => {
  it("does not claim Intake is stored when the project only has legacy status", async () => {
    await render(StageChangeDialog, {
      open: true,
      currentStageLabel: "Legacy status only",
      options: [],
      onSubmit: () => undefined,
    });
    expect(document.body.textContent).toContain("Current stage: Legacy status only");
    expect(document.body.textContent).not.toContain("Current stage: Intake");
  });

  it("shows supplied options and explains unavailable prerequisites", async () => {
    await render(StageChangeDialog, {
      open: true,
      currentStageLabel: "Drafting",
      options,
      onSubmit: vi.fn(),
    });
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("Needs a promoted report branch");
    const blocked = [...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent?.includes("Ready for delivery")
    );
    expect(blocked?.getAttribute("aria-disabled")).toBe("true");
    expect(blocked?.tabIndex).toBe(-1);
  });

  it("requires an audit note for reason-required transitions", async () => {
    const onSubmit = vi.fn();
    await render(StageChangeDialog, {
      open: true,
      currentStageLabel: "Drafting",
      options,
      onSubmit,
    });
    const hold = [...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent?.includes("On hold")
    )!;
    await userEvent.click(hold);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const submit = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Change stage"
    )!;
    expect(submit.disabled).toBe(true);
    await userEvent.fill(document.body.querySelector("textarea")!, "Waiting on client evidence");
    expect(submit.disabled).toBe(false);
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("on_hold", "Waiting on client evidence");
  });

  it("supports arrow-key radiogroup navigation", async () => {
    await render(StageChangeDialog, {
      open: true,
      currentStageLabel: "Drafting",
      options,
      onSubmit: vi.fn(),
    });
    const rows = [...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(rows[2].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(rows[2]);
  });

  it("preserves an audit note while reconciling stale workflow values", async () => {
    const onUseLatest = vi.fn();
    const view = await render(StageChangeDialog, {
      open: true,
      currentStageLabel: "Drafting",
      options,
      onSubmit: vi.fn(),
    });
    const hold = [...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent?.includes("On hold")
    )!;
    await userEvent.click(hold);
    const textarea = document.body.querySelector<HTMLTextAreaElement>("textarea")!;
    await userEvent.fill(textarea, "Waiting on evidence");

    await view.rerender({
      open: true,
      currentStageLabel: "Drafting",
      latestStageLabel: "Internal review",
      stale: true,
      onUseLatest,
      options: options.filter((option) => option.to !== "on_hold"),
      onSubmit: vi.fn(),
    });

    expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
      "It is now Internal review"
    );
    expect(document.body.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Waiting on evidence"
    );
    expect(document.body.textContent).toContain("audit note has been preserved");
    const latest = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Use latest values"
    )!;
    await userEvent.click(latest);
    expect(onUseLatest).toHaveBeenCalledOnce();
  });

  it("renders server errors and 44px interactive rows", async () => {
    await render(StageChangeDialog, {
      open: true,
      currentStageLabel: "Drafting",
      options,
      errorMessage: "The project workflow changed.",
      onSubmit: vi.fn(),
    });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("workflow changed");
    for (const button of document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
