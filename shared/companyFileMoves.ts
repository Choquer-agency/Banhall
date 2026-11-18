/**
 * 2026-11-18 (a company holds all its files): a merge moves the merged
 * companies' files to the kept company in steps of 100. While some are
 * still on their way, a draft for a project of that company is refused
 * with this message, so it never reads only part of the company's files.
 * The start dialog shows the same words.
 */
export const COMPANY_FILES_MOVING_MESSAGE =
  "This company's files are still moving here from a merge. Try again in a few minutes.";

/** Files the company page loads per "Show more" (the server caps a page at this size). */
export const COMPANY_FILE_PAGE_SIZE = 100;

/** Files a name search on the company page returns at most. */
export const COMPANY_FILE_SEARCH_LIMIT = 50;
