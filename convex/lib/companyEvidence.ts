/**
 * How a draft's prompts present the company's files (2026-10-26, Phase C;
 * decision "2026-10-26", part 1): files a company keeps for all its
 * projects, about the company, not necessarily this project or fiscal year,
 * ranked below the project's own evidence. The note goes in a prompt only
 * when the draft froze a company file, so every other prompt is unchanged.
 * Part of the prompt program (convex/ai/promptProgram.ts).
 */

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
