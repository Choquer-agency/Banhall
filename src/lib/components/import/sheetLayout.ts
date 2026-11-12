/**
 * The Import sheet's one column grid (board ao5), shared by the header, the
 * company bands, the file rows and the search results so every column lines
 * up. File takes the rest; Fiscal year 96px, Version 60px, Writer 172px and
 * Science code 328px each add 8px either side of the light rule at their
 * left edge (the boards' 16px gaps). Indents step 24px: company, section, file.
 */
export const SHEET_GRID = "grid grid-cols-[minmax(0,1fr)_7rem_4.75rem_11.75rem_21.5rem]";

/** Below this the sheet scrolls sideways instead of squeezing the File column. */
export const SHEET_MIN_WIDTH = "min-w-[54rem]";

/** A fixed column's cell on the header and file rows: the rule, then 8px in. */
export const FIXED_CELL = "flex min-w-0 items-center border-l border-line-soft px-2";

/** 13/18, the sheet's body text. */
export const SHEET_TEXT = "text-[0.8125rem] leading-[calc(18/13)]";

/** 12/16, secondary words (code titles, year splits, "Being read"). */
export const SHEET_SMALL = "text-xs leading-[calc(4/3)]";

/** Amber words: only for something a person must do. */
export const AMBER = "text-warning-ink-muted";

/** A "Show more" control: primary words on a 40px row. */
export const SHOW_MORE =
  "inline-flex items-center gap-1 rounded-sm text-[0.8125rem] leading-[calc(18/13)] text-primary-selected transition-colors hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:text-ink-muted motion-reduce:transition-none pointer-coarse:min-h-11";

/**
 * A disclosure button whose hit area covers its whole row (an `after:`
 * overlay), so the row's other words stay plain text but clicking anywhere
 * on it toggles. Later controls in the row sit above it with `relative z-[1]`.
 */
export const ROW_TOGGLE =
  "flex min-w-0 items-center rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-fir";
