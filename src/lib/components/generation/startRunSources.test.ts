import { describe, expect, it } from "vitest";
import { COMPANY_FILE_ROOM_NOTE, PINNED_FINAL_PD_NOTE, projectStartSources } from "./startRunSources";

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
