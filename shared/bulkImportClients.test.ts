import { describe, expect, it } from "vitest";
import {
  BULK_IMPORT_MAX_LINES,
  classifyBulkCompanyNames,
  parseBulkCompanyText,
} from "./bulkImportClients";

describe("parseBulkCompanyText", () => {
  it("parses plain newline-separated company lists and preserves legal-suffix commas", () => {
    const raw = `
      Acme Robotics, Inc.
      Halden Foods Ltd.
      "Cedar Line Systems"
    `;
    expect(parseBulkCompanyText(raw)).toEqual({
      names: ["Acme Robotics, Inc.", "Halden Foods Ltd.", "Cedar Line Systems"],
      truncated: false,
      totalLines: 3,
    });
  });

  it("auto-detects single-column and multi-column CSV headers and quoted names", () => {
    const csv = `\uFEFFIndustry,Company Name,Notes
Manufacturing,"Acme Robotics, Inc.",Priority
Software,Northgate Labs,Active
`;
    expect(parseBulkCompanyText(csv)).toEqual({
      names: ["Acme Robotics, Inc.", "Northgate Labs"],
      truncated: false,
      totalLines: 2,
    });

    const singleColWithHeader = "Company Name\nCedarline Systems\nHalden Foods";
    expect(parseBulkCompanyText(singleColWithHeader)).toEqual({
      names: ["Cedarline Systems", "Halden Foods"],
      truncated: false,
      totalLines: 2,
    });
  });

  it("caps parsed lines at BULK_IMPORT_MAX_LINES and flags truncation", () => {
    const lines = Array.from({ length: BULK_IMPORT_MAX_LINES + 15 }, (_, i) => `Company ${i + 1}`).join("\n");
    const parsed = parseBulkCompanyText(lines);
    expect(parsed.names).toHaveLength(BULK_IMPORT_MAX_LINES);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalLines).toBe(BULK_IMPORT_MAX_LINES + 15);
  });
});

describe("classifyBulkCompanyNames", () => {
  it("classifies new, similar, exists, merged, duplicate, and invalid rows with Map indexing", () => {
    const result = classifyBulkCompanyNames(
      [
        "Acme Robotics Inc.", // exact exists
        "Acme Robotics", // similar to existing Acme Robotics Inc.
        "Old Halden Co", // merged alias
        "Northgate Labs", // new
        "northgate labs", // exact intra-batch duplicate
        "Northgate Labs Ltd.", // intra-batch near-duplicate (similar)
        "Cedar Line", // compact lookalike to existing Cedarline Inc.
        "x".repeat(201), // invalid (too long)
        "---", // invalid (no letters/digits)
        "Fresh BioTech", // new
      ],
      {
        active: [
          { key: "acme robotics inc.", name: "Acme Robotics Inc." },
          { key: "cedarline inc.", name: "Cedarline Inc." },
        ],
        merged: [
          { key: "old halden co", name: "Old Halden Co", intoName: "Halden Foods Ltd." },
        ],
      }
    );

    expect(result.counts).toEqual({
      total: 10,
      new: 2,
      similar: 3,
      exists: 1,
      merged: 1,
      duplicate: 1,
      invalid: 2,
    });

    expect(result.rows.map((r) => ({ name: r.name.slice(0, 20), status: r.status }))).toEqual([
      { name: "Acme Robotics Inc.", status: "exists" },
      { name: "Acme Robotics", status: "similar" },
      { name: "Old Halden Co", status: "merged" },
      { name: "Northgate Labs", status: "new" },
      { name: "northgate labs", status: "duplicate" },
      { name: "Northgate Labs Ltd.", status: "similar" },
      { name: "Cedar Line", status: "similar" },
      { name: "x".repeat(20), status: "invalid" },
      { name: "---", status: "invalid" },
      { name: "Fresh BioTech", status: "new" },
    ]);
    expect(result.rows[1]?.similarMatches).toEqual(["Acme Robotics Inc."]);
    expect(result.rows[2]?.mergedInto).toBe("Halden Foods Ltd.");
    expect(result.rows[5]?.similarMatches).toEqual(["Northgate Labs"]);
    expect(result.rows[6]?.similarMatches).toEqual(["Cedarline Inc."]);
  });
});
