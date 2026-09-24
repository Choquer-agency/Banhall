import { describe, expect, it } from "vitest";
import { scienceCodeLabel } from "../../../../../shared/craScienceCodes";
import {
  firstName,
  fiscalYearParts,
  formatEdited,
  fromDateInput,
  nextInProgressStage,
  scienceCodeDisplay,
  scienceCodeGroups,
  scienceFieldName,
  toDateInput,
  workItemKindForStage,
} from "./detailsFormat";
import { handOffStageOptions, NOT_AVAILABLE_YET, stageMenuGroups, stageMove } from "./stageMenu";

describe("Details formatting", () => {
  it("shows the science code label and code apart, without touching the retrieval label", () => {
    expect(scienceCodeDisplay("2.03.01")).toEqual({ label: "Mechanical engineering", code: "2.03.01" });
    expect(scienceCodeDisplay(null)).toBeNull();
    // The AI retrieval label keeps its own format.
    expect(scienceCodeLabel("2.03.01")).not.toBe("Mechanical engineering");
  });

  it("groups science codes by the field after the separator", () => {
    expect(scienceFieldName("Engineering and technology \u2014 Mechanical engineering")).toBe("Mechanical engineering");
    const groups = scienceCodeGroups();
    expect(groups.every((group) => !group.field.includes("\u2014"))).toBe(true);
    expect(groups.find((group) => group.field === "Mechanical engineering")?.items[0]).toEqual({
      code: "2.03.01",
      label: "Mechanical engineering",
    });
    const filtered = scienceCodeGroups("robotics");
    expect(filtered.flatMap((group) => group.items.map((item) => item.code))).toContain("2.02.02");
    expect(scienceCodeGroups("2.03.01").flatMap((group) => group.items)).toHaveLength(1);
  });

  it("reads the fiscal year as the year of its end date plus the full date", () => {
    expect(fiscalYearParts(new Date(2026, 5, 30).getTime())).toEqual({ year: "2026", date: "June 30, 2026" });
    expect(fiscalYearParts(null)).toBeNull();
    const value = toDateInput(new Date(2026, 2, 31).getTime());
    expect(value).toBe("2026-03-31");
    expect(toDateInput(fromDateInput(value))).toBe(value);
  });

  it("says when a project was edited in plain relative words", () => {
    const now = Date.UTC(2026, 8, 24, 12);
    expect(formatEdited(now - 10_000, now)).toBe("Just now");
    expect(formatEdited(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(formatEdited(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(formatEdited(now - 26 * 3_600_000, now)).toBe("Yesterday");
  });

  it("derives the work item type from the hand-off stage", () => {
    expect(workItemKindForStage("internal_review")).toBe("internal_review");
    expect(workItemKindForStage("edits")).toBe("revision");
    expect(workItemKindForStage("revisions")).toBe("revision");
    expect(workItemKindForStage("intake")).toBe("interview_followup");
    expect(workItemKindForStage("interview_complete")).toBe("interview_followup");
    expect(workItemKindForStage("ready_for_delivery")).toBe("delivery_prep");
    expect(workItemKindForStage("delivered")).toBe("delivery_prep");
    expect(workItemKindForStage("drafting")).toBe("other");
    expect(workItemKindForStage("on_hold")).toBe("other");
  });

  it("finds the next In progress stage and the first name", () => {
    expect(nextInProgressStage("drafting")).toBe("internal_review");
    expect(nextInProgressStage("revisions")).toBe("revisions");
    expect(nextInProgressStage("on_hold")).toBe("on_hold");
    expect(firstName("Sam Chen")).toBe("Sam");
  });
});

describe("Stage menu", () => {
  it("lists all eleven stages in three groups with the current one checked", () => {
    const groups = stageMenuGroups("drafting");
    expect(groups.map((group) => group.label)).toEqual(["In progress", "Done", "Paused"]);
    expect(groups.flatMap((group) => group.options)).toHaveLength(11);
    const drafting = groups[0].options.find((option) => option.stage === "drafting")!;
    expect(drafting.current).toBe(true);
    expect(groups[0].options.find((option) => option.stage === "internal_review")?.hint).toBe("next");
  });

  it("keeps Submitted and Delivered unavailable and asks for reasons on pause edges", () => {
    const options = stageMenuGroups("drafting").flatMap((group) => group.options);
    const byStage = Object.fromEntries(options.map((option) => [option.stage, option]));
    expect(byStage.ready_for_delivery.disabledReason).toBe(NOT_AVAILABLE_YET);
    expect(byStage.delivered.disabledReason).toBe(NOT_AVAILABLE_YET);
    expect(byStage.on_hold.move).toBe("reason");
    expect(byStage.on_hold.hint).toBe("asks for a reason");
    expect(byStage.abandoned.move).toBe("reason");
    expect(byStage.edits.move).toBe("plain");
  });

  it("keeps the review decision step on the internal-review completion edge", () => {
    expect(stageMove("internal_review", "edits")).toBe("decision");
    expect(stageMove("abandoned", "drafting")).toBe("reason");
  });

  it("disables edges the viewer has no authority for", () => {
    const options = stageMenuGroups("abandoned", ["owner"]).flatMap((group) => group.options);
    expect(options.find((option) => option.stage === "drafting")?.disabledReason).toBe("needs a Manager or an Admin");
    const managed = stageMenuGroups("abandoned", ["manager"]).flatMap((group) => group.options);
    expect(managed.find((option) => option.stage === "drafting")?.disabledReason).toBeNull();
  });

  it("offers hand-off stages without unavailable or decision edges, keeping the current stage", () => {
    const stages = handOffStageOptions("internal_review").map((option) => option.stage);
    expect(stages).toContain("internal_review");
    expect(stages).not.toContain("edits");
    expect(stages).not.toContain("ready_for_delivery");
    expect(stages).not.toContain("delivered");
    expect(stages).toContain("on_hold");
  });
});
