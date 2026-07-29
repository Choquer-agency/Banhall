import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import WorkflowDetailsPanel from "./WorkflowDetailsPanel.svelte";

const baseProps = {
  titleId: "workflow-title",
  state: "ready" as const,
  stage: "on_hold" as const,
  owner: { label: "Admin Writer", initials: "AW" },
};

describe("WorkflowDetailsPanel", () => {
  it("shows only current Stage and Owner before handoff storage ships", async () => {
    await render(WorkflowDetailsPanel, baseProps);

    const labels = [...document.body.querySelectorAll("dt")].map((node) => node.textContent?.trim());
    expect(labels).toEqual(["Stage", "Owner"]);
    expect(document.body.textContent).toContain("On hold");
    expect(document.body.textContent).toContain("Admin Writer");
    expect(document.body.textContent).not.toContain("With");
    expect(document.body.textContent).not.toContain("Due");
  });

  it("uses explicit fallback and unassigned copy instead of ambiguous dashes", async () => {
    await render(WorkflowDetailsPanel, {
      ...baseProps,
      stage: "intake",
      stageIsFallback: true,
      owner: null,
    });

    expect(document.body.textContent).toContain("Legacy status only");
    expect(document.body.textContent).toContain("transitions begin from Intake");
    expect(document.body.textContent).toContain("Not assigned");
    expect(document.body.textContent).not.toContain("—");
  });

  it("shows explicit secondary actions and migration review status", async () => {
    const onChangeStage = vi.fn();
    const onTransferOwner = vi.fn();
    await render(WorkflowDetailsPanel, {
      ...baseProps,
      ownerNeedsReview: true,
      canChangeStage: true,
      canTransferOwner: true,
      onChangeStage,
      onTransferOwner,
    });

    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Change stage",
      "Transfer ownership",
    ]);
    for (const button of buttons) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain(
      "administrator review"
    );
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);
    expect(onChangeStage).toHaveBeenCalledOnce();
    expect(onTransferOwner).toHaveBeenCalledOnce();
  });

  it("distinguishes loading, retryable errors, and unavailable access", async () => {
    const loading = await render(WorkflowDetailsPanel, {
      ...baseProps,
      state: "loading",
    });
    expect(document.body.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Loading workflow details");
    loading.unmount();

    const onRetry = vi.fn();
    const failed = await render(WorkflowDetailsPanel, {
      ...baseProps,
      state: "error",
      errorMessage: "Workflow details are temporarily unavailable.",
      onRetry,
    });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "temporarily unavailable"
    );
    await userEvent.click(
      [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Try again"
      )!
    );
    expect(onRetry).toHaveBeenCalledOnce();
    failed.unmount();

    await render(WorkflowDetailsPanel, {
      ...baseProps,
      state: "denied",
    });
    expect(document.body.textContent).toContain("not available for this project");
    expect(document.body.textContent).not.toContain("Try again");
  });
});
