import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import WorkflowDetailsPanel from "./WorkflowDetailsPanel.svelte";

const baseProps = {
  titleId: "workflow-title",
  state: "ready" as const,
  stage: "on_hold" as const,
};

describe("WorkflowDetailsPanel", () => {
  it("leads with the status action without repeating project summary facts", async () => {
    const onChangeStage = vi.fn();
    await render(WorkflowDetailsPanel, {
      ...baseProps,
      canChangeStage: true,
      onChangeStage,
    });

    const status = document.body.querySelector<HTMLButtonElement>("[data-workflow-stage-action]")!;
    expect(document.body.textContent).toContain("On hold");
    expect(status.textContent).toContain("Change");
    expect(document.body.textContent).not.toContain("Admin Writer");
    expect(document.body.textContent).not.toContain("No current handoff");
    expect(document.body.textContent).not.toContain("Not set");
    expect(document.body.querySelector("dl")).toBeNull();
    await userEvent.click(status);
    expect(onChangeStage).toHaveBeenCalledOnce();
  });

  it("renders the canonical labelled StageBadge for stored stages, plain text for fallbacks", async () => {
    const stored = await render(WorkflowDetailsPanel, baseProps);
    expect(document.body.querySelector('[data-stage-badge="on_hold"]')?.textContent).toContain(
      "On hold"
    );
    stored.unmount();

    await render(WorkflowDetailsPanel, {
      ...baseProps,
      stage: "intake",
      stageIsFallback: true,
    });
    expect(document.body.querySelector("[data-stage-badge]")).toBeNull();
    expect(document.body.textContent).toContain("Legacy status only");
  });

  it("uses the AA primary-selected pair for the white-plane primary action", async () => {
    await render(WorkflowDetailsPanel, {
      ...baseProps,
      stage: "drafting",
      canCreateWork: true,
      canSendForReview: true,
      assignable: true,
      onAssignWork: vi.fn(),
      onSendForReview: vi.fn(),
    });
    const primary = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Send for internal review"
    )!;
    expect(primary.className).toContain("bg-primary-selected");
    expect(primary.className).not.toMatch(/bg-primary(?![-_])/);
  });

  it("renders current handoff metadata and work actions", async () => {
    const onAssignWork = vi.fn();
    const onSendForReview = vi.fn();
    await render(WorkflowDetailsPanel, {
      ...baseProps,
      stage: "drafting",
      workItems: [{
        workItemId: "work-1" as never,
        kind: "internal_review",
        blocking: true,
        isCurrentHandoff: true,
        dueAt: Date.now() + 86_400_000,
        instructionsPreview: "Review the current draft.",
        version: 0,
        assignee: { userId: "user-1" as never, label: "Alex Lee", initials: "AL" },
        viewerCanManage: true,
      }],
      canCreateWork: true,
      canSendForReview: true,
      onAssignWork,
      onSendForReview,
    });
    expect(document.body.textContent).toContain("Alex Lee");
    expect(document.body.textContent).toContain("Internal review");
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Send for internal review")!);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Assign work")!);
    expect(onSendForReview).toHaveBeenCalledOnce();
    expect(onAssignWork).toHaveBeenCalledOnce();
  });

  it("uses explicit fallback and unassigned copy instead of ambiguous dashes", async () => {
    await render(WorkflowDetailsPanel, {
      ...baseProps,
      stage: "intake",
      stageIsFallback: true,
    });

    expect(document.body.textContent).toContain("Legacy status only");
    expect(document.body.textContent).toContain("Changes begin from Intake");
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

    const status = document.body.querySelector<HTMLButtonElement>("[data-workflow-stage-action]")!;
    const transfer = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Transfer owner"
    )!;
    const buttons = [status, transfer];
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

  it("keeps the activity section closed by default and toggles it accessibly", async () => {
    const onToggleActivity = vi.fn();
    await render(WorkflowDetailsPanel, {
      ...baseProps,
      onToggleActivity,
      activityOpen: false,
      activityState: "ready" as const,
    });
    const disclosure = document.body.querySelector<HTMLButtonElement>(
      "[data-activity-disclosure]"
    )!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.textContent).toContain("Activity");
    // Closed: no activity region rendered, so no query result is displayed.
    expect(document.body.textContent).not.toContain("No recorded activity yet");
    await userEvent.click(disclosure);
    expect(onToggleActivity).toHaveBeenCalledOnce();
  });

  it("renders typed activity entries newest-first with truthful truncation", async () => {
    const at = Date.UTC(2026, 7, 6, 15, 0);
    await render(WorkflowDetailsPanel, {
      ...baseProps,
      onToggleActivity: vi.fn(),
      activityOpen: true,
      activityState: "ready" as const,
      activityTruncated: true,
      activityEntries: [
        {
          id: "e2",
          kind: "work_reassigned" as const,
          at: at + 1000,
          actor: { label: "Avery Admin", initials: "AA" },
          workKind: "internal_review" as const,
          fromAssigneeLabel: "Olivia Owner",
          toAssigneeLabel: "Riley Reviewer",
          note: null,
        },
        {
          id: "e1",
          kind: "stage_changed" as const,
          at,
          actor: { label: "Olivia Owner", initials: "OO" },
          fromStage: "drafting" as const,
          toStage: "internal_review" as const,
          note: "Ready for QA",
        },
      ] as never,
    });
    const rows = [...document.body.querySelectorAll("[data-activity-entry]")];
    expect(rows.map((row) => row.getAttribute("data-activity-entry"))).toEqual([
      "work_reassigned",
      "stage_changed",
    ]);
    expect(rows[0].textContent).toContain("Internal review reassigned");
    expect(rows[0].textContent).toContain("Olivia Owner → Riley Reviewer");
    expect(rows[1].textContent).toContain("Stage changed");
    expect(rows[1].textContent).toContain("Drafting → Internal review");
    expect(rows[1].textContent).toContain("Note: Ready for QA");
    expect(
      document.body.querySelector("[data-activity-truncated]")?.textContent
    ).toContain("most recent events");
  });

  it("covers activity loading, empty, denied, and error states", async () => {
    const open = { ...baseProps, onToggleActivity: vi.fn(), activityOpen: true };
    const loading = await render(WorkflowDetailsPanel, {
      ...open,
      activityState: "loading" as const,
    });
    expect(document.body.textContent).toContain("Loading project activity");
    loading.unmount();

    const empty = await render(WorkflowDetailsPanel, {
      ...open,
      activityState: "ready" as const,
      activityEntries: [],
    });
    expect(document.body.textContent).toContain("No recorded activity yet");
    empty.unmount();

    const denied = await render(WorkflowDetailsPanel, {
      ...open,
      activityState: "denied" as const,
    });
    expect(document.body.textContent).toContain(
      "Project activity is not available for this project."
    );
    denied.unmount();

    await render(WorkflowDetailsPanel, {
      ...open,
      activityState: "error" as const,
    });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Project activity is temporarily unavailable"
    );
  });

  it("distinguishes loading, retryable errors, and unavailable access", async () => {
    const loading = await render(WorkflowDetailsPanel, {
      ...baseProps,
      state: "loading",
    });
    expect(document.body.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Loading workflow");
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
    expect(document.body.textContent).toContain("controls are not available for this project");
    expect(document.body.textContent).not.toContain("Try again");
  });
});
