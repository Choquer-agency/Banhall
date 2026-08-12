import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_PROJECTS,
  parseRecentProjects,
  recordRecentProject,
  type RecentProject,
} from "./recentProjects";

describe("workspace recent projects", () => {
  it("parses nothing from missing, malformed, or wrongly-shaped storage", () => {
    expect(parseRecentProjects(null)).toEqual([]);
    expect(parseRecentProjects("not json")).toEqual([]);
    expect(parseRecentProjects(JSON.stringify({ id: "a" }))).toEqual([]);
    expect(parseRecentProjects(JSON.stringify([{ id: 1, title: "x" }, { id: "a" }, null]))).toEqual([]);
  });

  it("round trips valid entries and drops duplicates", () => {
    const stored = JSON.stringify([
      { id: "a", title: "Alpha" },
      { id: "a", title: "Alpha again" },
      { id: "b", title: "Beta" },
    ]);
    expect(parseRecentProjects(stored)).toEqual([
      { id: "a", title: "Alpha" },
      { id: "b", title: "Beta" },
    ]);
  });

  it("records most-recent-first, dedupes by id, and caps the list", () => {
    let list: RecentProject[] = [];
    for (let i = 0; i < MAX_RECENT_PROJECTS + 2; i++) {
      list = recordRecentProject(list, { id: `p${i}`, title: `Project ${i}` });
    }
    expect(list).toHaveLength(MAX_RECENT_PROJECTS);
    expect(list[0]).toEqual({ id: "p6", title: "Project 6" });

    list = recordRecentProject(list, { id: "p4", title: "Project 4 renamed" });
    expect(list[0]).toEqual({ id: "p4", title: "Project 4 renamed" });
    expect(list.filter((item) => item.id === "p4")).toHaveLength(1);
    expect(list).toHaveLength(MAX_RECENT_PROJECTS);
  });

  it("never records an empty title", () => {
    expect(recordRecentProject([], { id: "a", title: "   " })[0].title).toBe("Untitled project");
  });

  it("carries stage, client, and openedAt when valid — and drops them when not", () => {
    const entry = recordRecentProject([], {
      id: "a",
      title: "Alpha",
      stage: "drafting",
      client: "  Acme Ltd  ",
      openedAt: 1_700_000_000_000,
    })[0];
    expect(entry).toEqual({
      id: "a",
      title: "Alpha",
      stage: "drafting",
      client: "Acme Ltd",
      openedAt: 1_700_000_000_000,
    });

    const invalid = recordRecentProject([], {
      id: "b",
      title: "Beta",
      stage: "not_a_stage",
      client: "   ",
      openedAt: -5,
    })[0];
    expect(invalid).toEqual({ id: "b", title: "Beta" });
  });

  it("round trips optional fields through storage and rejects tampered ones", () => {
    const stored = JSON.stringify([
      { id: "a", title: "Alpha", stage: "client_review", client: "Acme", openedAt: 12345 },
      { id: "b", title: "Beta", stage: "bogus", client: 7, openedAt: "later" },
    ]);
    expect(parseRecentProjects(stored)).toEqual([
      { id: "a", title: "Alpha", stage: "client_review", client: "Acme", openedAt: 12345 },
      { id: "b", title: "Beta" },
    ]);
  });
});
