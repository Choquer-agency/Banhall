/**
 * The Import sheet's one column grid (board ao5), shared by the header, the
 * company bands, the file rows and the search results so every column lines
 * up. At the boards' width File takes the rest; Fiscal year 96px, Version
 * 60px, Writer 172px and Science code 328px each add 8px either side of the
 * light rule at their left edge (the boards' 16px gaps). Indents step 24px:
 * company, section, file.
 *
 * On a narrower window (live QA fixes, 2026-11-11) File keeps at least 280px
 * and the other four give up room first, down to their own minimums (Fiscal
 * year 80px, Version 64px, Writer 120px, Science code 144px): a grid grows
 * every fixed column to its widest before the File column gets any of the
 * rest. Below the width where every column is at its minimum (SHEET_MIN_WIDTH)
 * the sheet scrolls sideways in its own area, header and all.
 */
export const SHEET_GRID =
  "grid grid-cols-[minmax(17.5rem,1fr)_minmax(5rem,7rem)_minmax(4rem,4.75rem)_minmax(7.5rem,11.75rem)_minmax(9rem,21.5rem)]";

/**
 * The same grid with Select on (board ao4): a 36px checkbox column first.
 * The File column gives up the room (its minimum too), so no other column moves.
 */
export const SHEET_GRID_SELECT =
  "grid grid-cols-[2.25rem_minmax(15.25rem,1fr)_minmax(5rem,7rem)_minmax(4rem,4.75rem)_minmax(7.5rem,11.75rem)_minmax(9rem,21.5rem)]";

/**
 * The grids of a file row inside a company, which starts 24px in (the
 * company's sections are indented). Its File minimum is 24px less, so the
 * other columns get exactly the room they get in the header and line up
 * with it at every width, while they are still growing as much as when
 * they are at their widest.
 */
export const SHEET_GRID_INDENTED =
  "grid grid-cols-[minmax(16rem,1fr)_minmax(5rem,7rem)_minmax(4rem,4.75rem)_minmax(7.5rem,11.75rem)_minmax(9rem,21.5rem)]";
export const SHEET_GRID_INDENTED_SELECT =
  "grid grid-cols-[2.25rem_minmax(13.75rem,1fr)_minmax(5rem,7rem)_minmax(4rem,4.75rem)_minmax(7.5rem,11.75rem)_minmax(9rem,21.5rem)]";

/** The grid for a row: with Select on or off, and 24px in (a file inside a company) or not. */
export function sheetGrid(selecting: boolean, indented = false): string {
  if (indented) return selecting ? SHEET_GRID_INDENTED_SELECT : SHEET_GRID_INDENTED;
  return selecting ? SHEET_GRID_SELECT : SHEET_GRID;
}

/**
 * The checkbox cell, 9px in so every box lines up at the sheet's left edge.
 * Above a row's whole-row toggle (`relative z-[1]`).
 */
export const SELECT_CELL = "relative z-[1] flex min-w-0 items-center pl-[0.5625rem]";

/**
 * The checkbox cell of a row inside a company (24px in): it reaches back to
 * the sheet's edge, so its box lines up with the company's, and the row's
 * own words keep their indent. 60px wide, 36px of it in the row.
 */
export const SELECT_CELL_NESTED = `${SELECT_CELL} -ml-6 w-[3.75rem] shrink-0`;

/**
 * Every column at its minimum (17.5 + 5 + 4 + 7.5 + 9 rem): below this the
 * sheet scrolls sideways instead of squeezing a column.
 */
export const SHEET_MIN_WIDTH = "min-w-[43rem]";

/** A fixed column's cell on the header and file rows: the rule, then 8px in. */
export const FIXED_CELL = "flex min-w-0 items-center border-l border-line-soft px-2";

/**
 * The Science code cell of a row with a "..." menu (live QA fixes): the menu
 * sits over the cell's end, and the cell makes room for it only while the
 * row is hovered, holds focus or has its menu open (a 28px button 8px in,
 * clear of the cell control's 6px bleed), so a science code title has the
 * whole cell the rest of the time. A touch screen has no hover: there the
 * room (for a 44px button) is always kept.
 */
export const ROW_MENU_ROOM =
  "relative pointer-fine:group-hover/row:pr-11 pointer-fine:group-focus-within/row:pr-11 pointer-fine:has-[[data-import-row-menu-active]]:pr-11 pointer-coarse:pr-14";

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

/**
 * An editable label cell's control (board ao5): the cell's words, the whole
 * cell to click, the primary wash on hover and while its picker is open.
 * It is the cell's one tab stop.
 */
export const CELL_BUTTON =
  "group/cell -mx-1.5 flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left outline-none transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir data-[state=open]:bg-primary-wash motion-reduce:transition-none pointer-coarse:h-11";

/** The caret at an editable cell's end, shown on hover, focus and while open. */
export const CELL_CARET =
  "ml-auto shrink-0 text-ink-muted opacity-0 transition-opacity group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 group-data-[state=open]/cell:opacity-100 motion-reduce:transition-none";

/** The amber control for a label a person must pick ("Pick a writer", board ao5). */
export const PICK_CONTROL =
  "inline-flex h-6 min-w-0 shrink-0 items-center gap-1 rounded-md bg-warning-surface px-2 text-xs leading-[calc(4/3)] text-warning-ink-muted shadow-[inset_0_0_0_1px_var(--color-warning-line)] outline-none transition-colors hover:bg-warning-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-warning-soft motion-reduce:transition-none pointer-coarse:h-11";

/** A popover card under a cell or over the bar. */
export const POPOVER_CARD = "z-[120] rounded-xl border border-line bg-surface shadow-popover outline-none";

/** A choice row inside a picker. */
export const CHOICE_ROW =
  "flex min-h-[1.875rem] w-full cursor-default items-center gap-2.5 rounded-md px-2 py-1 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink outline-none transition-colors hover:bg-primary-wash focus-visible:bg-primary-wash data-[highlighted]:bg-primary-wash data-[selected]:bg-primary-wash aria-pressed:bg-primary-wash motion-reduce:transition-none pointer-coarse:min-h-11";

/** The confirm line under a picker over the bar ("Move 6 files to Transcripts", board ao6). */
export const CONFIRM_LINE =
  "flex min-h-9 w-full items-center justify-center rounded-md bg-primary-wash px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected transition-colors hover:bg-chrome focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-60 motion-reduce:transition-none pointer-coarse:min-h-11";
