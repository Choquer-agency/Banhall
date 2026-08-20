// Pure classification helpers for OneDrive corpus ingestion (BNH-17).
// Shared by the Graph delta sync (convex/ingestionSync.ts, node) and the
// crawler upload endpoint (convex/http.ts, default runtime) — keep this file
// framework-free and Node-free.

// File types worth staging. Everything else (xlsx, images, …) is skipped —
// Michael deprioritized drawings/spreadsheets for the Brain corpus.
export const INGEST_EXTENSIONS = new Set(["docx", "doc", "pdf", "txt", "vtt"]);
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export type Classified = {
  clientName?: string;
  fiscalYearLabel?: string;
  fiscalYear?: number;
  docKind: "pd" | "transcript" | "supporting" | "unknown";
  pairGroupKey: string;
};

/**
 * `<Client>/<Fiscal year>/…` convention (Jun 19 meeting): PDs are Word docs
 * whose immediate folder is a submission folder ("Submitted",
 * "To be submitted", …); transcripts live under an Audio folder inside
 * WIP/Technical.
 */
export function classify(relPath: string, fileName: string): Classified {
  const segments = relPath.split("/").filter(Boolean);
  const clientName = segments[0];
  const fiscalYearLabel = segments[1];
  const yearMatch = fiscalYearLabel?.match(/(19|20)\d{2}/);
  const fiscalYear = yearMatch ? Number(yearMatch[0]) : undefined;
  const lower = segments.map((s) => s.toLowerCase());
  const parent = lower[lower.length - 1] ?? "";
  const ext = extensionOf(fileName);

  let docKind: Classified["docKind"] = "supporting";
  if (lower.includes("audio")) {
    docKind = "transcript";
  } else if (parent.includes("submit") && (ext === "docx" || ext === "doc")) {
    docKind = "pd";
  } else if (!clientName || !fiscalYearLabel) {
    docKind = "unknown";
  }
  return {
    clientName,
    fiscalYearLabel,
    fiscalYear,
    docKind,
    pairGroupKey: `${clientName ?? "?"}::${fiscalYearLabel ?? "?"}`,
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Fiscal-year folder label ("2025 - Dec 31") → a projects.fiscalYearEnd
 * timestamp. Grouping only depends on the UTC year (dashboardFiscalYear), so
 * when no month/day suffix parses the Dec 31 fallback is safe.
 */
export function fiscalYearEndFromLabel(
  label: string | undefined,
  fiscalYear: number
): number {
  const match = label?.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})/i
  );
  if (match) {
    const monthIdx = MONTHS.indexOf(match[1].toLowerCase());
    const day = Number(match[2]);
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      return Date.UTC(fiscalYear, monthIdx, day);
    }
  }
  return Date.UTC(fiscalYear, 11, 31);
}

/**
 * Normalize a client-supplied relative path: forward slashes, no leading
 * separators, no traversal segments, bounded length. Returns null when
 * nothing safe remains.
 */
export function sanitizeRelPath(raw: string): string | null {
  const cleaned = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .join("/");
  if (!cleaned || cleaned.length > 1024) return null;
  return cleaned;
}
