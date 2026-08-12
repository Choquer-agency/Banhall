import { describe, expect, it } from "vitest";
import {
  formatActivityTimestamp,
  presentActivityEntry,
  type ActivityEntry,
} from "./activityPresentation";

const actor = { label: "Avery Admin", initials: "AA" };
const base = { id: "e1", at: Date.UTC(2026, 7, 6, 18, 30), actor };

describe("presentActivityEntry", () => {
  it("labels ownership transfers with a text diff and note", () => {
    expect(
      presentActivityEntry({
        ...base,
        kind: "ownership_transferred",
        fromLabel: "Olivia Owner",
        toLabel: "Riley Reviewer",
        note: "Vacation coverage",
      } as ActivityEntry)
    ).toEqual({
      label: "Ownership transferred",
      detail: "Olivia Owner → Riley Reviewer",
      note: "Vacation coverage",
    });
    expect(
      presentActivityEntry({
        ...base,
        kind: "ownership_transferred",
        fromLabel: null,
        toLabel: "Riley Reviewer",
        note: null,
      } as ActivityEntry).detail
    ).toBe("To Riley Reviewer");
  });

  it("uses canonical stage labels for stage changes", () => {
    expect(
      presentActivityEntry({
        ...base,
        kind: "stage_changed",
        fromStage: "drafting",
        toStage: "internal_review",
        note: null,
      } as ActivityEntry)
    ).toEqual({
      label: "Stage changed",
      detail: "Drafting → Internal review",
      note: null,
    });
    expect(
      presentActivityEntry({
        ...base,
        kind: "stage_changed",
        fromStage: null,
        toStage: "intake",
        note: null,
      } as ActivityEntry).detail
    ).toBe("To Intake");
  });

  it("describes work creation with assignee, blocking, and due details", () => {
    const presentation = presentActivityEntry({
      ...base,
      kind: "work_created",
      workKind: "internal_review",
      assigneeLabel: "Riley Reviewer",
      blocking: true,
      dueAt: Date.UTC(2026, 7, 20),
    } as ActivityEntry);
    expect(presentation.label).toBe("Internal review assigned");
    expect(presentation.detail).toContain("To Riley Reviewer");
    expect(presentation.detail).toContain("Blocking");
    expect(presentation.detail).toContain("Due ");
  });

  it("falls back to a neutral label when the work item kind is unresolved", () => {
    expect(
      presentActivityEntry({
        ...base,
        kind: "work_reassigned",
        workKind: null,
        fromAssigneeLabel: "A",
        toAssigneeLabel: "B",
        note: null,
      } as ActivityEntry).label
    ).toBe("Work item reassigned");
  });

  it("covers blocking, due, completed, declined, and canceled grammars", () => {
    expect(
      presentActivityEntry({
        ...base,
        kind: "work_blocking_changed",
        workKind: "revision",
        toBlocking: false,
      } as ActivityEntry)
    ).toEqual({
      label: "Blocking changed",
      detail: "Revision · No longer blocking",
      note: null,
    });
    expect(
      presentActivityEntry({
        ...base,
        kind: "work_due_changed",
        workKind: "revision",
        fromDueAt: null,
        toDueAt: Date.UTC(2026, 7, 20),
      } as ActivityEntry).detail
    ).toMatch(/^Revision · Not set → /);
    expect(
      presentActivityEntry({
        ...base,
        kind: "work_completed",
        workKind: "internal_review",
        assigneeLabel: "Riley Reviewer",
        onBehalfOfAssignee: true,
      } as ActivityEntry)
    ).toEqual({
      label: "Internal review completed",
      detail: "Riley Reviewer · Completed on their behalf",
      note: null,
    });
    expect(
      presentActivityEntry({
        ...base,
        kind: "work_declined",
        workKind: "revision",
        assigneeLabel: "Riley Reviewer",
        reason: "Out of scope",
      } as ActivityEntry)
    ).toEqual({
      label: "Revision declined",
      detail: "Riley Reviewer",
      note: "Out of scope",
    });
    expect(
      presentActivityEntry({
        ...base,
        kind: "work_canceled",
        workKind: "other",
        assigneeLabel: "Riley Reviewer",
        reason: null,
      } as ActivityEntry)
    ).toEqual({
      label: "Other canceled",
      detail: "Riley Reviewer",
      note: null,
    });
  });
});

describe("formatActivityTimestamp", () => {
  it("renders a firm-timezone date and time", () => {
    const text = formatActivityTimestamp(Date.UTC(2026, 7, 6, 18, 30));
    expect(text).toContain("2026");
    expect(text).toMatch(/Aug/);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});
