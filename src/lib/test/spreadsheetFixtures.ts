import * as XLSX from "xlsx";
import { capContent, MAX_CONTENT_CHARS } from "../documentContent";

/** Independent pre-worker extraction algorithm, retained as a parity oracle. */
export function baselineSpreadsheetText(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(buffer, { type: "array" });
  const parts: string[] = [];
  for (const name of workbook.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false }).trim();
    if (!csv) continue;
    parts.push(`## Sheet: ${name}\n${csv}`);
    if (parts.join("\n\n").length > MAX_CONTENT_CHARS) break;
  }
  return capContent(parts.join("\n\n"));
}

export function spreadsheetFixture(bookType: "xlsx" | "xls", large = false): File {
  const workbook = XLSX.utils.book_new();
  const first = XLSX.utils.aoa_to_sheet([
    ["Label", "Value"],
    ['Quoted "value", comma', 1234.5],
    [],
    ["Line\r\nbreak\u00a0here", new Date("2025-01-15T00:00:00Z")],
    ["  whitespace  ", true],
  ]);
  first.B2.z = "$#,##0.00";
  XLSX.utils.book_append_sheet(workbook, first, "First");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), "Empty");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(large
    ? Array.from({ length: 900 }, (_, i) => [`row ${i}`, "x".repeat(500)])
    : [["Last sheet", "a,b"]]), "Last");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["After cap"]]), "Tail");
  const bytes: unknown = XLSX.write(workbook, { type: "array", bookType });
  if (!(bytes instanceof ArrayBuffer)) throw new Error("Expected workbook ArrayBuffer");
  return new File([bytes], `fixture.${bookType}`);
}
