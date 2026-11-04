import { beforeEach, describe, expect, it } from "vitest";
import {
  companyLanding,
  lastViewedCompany,
  loadRecentCompanies,
  prunedRecentCompanies,
  pruneRecentCompanies,
  recentCompanyHref,
  rememberRecentCompany,
  withRecentCompany,
} from "./recentCompanies";

const cedar = { key: "cedarline systems", name: "Cedarline Systems" };
const delta = { key: "delta hydraulics", name: "Delta Hydraulics" };
const alder = { key: "alder research", name: "Alder Research" };
const birch = { key: "birchwood foods", name: "Birchwood Foods" };

describe("recent companies", () => {
  beforeEach(() => {
    // Unit tests run in Node: a minimal localStorage.
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  it("puts the latest company first, once, and keeps three", () => {
    expect(withRecentCompany([delta, cedar, alder], cedar)).toEqual([cedar, delta, alder]);
    expect(withRecentCompany([delta, cedar, alder], birch)).toEqual([birch, delta, cedar]);
  });

  it("keeps each person's list apart", () => {
    rememberRecentCompany("u-1", cedar);
    rememberRecentCompany("u-2", delta);
    expect(loadRecentCompanies("u-1")).toEqual([cedar]);
    expect(loadRecentCompanies("u-2")).toEqual([delta]);
    expect(loadRecentCompanies(null)).toEqual([]);
  });

  it("refreshes names and drops companies no longer listed", () => {
    expect(prunedRecentCompanies([cedar, delta], new Map([["cedarline systems", "Cedarline Systems Ltd"]]))).toEqual([
      { key: "cedarline systems", name: "Cedarline Systems Ltd" },
    ]);
    rememberRecentCompany("u-1", delta);
    rememberRecentCompany("u-1", cedar);
    pruneRecentCompanies("u-1", new Map([["delta hydraulics", "Delta Hydraulics"]]));
    expect(loadRecentCompanies("u-1")).toEqual([delta]);
  });

  it("ignores anything malformed", () => {
    localStorage.setItem("banhall.recentCompanies.v1:u-1", '[{"key":1},{"key":"a","name":""},"x"]');
    expect(loadRecentCompanies("u-1")).toEqual([]);
    localStorage.setItem("banhall.recentCompanies.v1:u-1", "{not json");
    expect(loadRecentCompanies("u-1")).toEqual([]);
  });
});

describe("recentCompanyHref", () => {
  it("selects the company on the Projects page and keeps the other params", () => {
    expect(recentCompanyHref("/projects", "delta hydraulics")).toBe("/projects?client=delta+hydraulics");
    expect(recentCompanyHref("/projects?layout=board&client=old", "alder")).toBe("/projects?layout=board&client=alder");
  });
});

describe("the Projects landing (2026-11-02)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  it("remembers the last company viewed, per person", () => {
    expect(lastViewedCompany("u1")).toBeNull();
    expect(lastViewedCompany(null)).toBeNull();
    rememberRecentCompany("u1", cedar);
    rememberRecentCompany("u1", delta);
    rememberRecentCompany("u2", alder);
    expect(lastViewedCompany("u1")).toEqual(delta);
    expect(lastViewedCompany("u2")).toEqual(alder);
    // Viewing an earlier company again makes it the landing.
    rememberRecentCompany("u1", cedar);
    expect(lastViewedCompany("u1")).toEqual(cedar);
  });

  it("lands on the remembered company while it is still in the company list", () => {
    const list = [cedar, { key: delta.key, name: "Delta Hydraulics Inc." }];
    expect(companyLanding(delta, { data: list, failed: false })).toEqual({
      kind: "company",
      key: delta.key,
      name: "Delta Hydraulics Inc.",
    });
  });

  it("shows the remembered company while the list loads", () => {
    expect(companyLanding(cedar, { data: undefined, failed: false })).toEqual({ kind: "pending", ...cedar });
  });

  it("falls back to All projects with no company, a company that is gone or merged, or a failed list", () => {
    expect(companyLanding(null, { data: [cedar], failed: false })).toEqual({ kind: "all" });
    expect(companyLanding(alder, { data: [cedar, delta], failed: false })).toEqual({ kind: "all" });
    // Review round 2: past the end of a cut-off list, it still opens.
    expect(companyLanding(alder, { data: [cedar, delta], failed: false, truncated: true })).toEqual({ kind: "company", ...alder });
    expect(companyLanding(cedar, { data: undefined, failed: true })).toEqual({ kind: "all" });
  });

  it("a recent company link drops an All projects or Starred scope", () => {
    expect(recentCompanyHref("/projects?scope=starred&layout=list", "acme")).toBe("/projects?layout=list&client=acme");
  });
});
