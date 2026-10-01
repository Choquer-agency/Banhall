import { describe, expect, it } from "vitest";
import {
  activityPhrase,
  clientInitial,
  clientTone,
  continueMetaLine,
  continueTarget,
  proposalsLine,
  withYouRows,
  type HomeRow,
} from "./homeRows";

const NOW = new Date(2026, 8, 24, 15, 0).getTime();

function item(projectId: string, projectUpdatedAt?: number) {
  return {
    projectId,
    projectTitle: `Project ${projectId}`,
    clientName: "Acme",
    workflowStage: "drafting" as const,
    projectUpdatedAt,
  };
}

describe("Home rows", () => {
  it("keeps one With you row per project in the server's due-first order", () => {
    const rows = withYouRows([item("a", 5), item("b", 9), item("a", 5)]);
    expect(rows.map((row) => row.projectId)).toEqual(["a", "b"]);
    expect(rows[0]).toEqual({ projectId: "a", title: "Project a", clientName: "Acme", stage: "drafting", editedAt: 5 });
    expect(withYouRows([item("c")])[0].editedAt).toBeNull();
  });

  it("resumes the last opened project first, then the latest edited work with you", () => {
    const withYou: HomeRow[] = withYouRows([item("a", 5), item("b", 9)]);
    expect(continueTarget([{ projectId: "r", openedAt: 7 }], withYou)).toEqual({ projectId: "r", source: "opened", at: 7 });
    expect(continueTarget([], withYou)).toEqual({ projectId: "b", source: "with_you", at: 9 });
    expect(continueTarget([], [])).toBeNull();
  });

  it("phrases activity in plain words", () => {
    expect(activityPhrase("Opened", NOW - 20_000, NOW)).toBe("Opened just now");
    expect(activityPhrase("Opened", NOW - 12 * 60_000, NOW)).toBe("Opened 12 min ago");
    expect(activityPhrase("Edited", NOW - 26 * 3_600_000, NOW)).toBe("Edited yesterday");
    expect(activityPhrase("Edited", new Date(2026, 8, 1).getTime(), NOW)).toBe("Edited on Sep 1, 2026");
  });

  it("joins the continue line with commas and skips missing parts", () => {
    expect(
      continueMetaLine({ clientName: "Cedarline Systems", fiscalYearEnd: new Date(2026, 5, 30).getTime(), projectNumber: "01A" })
    ).toBe("Cedarline Systems, FY 2026, #01A");
    expect(continueMetaLine({ clientName: "Cedarline Systems", fiscalYearEnd: null, projectNumber: " " })).toBe("Cedarline Systems");
  });

  it("counts proposals waiting to apply, and says nothing at zero", () => {
    expect(proposalsLine(0, false)).toBeNull();
    expect(proposalsLine(1, false)).toBe("1 proposal waiting to apply");
    expect(proposalsLine(3, false)).toBe("3 proposals waiting to apply");
    expect(proposalsLine(200, true)).toBe("200+ proposals waiting to apply");
  });

  it("marks each client with a stable initial and tone", () => {
    expect(clientInitial("meridian Materials")).toBe("M");
    expect(clientInitial("  (Ørsted)")).toBe("Ø");
    expect(clientInitial("")).toBe("?");
    expect(clientTone("Cedarline Systems")).toBe(clientTone("cedarline systems "));
  });
});
