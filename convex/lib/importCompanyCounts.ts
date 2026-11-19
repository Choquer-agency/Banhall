// The Import sheet's per-company counts (2026-11-11, phase 2): the
// importCompanies table. Every write to an ingestion item calls
// adjustImportCompanyCounts with the row before and after, and nothing else
// changes the counts, so a band always equals a recount of its files.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { activeClientForKey } from "./clients";
import { isBeingRead, sheetSectionFor } from "./ingestionSheet";
import type { ImportCounts, SheetTab } from "./ingestionSheetValidators";

/** The band key for files with no company yet. */
export const NO_COMPANY_KEY = "";
/** The fiscal year bucket for files with no fiscal year end. */
export const NO_FISCAL_YEAR = "none";

/** The fields of a row the counts read. */
export type CountedRow = Pick<
  Doc<"ingestionItems">,
  | "sheetTab"
  | "companyKey"
  | "category"
  | "fiscalYearEnd"
  | "needsCheck"
  | "checkReasons"
  | "status"
  | "clientName"
  | "isNew"
  | "brainCheck"
>;

/** What one row adds to its band. */
export type CountShare = {
  sheetTab: SheetTab;
  companyKey: string;
  /** The section the row shows in (sheetSectionFor): Not sorted yet ("unknown") while it is being read. */
  category: string;
  fiscalYear: string;
  needsCheck: boolean;
  /** Why it needs a check, each reason once and sorted; empty when it needs none. */
  checkReasons: string[];
  beingRead: boolean;
  /** New (2026-11-12): only a file on To review counts as New. */
  isNew: boolean;
  /** 2026-11-17: an approved final PD waiting for its Brain check (Approved tab only). */
  brainCheck: boolean;
};

/** The fiscal year bucket of a fiscal year end: its UTC year, or "none". */
export function fiscalYearBucket(fiscalYearEnd: number | undefined): string {
  return fiscalYearEnd === undefined ? NO_FISCAL_YEAR : String(new Date(fiscalYearEnd).getUTCFullYear());
}

/** The band a row counts in and what it adds, or null for a row not on the sheet. */
export function countShareOf(row: CountedRow | null | undefined): CountShare | null {
  if (!row || row.sheetTab === undefined || row.category === undefined) return null;
  const needsCheck = row.needsCheck === true;
  return {
    sheetTab: row.sheetTab,
    companyKey: row.companyKey ?? NO_COMPANY_KEY,
    category: sheetSectionFor(row)!,
    fiscalYear: fiscalYearBucket(row.fiscalYearEnd),
    needsCheck,
    // Only a file that needs a check counts under its reasons.
    checkReasons: needsCheck ? [...new Set(row.checkReasons ?? [])].sort() : [],
    beingRead: isBeingRead(row.status),
    isNew: row.sheetTab === "review" && row.isNew === true,
    brainCheck: row.sheetTab === "approved" && row.brainCheck === "waiting",
  };
}

function sameShare(a: CountShare, b: CountShare): boolean {
  return (
    a.sheetTab === b.sheetTab &&
    a.companyKey === b.companyKey &&
    a.category === b.category &&
    a.fiscalYear === b.fiscalYear &&
    a.needsCheck === b.needsCheck &&
    a.checkReasons.length === b.checkReasons.length &&
    a.checkReasons.every((reason, index) => reason === b.checkReasons[index]) &&
    a.beingRead === b.beingRead &&
    a.isNew === b.isNew &&
    a.brainCheck === b.brainCheck
  );
}

export function emptyImportCounts(): ImportCounts {
  return { total: 0, needsCheck: 0, ready: 0, beingRead: 0, categories: {} };
}

/** `record` with `key` moved by `sign`, the key gone at zero. Returns a new object. */
function bump(record: Record<string, number> | undefined, key: string, sign: 1 | -1): Record<string, number> {
  const next = { ...record };
  const value = (next[key] ?? 0) + sign;
  if (value === 0) delete next[key];
  else next[key] = value;
  return next;
}

/**
 * `counts` with one row's share added (sign 1) or taken away (sign -1). A
 * category, year or check reason that reaches zero is removed, and so is a
 * category's reason map once it is empty. A category stored without a reason
 * map (a band row from before it existed) starts from an empty one. The New
 * counts (2026-11-12) work the same way: `newFiles` and a category's
 * `newFiles` and `newFiscalYears` are left out at zero. Returns a new object.
 */
export function addShare(counts: ImportCounts, share: CountShare, sign: 1 | -1): ImportCounts {
  const categories = { ...counts.categories };
  const before = categories[share.category] ?? { total: 0, needsCheck: 0, fiscalYears: {} };
  const fiscalYears = bump(before.fiscalYears, share.fiscalYear, sign);
  let checkReasons = { ...before.checkReasons };
  for (const reason of share.checkReasons) checkReasons = bump(checkReasons, reason, sign);
  const newFiles = (before.newFiles ?? 0) + (share.isNew ? sign : 0);
  const newFiscalYears = share.isNew ? bump(before.newFiscalYears, share.fiscalYear, sign) : { ...before.newFiscalYears };
  const category = {
    total: before.total + sign,
    needsCheck: before.needsCheck + (share.needsCheck ? sign : 0),
    fiscalYears,
    ...(Object.keys(checkReasons).length > 0 ? { checkReasons } : {}),
    ...(newFiles !== 0 ? { newFiles } : {}),
    ...(Object.keys(newFiscalYears).length > 0 ? { newFiscalYears } : {}),
  };
  if (category.total === 0) delete categories[share.category];
  else categories[share.category] = category;
  const bandNew = (counts.newFiles ?? 0) + (share.isNew ? sign : 0);
  const bandBrainCheck = (counts.brainCheck ?? 0) + (share.brainCheck ? sign : 0);
  return {
    total: counts.total + sign,
    needsCheck: counts.needsCheck + (share.needsCheck ? sign : 0),
    ready: counts.ready + (!share.needsCheck && !share.beingRead ? sign : 0),
    beingRead: counts.beingRead + (share.beingRead ? sign : 0),
    ...(bandNew !== 0 ? { newFiles: bandNew } : {}),
    ...(bandBrainCheck !== 0 ? { brainCheck: bandBrainCheck } : {}),
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
    ...(row.newFiles !== undefined && row.newFiles !== 0 ? { newFiles: row.newFiles } : {}),
    ...(row.brainCheck !== undefined && row.brainCheck !== 0 ? { brainCheck: row.brainCheck } : {}),
    categories: row.categories,
  };
}

/** True when any count went below zero, which only drift can cause. */
function hasNegative(counts: ImportCounts): boolean {
  if (counts.total < 0 || counts.needsCheck < 0 || counts.ready < 0 || counts.beingRead < 0) return true;
  if ((counts.newFiles ?? 0) < 0 || (counts.brainCheck ?? 0) < 0) return true;
  return Object.values(counts.categories).some(
    (c) =>
      c.total < 0 ||
      c.needsCheck < 0 ||
      (c.newFiles ?? 0) < 0 ||
      Object.values(c.fiscalYears).some((n) => n < 0) ||
      Object.values(c.checkReasons ?? {}).some((n) => n < 0) ||
      Object.values(c.newFiscalYears ?? {}).some((n) => n < 0)
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
 * The name a band shows (2026-11-11, phase 3b fixes). The rule: the name of
 * the active company with the band's key, when there is one; otherwise the
 * name the band already has, so a later file's spelling ("CEDARLINE
 * SYSTEMS" in one folder) never renames it; otherwise `offered`, the
 * spelling of the file that starts the band. Only a different spelling can
 * change a named band, so the company is read only then, or always with
 * `checkCompany` (a rebuild). The band for files with no company has no name.
 */
export async function bandDisplayName(
  ctx: QueryCtx | MutationCtx,
  companyKey: string,
  stored: string | undefined,
  offered: string | undefined,
  options: { checkCompany?: boolean } = {}
): Promise<string> {
  if (companyKey === NO_COMPANY_KEY) return "";
  const kept = stored?.trim() ? stored : undefined;
  if (!options.checkCompany && kept !== undefined && (offered === undefined || offered === kept)) return kept;
  const company = await activeClientForKey(ctx, companyKey);
  return company?.name ?? kept ?? offered ?? "";
}

/**
 * Write a band's new counts: deleted when the total reaches zero, created
 * when it did not exist. Its name follows bandDisplayName, with `offered`
 * the spelling of the file just written (or, for a rebuild, its earliest).
 */
export async function writeImportCompany(
  ctx: MutationCtx,
  sheetTab: SheetTab,
  companyKey: string,
  existing: Doc<"importCompanies"> | null,
  counts: ImportCounts,
  offered: string | undefined,
  options: { checkCompany?: boolean } = {}
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
    // A band that had New files (or Brain checks) and has none now loses the count.
    newFiles: counts.newFiles,
    brainCheck: counts.brainCheck,
    hasCheck: counts.needsCheck > 0,
    hasNew: (counts.newFiles ?? 0) > 0,
    displayName: await bandDisplayName(ctx, companyKey, existing?.displayName, offered, options),
    updatedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, { ...fields, revision: existing.revision + 1 });
  } else {
    const { newFiles, brainCheck, ...rest } = fields;
    await ctx.db.insert("importCompanies", {
      sheetTab,
      companyKey,
      ...rest,
      ...(newFiles === undefined ? {} : { newFiles }),
      ...(brainCheck === undefined ? {} : { brainCheck }),
      revision: 1,
    });
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
    // Counts unchanged; only the spelling of the client name may have moved,
    // which renames the band only as bandDisplayName allows.
    if (before?.clientName === displayName || displayName === undefined) return;
    if (into.companyKey === NO_COMPANY_KEY) return;
    const existing = await importCompanyRow(ctx, into.sheetTab, into.companyKey);
    if (!existing) return;
    const name = await bandDisplayName(ctx, into.companyKey, existing.displayName, displayName);
    if (name !== existing.displayName) {
      // The revision moves too, so a rebuild running meanwhile starts again
      // rather than write back the name it read before.
      await ctx.db.patch(existing._id, { displayName: name, revision: existing.revision + 1, updatedAt: Date.now() });
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

// ─── Final PD progress (2026-11-17, docs/product-domain.md) ─────────────────
// The progress line on the Import page ("312 of 1,040 final PDs approved")
// and its breakdown by fiscal year and by writer read the
// importFinalPdCounts table, never the files. Only final PDs count, and only
// on To review (staged, not yet approved) and Approved: a deleted file is not
// counted. The staged total is the final PDs added so far, so it grows as
// files arrive; nothing here knows how many PDs the firm has in all.

/** The key of the one total row. */
export const FINAL_PD_TOTAL_KEY = "all";
/** The writer bucket for a final PD with no writer yet. */
export const NO_WRITER_KEY = "none";
/**
 * The writer bucket for a final PD whose name has three or four initials
 * groups (initialsGroups) and no writer: what the groups mean waits for the
 * client (2026-11-17), so it is not sorted to a writer yet.
 */
export const UNSORTED_WRITER_KEY = "unsorted";

type FinalPdTab = "review" | "approved";

/** The fields of a row the final PD counts read. */
export type FinalPdCountedRow = Pick<
  Doc<"ingestionItems">,
  "sheetTab" | "category" | "fiscalYearEnd" | "writerId" | "initialsGroups"
>;

/** Where one final PD counts. */
export type FinalPdShare = {
  tab: FinalPdTab;
  fiscalYear: string;
  /** The writer's id, NO_WRITER_KEY or UNSORTED_WRITER_KEY. */
  writerKey: string;
  writerId?: Id<"pdWriters">;
};

/** Where a row counts, or null for a row that is not a final PD on To review or Approved. */
export function finalPdShareOf(row: FinalPdCountedRow | null | undefined): FinalPdShare | null {
  if (!row || row.category !== "final_pd") return null;
  if (row.sheetTab !== "review" && row.sheetTab !== "approved") return null;
  const fiscalYear = fiscalYearBucket(row.fiscalYearEnd);
  if (row.writerId !== undefined) return { tab: row.sheetTab, fiscalYear, writerKey: row.writerId, writerId: row.writerId };
  const unsorted = (row.initialsGroups?.length ?? 0) > 0;
  return { tab: row.sheetTab, fiscalYear, writerKey: unsorted ? UNSORTED_WRITER_KEY : NO_WRITER_KEY };
}

/** One counter row's change: what is added to its two counts. */
type FinalPdMove = {
  kind: "total" | "year" | "writer";
  key: string;
  writerId?: Id<"pdWriters">;
  review: number;
  approved: number;
};

/** The moves one share makes, signed. */
function finalPdMoves(share: FinalPdShare, sign: 1 | -1): FinalPdMove[] {
  const review = share.tab === "review" ? sign : 0;
  const approved = share.tab === "approved" ? sign : 0;
  return [
    { kind: "total", key: FINAL_PD_TOTAL_KEY, review, approved },
    { kind: "year", key: share.fiscalYear, review, approved },
    { kind: "writer", key: share.writerKey, ...(share.writerId ? { writerId: share.writerId } : {}), review, approved },
  ];
}

/** The stored counter row for a kind and key, or null. */
export async function finalPdCountRow(
  ctx: QueryCtx | MutationCtx,
  kind: FinalPdMove["kind"],
  key: string
): Promise<Doc<"importFinalPdCounts"> | null> {
  return await ctx.db
    .query("importFinalPdCounts")
    .withIndex("by_kind_and_key", (q) => q.eq("kind", kind).eq("key", key))
    // One counter per kind and key: two is broken data and fails loudly. The
    // rebuild reads every row on its own and deletes strays.
    .unique();
}

/**
 * The total row, made with zero counts when it is missing, so its revision
 * can always be read and raised.
 */
export async function ensureFinalPdTotalRow(ctx: MutationCtx): Promise<Doc<"importFinalPdCounts">> {
  const existing = await finalPdCountRow(ctx, "total", FINAL_PD_TOTAL_KEY);
  if (existing) return existing;
  const id = await ctx.db.insert("importFinalPdCounts", {
    kind: "total",
    key: FINAL_PD_TOTAL_KEY,
    review: 0,
    approved: 0,
    revision: 1,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

/**
 * The total row for the rebuild, which must work on the broken data it
 * repairs: it reads up to ten total rows without `.unique()`, keeps the
 * oldest, deletes the rest and makes a zero row when there is none. Every
 * other caller keeps `ensureFinalPdTotalRow`, which fails loudly on two.
 */
export async function collapseFinalPdTotalRows(ctx: MutationCtx): Promise<Doc<"importFinalPdCounts">> {
  const rows = await ctx.db
    .query("importFinalPdCounts")
    .withIndex("by_kind_and_key", (q) => q.eq("kind", "total").eq("key", FINAL_PD_TOTAL_KEY))
    .take(10);
  const [kept, ...extras] = rows;
  for (const extra of extras) await ctx.db.delete(extra._id);
  if (kept) return kept;
  return await ensureFinalPdTotalRow(ctx);
}

/**
 * Keep the final PD counts right after one write to an ingestion item, as
 * adjustImportCompanyCounts does for the bands: take the row's old share
 * out and put the new one in. Writes nothing when neither the tab, the
 * fiscal year nor the writer bucket moved. Every change raises the total
 * row's revision, even one that leaves its counts as they were (a file
 * moved to another writer), so a rebuild running meanwhile starts again.
 *
 * Not handled yet: every final PD writes the total row, so final PDs
 * written at once by separate mutations conflict on it and Convex retries
 * them, as for a company's band. A sync page or an approval step writes many
 * files in one mutation, so this is a slower burst, not a failure.
 */
export async function adjustImportFinalPdCounts(
  ctx: MutationCtx,
  before: FinalPdCountedRow | null,
  after: FinalPdCountedRow | null
): Promise<void> {
  const out = finalPdShareOf(before);
  const into = finalPdShareOf(after);
  if (out && into && out.tab === into.tab && out.fiscalYear === into.fiscalYear && out.writerKey === into.writerKey) return;
  if (!out && !into) return;
  const moves = new Map<string, FinalPdMove>();
  for (const move of [...(out ? finalPdMoves(out, -1) : []), ...(into ? finalPdMoves(into, 1) : [])]) {
    const id = `${move.kind}|${move.key}`;
    const seen = moves.get(id);
    if (seen) {
      seen.review += move.review;
      seen.approved += move.approved;
    } else moves.set(id, { ...move });
  }
  const now = Date.now();
  for (const move of moves.values()) {
    if (move.kind === "total") continue;
    if (move.review === 0 && move.approved === 0) continue;
    const existing = await finalPdCountRow(ctx, move.kind, move.key);
    const review = (existing?.review ?? 0) + move.review;
    const approved = (existing?.approved ?? 0) + move.approved;
    if (review < 0 || approved < 0) {
      // Only a write that skipped this helper, or counts never rebuilt after the deploy, can cause it.
      console.warn("importFinalPdCounts went below zero; run ingestion.rebuildImportFinalPdCounts", {
        kind: move.kind,
        key: move.key,
      });
    }
    if (review === 0 && approved === 0) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      await ctx.db.patch(existing._id, { review, approved, updatedAt: now });
    } else {
      await ctx.db.insert("importFinalPdCounts", {
        kind: move.kind,
        key: move.key,
        ...(move.writerId ? { writerId: move.writerId } : {}),
        review,
        approved,
        updatedAt: now,
      });
    }
  }
  const total = await ensureFinalPdTotalRow(ctx);
  const move = moves.get(`total|${FINAL_PD_TOTAL_KEY}`)!;
  await ctx.db.patch(total._id, {
    review: total.review + move.review,
    approved: total.approved + move.approved,
    revision: (total.revision ?? 0) + 1,
    updatedAt: now,
  });
}
