// Pure parser and O(N+M) Map-indexed matcher for bulk-loading official company
// lists (paste or CSV, up to 500 lines at a time). Zero database access so
// both Convex preview/create endpoints and browser preview UI can share it.

import { dashboardCompanyKey } from "./dashboardProjection";
import { clientLooseKey, clientNamesLookAlike } from "./clientNames";

export const BULK_IMPORT_MAX_LINES = 500;
export const BULK_CREATE_BATCH_MAX = 100;
export const BULK_CLIENT_NAME_MAX_LENGTH = 200;

export type BulkCompanyStatus = "new" | "similar" | "exists" | "merged" | "duplicate" | "invalid";

export type ExistingCompanyRef = {
  key: string;
  name: string;
};

export type MergedCompanyRef = {
  key: string;
  name: string;
  intoName: string;
};

export type BulkCompanyPreviewRow = {
  index: number;
  name: string;
  key: string;
  status: BulkCompanyStatus;
  existingName?: string;
  mergedInto?: string;
  similarMatches?: string[];
  reason?: string;
};

export type BulkCompanyCounts = {
  total: number;
  new: number;
  similar: number;
  exists: number;
  merged: number;
  duplicate: number;
  invalid: number;
};

const HEADER_NAMES = new Set([
  "company",
  "company name",
  "companies",
  "client",
  "client name",
  "clients",
  "name",
  "legal name",
  "organization",
  "organisation",
  "business",
  "business name",
  "claimant",
  "claimant name",
]);

const TRAILING_LEGAL_SUFFIX =
  /^(?:inc|incorporated|ltd|limited|ltee|ltée|llc|llp|lp|corp|corporation|co|company|ulc|plc)\.?$/i;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function collapseSpaces(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

/**
 * Parses pasted newline-separated text or CSV into clean company names.
 * Auto-detects a CSV header row (e.g. "Company Name,Industry") while preserving
 * plain-text company names containing commas before legal suffixes ("Acme, Inc.").
 */
export function parseBulkCompanyText(raw: string): { names: string[]; truncated: boolean; totalLines: number } {
  const cleaned = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rawLines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rawLines.length === 0) return { names: [], truncated: false, totalLines: 0 };

  const parsedRows = rawLines.map((line) => parseCsvLine(line));
  const firstRow = parsedRows[0]!;
  const headerCol = firstRow.findIndex((cell) => HEADER_NAMES.has(normalizeHeader(cell)));

  // Treat as multi-column CSV when either:
  // 1) Row 1 has a recognized header column and >1 column, OR
  // 2) At least half of the rows have >1 column whose 2nd cell is NOT a legal suffix.
  const multiColLines = parsedRows.filter(
    (cells) => cells.length > 1 && !TRAILING_LEGAL_SUFFIX.test(cells[1] ?? "")
  ).length;
  const isMultiColumnCsv =
    (firstRow.length > 1 && headerCol >= 0) || (rawLines.length >= 2 && multiColLines >= Math.ceil(rawLines.length / 2));

  const targetCol = headerCol >= 0 ? headerCol : 0;
  const skipFirstRow = headerCol >= 0 && (isMultiColumnCsv || firstRow.length === 1);
  const startIndex = skipFirstRow ? 1 : 0;

  const allNames: string[] = [];
  for (let i = startIndex; i < rawLines.length; i += 1) {
    const rawValue = isMultiColumnCsv
      ? (parsedRows[i]![targetCol] ?? "")
      : stripWrappingQuotes(rawLines[i]!);
    const name = collapseSpaces(rawValue);
    if (!name) continue;
    allNames.push(name);
  }

  const truncated = allNames.length > BULK_IMPORT_MAX_LINES;
  return {
    names: allNames.slice(0, BULK_IMPORT_MAX_LINES),
    truncated,
    totalLines: allNames.length,
  };
}

function pushBucket<T>(map: Map<string, T[]>, key: string, value: T) {
  if (!key) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function firstWordOf(loose: string): string {
  const space = loose.indexOf(" ");
  return space === -1 ? loose : loose.slice(0, space);
}

/**
 * Classifies up to 500 candidate company names against existing active & merged
 * companies and earlier lines in the same batch in O(N + M) time using Map indexes.
 */
export function classifyBulkCompanyNames(
  names: readonly string[],
  existing: {
    active: readonly ExistingCompanyRef[];
    merged: readonly MergedCompanyRef[];
  }
): { rows: BulkCompanyPreviewRow[]; counts: BulkCompanyCounts } {
  const activeByKey = new Map<string, ExistingCompanyRef>();
  const activeByLoose = new Map<string, ExistingCompanyRef[]>();
  const activeByCompact = new Map<string, ExistingCompanyRef[]>();
  const activeByFirstWord = new Map<string, ExistingCompanyRef[]>();

  for (const company of existing.active) {
    const key = company.key || dashboardCompanyKey(company.name);
    if (!key) continue;
    if (!activeByKey.has(key)) activeByKey.set(key, { key, name: company.name });
    const loose = clientLooseKey(company.name);
    if (!loose) continue;
    pushBucket(activeByLoose, loose, company);
    pushBucket(activeByCompact, loose.replace(/ /g, ""), company);
    pushBucket(activeByFirstWord, firstWordOf(loose), company);
  }

  const mergedByKey = new Map<string, MergedCompanyRef>();
  for (const merged of existing.merged) {
    const key = merged.key || dashboardCompanyKey(merged.name);
    if (key && !mergedByKey.has(key)) mergedByKey.set(key, merged);
  }

  const batchByKey = new Map<string, string>();
  const batchByLoose = new Map<string, string[]>();
  const batchByCompact = new Map<string, string[]>();
  const batchByFirstWord = new Map<string, string[]>();

  const rows: BulkCompanyPreviewRow[] = [];
  const counts: BulkCompanyCounts = {
    total: 0,
    new: 0,
    similar: 0,
    exists: 0,
    merged: 0,
    duplicate: 0,
    invalid: 0,
  };

  const limited = names.slice(0, BULK_IMPORT_MAX_LINES);
  for (let index = 0; index < limited.length; index += 1) {
    const name = collapseSpaces(limited[index] ?? "");
    counts.total += 1;

    if (!name) {
      counts.invalid += 1;
      rows.push({ index, name: "", key: "", status: "invalid", reason: "Company name is blank." });
      continue;
    }
    if (name.length > BULK_CLIENT_NAME_MAX_LENGTH) {
      counts.invalid += 1;
      rows.push({
        index,
        name: name.slice(0, BULK_CLIENT_NAME_MAX_LENGTH),
        key: "",
        status: "invalid",
        reason: `Keep company names under ${BULK_CLIENT_NAME_MAX_LENGTH} characters.`,
      });
      continue;
    }
    const key = dashboardCompanyKey(name);
    if (!key || !/[\p{L}\p{N}]/u.test(name)) {
      counts.invalid += 1;
      rows.push({ index, name, key: "", status: "invalid", reason: "Company name needs letters or numbers." });
      continue;
    }

    const exactActive = activeByKey.get(key);
    if (exactActive) {
      counts.exists += 1;
      rows.push({ index, name, key, status: "exists", existingName: exactActive.name });
      continue;
    }

    const exactMerged = mergedByKey.get(key);
    if (exactMerged) {
      counts.merged += 1;
      rows.push({
        index,
        name,
        key,
        status: "merged",
        existingName: exactMerged.name,
        mergedInto: exactMerged.intoName,
      });
      continue;
    }

    const earlierExact = batchByKey.get(key);
    if (earlierExact) {
      counts.duplicate += 1;
      rows.push({ index, name, key, status: "duplicate", existingName: earlierExact });
      continue;
    }

    // Look for lookalike existing companies or earlier rows in this batch via indexed buckets.
    const loose = clientLooseKey(name);
    const similarNames: string[] = [];
    const seenSimilar = new Set<string>();
    const addSimilar = (candidateName: string) => {
      const lowered = candidateName.toLowerCase();
      if (seenSimilar.has(lowered) || similarNames.length >= 3) return;
      seenSimilar.add(lowered);
      similarNames.push(candidateName);
    };

    if (loose) {
      const compact = loose.replace(/ /g, "");
      const firstWord = firstWordOf(loose);
      const existingCandidates = [
        ...(activeByLoose.get(loose) ?? []),
        ...(activeByCompact.get(compact) ?? []),
        ...(activeByFirstWord.get(firstWord) ?? []),
      ];
      for (const candidate of existingCandidates) {
        if (candidate.key !== key && clientNamesLookAlike(candidate.name, name)) {
          addSimilar(candidate.name);
        }
      }
      const batchCandidates = [
        ...(batchByLoose.get(loose) ?? []),
        ...(batchByCompact.get(compact) ?? []),
        ...(batchByFirstWord.get(firstWord) ?? []),
      ];
      for (const earlierName of batchCandidates) {
        if (clientNamesLookAlike(earlierName, name)) {
          addSimilar(earlierName);
        }
      }
    }

    // Record in intra-batch indexes so later lines see exact duplicates & lookalikes.
    batchByKey.set(key, name);
    if (loose) {
      pushBucket(batchByLoose, loose, name);
      pushBucket(batchByCompact, loose.replace(/ /g, ""), name);
      pushBucket(batchByFirstWord, firstWordOf(loose), name);
    }

    if (similarNames.length > 0) {
      counts.similar += 1;
      rows.push({ index, name, key, status: "similar", similarMatches: similarNames });
    } else {
      counts.new += 1;
      rows.push({ index, name, key, status: "new" });
    }
  }

  return { rows, counts };
}
