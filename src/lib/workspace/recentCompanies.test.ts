import { describe, expect, it } from "vitest";
import { recentCompanies, recentCompanyHref } from "./recentCompanies";

describe("recentCompanies", () => {
  it("lists each recent project's company once, most recent first, at most three", () => {
    expect(
      recentCompanies([
        { id: "p1", title: "A", client: "Cedarline Systems" },
        { id: "p2", title: "B" },
        { id: "p3", title: "C", client: "  cedarline   systems " },
        { id: "p4", title: "D", client: "Delta Hydraulics" },
        { id: "p5", title: "E", client: "Alder Research" },
        { id: "p6", title: "F", client: "Birchwood Foods" },
      ])
    ).toEqual([
      { key: "cedarline systems", name: "Cedarline Systems" },
      { key: "delta hydraulics", name: "Delta Hydraulics" },
      { key: "alder research", name: "Alder Research" },
    ]);
  });

  it("returns nothing when no recent project recorded a company", () => {
    expect(recentCompanies([{ id: "p1", title: "A" }, { id: "p2", title: "B", client: "   " }])).toEqual([]);
  });
});

describe("recentCompanyHref", () => {
  it("selects the company on the Projects page and keeps the other params", () => {
    expect(recentCompanyHref("/projects", "delta hydraulics")).toBe("/projects?client=delta+hydraulics");
    expect(recentCompanyHref("/projects?layout=board&client=old", "alder")).toBe("/projects?layout=board&client=alder");
  });
});
