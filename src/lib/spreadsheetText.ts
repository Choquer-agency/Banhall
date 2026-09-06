import * as XLSX from "xlsx";
import { capContent, MAX_CONTENT_CHARS } from "./documentContent";
import type { SpreadsheetProgress } from "./spreadsheetProtocol";

/** Keep the original sheet-level stopping rule: normalize only after joining. */
export function spreadsheetText(buffer: ArrayBuffer, onProgress?: (progress: SpreadsheetProgress) => void): string {
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
