/**
 * How a draft's prompts present the company's files (2026-10-26, Phase C;
 * decision "2026-10-26", part 1): files a company keeps for all its
 * projects, about the company, not necessarily this project or fiscal year,
 * ranked below the project's own evidence. The note goes in a prompt only
 * when the draft froze a company file, so every other prompt is unchanged.
 * Part of the prompt program (convex/ai/promptProgram.ts).
 */
import type { Doc } from "../_generated/dataModel";

/** The note before the first company file in the analyzer, Brief and Seed prompts. */
export const COMPANY_FILES_NOTE =
  "The files marked as company files are kept by the company for all its projects. They describe the company, not necessarily this project or this fiscal year. Use them for background, rank them below this project's own transcripts and files, and never present work they describe as this year's work unless this project's own evidence says so.";

/** The analyzer's block label prefix for a company file. */
export const COMPANY_FILE_LABEL_PREFIX = "COMPANY FILE, ";

/** What a viewer who may not read company files sees for one's name. */
export const COMPANY_FILE_HIDDEN_LABEL = "company file";

/**
 * A frozen row's label as a viewer sees it: a company file's name only for
 * one who may read company files (Phase C review, 2026-10-26).
 */
export function visibleSourceLabel(kind: string, label: string, mayReadCompanyFiles: boolean): string {
  return kind === "company_file" && !mayReadCompanyFiles ? COMPANY_FILE_HIDDEN_LABEL : label;
}

/**
 * 2026-11-17 (company history): the categories an approved Import file keeps
 * on its company page. Only Import sets them; a person picks among the
 * other (hand-added) categories in Edit details. A draft reads a final PD
 * of the two fiscal years before the project's (`draftCompanyFiles` in
 * lib/briefEvidence.ts) and none of the others; chat searches them all.
 */
export const COMPANY_HISTORY_CATEGORIES = ["final_pd", "draft", "review_copy", "transcript", "supporting"] as const;
export type CompanyHistoryCategory = (typeof COMPANY_HISTORY_CATEGORIES)[number];

/** The categories a person gives a file added by hand, and "no category". */
export const HAND_COMPANY_FILE_CATEGORIES = ["previous_pd", "scoping_notes", "writer_notes", "background", "other", undefined] as const;
export type HandCompanyFileCategory = (typeof HAND_COMPANY_FILE_CATEGORIES)[number];

/**
 * Type check (review, 2026-11-17): the two lists together are exactly the
 * schema's `companyFiles.category`, so a category added to the schema and
 * to neither list fails to compile.
 */
type SameSet<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const categoryListsMatchSchema: SameSet<Doc<"companyFiles">["category"], CompanyHistoryCategory | HandCompanyFileCategory> = true;
void categoryListsMatchSchema;

export function isCompanyHistoryCategory(category: string | null | undefined): category is CompanyHistoryCategory {
  return (COMPANY_HISTORY_CATEGORIES as readonly (string | null | undefined)[]).includes(category);
}

/** A PD number compared without case, spaces or leading zeros ("04" is "4"); null for none. */
export function pdNumberKey(value: string | undefined): string | null {
  const key = value?.trim().toUpperCase().replace(/^0+(?=\d)/, "");
  return key ? key : null;
}

/** Excerpts one search keeps from one PD's versions (its final, drafts and review copies). */
export const VERSION_FAMILY_EXCERPTS = 2;

/**
 * A company file's version family (2026-11-17): a final PD, its drafts and
 * its review copies of one fiscal year and PD number are one family; any
 * other file is its own.
 */
export function versionFamily(file: {
  _id: string;
  category?: string | null;
  fiscalYear?: number | null;
  pdNumber?: string;
}): string {
  const number = pdNumberKey(file.pdNumber);
  if ((file.category === "final_pd" || file.category === "draft" || file.category === "review_copy") && typeof file.fiscalYear === "number" && number) {
    return `pd:${file.fiscalYear}:${number}`;
  }
  return `file:${file._id}`;
}

/**
 * Search hits with version families collapsed (2026-11-17, the research's
 * draft evidence rule): a PD family keeps at most VERSION_FAMILY_EXCERPTS
 * hits, its final PD's first, then the best ranked; a file of its own keeps
 * up to `perFile`. Families stay in relevance order: a family's kept hits
 * take the places its best-ranked hits held, final PD first, so a caller
 * that cuts the list to its remaining places keeps the final PD before a
 * sibling draft or review copy (review, 2026-11-17).
 */
export function collapseVersionFamilies<T extends { family: string; final: boolean }>(hits: readonly T[], perFile: number): T[] {
  const families = new Map<string, number[]>();
  hits.forEach((hit, index) => {
    const indices = families.get(hit.family);
    if (indices) indices.push(index);
    else families.set(hit.family, [index]);
  });
  const places = new Map<number, T>();
  for (const [family, indices] of families) {
    const cap = family.startsWith("pd:") ? VERSION_FAMILY_EXCERPTS : perFile;
    const ordered = [...indices].sort((a, b) => Number(hits[b]!.final) - Number(hits[a]!.final) || a - b).slice(0, cap);
    // `indices` is ascending: the family's best-ranked places, in order.
    ordered.forEach((index, rank) => places.set(indices[rank]!, hits[index]!));
  }
  return [...places.entries()].sort(([a], [b]) => a - b).map(([, hit]) => hit);
}
