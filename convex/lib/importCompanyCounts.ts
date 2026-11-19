// The Import sheet's per-company counts (2026-11-11, phase 2): the
// importCompanies table. Every write to an ingestion item calls
// adjustImportCompanyCounts with the row before and after, and nothing else
// changes the counts, so a band always equals a recount of its files.

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isBeingRead } from "./ingestionSheet";
import type { ImportCounts, SheetTab } from "./ingestionSheetValidators";

/** The band key for files with no company yet. */
export const NO_COMPANY_KEY = "";
/** The fiscal year bucket for files with no fiscal year end. */
export const NO_FISCAL_YEAR = "none";

/** The fields of a row the counts read. */
export type CountedRow = Pick<
  Doc<"ingestionItems">,
  "sheetTab" | "companyKey" | "category" | "fiscalYearEnd" | "needsCheck" | "status" | "clientName"
>;

/** What one row adds to its band. */
export type CountShare = {
  sheetTab: SheetTab;
  companyKey: string;
  category: string;
  fiscalYear: string;
  needsCheck: boolean;
  beingRead: boolean;
};

/** The fiscal year bucket of a fiscal year end: its UTC year, or "none". */
export function fiscalYearBucket(fiscalYearEnd: number | undefined): string {
  return fiscalYearEnd === undefined ? NO_FISCAL_YEAR : String(new Date(fiscalYearEnd).getUTCFullYear());
}

/** The band a row counts in and what it adds, or null for a row not on the sheet. */
export function countShareOf(row: CountedRow | null | undefined): CountShare | null {
  if (!row || row.sheetTab === undefined || row.category === undefined) return null;
  return {
    sheetTab: row.sheetTab,
    companyKey: row.companyKey ?? NO_COMPANY_KEY,
    category: row.category,
    fiscalYear: fiscalYearBucket(row.fiscalYearEnd),
    needsCheck: row.needsCheck === true,
    beingRead: isBeingRead(row.status),
  };
}

function sameShare(a: CountShare, b: CountShare): boolean {
  return (
    a.sheetTab === b.sheetTab &&
    a.companyKey === b.companyKey &&
    a.category === b.category &&
    a.fiscalYear === b.fiscalYear &&
    a.needsCheck === b.needsCheck &&
    a.beingRead === b.beingRead
  );
}

export function emptyImportCounts(): ImportCounts {
  return { total: 0, needsCheck: 0, ready: 0, beingRead: 0, categories: {} };
}

/**
 * `counts` with one row's share added (sign 1) or taken away (sign -1). A
 * category or year that reaches zero is removed. Returns a new object.
 */
export function addShare(counts: ImportCounts, share: CountShare, sign: 1 | -1): ImportCounts {
  const categories = { ...counts.categories };
  const before = categories[share.category] ?? { total: 0, needsCheck: 0, fiscalYears: {} };
  const fiscalYears = { ...before.fiscalYears };
  const years = (fiscalYears[share.fiscalYear] ?? 0) + sign;
  if (years === 0) delete fiscalYears[share.fiscalYear];
  else fiscalYears[share.fiscalYear] = years;
  const category = {
    total: before.total + sign,
    needsCheck: before.needsCheck + (share.needsCheck ? sign : 0),
    fiscalYears,
  };
  if (category.total === 0) delete categories[share.category];
  else categories[share.category] = category;
  return {
    total: counts.total + sign,
    needsCheck: counts.needsCheck + (share.needsCheck ? sign : 0),
    ready: counts.ready + (!share.needsCheck && !share.beingRead ? sign : 0),
    beingRead: counts.beingRead + (share.beingRead ? sign : 0),
    categories,
  };
}

/** The counts of a stored band row. */
export function countsOf(row: Doc<"importCompanies">): ImportCounts {
  return {
    total: row.total,
    needsCheck: row.needsCheck,
    ready: row.ready,
    beingRead: row.beingRead,
    categories: row.categories,
  };
}

/** True when any count went below zero, which only drift can cause. */
function hasNegative(counts: ImportCounts): boolean {
  if (counts.total < 0 || counts.needsCheck < 0 || counts.ready < 0 || counts.beingRead < 0) return true;
  return Object.values(counts.categories).some(
    (c) => c.total < 0 || c.needsCheck < 0 || Object.values(c.fiscalYears).some((n) => n < 0)
  );
}

/** The stored band row for a tab and company key, or null. */
export async function importCompanyRow(
  ctx: QueryCtx | MutationCtx,
  sheetTab: SheetTab,
  companyKey: string
): Promise<Doc<"importCompanies"> | null> {
  return await ctx.db
    .query("importCompanies")
    .withIndex("by_sheetTab_and_companyKey", (q) => q.eq("sheetTab", sheetTab).eq("companyKey", companyKey))
    .first();
}

/**
 * Write a band's new counts: deleted when the total reaches zero, created
 * when it did not exist. `displayName` replaces the stored name when given.
 */
export async function writeImportCompany(
  ctx: MutationCtx,
  sheetTab: SheetTab,
  companyKey: string,
  existing: Doc<"importCompanies"> | null,
  counts: ImportCounts,
  displayName: string | undefined
): Promise<void> {
  if (hasNegative(counts)) {
    // Only a write that skipped this helper can cause it. Keep the band
    // (a rebuild puts it right) rather than failing the write.
    console.warn("importCompanies went below zero; run ingestion.rebuildImportCompanyCounts", {
      sheetTab,
      companyKey,
    });
  }
  if (counts.total <= 0) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const fields = {
    ...counts,
    hasCheck: counts.needsCheck > 0,
    displayName: companyKey === NO_COMPANY_KEY ? "" : (displayName ?? existing?.displayName ?? ""),
    updatedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, { ...fields, revision: existing.revision + 1 });
  } else {
    await ctx.db.insert("importCompanies", { sheetTab, companyKey, ...fields, revision: 1 });
  }
}

async function changeBand(
  ctx: MutationCtx,
  sheetTab: SheetTab,
  companyKey: string,
  change: (counts: ImportCounts) => ImportCounts,
  displayName: string | undefined
): Promise<void> {
  const existing = await importCompanyRow(ctx, sheetTab, companyKey);
  const counts = change(existing ? countsOf(existing) : emptyImportCounts());
  await writeImportCompany(ctx, sheetTab, companyKey, existing, counts, displayName);
}

/**
 * Keep the bands right after one write to an ingestion item: take the row's
 * old share out of its band and put the new share into its band (the same
 * band or two). `before` is absent for an insert and `after` for a delete.
 * Writes nothing when the share and the client name did not change.
 *
 * Not handled yet: every file of one company writes the same band row, so
 * many uploads into one company at once conflict on it and retry. The intake
 * phase is to stage uploads in batch inserts, one band write per batch.
 */
export async function adjustImportCompanyCounts(
  ctx: MutationCtx,
  before: CountedRow | null,
  after: CountedRow | null
): Promise<void> {
  const out = countShareOf(before);
  const into = countShareOf(after);
  const displayName = after?.clientName;
  if (out && into && sameShare(out, into)) {
    // Counts unchanged; only the latest client name may have moved.
    if (before?.clientName === displayName || displayName === undefined) return;
    const existing = await importCompanyRow(ctx, into.sheetTab, into.companyKey);
    if (existing && existing.displayName !== displayName && into.companyKey !== NO_COMPANY_KEY) {
      // The revision moves too, so a rebuild running meanwhile starts again
      // rather than write back the name it read before.
      await ctx.db.patch(existing._id, { displayName, revision: existing.revision + 1, updatedAt: Date.now() });
    }
    return;
  }
  if (out && into && out.sheetTab === into.sheetTab && out.companyKey === into.companyKey) {
    await changeBand(ctx, into.sheetTab, into.companyKey, (c) => addShare(addShare(c, out, -1), into, 1), displayName);
    return;
  }
  if (out) await changeBand(ctx, out.sheetTab, out.companyKey, (c) => addShare(c, out, -1), undefined);
  if (into) await changeBand(ctx, into.sheetTab, into.companyKey, (c) => addShare(c, into, 1), displayName);
}
