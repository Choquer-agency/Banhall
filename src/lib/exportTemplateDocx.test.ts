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

async function exportedXml(s244: string): Promise<string> {
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
    project: { title: "Cold room readiness", clientName: "Example Co", fiscalYearEnd: Date.UTC(2025, 11, 31), scienceCode: "2.02.09" },
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
