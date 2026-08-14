import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECTS_TABLE_PREFERENCES,
  parseHideEmptyParam,
  parseProjectGroupParam,
  parseProjectLayoutParam,
  parseProjectsTablePreferences,
  serializeProjectsTablePreferences,
  withHideEmptyParam,
  withProjectGroupParam,
  withProjectLayoutParam,
} from "./projectsTablePreferences";

describe("projects table preferences", () => {
  it("fails closed to the complete default view", () => {
    expect(parseProjectsTablePreferences("not-json")).toEqual(DEFAULT_PROJECTS_TABLE_PREFERENCES);
    expect(parseProjectsTablePreferences(null)).toEqual(DEFAULT_PROJECTS_TABLE_PREFERENCES);
    // 2026-08-13 owner direction: client-grouped List is the default view.
    expect(DEFAULT_PROJECTS_TABLE_PREFERENCES.layout).toBe("list");
    expect(DEFAULT_PROJECTS_TABLE_PREFERENCES.group).toBe("client");
  });

  it("keeps known values and ignores malformed fields", () => {
    expect(parseProjectsTablePreferences(JSON.stringify({
      layout: "list",
      density: "compact",
      columns: { clientName: false, owner: "no" },
    }))).toEqual({
      layout: "list",
      density: "compact",
      group: "client",
      columns: {
        clientName: false,
        stage: true,
        owner: true,
        generationActivity: true,
        updated: true,
      },
      hideEmptyBoard: true,
      hideEmptyClientGroups: true,
    });
  });

  it("parses hide-empty preferences with the documented per-surface defaults", () => {
    // Board defaults OFF (all ten canonical stages), client surfaces ON.
    expect(parseProjectsTablePreferences(null).hideEmptyBoard).toBe(true);
    expect(parseProjectsTablePreferences(null).hideEmptyClientGroups).toBe(true);
    const stored = parseProjectsTablePreferences(
      JSON.stringify({ hideEmptyBoard: true, hideEmptyClientGroups: false })
    );
    expect(stored.hideEmptyBoard).toBe(true);
    expect(stored.hideEmptyClientGroups).toBe(false);
    // Fail closed on anything but explicit booleans.
    const malformed = parseProjectsTablePreferences(
      JSON.stringify({ hideEmptyBoard: "yes", hideEmptyClientGroups: 0 })
    );
    expect(malformed.hideEmptyBoard).toBe(true);
    expect(malformed.hideEmptyClientGroups).toBe(true);
  });

  it("migrates the retired grid preference to board", () => {
    expect(parseProjectsTablePreferences(JSON.stringify({ layout: "grid" })).layout).toBe("board");
    expect(parseProjectsTablePreferences(JSON.stringify({ layout: "board" })).layout).toBe("board");
  });

  it("keeps explicit grouping choices and fails closed to the default on unknown groups", () => {
    expect(parseProjectsTablePreferences(JSON.stringify({ group: "client" })).group).toBe("client");
    // Explicit flat choice survives; unknown values take the client default.
    expect(parseProjectsTablePreferences(JSON.stringify({ group: "none" })).group).toBe("none");
    expect(parseProjectsTablePreferences(JSON.stringify({ group: "company" })).group).toBe("client");
    expect(parseProjectsTablePreferences(JSON.stringify({ group: 4 })).group).toBe("client");
  });

  it("parses canonical and legacy URL layout values without claiming unknown values", () => {
    expect(parseProjectLayoutParam("board")).toBe("board");
    expect(parseProjectLayoutParam("list")).toBe("list");
    expect(parseProjectLayoutParam("grid")).toBe("board");
    expect(parseProjectLayoutParam("columns")).toBeNull();
    expect(parseProjectLayoutParam(null)).toBeNull();
  });

  it("parses the group URL param and stays silent on unknown values", () => {
    expect(parseProjectGroupParam("client")).toBe("client");
    expect(parseProjectGroupParam("none")).toBe("none");
    expect(parseProjectGroupParam("company")).toBeNull();
    expect(parseProjectGroupParam(null)).toBeNull();
  });

  it("updates layout URL state without replacing the dashboard view parameter", () => {
    const url = withProjectLayoutParam(
      new URL("https://banhall.test/dashboard?view=all_projects&workspace=preview"),
      "list"
    );
    expect(url.pathname).toBe("/dashboard");
    expect(url.searchParams.get("view")).toBe("all_projects");
    expect(url.searchParams.get("workspace")).toBe("preview");
    expect(url.searchParams.get("layout")).toBe("list");
  });

  it("sets and clears the group URL param while preserving other params", () => {
    const base = new URL("https://banhall.test/dashboard?view=all_projects&layout=list");
    const grouped = withProjectGroupParam(base, "client");
    expect(grouped.searchParams.get("group")).toBe("client");
    expect(grouped.searchParams.get("view")).toBe("all_projects");
    expect(grouped.searchParams.get("layout")).toBe("list");
    const flat = withProjectGroupParam(grouped, "none");
    expect(flat.searchParams.get("group")).toBeNull();
    expect(flat.searchParams.get("layout")).toBe("list");
  });

  it("round trips a valid preference", () => {
    const preferences = {
      layout: "board" as const,
      density: "compact" as const,
      group: "client" as const,
      columns: {
        clientName: true,
        stage: true,
        owner: false,
        generationActivity: false,
        updated: true,
      },
      hideEmptyBoard: true,
      hideEmptyClientGroups: false,
    };
    expect(parseProjectsTablePreferences(serializeProjectsTablePreferences(preferences))).toEqual(preferences);
  });

  it("parses the hideEmpty URL param fail-closed and round-trips it", () => {
    expect(parseHideEmptyParam("1")).toBe(true);
    expect(parseHideEmptyParam("0")).toBe(false);
    expect(parseHideEmptyParam("yes")).toBeNull();
    expect(parseHideEmptyParam(null)).toBeNull();
    const url = withHideEmptyParam(new URL("https://banhall.test/projects?layout=board"), true);
    expect(url.searchParams.get("hideEmpty")).toBe("1");
    expect(withHideEmptyParam(url, null).searchParams.get("hideEmpty")).toBeNull();
  });
});
