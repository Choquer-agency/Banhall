// The Import sheet's row fields (2026-11-11, phase 2). Pure: no database.
//
// convex/ingestion.ts passes every row it writes through settleItem, so the
// fields the old page, pairing and approval read (docKind, clientName,
// fiscalYear, pairGroupKey) and the fields the sheet reads (category,
// companyKey, fiscalYearEnd, sheetTab, needsCheck, sortKey) always agree.

import type { WithoutSystemFields } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import { dashboardCompanyKey, DASHBOARD_UNNAMED_COMPANY_KEY } from "../../shared/dashboardProjection";
import { normalizeCraScienceCode } from "../../shared/craScienceCodes";
import {
  isBeingRead as statusIsBeingRead,
  looksLikeEmail,
  tabForStatus,
  writerInitialsKey,
} from "../../shared/importSheetRules";
import {
  classifyItemPath,
  labelsOf,
  pairGroupKeyFor,
  type IngestionCategory,
  type IngestionLabels,
} from "./ingestionClassify";
import { scienceCodeFromText } from "./scienceCodeFromText";
import { domainError } from "./contracts";
import type {
  CheckReason,
  EditableLabel,
  SheetLabelPatch,
  SheetTab,
} from "./ingestionSheetValidators";

export type IngestionItemFields = WithoutSystemFields<Doc<"ingestionItems">>;
type Status = Doc<"ingestionItems">["status"];
type DocKind = Doc<"ingestionItems">["docKind"];

/** The labels a person can set, in the order editedLabels keeps them. */
export const EDITABLE_LABELS: readonly EditableLabel[] = [
  "company",
  "category",
  "fiscalYearEnd",
  "pdNumber",
  "version",
  "writerName",
  "scienceCode",
];

/** The tab a status shows on (shared/importSheetRules.ts, which the page reads too). */
export function sheetTabForStatus(status: Status): SheetTab {
  return tabForStatus(status);
}

/** True while the file is still being fetched or read. */
export function isBeingRead(status: Status): boolean {
  return statusIsBeingRead(status);
}

/**
 * Whether a row holds text that was read from its file (2026-11-11, phase 3b
 * fixes): its preview (`text`) is not blank, or its full text is in storage
 * (`textStorageId`). The same test approval uses (getItemForApproval) and
 * sheetFile's `hasText`. `extractNote` is not used: it also carries notes
 * that are not about missing text (a truncation), and a read file with no
 * text may have no note at all.
 */
export function hasReadText(row: Pick<IngestionItemFields, "text" | "textStorageId">): boolean {
  return Boolean(row.text?.trim()) || row.textStorageId !== undefined;
}

/** docKind, which pairing, approval and porting read, from the category. */
export function docKindForCategory(category: IngestionCategory): DocKind {
  if (category === "final_pd") return "pd";
  if (category === "transcript") return "transcript";
  if (category === "unknown") return "unknown";
  return "supporting";
}

/** Categories that do not belong to one fiscal year. */
const NO_FISCAL_YEAR_NEEDED: ReadonlySet<IngestionCategory> = new Set(["company_file", "unknown"]);

type CheckInput = Pick<
  IngestionItemFields,
  | "status"
  | "category"
  | "companyKey"
  | "fiscalYearEnd"
  | "scienceCode"
  | "writerName"
  | "writerInitials"
  | "text"
  | "textStorageId"
>;

/**
 * Why a row needs a person to look at it. Only rows on the review tab can.
 * A file still being read is not flagged at all (2026-11-12): its row shows
 * only "Being read" with nothing to pick, reading may still fill labels in,
 * and the band counts it as being read, not as to check. It is settled again
 * when reading ends. A file that was read but gave no text (a PDF that is
 * only a scan) needs a person too: "no_text" (hasReadText).
 */
export function checkReasonsFor(row: CheckInput): CheckReason[] {
  if (sheetTabForStatus(row.status) !== "review") return [];
  if (isBeingRead(row.status)) return [];
  const reasons: CheckReason[] = [];
  if (row.companyKey === undefined) reasons.push("no_company");
  if (row.category === "unknown") reasons.push("unknown_category");
  if (row.status === "failed") reasons.push("could_not_read");
  if (row.status === "pending_review" && !hasReadText(row)) reasons.push("no_text");
  if (
    row.category !== undefined &&
    !NO_FISCAL_YEAR_NEEDED.has(row.category) &&
    row.fiscalYearEnd === undefined
  ) {
    reasons.push("no_fiscal_year");
  }
  if (row.category === "final_pd") {
    if (!row.scienceCode) reasons.push("no_science_code");
    // Initials alone are not a writer (shared/pdFilename.ts): a person says
    // who they are once, and every file with them takes the name.
    if (!row.writerName) reasons.push(writerInitialsKey(row.writerInitials) ? "unmatched_initials" : "no_writer");
  }
  return reasons;
}

// ─── Writers by initials (2026-11-12) ───────────────────────────────────────

/** The initials a remembered writer is kept under (shared/importSheetRules.ts, which the page reads too). */
export { writerInitialsKey };

/** Whether a person set the file's writer on the file itself (its cell, or the bar). */
export function writerSetByPerson(row: Pick<IngestionItemFields, "writerNameSource" | "editedLabels">): boolean {
  return row.writerNameSource === "person" || (row.editedLabels ?? []).includes("writerName");
}

type RememberedInput = Pick<
  IngestionItemFields,
  "status" | "writerInitials" | "writerName" | "writerNameSource" | "editedLabels"
>;

/**
 * Whether a row's writer follows the firm's remembered initials: a file not
 * approved (an approved one keeps what it was approved as) whose writer no
 * person set on the file, and which has initials or a name taken from them.
 */
export function followsRememberedWriter(row: RememberedInput): boolean {
  if (row.status === "approved" || writerSetByPerson(row)) return false;
  return writerInitialsKey(row.writerInitials) !== null || row.writerNameSource === "initials";
}

/**
 * The writer fields a row takes from the remembered initials: `remembered`
 * is the writer its initials stand for, or null when no person has said.
 * A row that does not follow them (followsRememberedWriter) gets nothing;
 * one whose initials have no writer any more loses the name it took.
 */
export function rememberedWriterFields(row: RememberedInput, remembered: string | null): Partial<IngestionItemFields> {
  if (!followsRememberedWriter(row)) return {};
  if (writerInitialsKey(row.writerInitials) !== null && remembered) {
    return { writerName: remembered, writerNameSource: "initials" };
  }
  return row.writerNameSource === "initials" ? { writerName: undefined, writerNameSource: undefined } : {};
}

/** Categories whose rows are ordered by fiscal year, PD number and version. */
const NUMBERED_CATEGORIES: ReadonlySet<IngestionCategory> = new Set([
  "final_pd",
  "draft",
  "review_copy",
]);

/** Version letters in the order a PD moves through them: in review, to be submitted, submitted. */
const VERSION_STAGE: Record<"R" | "T" | "S", string> = { R: "1", T: "2", S: "3" };

/** Sorts after every number or version. */
const LAST = "~";

function pdNumberSortPart(pdNumber: string | undefined): string {
  const match = pdNumber === undefined ? null : /^(\d{1,4})([a-z]?)$/i.exec(pdNumber);
  if (!match) return LAST;
  // Fixed width: four digits, then the letter or "-", which sorts before
  // every letter, so 4 < 4a < 4b < 12.
  return `${match[1].padStart(4, "0")}${(match[2] || "-").toLowerCase()}`;
}

function versionSortPart(code: "T" | "S" | "R" | undefined, number: number | undefined): string {
  if (code === undefined && number === undefined) return LAST;
  const stage = code === undefined ? "0" : VERSION_STAGE[code];
  const n = number === undefined || !Number.isFinite(number) ? 0 : Math.max(0, Math.floor(number));
  return `${stage}${String(n).padStart(4, "0")}`;
}

/**
 * The fiscal year, newest first: 9999 less the UTC year of the year end, in
 * four digits (2025 is "7974", 2024 "7975"), so a plain ascending sort puts
 * the newest year first; a row with no year end sorts after every year.
 */
function fiscalYearSortPart(fiscalYearEnd: number | undefined): string {
  if (fiscalYearEnd === undefined || !Number.isFinite(fiscalYearEnd)) return LAST;
  const year = new Date(fiscalYearEnd).getUTCFullYear();
  if (!(year >= 0 && year <= 9999)) return LAST;
  return String(9999 - year).padStart(4, "0");
}

/**
 * The order of rows inside one category section, as a plain string sorted
 * ascending (the sheet's index). Final PDs, drafts and review copies go by
 * fiscal year, newest first (live QA fixes, 2026-11-11: two "PD 1" rows of
 * different years no longer sit together as if they were the same file),
 * then PD number (number, then letter), then version (R, then T, then S,
 * each by number), then name; rows with no year, number or version come
 * after the ones with one. Everything else goes by name. Every write settles
 * the row (settleItem), so a new year end moves the row at once, and the
 * label backfill rewrites the key of rows stored before.
 */
export function sortKeyFor(
  row: Pick<IngestionItemFields, "category" | "fiscalYearEnd" | "pdNumber" | "versionCode" | "versionNumber" | "name">
): string {
  const name = row.name.toLowerCase();
  if (row.category === undefined || !NUMBERED_CATEGORIES.has(row.category)) return name;
  return `${fiscalYearSortPart(row.fiscalYearEnd)} ${pdNumberSortPart(row.pdNumber)} ${versionSortPart(row.versionCode, row.versionNumber)} ${name}`;
}

/** The fields a path decides. Every key is present, so a patch clears old values. */
export type PathFields = IngestionLabels & {
  clientName: string | undefined;
  fiscalYearLabel: string | undefined;
};

type KeptLabels = Pick<
  IngestionItemFields,
  | "editedLabels"
  | "clientName"
  | "category"
  | "fiscalYearEnd"
  | "fiscalYearEndAssumed"
  | "pdNumber"
  | "versionCode"
  | "versionNumber"
>;

/**
 * What a stored path and file name say about a file: the client and fiscal
 * year folders and the sheet labels. A label in `kept.editedLabels` keeps the
 * value a person gave it: a person's value wins over the path.
 *
 * fiscalYearLabel is always the fiscal year folder's name, even when a person
 * set the year end: only the old page shows it, and pairing reads the year
 * from fiscalYearEnd, not from the label.
 */
export function pathFieldsFor(path: string, name: string, kept?: KeptLabels | null): PathFields {
  const personCategory =
    kept?.editedLabels?.includes("category") && kept.category !== undefined ? kept.category : undefined;
  const c = classifyItemPath(path, name, personCategory);
  const fields: PathFields = {
    clientName: c.clientName,
    fiscalYearLabel: c.fiscalYearLabel,
    ...labelsOf(c),
  };
  const edited = new Set(kept?.editedLabels ?? []);
  if (!kept || edited.size === 0) return fields;
  if (edited.has("company")) fields.clientName = kept.clientName;
  if (edited.has("fiscalYearEnd")) {
    fields.fiscalYearEnd = kept.fiscalYearEnd;
    fields.fiscalYearEndAssumed = kept.fiscalYearEndAssumed;
  }
  if (edited.has("pdNumber")) fields.pdNumber = kept.pdNumber;
  if (edited.has("version")) {
    fields.versionCode = kept.versionCode;
    fields.versionNumber = kept.versionNumber;
  }
  return fields;
}

type ApprovedRow = KeptLabels &
  Pick<IngestionItemFields, "path" | "name" | "clientName" | "fiscalYearLabel" | "docKind">;

function pairingRoleOf(docKind: DocKind): "pd" | "transcript" | "other" {
  return docKind === "pd" || docKind === "transcript" ? docKind : "other";
}

/**
 * The labels of an approved row that has none yet (approved before the
 * labels existed). An approved row keeps what it was approved as, which is
 * what the Brain and porting hold: its stored client and fiscal year folder,
 * with the folders below them from its current path (main moved the path
 * but kept the client and year). When that still disagrees with the stored
 * docKind on PD or transcript, the category follows the docKind.
 */
export function approvedPathFields(row: ApprovedRow): PathFields {
  const segments = row.path.split("/").filter(Boolean);
  const file = segments.pop() ?? row.name;
  const folders =
    row.clientName === undefined
      ? []
      : row.fiscalYearLabel === undefined
        ? [row.clientName]
        : [row.clientName, row.fiscalYearLabel, ...segments.slice(2)];
  const fields = pathFieldsFor([...folders, file].join("/"), row.name, row);
  const role = pairingRoleOf(row.docKind);
  if (pairingRoleOf(docKindForCategory(fields.category!)) !== role) {
    fields.category =
      role === "pd"
        ? "final_pd"
        : role === "transcript"
          ? "transcript"
          : fields.clientName === undefined
            ? "unknown"
            : "supporting";
  }
  return fields;
}

/**
 * The section a file shows in on the sheet (2026-11-12): its category once
 * it is read, and "unknown", which the sheet calls Not sorted yet, while it
 * is still being read. A file whose category is unknown after reading stays
 * there. The counts (lib/importCompanyCounts.ts) and the section's file list
 * (ingestion.sheetFiles) both go by this, so a section's count always lists.
 */
export function sheetSectionFor(row: Pick<IngestionItemFields, "status" | "category">): IngestionCategory | undefined {
  if (row.category === undefined) return undefined;
  return isBeingRead(row.status) ? "unknown" : row.category;
}

/** The fields that follow from a row's own values. */
export type DerivedFields = {
  docKind: DocKind;
  companyKey: string | undefined;
  fiscalYear: number | undefined;
  pairGroupKey: string;
  scienceCodeSource: IngestionItemFields["scienceCodeSource"];
  writerNameSource: IngestionItemFields["writerNameSource"];
  sheetTab: SheetTab;
  needsCheck: boolean;
  checkReasons: CheckReason[];
  sortKey: string;
  sheetSection: IngestionCategory;
};

/**
 * The invariants, worked out from the row: docKind follows category,
 * companyKey is the app's company key of clientName, fiscalYear is the UTC
 * year of fiscalYearEnd, pairGroupKey is built from companyKey and fiscalYear
 * (ingestionClassify.ts pairGroupKeyFor), and the sheet fields follow from
 * the rest.
 */
export function derivedFields(row: IngestionItemFields & { category: IngestionCategory }): DerivedFields {
  const companyKey = row.clientName === undefined ? undefined : dashboardCompanyKey(row.clientName);
  const fiscalYear =
    row.fiscalYearEnd === undefined ? undefined : new Date(row.fiscalYearEnd).getUTCFullYear();
  const checkReasons = checkReasonsFor({ ...row, companyKey });
  return {
    docKind: docKindForCategory(row.category),
    companyKey,
    fiscalYear,
    pairGroupKey: pairGroupKeyFor(companyKey, fiscalYear),
    scienceCodeSource: row.scienceCode === undefined ? undefined : row.scienceCodeSource,
    writerNameSource: row.writerName === undefined ? undefined : row.writerNameSource,
    sheetTab: sheetTabForStatus(row.status),
    needsCheck: checkReasons.length > 0,
    checkReasons,
    sortKey: sortKeyFor(row),
    sheetSection: sheetSectionFor(row)!,
  };
}

/**
 * A row ready to store: labels from its path when it has none yet (a row
 * staged before the labels existed; an approved one keeps its approved client
 * and year, see approvedPathFields), then every derived field.
 */
export function settleItem(row: IngestionItemFields): IngestionItemFields {
  const fill = () =>
    row.status === "approved" ? approvedPathFields(row) : pathFieldsFor(row.path, row.name, row);
  const labelled = row.category === undefined ? { ...row, ...fill() } : row;
  return { ...labelled, ...derivedFields(labelled as IngestionItemFields & { category: IngestionCategory }) };
}

type PreviewInput = Pick<
  IngestionItemFields,
  "category" | "status" | "scienceCode" | "scienceCodeSource" | "editedLabels" | "text"
>;

/**
 * A science code read from the row's stored text preview (the first 8,000
 * characters), for a final PD that was read and is waiting on the review tab
 * with no science code and none set by a person; {} otherwise. Used where
 * extraction's own reading (from the whole text) may have missed the row:
 * the label backfill, and a person making a file a final PD. A row still
 * being read is left to extraction; a failed one has nothing to trust.
 */
export function previewScienceCode(row: PreviewInput): Partial<IngestionItemFields> {
  if (row.category !== "final_pd" || row.status !== "pending_review") return {};
  if (row.scienceCode !== undefined) return {};
  if (row.scienceCodeSource === "person" || (row.editedLabels ?? []).includes("scienceCode")) return {};
  const code = row.text ? scienceCodeFromText(row.text) : undefined;
  return code === undefined ? {} : { scienceCode: code, scienceCodeSource: "document" };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The keys whose value differs, with the value from `after` (undefined clears). */
export function changedFields(
  before: Partial<IngestionItemFields>,
  after: Partial<IngestionItemFields>
): Partial<IngestionItemFields> {
  const changes: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === "_id" || key === "_creationTime") continue;
    const a = (before as Record<string, unknown>)[key];
    const b = (after as Record<string, unknown>)[key];
    if (!sameValue(a, b)) changes[key] = b;
  }
  return changes as Partial<IngestionItemFields>;
}

/** The object without its undefined values, for an insert. */
export function definedFields<T extends object>(fields: T): T {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as T;
}

/** editedLabels with `added` included, in EDITABLE_LABELS order. */
export function mergeEditedLabels(
  existing: readonly EditableLabel[] | undefined,
  added: readonly EditableLabel[]
): EditableLabel[] {
  const all = new Set([...(existing ?? []), ...added]);
  return EDITABLE_LABELS.filter((label) => all.has(label));
}

/** Numbered projects are capped at 20 per company, as in shared/pdFilename.ts. */
const MAX_PD_NUMBER = 20;
const MAX_VERSION_NUMBER = 99;
const MAX_COMPANY_NAME = 200;
const MAX_WRITER_NAME = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A writer's name as it is stored: trimmed, inner spaces collapsed. Refuses
 * (INVALID_INPUT, words the page shows) an empty name, an email address and
 * one longer than 120 characters.
 */
export function cleanWriterName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) domainError("INVALID_INPUT", "Type the writer's name.");
  if (looksLikeEmail(name)) domainError("INVALID_INPUT", "Type the writer's name, not an email address.");
  if (name.length > MAX_WRITER_NAME) {
    domainError("INVALID_INPUT", `A writer's name can be up to ${MAX_WRITER_NAME} characters.`);
  }
  return name;
}

/** "04" -> "4", "12a" -> "12a"; null when it is not a PD number from 1 to 20. */
export function normalizePdNumber(value: string): string | null {
  const match = /^(\d{1,3})([A-Za-z])?$/.exec(value.trim());
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  if (number < 1 || number > MAX_PD_NUMBER) return null;
  return `${number}${match[2] ?? ""}`;
}

/**
 * The row fields one sheet edit sets, and the labels it marks as set by a
 * person. Throws a plain message for a value it cannot take, as a
 * ConvexError (INVALID_INPUT) so the Import page can show it. A picked fiscal
 * year end leaves the fiscal year folder label as it is: fiscalYear and the
 * pairing key follow fiscalYearEnd when the row is settled.
 */
export function labelPatchFields(patch: SheetLabelPatch): {
  fields: Partial<IngestionItemFields>;
  labels: EditableLabel[];
} {
  const fields: Partial<IngestionItemFields> = {};
  const labels: EditableLabel[] = [];

  if (patch.company !== undefined) {
    const name = patch.company.trim().replace(/\s+/g, " ");
    if (!name || dashboardCompanyKey(name) === DASHBOARD_UNNAMED_COMPANY_KEY) {
      domainError("INVALID_INPUT", "Type a company name.");
    }
    if (name.length > MAX_COMPANY_NAME) {
      domainError("INVALID_INPUT", `A company name can be up to ${MAX_COMPANY_NAME} characters.`);
    }
    fields.clientName = name;
    labels.push("company");
  }

  if (patch.category !== undefined) {
    fields.category = patch.category;
    labels.push("category");
  }

  if (patch.fiscalYearEnd !== undefined) {
    const end = patch.fiscalYearEnd;
    const year = Number.isFinite(end) ? new Date(end).getUTCFullYear() : NaN;
    if (!Number.isInteger(end) || end % DAY_MS !== 0 || !(year >= 1990 && year <= 2100)) {
      domainError("INVALID_INPUT", "Pick a fiscal year end date.");
    }
    fields.fiscalYearEnd = end;
    fields.fiscalYearEndAssumed = false;
    labels.push("fiscalYearEnd");
  }

  if (patch.pdNumber !== undefined) {
    const pdNumber = normalizePdNumber(patch.pdNumber);
    if (pdNumber === null) {
      domainError("INVALID_INPUT", "A PD number is 1 to 20, with an optional letter, for example 4 or 12a.");
    }
    fields.pdNumber = pdNumber;
    labels.push("pdNumber");
  }

  if (patch.version !== undefined) {
    const n = patch.version.number;
    if (!Number.isInteger(n) || n < 0 || n > MAX_VERSION_NUMBER) {
      domainError("INVALID_INPUT", `A version number is a whole number from 0 to ${MAX_VERSION_NUMBER}.`);
    }
    fields.versionCode = patch.version.code;
    fields.versionNumber = n;
    labels.push("version");
  }

  if (patch.writerName !== undefined) {
    fields.writerName = cleanWriterName(patch.writerName);
    fields.writerNameSource = "person";
    labels.push("writerName");
  }

  if (patch.scienceCode !== undefined) {
    const code = normalizeCraScienceCode(patch.scienceCode);
    if (!code) domainError("INVALID_INPUT", "That is not a CRA field of science code.");
    fields.scienceCode = code;
    fields.scienceCodeSource = "person";
    labels.push("scienceCode");
  }

  if (labels.length === 0) domainError("INVALID_INPUT", "Choose a label to change.");
  return { fields, labels };
}

/** The row fields each label sets (labelPatchFields). */
const LABEL_FIELDS: Record<EditableLabel, ReadonlyArray<keyof IngestionItemFields>> = {
  company: ["clientName"],
  category: ["category"],
  fiscalYearEnd: ["fiscalYearEnd", "fiscalYearEndAssumed"],
  pdNumber: ["pdNumber"],
  version: ["versionCode", "versionNumber"],
  writerName: ["writerName", "writerNameSource"],
  scienceCode: ["scienceCode", "scienceCodeSource"],
};

/** Only the fields of `labels` from what labelPatchFields gave (2026-11-11, phase 3b fixes). */
export function fieldsForLabels(
  fields: Partial<IngestionItemFields>,
  labels: readonly EditableLabel[]
): Partial<IngestionItemFields> {
  const picked: Record<string, unknown> = {};
  for (const label of labels) {
    for (const key of LABEL_FIELDS[label]) if (key in fields) picked[key] = fields[key];
  }
  return picked as Partial<IngestionItemFields>;
}

/** Whether pairing must be recomputed: the group, the PD or transcript role, or liveness moved. */
const LIVE_STATUSES: ReadonlySet<Status> = new Set(["discovered", "fetched", "pending_review", "approved"]);

function pairingRole(row: Pick<IngestionItemFields, "docKind" | "status">): string {
  const role = row.docKind === "pd" || row.docKind === "transcript" ? row.docKind : "other";
  return `${role}:${LIVE_STATUSES.has(row.status) ? "live" : "out"}`;
}

/**
 * The pair groups a write touched: both when the group changed (the row's
 * group now first, then the one it left), none when nothing pairing reads moved.
 */
export function pairGroupsTouched(
  before: Pick<IngestionItemFields, "pairGroupKey" | "docKind" | "status">,
  after: Pick<IngestionItemFields, "pairGroupKey" | "docKind" | "status">
): string[] {
  if (before.pairGroupKey !== after.pairGroupKey) return [after.pairGroupKey, before.pairGroupKey];
  if (pairingRole(before) !== pairingRole(after)) return [after.pairGroupKey];
  return [];
}
