export type SpreadsheetProgress =
  | { kind: "queued" }
  | { kind: "reading" }
  | { kind: "converting"; sheet: number; total: number };

export type SpreadsheetResponse =
  | { kind: "progress"; progress: SpreadsheetProgress }
  | { kind: "complete"; content: string }
  | { kind: "error"; message: string };

export function isSpreadsheetResponse(value: unknown): value is SpreadsheetResponse {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  switch (value.kind) {
    case "complete": return "content" in value && typeof value.content === "string";
    case "error": return "message" in value && typeof value.message === "string";
    case "progress": {
      if (!("progress" in value) || !value.progress || typeof value.progress !== "object" || !("kind" in value.progress)) return false;
      const progress = value.progress;
      if (progress.kind === "queued" || progress.kind === "reading") return true;
      return progress.kind === "converting" && "sheet" in progress && "total" in progress &&
        typeof progress.sheet === "number" && Number.isInteger(progress.sheet) && progress.sheet > 0 &&
        typeof progress.total === "number" && Number.isInteger(progress.total) && progress.total >= progress.sheet;
    }
    default: return false;
  }
}
