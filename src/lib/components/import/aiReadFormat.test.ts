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
});

describe("documentSheetSubtitle", () => {
  it("formats SR&ED project description and other categories", () => {
    expect(documentSheetSubtitle("final_pd", "Cedarline Systems")).toBe(
      "Cedarline Systems. SR&ED project description."
    );
    expect(documentSheetSubtitle("draft", "Cedarline Systems")).toBe(
      "Cedarline Systems. SR&ED project description."
    );
    expect(documentSheetSubtitle("transcript", "Cedarline Systems")).toBe(
      "Cedarline Systems. Interview transcript."
    );
    expect(documentSheetSubtitle("final_pd", null)).toBe("SR&ED project description.");
  });
});

describe("formatFolderPath", () => {
  it("strips the trailing filename and spaces folder slashes", () => {
    expect(formatFolderPath("Cedarline Systems/2025 - Mar 31/Submitted/pd1.docx")).toBe(
      "Cedarline Systems / 2025 - Mar 31 / Submitted"
    );
    expect(formatFolderPath("Cedarline Systems/2025 - Mar 31/Submitted")).toBe(
      "Cedarline Systems / 2025 - Mar 31 / Submitted"
    );
  });
});
