import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { buildTiptapDocument } from "../../convex/lib/tiptapReport";
import { canonicalizeExportPreflight } from "./exportValidation";
import { exportToTemplateDocx } from "./exportTemplateDocx";

// 2026-10-29 (owner): notes still in the text export highlighted, through
// the real Schedule 60 template: a [GAP: ...] in yellow as before, and an
// [INFERRED: ...] the writer has not checked yet in cyan.
const TEMPLATE = readFileSync(fileURLToPath(new URL("../../static/templates/schedule60.docx", import.meta.url)));
const MARK = "[INFERRED: the source asks for stability over time, not single-point checks]";

type ProjectOverrides = { clientName?: string; fiscalYearEnd?: number };

async function exportedXml(s244: string | null, project: ProjectOverrides = {}): Promise<string> {
  const content = JSON.stringify(
    buildTiptapDocument("Cold room readiness", "The company asked how long a cold room takes to settle.", s244, "The work showed how load affects settling.")
  );
  const canonical = canonicalizeExportPreflight({
    reportId: "r1",
    reportVersion: 1,
    revisionNumber: 1,
    contentHash: "hash",
    content,
    templateVersion: "v1",
    supportingDocumentCount: 1,
    project: { title: "Cold room readiness", clientName: "Example Co", fiscalYearEnd: Date.UTC(2025, 11, 31), scienceCode: "2.02.09", ...project },
  });
  const template = TEMPLATE.buffer.slice(TEMPLATE.byteOffset, TEMPLATE.byteOffset + TEMPLATE.byteLength) as ArrayBuffer;
  const blob = await exportToTemplateDocx(canonical, template);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return (await zip.file("word/document.xml")!.async("string"));
}

/** The run (`<w:r>...</w:r>`) that holds `text`. */
function runHolding(xml: string, text: string): string {
  const at = xml.indexOf(text);
  expect(at).toBeGreaterThan(-1);
  return xml.slice(xml.lastIndexOf("<w:r>", at), xml.indexOf("</w:r>", at));
}

/** The table cell (`<w:tc>...</w:tc>`) that holds `text`, as plain text. */
function cellTextHolding(xml: string, text: string): string {
  const at = xml.indexOf(text);
  expect(at).toBeGreaterThan(-1);
  const cell = xml.slice(xml.lastIndexOf("<w:tc>", at), xml.indexOf("</w:tc>", at));
  return [...cell.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");
}

const BODY = "Readiness was first judged from single readings.";

describe("exportToTemplateDocx header", () => {
  test("writes the claimant name beside its label and leaves the project box alone", async () => {
    const xml = await exportedXml(BODY);
    expect(cellTextHolding(xml, "Name of Claimant:")).toBe("Name of Claimant: Example Co");
    expect(cellTextHolding(xml, "Project: 01")).toBe("Project: 01");
  });

  test("writes the taxation year end beside its label, not in the divider row below", async () => {
    const xml = await exportedXml(BODY);
    expect(cellTextHolding(xml, "Taxation Year Ending")).toBe("Taxation Year Ending: December 31, 2025");
    expect(xml.match(/December 31, 2025/g)).toHaveLength(1);
  });

  test("prints the chosen day for a year end stored as midnight UTC or as local midnight", async () => {
    const utcMidnight = await exportedXml(BODY, { fiscalYearEnd: Date.UTC(2025, 5, 30) });
    expect(cellTextHolding(utcMidnight, "Taxation Year Ending")).toBe("Taxation Year Ending: June 30, 2025");
    // Vancouver midnight on June 30 is 07:00 UTC the same day.
    const pacificMidnight = await exportedXml(BODY, { fiscalYearEnd: Date.UTC(2025, 5, 30, 7) });
    expect(cellTextHolding(pacificMidnight, "Taxation Year Ending")).toBe("Taxation Year Ending: June 30, 2025");
  });

  test("escapes a claimant name that holds XML characters", async () => {
    const xml = await exportedXml(BODY, { clientName: "Smith & Sons <West>" });
    expect(xml).toContain("Name of Claimant:");
    expect(xml).toContain("Smith &amp; Sons &lt;West&gt;");
  });
});

describe("exportToTemplateDocx text safety", () => {
  test("leaves out control characters Word cannot open, and keeps a vertical tab or form feed as a space", async () => {
    const xml = await exportedXml("Trial\u0000 one\u0008 ran.\u000BTrial two\u000Cran. Done\uD800.", { clientName: "Example\u0001 Co" });
    // Nothing XML 1.0 forbids is left anywhere in the document.
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
    expect(xml).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(xml).toContain("Trial one ran. Trial two ran. Done.");
    expect(cellTextHolding(xml, "Name of Claimant:")).toBe("Name of Claimant: Example Co");
  });

  test("keeps a character outside the basic plane whole", async () => {
    const xml = await exportedXml("The rig used a 5 \u{1D6C0} load.");
    expect(xml).toContain("The rig used a 5 \u{1D6C0} load.");
  });
});

describe("exportToTemplateDocx undrafted sections", () => {
  test("refuses to export while a section still holds the not drafted placeholder", async () => {
    await expect(exportedXml(null)).rejects.toThrow("Report parser diagnostics must be resolved before export");
  });
});

describe("exportToTemplateDocx notes", () => {
  test("exports an unchecked inference highlighted in cyan, and a gap in yellow, each in its own run", async () => {
    const xml = await exportedXml(`Readiness was first judged from single readings. ${MARK} The hold time was [GAP: the hold time] minutes.`);
    const inferred = runHolding(xml, MARK);
    expect(inferred).toContain('<w:highlight w:val="cyan"/>');
    expect(inferred).toContain('w:ascii="Courier New"');
    const gap = runHolding(xml, "[GAP: the hold time]");
    expect(gap).toContain('<w:highlight w:val="yellow"/>');
    // The sentences around them stay plain.
    expect(runHolding(xml, "Readiness was first judged from single readings.")).not.toContain("<w:highlight");
    expect(runHolding(xml, "The hold time was")).not.toContain("<w:highlight");
  });

  // Review round 1 (P3-11): a marker across a hard break is highlighted on both lines.
  test("highlights a marker that spans a hard break on each line it covers", async () => {
    const xml = await exportedXml("Readiness was judged from single readings. [INFERRED: the source asks\nfor stability over time] The team then held each sample.");
    const first = runHolding(xml, "[INFERRED: the source asks");
    expect(first).toContain('<w:highlight w:val="cyan"/>');
    const second = runHolding(xml, "for stability over time]");
    expect(second).toContain('<w:highlight w:val="cyan"/>');
    expect(second).toContain("<w:br/>");
    expect(runHolding(xml, " The team then held each sample.")).not.toContain("<w:highlight");
  });

  test("an inference does not block the export", async () => {
    await expect(exportedXml(`Only an inference here. ${MARK}`)).resolves.toContain(MARK);
  });
});
