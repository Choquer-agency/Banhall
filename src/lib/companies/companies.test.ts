import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeMergedNote,
  companiesPath,
  companyCountLabel,
  companyKeyFromPath,
  hasCompanyPage,
  mergedNoteClosed,
  mergedNoteText,
  yearEndLabel,
} from "./companies";
import { DASHBOARD_UNNAMED_COMPANY_KEY } from "../../../shared/dashboardProjection";

describe("companiesPath", () => {
  it("names All companies and one company's page, its key as one encoded segment", () => {
    expect(companiesPath("/")).toBe("/companies");
    expect(companiesPath("/app/", null)).toBe("/app/companies");
    expect(companiesPath("/", "cedarline systems")).toBe("/companies/cedarline%20systems");
    expect(companiesPath("/", "a/b corp")).toBe("/companies/a%2Fb%20corp");
  });
});

describe("companyKeyFromPath", () => {
  it("reads All companies, a company key, and nothing outside the section", () => {
    expect(companyKeyFromPath("/companies")).toBeNull();
    expect(companyKeyFromPath("/companies/cedarline%20systems")).toBe("cedarline systems");
    expect(companyKeyFromPath("/companies/a%2Fb%20corp")).toBe("a/b corp");
    expect(companyKeyFromPath("/projects")).toBeUndefined();
    expect(companyKeyFromPath("/companiesx")).toBeUndefined();
  });
});

describe("hasCompanyPage", () => {
  it("is false for the no-company bucket and blanks", () => {
    expect(hasCompanyPage("acme")).toBe(true);
    expect(hasCompanyPage(DASHBOARD_UNNAMED_COMPANY_KEY)).toBe(false);
    expect(hasCompanyPage("")).toBe(false);
    expect(hasCompanyPage(null)).toBe(false);
  });
});

describe("yearEndLabel", () => {
  it("names the month and day, or null when unset", () => {
    expect(yearEndLabel(9, 30)).toBe("September 30");
    expect(yearEndLabel(2, 29)).toBe("February 29");
    expect(yearEndLabel(undefined, undefined)).toBeNull();
    expect(yearEndLabel(9, undefined)).toBeNull();
  });
});

describe("mergedNoteText", () => {
  const base = { fromName: "Cedarline Systems Inc", intoName: "Cedarline Systems", mergedAt: Date.UTC(2026, 9, 3, 12) };
  it("reads as Paper Z9g draws it", () => {
    expect(mergedNoteText({ ...base, projectCount: 2 })).toBe(
      "Cedarline Systems Inc was merged into Cedarline Systems on October 3, 2026. Its 2 projects are here now."
    );
    expect(mergedNoteText({ ...base, projectCount: 1 })).toMatch(/Its 1 project is here now\.$/);
    expect(mergedNoteText({ ...base, projectCount: null })).toMatch(/Its projects are here now\.$/);
  });
});

describe("companyCountLabel", () => {
  it("counts companies", () => {
    expect(companyCountLabel(1)).toBe("1 company");
    expect(companyCountLabel(12)).toBe("12 companies");
    expect(companyCountLabel(1000, true)).toBe("1000+ companies");
  });
});

describe("merged notes stay closed", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("remembers a closed note in this browser", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    expect(mergedNoteClosed("note-1")).toBe(false);
    closeMergedNote("note-1");
    expect(mergedNoteClosed("note-1")).toBe(true);
    expect(mergedNoteClosed("note-2")).toBe(false);
  });
  it("reads as open when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(mergedNoteClosed("note-1")).toBe(false);
    expect(() => closeMergedNote("note-1")).not.toThrow();
  });
});
