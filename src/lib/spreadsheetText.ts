// 2026-10-26 (Phase B2): moved to shared/spreadsheetText.ts so the server's
// reader turns a workbook into the same text. Re-exported here for the
// browser's worker.
export { spreadsheetText } from "../../shared/spreadsheetText";
