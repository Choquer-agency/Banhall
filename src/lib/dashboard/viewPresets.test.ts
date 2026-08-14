import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECTS_TABLE_PREFERENCES,
} from "./projectsTablePreferences";
import {
  MAX_PRESETS,
  deleteViewPreset,
  parseViewPresets,
  presetMatches,
  saveViewPreset,
  type ProjectsViewPreset,
} from "./viewPresets";

const preset = (name: string, over: Partial<ProjectsViewPreset> = {}): ProjectsViewPreset => ({
  name,
  preferences: structuredClone(DEFAULT_PROJECTS_TABLE_PREFERENCES),
  stage: null,
  ownerId: null,
  ownerLabel: null,
  ...over,
});

describe("projects view presets", () => {
  it("fails closed on garbage and non-arrays", () => {
    expect(parseViewPresets(null)).toEqual([]);
    expect(parseViewPresets("not-json")).toEqual([]);
    expect(parseViewPresets(JSON.stringify({ nope: true }))).toEqual([]);
  });

  it("re-parses stored preferences through the canonical parser and dedupes names", () => {
    const raw = JSON.stringify([
      { name: "Boards ", preferences: { layout: "grid", group: "company" }, stage: "drafting" },
      { name: "boards", preferences: {} },
      { name: "", preferences: {} },
      { name: 4, preferences: {} },
    ]);
    const parsed = parseViewPresets(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Boards");
    // Retired `grid` migrates to board; unknown group falls to the default.
    expect(parsed[0].preferences.layout).toBe("board");
    expect(parsed[0].preferences.group).toBe(DEFAULT_PROJECTS_TABLE_PREFERENCES.group);
    expect(parsed[0].stage).toBe("drafting");
  });

  it("upserts by case-insensitive name, newest first, capped", () => {
    let list = saveViewPreset([], preset("Drafting queue", { stage: "drafting" }));
    list = saveViewPreset(list, preset("Client boards"));
    expect(list.map((p) => p.name)).toEqual(["Client boards", "Drafting queue"]);
    list = saveViewPreset(list, preset("drafting QUEUE", { stage: "internal_review" }));
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("drafting QUEUE");
    expect(list[0].stage).toBe("internal_review");
    for (let i = 0; i < MAX_PRESETS + 3; i++) list = saveViewPreset(list, preset(`v${i}`));
    expect(list.length).toBeLessThanOrEqual(MAX_PRESETS);
  });

  it("deletes by name and matches the live view exactly", () => {
    const a = preset("A", { stage: "drafting" });
    expect(deleteViewPreset([a], " a ")).toEqual([]);
    expect(
      presetMatches(a, DEFAULT_PROJECTS_TABLE_PREFERENCES, "drafting", null)
    ).toBe(true);
    expect(presetMatches(a, DEFAULT_PROJECTS_TABLE_PREFERENCES, null, null)).toBe(false);
    expect(
      presetMatches(
        a,
        { ...DEFAULT_PROJECTS_TABLE_PREFERENCES, density: "compact" },
        "drafting",
        null
      )
    ).toBe(false);
  });
});
