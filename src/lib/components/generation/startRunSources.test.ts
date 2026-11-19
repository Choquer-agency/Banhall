import { describe, expect, it } from "vitest";
import { COMPANY_FILE_ROOM_NOTE, PINNED_FINAL_PD_NOTE, PREVIOUS_YEAR_PD_NOTE, projectStartSources } from "./startRunSources";

describe("company files in the start dialog (2026-11-17)", () => {
  it("says a pinned final PD is read last by year, and keeps the old note on every other company file", () => {
    const rows = projectStartSources([], [], [
      { _id: "hand", fileName: "notes.txt", wordCount: 900, category: null },
      { _id: "final", fileName: "final-2024.docx", wordCount: 2_000, category: "final_pd" },
    ]);
    expect(rows.map((row) => row.meta)).toEqual([
      `900 words · ${COMPANY_FILE_ROOM_NOTE}`,
      `2,000 words · ${PINNED_FINAL_PD_NOTE}`,
    ]);
  });
});

describe("last year's final PD in the start dialog (2026-11-18, third)", () => {
  it("says the counting PD is read as the previous-year report, and keeps the other notes", () => {
    const rows = projectStartSources([], [], [
      { _id: "hand", fileName: "notes.txt", wordCount: 900, category: null, previousYear: false },
      { _id: "counting", fileName: "final-2024.docx", wordCount: 2_000, category: "final_pd", previousYear: true },
      { _id: "older", fileName: "final-2023.docx", wordCount: 1_500, category: "final_pd", previousYear: false },
    ]);
    expect(rows.map((row) => row.meta)).toEqual([
      `900 words · ${COMPANY_FILE_ROOM_NOTE}`,
      `2,000 words · ${PREVIOUS_YEAR_PD_NOTE}`,
      `1,500 words · ${PINNED_FINAL_PD_NOTE}`,
    ]);
    expect(PREVIOUS_YEAR_PD_NOTE).toBe("Last year's final PD, read as the previous-year report while there is room");
  });
});
