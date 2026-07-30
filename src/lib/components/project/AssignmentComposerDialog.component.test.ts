import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import AssignmentComposerDialog from "./AssignmentComposerDialog.svelte";

const candidates = [
  { userId: "user-a" as never, label: "Alex Lee", initials: "AL", email: "alex@example.com", role: "writer" as const },
  { userId: "user-b" as never, label: "Morgan Manager", initials: "MM", email: null, role: "manager" as const },
];

function props(overrides = {}) {
  return {
    open: true,
    candidates,
    initialKind: "internal_review" as const,
    initialBlocking: true,
    initialInstructions: "Review the current draft and leave actionable feedback.",
    initialDueDate: "2026-08-04",
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe("AssignmentComposerDialog", () => {
  it("shows review defaults and submits only after an assignee is chosen", async () => {
    const onSubmit = vi.fn();
    await render(AssignmentComposerDialog, props({ variant: "review", onSubmit }));
    expect(document.body.textContent).toContain("Internal review");
    expect(document.body.textContent).toContain("Blocking handoff");
    expect(document.body.textContent).toContain("Also move Stage to Internal review");
    const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Send for internal review"))!;
    expect(submit.disabled).toBe(true);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')][0]);
    expect(submit.disabled).toBe(false);
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      assigneeId: "user-a",
      kind: "internal_review",
      blocking: true,
      changeStage: true,
    }));
  });

  it("renders BLOCKING_EXISTS guidance with direct recovery actions", async () => {
    const onReassignConflict = vi.fn();
    await render(AssignmentComposerDialog, props({
      conflict: { workItemId: "work-1" as never, assigneeLabel: "Sidney", kindLabel: "Revision", canReassign: true },
      onReassignConflict,
    }));
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')][0]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("already has a revision handoff with Sidney");
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Reassign that handoff"))!);
    expect(onReassignConflict).toHaveBeenCalledWith("work-1", "user-a");
  });

  it("supports assignee search, arrow navigation, and keyboard submit", async () => {
    const onSubmit = vi.fn();
    await render(AssignmentComposerDialog, props({ variant: "review", onSubmit }));
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search assignees"]')!;
    await userEvent.fill(search, "Morgan");
    const option = document.querySelector<HTMLButtonElement>('[role="radio"]')!;
    expect(option.textContent).toContain("Morgan Manager");
    await userEvent.click(option);
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    await userEvent.click(textarea);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("freezes every fingerprinted assignment control while submitting", async () => {
    await render(AssignmentComposerDialog, props({ variant: "full", busy: true }));
    expect(document.querySelector<HTMLInputElement>("#assignment-kind")?.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#assignment-due")?.disabled).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>("#assignment-instructions")?.disabled).toBe(true);
  });

  it("uses a mobile bottom sheet and 44px controls", async () => {
    await render(AssignmentComposerDialog, props({ variant: "full" }));
    const form = document.querySelector("form")!;
    expect(getComputedStyle(form).borderTopLeftRadius).not.toBe("0px");
    for (const button of document.querySelectorAll<HTMLButtonElement>('button:not([aria-label="Toggle options"])')) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
