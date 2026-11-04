import * as XLSX from "xlsx";
import { capContent, MAX_CONTENT_CHARS } from "./documentContent";

/** What spreadsheetText reports while it works (the browser's worker passes it on). */
export type SpreadsheetTextProgress =
  | { kind: "reading" }
  | { kind: "converting"; sheet: number; total: number };

/**
 * A workbook as text: each sheet with rows as CSV, under "## Sheet: <name>".
 * Shared by the browser's worker and the server's reader (2026-10-26).
 * Keep the original sheet-level stopping rule: normalize only after joining.
 */
export function spreadsheetText(
  buffer: ArrayBuffer | Uint8Array,
  onProgress?: (progress: SpreadsheetTextProgress) => void
): string {
  onProgress?.({ kind: "reading" });
  const workbook = XLSX.read(buffer, { type: "array" });
  const parts: string[] = [];
  let length = 0;
  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    onProgress?.({ kind: "converting", sheet: index + 1, total: workbook.SheetNames.length });
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false }).trim();
    if (!csv) continue;
    const part = `## Sheet: ${sheetName}\n${csv}`;
    length += part.length + (parts.length ? 2 : 0);
    parts.push(part);
    if (length > MAX_CONTENT_CHARS) break;
  }
  return capContent(parts.join("\n\n"));
}
