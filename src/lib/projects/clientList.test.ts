import { describe, expect, it } from "vitest";
import {
  addToSelection,
  clientHref,
  clientKeyFromUrl,
  defaultKeepKey,
  filterClients,
  mergeCollisionText,
  mergeIntroText,
  mergeSummaryText,
  newProjectSearch,
} from "./clientList";

describe("client URL state", () => {
  it("reads the selected client key, treating a blank value as All clients", () => {
    expect(clientKeyFromUrl(new URL("http://x/projects?client=cedarline%20systems"))).toBe(
      "cedarline systems"
    );
    expect(clientKeyFromUrl(new URL("http://x/projects"))).toBeNull();
    expect(clientKeyFromUrl(new URL("http://x/projects?client="))).toBeNull();
    expect(clientKeyFromUrl(new URL("http://x/projects?client=%20"))).toBeNull();
  });

  it("sets and clears the param, keeping the others", () => {
    const url = new URL("http://x/projects?layout=list&client=old");
    expect(clientHref(url, "acme inc")).toBe("/projects?layout=list&client=acme+inc");
    expect(clientHref(url, null)).toBe("/projects?layout=list");
    expect(clientKeyFromUrl(new URL(clientHref(url, "café & co"), "http://x"))).toBe("café & co");
  });

  it("builds the New project query with the client name", () => {
    expect(newProjectSearch("Acme & Sons")).toBe("?client=Acme+%26+Sons");
  });
});

describe("filterClients", () => {
  const clients = [{ name: "Acuity Insights" }, { name: "Société Générale" }, { name: "Birchwood Foods" }];

  it("matches any part of the name, ignoring case and accents", () => {
    expect(filterClients(clients, "INSIGHT").map((c) => c.name)).toEqual(["Acuity Insights"]);
    expect(filterClients(clients, "societe gen").map((c) => c.name)).toEqual(["Société Générale"]);
    expect(filterClients(clients, "  wood ").map((c) => c.name)).toEqual(["Birchwood Foods"]);
  });

  it("returns every client for a blank query and none for no match", () => {
    expect(filterClients(clients, "  ")).toHaveLength(3);
    expect(filterClients(clients, "zzz")).toEqual([]);
  });
});

describe("addToSelection", () => {
  it("adds new ids once and refuses past the limit", () => {
    expect(addToSelection(["a"], ["a", "b"], 3)).toEqual({ ids: ["a", "b"], refused: false });
    expect(addToSelection(["a", "b"], ["c", "d"], 3)).toEqual({ ids: ["a", "b", "c"], refused: true });
  });

  it("defaults to the 200 project limit", () => {
    const ids = Array.from({ length: 201 }, (_, index) => `p${index}`);
    const result = addToSelection([], ids);
    expect(result.ids).toHaveLength(200);
    expect(result.refused).toBe(true);
  });
});

describe("merge copy", () => {
  const client = (key: string, projectCount: number) => ({ key, clientId: null, name: key, projectCount });

  it("keeps the client with the most projects by default", () => {
    expect(defaultKeepKey([client("a", 1), client("b", 4), client("c", 4)])).toBe("b");
    expect(defaultKeepKey([])).toBeNull();
  });

  it("states where the projects go", () => {
    expect(mergeIntroText(7)).toBe("Pick the name to keep. All 7 projects move to it.");
    expect(mergeIntroText(1)).toBe("Pick the name to keep. The 1 project moves to it.");
    expect(mergeSummaryText(7, "Acuity Insights Inc.", 2)).toBe(
      "7 projects will show under Acuity Insights Inc. Their fiscal years stay as they are. The other names are removed from the client list."
    );
    expect(mergeSummaryText(1, "Acme", 1)).toBe(
      "1 project will show under Acme. Its fiscal year stays as it is. The other name is removed from the client list."
    );
  });

  it("lists number collisions in plain words", () => {
    expect(mergeCollisionText({ fiscalYear: 2025, projectNumber: "1", titles: ["A", "B"] })).toBe(
      "Project number 1 appears twice in FY 2025: A, B. Change one after the merge."
    );
    expect(mergeCollisionText({ fiscalYear: null, projectNumber: "a", titles: ["A", "B", "C"] })).toBe(
      "Project number A appears 3 times among projects with no fiscal year: A, B, C. Change one after the merge."
    );
  });
});
