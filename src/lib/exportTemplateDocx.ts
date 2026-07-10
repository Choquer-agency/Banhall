import JSZip from "jszip";
import type {
  CanonicalExportReport,
} from "$lib/exportValidation";
import type {
  CanonicalReportSection,
  ExportParagraphBlock,
} from "$lib/reportSections";
import {
  normalizeCraScienceCode,
  type CraScienceCode,
} from "../../shared/craScienceCodes";

const TEMPLATE_URL = "/templates/schedule60.docx";
const RULER_78 =
  "123456789012345678901234567890123456789012345678901234567890123456789012345678";
const RULER_60_RUN =
  "123456789012345678901234567890123456789012345678901234567890</w:t>";
const SECTION_MARKERS: Record<"s242" | "s244" | "s246", string> = {
  s242: "242 What",
  s244: "244 What",
  s246: "246 What",
};
const MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const COURIER_RPR =
  '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>';
const BLANK_PARAGRAPH =
  '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="24"/></w:rPr></w:pPr></w:p>';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function courierParagraph(block: ExportParagraphBlock): string {
  const lines = block.text.split("\n");
  const runs = lines
    .map((line, index) => {
      const breakXml = index === 0 ? "" : "<w:br/>";
      return `<w:r>${COURIER_RPR}${breakXml}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
    })
    .join("");
  return `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="24"/></w:rPr></w:pPr>${runs}</w:p>`;
}

function sectionParagraphsXml(section: CanonicalReportSection): string {
  if (section.blocks.length === 0) {
    throw new Error(`Line ${section.line} has no exportable paragraphs`);
  }
  return section.blocks.map(courierParagraph).join(BLANK_PARAGRAPH);
}

function fillSectionCell(
  xml: string,
  marker: string,
  section: CanonicalReportSection
): string {
  const markerIndex = xml.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Template marker "${marker}" was not found`);
  const rulerIndex = xml.indexOf(RULER_78, markerIndex);
  if (rulerIndex < 0) throw new Error(`Template ruler after "${marker}" was not found`);
  const gutterCell = xml.indexOf("<w:tc>", rulerIndex);
  const contentCell = xml.indexOf("<w:tc>", gutterCell + 1);
  const cellEnd = xml.indexOf("</w:tc>", contentCell);
  const paragraphStart = xml.indexOf("<w:p", contentCell);
  if (
    gutterCell < 0 ||
    contentCell < 0 ||
    cellEnd < 0 ||
    paragraphStart < 0 ||
    paragraphStart > cellEnd
  ) {
    throw new Error(`Template content cell for "${marker}" was not found`);
  }
  return (
    xml.slice(0, paragraphStart) +
    sectionParagraphsXml(section) +
    xml.slice(cellEnd)
  );
}

function fillTitleBox(xml: string, title: string): string {
  if (!title || title.length > 60) {
    throw new Error("Project title must contain 1 to 60 characters");
  }
  const rulerIndex = xml.indexOf(RULER_60_RUN);
  if (rulerIndex < 0) throw new Error("Template project-title ruler was not found");
  const cellEnd = xml.indexOf("</w:tc>", rulerIndex);
  if (cellEnd < 0) throw new Error("Template project-title cell was not found");
  return xml.slice(0, cellEnd) + courierParagraph({ kind: "paragraph", text: title }) + xml.slice(cellEnd);
}

function fillHeaderField(xml: string, label: string, value: string): string {
  if (!value.trim()) throw new Error(`${label} value is required`);
  const labelIndex = xml.indexOf(label);
  if (labelIndex < 0) throw new Error(`Template header label "${label}" was not found`);
  const cellStart = xml.indexOf("<w:tc>", labelIndex);
  const cellEnd = xml.indexOf("</w:tc>", cellStart);
  const paragraphEnd = xml.indexOf("</w:p>", cellStart);
  if (
    cellStart < 0 ||
    cellEnd < 0 ||
    paragraphEnd < 0 ||
    paragraphEnd > cellEnd
  ) {
    throw new Error(`Template header cell for "${label}" was not found`);
  }
  const run = `<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
  return xml.slice(0, paragraphEnd) + run + xml.slice(paragraphEnd);
}

function fillScienceCode(xml: string, value: CraScienceCode): string {
  const lineIndex = xml.indexOf("<w:t>206</w:t>");
  if (lineIndex < 0) throw new Error("Template line 206 marker was not found");
  const paragraphStart = xml.indexOf('<w:p w14:paraId="79466BD4"', lineIndex);
  if (paragraphStart < 0) throw new Error("Template line 206 value cell was not found");
  const paragraphEnd = xml.indexOf("</w:p>", paragraphStart);
  if (paragraphEnd < 0) throw new Error("Template line 206 paragraph was not found");
  const run = `<w:r>${COURIER_RPR}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
  return xml.slice(0, paragraphEnd) + run + xml.slice(paragraphEnd);
}

export async function exportToTemplateDocx(
  report: Readonly<CanonicalExportReport>,
  templateBytes?: ArrayBuffer
): Promise<Blob> {
  const scienceCode = normalizeCraScienceCode(report.scienceCode);
  if (!scienceCode) {
    throw new Error("A valid CRA field of science or technology code is required");
  }
  if (report.body.diagnostics.length > 0) {
    throw new Error("Report parser diagnostics must be resolved before export");
  }
  let bytes = templateBytes;
  if (!bytes) {
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) throw new Error(`Template fetch failed (${response.status})`);
    bytes = await response.arrayBuffer();
  }
  const zip = await JSZip.loadAsync(bytes);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Template is missing word/document.xml");
  let xml = await documentFile.async("string");

  xml = fillSectionCell(xml, SECTION_MARKERS.s242, report.body.sections.s242);
  xml = fillSectionCell(xml, SECTION_MARKERS.s244, report.body.sections.s244);
  xml = fillSectionCell(xml, SECTION_MARKERS.s246, report.body.sections.s246);
  xml = fillTitleBox(xml, report.title);
  xml = fillHeaderField(xml, "Name of Claimant:", ` ${report.clientName}`);
  if (!report.fiscalYearEnd) throw new Error("Taxation year end is required");
  const taxationYear = new Date(report.fiscalYearEnd);
  if (Number.isNaN(taxationYear.getTime())) {
    throw new Error("Taxation year end is invalid");
  }
  xml = fillHeaderField(
    xml,
    "Taxation Year Ending",
    ` ${taxationYear.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`
  );
  xml = fillScienceCode(xml, scienceCode);

  zip.file("word/document.xml", xml);
  return await zip.generateAsync({ type: "blob", mimeType: MIME_TYPE });
}
