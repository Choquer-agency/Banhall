import { describe, expect, it } from "vitest";
import { documentSheetSubtitle, formatAiReadDocument, formatFolderPath } from "./aiReadFormat";

describe("formatAiReadDocument", () => {
  it("parses metadata rows, missing science code callout, section headings, and paragraphs", () => {
    const raw = [
      "Label vision check",
      "",
      "Project start: Apr 2, 2024",
      "Project end: Still going",
      "Sites: Two Cedarline warehouses",
      "Field of science or technology code: to be added",
      "",
      "1. Uncertainty",
      "Labels on the belt are often tilted, creased or half covered by tape,",
      "and the camera sees each one for less than a second.",
      "",
      "2. Work done",
      "We filmed 18,000 parcels at two warehouses and marked where each label sat.",
      "",
      "Page 1 of 6",
    ].join("\n");

    const doc = formatAiReadDocument(raw, { documentTitle: "Label vision check" });
    expect(doc.hasScienceCodeField).toBe(true);
    expect(doc.blocks).toEqual([
      {
        kind: "metadata",
        rows: [
          { label: "Project start", value: "Apr 2, 2024" },
          { label: "Project end", value: "Still going" },
          { label: "Sites", value: "Two Cedarline warehouses" },
        ],
      },
      {
        kind: "callout",
        label: "Field of science or technology code",
        value: "to be added",
        tone: "amber",
      },
      { kind: "heading", text: "Uncertainty" },
      {
        kind: "paragraph",
        text: "Labels on the belt are often tilted, creased or half covered by tape, and the camera sees each one for less than a second.",
      },
      { kind: "heading", text: "Work done" },
      {
        kind: "paragraph",
        text: "We filmed 18,000 parcels at two warehouses and marked where each label sat.",
      },
    ]);
  });

  it("splits inline CRA line leads into heading and paragraph and formats bullet lists", () => {
    const raw = [
      "Project description",
      "",
      "Cedarline Systems set out to plan delivery routes.",
      "",
      "Line 242: The team did not know whether a solver could re-plan within 30 seconds.",
      "",
      "- Built a prototype solver",
      "- Ran 140 benchmark scenarios",
    ].join("\n");

    const doc = formatAiReadDocument(raw);
    expect(doc.hasScienceCodeField).toBe(false);
    expect(doc.blocks).toEqual([
      { kind: "heading", text: "Project description" },
      { kind: "paragraph", text: "Cedarline Systems set out to plan delivery routes." },
      { kind: "heading", text: "Line 242" },
      { kind: "paragraph", text: "The team did not know whether a solver could re-plan within 30 seconds." },
      { kind: "list", items: ["Built a prototype solver", "Ran 140 benchmark scenarios"] },
    ]);
  });

  it("handles tab-separated Word table rows and markdown headings cleanly", () => {
    const raw = [
      "## Overview",
      "Project start date\t2024-04-02",
      "Field of science or technology code\t2.02.09",
      "",
      "The **route solver** evaluated *freezer loads* at depot hubs.",
    ].join("\n");

    const doc = formatAiReadDocument(raw);
    expect(doc.hasScienceCodeField).toBe(true);
    expect(doc.blocks).toEqual([
      { kind: "heading", text: "Overview" },
      {
        kind: "metadata",
        rows: [
          { label: "Project start date", value: "2024-04-02" },
          { label: "Field of science or technology code", value: "2.02.09" },
        ],
      },
      { kind: "paragraph", text: "The route solver evaluated freezer loads at depot hubs." },
    ]);
  });

  it("preserves CRA Line 242/244 question prompts as headings and numbered steps as ordered lists", () => {
    const raw = [
      "Line 242 - What scientific or technological uncertainties did you attempt to overcome?",
      "Standard CNC tolerances drifted across cold-start cycles.",
      "",
      "Line 244 - What work did you perform in the tax year to overcome the uncertainties?",
      "1. Calibrated the API telemetry capture at 200 Hz.",
      "2. Benchmarked SR&ED T661 prototypes across 12 runs.",
      "",
      "TECHNOLOGICAL ADVANCEMENTS FOR SR&ED",
      "03/2025",
      "The CRA review confirmed repeatable accuracy on 12/31.",
    ].join("\n");

    const doc = formatAiReadDocument(raw, { category: "final_pd" });
    expect(doc.blocks).toEqual([
      { kind: "heading", text: "Line 242 - What scientific or technological uncertainties did you attempt to overcome?" },
      { kind: "paragraph", text: "Standard CNC tolerances drifted across cold-start cycles." },
      { kind: "heading", text: "Line 244 - What work did you perform in the tax year to overcome the uncertainties?" },
      {
        kind: "list",
        ordered: true,
        items: [
          "Calibrated the API telemetry capture at 200 Hz.",
          "Benchmarked SR&ED T661 prototypes across 12 runs.",
        ],
      },
      { kind: "heading", text: "Technological advancements for SR&ED" },
      { kind: "paragraph", text: "03/2025 The CRA review confirmed repeatable accuracy on 12/31." },
    ]);
  });

  it("keeps non-PD transcripts and notes as clean paragraphs without misparsing speaker labels", () => {
    const raw = [
      "00:01:15 Dana: We ran three trials on the freezing belt.",
      "",
      "Note: Follow up with operations on sensor mounting.",
    ].join("\n");

    const doc = formatAiReadDocument(raw, { category: "transcript" });
    expect(doc.blocks).toEqual([
      { kind: "paragraph", text: "00:01:15 Dana: We ran three trials on the freezing belt." },
      { kind: "paragraph", text: "Note: Follow up with operations on sensor mounting." },
    ]);
  });

  it("preserves standalone numbers, dates, prose Line 242 sentences, and inline math or identifiers", () => {
    const raw = [
      "120",
      "12/31",
      "6/30",
      "",
      "Line 242 was revised in May after thermal tests.",
      "",
      "Compute 5 * x * 2 inside __init__ before logging.",
    ].join("\n");

    const doc = formatAiReadDocument(raw, { category: "final_pd" });
    expect(doc.blocks).toEqual([
      { kind: "paragraph", text: "120 12/31 6/30" },
      { kind: "paragraph", text: "Line 242 was revised in May after thermal tests." },
      { kind: "paragraph", text: "Compute 5 * x * 2 inside __init__ before logging." },
    ]);
  });

  it("keeps blank-line-separated ordered lists joined and preserves start number after interrupting paragraphs", () => {
    const raw = [
      "1. First step",
      "",
      "2. Second step",
      "",
      "Page 2 of 4",
      "",
      "3. Third step",
      "",
      "Intermediate note between phases.",
      "",
      "4. Fourth step",
      "5. Fifth step",
    ].join("\n");

    const doc = formatAiReadDocument(raw, { category: "final_pd" });
    expect(doc.blocks).toEqual([
      {
        kind: "list",
        ordered: true,
        items: ["First step", "Second step", "Third step"],
      },
      { kind: "paragraph", text: "Intermediate note between phases." },
      {
        kind: "list",
        ordered: true,
        start: 4,
        items: ["Fourth step", "Fifth step"],
      },
    ]);
  });
});

describe("documentSheetSubtitle", () => {
  it("formats SR&ED project description and other categories including company_file", () => {
    expect(documentSheetSubtitle("final_pd", "Cedarline Systems")).toBe(
      "Cedarline Systems. SR&ED project description."
    );
    expect(documentSheetSubtitle("draft", "Cedarline Systems")).toBe(
      "Cedarline Systems. SR&ED project description."
    );
    expect(documentSheetSubtitle("transcript", "Cedarline Systems")).toBe(
      "Cedarline Systems. Interview transcript."
    );
    expect(documentSheetSubtitle("company_file", "Cedarline Systems")).toBe(
      "Cedarline Systems. Company file."
    );
    expect(documentSheetSubtitle("final_pd", null)).toBe("SR&ED project description.");
  });
});

describe("formatFolderPath", () => {
  it("strips the trailing filename, handles backslashes, and preserves dotted folder names", () => {
    expect(formatFolderPath("Cedarline Systems/2025 - Mar 31/Submitted/pd1.docx")).toBe(
      "Cedarline Systems / 2025 - Mar 31 / Submitted"
    );
    expect(formatFolderPath("\\Cedarline Systems\\2025\\Submitted\\notes", "notes")).toBe(
      "Cedarline Systems / 2025 / Submitted"
    );
    expect(formatFolderPath("Cedarline Systems/2025 - Mar 31/Submitted")).toBe(
      "Cedarline Systems / 2025 - Mar 31 / Submitted"
    );
    expect(formatFolderPath("Cedarline Systems/Rev 2.10")).toBe(
      "Cedarline Systems / Rev 2.10"
    );
    expect(formatFolderPath(null)).toBe("");
  });
});
