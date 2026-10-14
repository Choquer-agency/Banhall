import { describe, expect, it } from "vitest";
import { changedProjectFields, editPanelTitle, projectEditValues } from "./projectEdit";

const PROJECT = {
  title: "Pump control",
  sredTitle: "Variable-speed pumping",
  clientName: "Cedarline Systems",
  // UTC midnight, as the cards and bulk edit store it.
  fiscalYearEnd: Date.UTC(2026, 8, 30),
  projectNumber: "5",
  industry: "manufacturing",
  scienceCode: "2.03.01",
  tagIds: ["t1", "t2"],
};

describe("project edit draft", () => {
  it("prefills the draft from the project, the date as yyyy-mm-dd", () => {
    expect(projectEditValues(PROJECT)).toEqual({ ...PROJECT, fiscalYearEnd: "2026-09-30" });
    expect(projectEditValues({ title: "T", clientName: "C" })).toEqual({
      title: "T",
      sredTitle: "",
      clientName: "C",
      fiscalYearEnd: "",
      projectNumber: "",
      industry: "",
      scienceCode: "",
      tagIds: [],
    });
  });

  it("finds only the fields that changed, in save order, ignoring spaces, case of the number and tag order", () => {
    const saved = projectEditValues(PROJECT);
    expect(changedProjectFields(saved, { ...saved, title: " Pump control ", tagIds: ["t2", "t1"] })).toEqual([]);
    expect(changedProjectFields({ ...saved, projectNumber: "2a" }, { ...saved, projectNumber: "2A" })).toEqual([]);
    expect(
      changedProjectFields(saved, { ...saved, tagIds: ["t1"], title: "New", fiscalYearEnd: "" })
    ).toEqual(["title", "fiscalYearEnd", "tagIds"]);
  });

  it("reads the date in UTC, so a UTC midnight never shows the day before", () => {
    expect(projectEditValues({ ...PROJECT, fiscalYearEnd: Date.UTC(2026, 2, 31) }).fiscalYearEnd).toBe("2026-03-31");
    expect(projectEditValues({ ...PROJECT, fiscalYearEnd: Date.UTC(2026, 2, 31, 23, 30) }).fiscalYearEnd).toBe("2026-03-31");
  });

  it("titles the panel with the project number when there is one", () => {
    expect(editPanelTitle("5")).toBe("Edit project #5");
    expect(editPanelTitle(null)).toBe("Edit project");
    expect(editPanelTitle(" ")).toBe("Edit project");
  });
});
