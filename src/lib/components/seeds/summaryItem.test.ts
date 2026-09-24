import { describe, expect, it } from "vitest";
import type { SeedSummaryItem } from "./types";
import { citationSourceLabel, itemCitations, itemEdited } from "./summaryItem";
import { PD_SECTION_TITLES, pdSectionNumber } from "./sectionTitles";
import { seedTagLabel, seedTagStyle } from "./seedTagPalette";

const base = {
  kind: "selection",
  seedId: "seed-a",
  roleId: "company_context",
  subsectionKind: "standard",
  bullets: ["Wording."],
  support: "source_supported",
  tags: [],
  uncertaintySeedId: null,
  experimentSeedIds: [],
};
const summaryItem = (fields: Record<string, unknown> = {}) => ({ ...base, ...fields }) as unknown as SeedSummaryItem;

describe("Summary item readers", () => {
  it("reads edited only when the DTO says true", () => {
    expect(itemEdited(summaryItem())).toBe(false);
    expect(itemEdited(summaryItem({ edited: false }))).toBe(false);
    expect(itemEdited(summaryItem({ edited: "yes" }))).toBe(false);
    expect(itemEdited(summaryItem({ edited: true }))).toBe(true);
  });

  it("keeps well-formed citations and drops the rest", () => {
    expect(itemCitations(summaryItem())).toEqual([]);
    expect(itemCitations(summaryItem({ provenance: "nope" }))).toEqual([]);
    expect(itemCitations(summaryItem({
      provenance: [
        { sourceId: "source-1", exactExcerpt: "We run four sites.", speaker: " Priya ", line: 18 },
        { sourceId: "source-2", exactExcerpt: "   " },
        null,
        { sourceId: "source-3", exactExcerpt: "Loads vary.", speaker: "", line: Number.NaN },
      ],
    }))).toEqual([
      { sourceId: "source-1", exactExcerpt: "We run four sites.", speaker: "Priya", line: 18 },
      { sourceId: "source-3", exactExcerpt: "Loads vary." },
    ]);
  });

  it("labels a source only with what the transcript gives", () => {
    expect(citationSourceLabel({ sourceId: "s", exactExcerpt: "x", speaker: "Priya", line: 18 })).toBe("Priya, line 18");
    expect(citationSourceLabel({ sourceId: "s", exactExcerpt: "x", speaker: "Priya" })).toBe("Priya");
    expect(citationSourceLabel({ sourceId: "s", exactExcerpt: "x", line: 4 })).toBe("Line 4");
    expect(citationSourceLabel({ sourceId: "s", exactExcerpt: "x" })).toBe("Cited excerpt");
  });
});

describe("Section titles and tag palette", () => {
  it("names the three Sections", () => {
    expect(PD_SECTION_TITLES).toEqual({
      s242: "Technological uncertainty",
      s244: "Work performed",
      s246: "Technological advancement",
    });
    expect(pdSectionNumber("s244")).toBe("244");
  });

  it("colours known tags from the fixed palette and falls back for others", () => {
    expect(seedTagLabel("technical")).toBe("Technical");
    expect(seedTagStyle("aggressive")).toBe("background:#FEE2E2;color:#B91C1C");
    expect(seedTagLabel("custom")).toBe("custom");
    expect(seedTagStyle("custom")).toContain("var(--color-gray-50)");
  });
});
