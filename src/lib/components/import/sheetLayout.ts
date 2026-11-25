/**
 * The Import sheet's one column grid (board ao5), shared by the header, the
 * company bands, the file rows and the search results so every column lines
 * up. At the boards' width File takes the rest; Fiscal year, Version,
 * Writer, Reviewer and Science code each add 8px either side of the light
 * rule at their left edge (the boards' 16px gaps). Indents step 24px:
 * company, section, file.
 *
 * Reviewer (2026-11-17) sits after Writer. To make room the widest Writer
 * and Reviewer are 152px and Fiscal year 104px (Science code keeps its
 * 344px, so a common code title still fits at the boards' width), and on
 * a narrow window File keeps at least 224px while the other five give up
 * room first, down to their own minimums: Fiscal year 80px, Version 60px,
 * Writer 138px (so the required "Choose writer" and a full name such as
 * "Dana Whitlock" stay whole), Reviewer 102px (a short name whole; the
 * quiet "Choose reviewer" is cut, and whole on hover) and Science code
 * 108px, which is the code alone: its title shows once there is room. A
 * grid grows every fixed column to its widest before the File column gets
 * any of the rest. Every column at its minimum is 712px, which still fits
 * the sheet's 714px at a 1100px window; below that (SHEET_MIN_WIDTH) the
 * sheet scrolls sideways in its own area, header and all.
 *
 * Words have room to spare at those minimums (2026-11-17): Linux and
 * Windows draw text about 5% wider than macOS, and CI's Linux browser cut
 * "Choose writer" in a 132px Writer. So Writer took 6px from Reviewer, and
 * "Choose writer", "Dana Whitlock" and "Priya Nair" would still be whole
 * drawn 8% wider than wherever the tests run.
 */
// Written out whole: Tailwind finds a class only as literal text.
// One unified 6-column full-bleed grid shared by the header, every company
// band, every file row, and search results. Because the checkbox lives inside
// the fixed 36px left gutter (`SELECT_GUTTER`) and hierarchy is expressed via
// internal left padding, hovering or toggling Select causes zero column shift
// and rows highlight cleanly edge-to-edge with zero left hover gap.
export const SHEET_GRID = "grid grid-cols-[minmax(14rem,1fr)_minmax(5rem,6.5rem)_minmax(3.75rem,4.75rem)_minmax(8.625rem,9.5rem)_minmax(6.375rem,9.5rem)_minmax(6.75rem,21.5rem)]";

/** Kept for callers; unified grid never shifts columns when selecting or nested. */
export function sheetGrid(_selecting = false, _indented = false): string {
  return SHEET_GRID;
}

/**
 * Fixed 36px left gutter holding the hover-to-select checkbox at the sheet's
 * left edge, aligned identically across company bands, category sections, and
 * file rows with zero horizontal shift.
 */
export const SELECT_GUTTER =
  "absolute inset-y-0 left-0 z-[2] flex w-9 items-center justify-center transition-opacity duration-150 ease-out motion-reduce:transition-none";

/**
 * Every column at its minimum (14 + 5 + 3.75 + 8.625 + 6.375 + 6.75 rem): below this
 * the sheet scrolls sideways instead of squeezing a column.
 */
export const SHEET_MIN_WIDTH = "min-w-[44.5rem]";

/** A fixed column's cell on the header and file rows: the rule, then 8px in. */
export const FIXED_CELL = "flex min-w-0 items-center border-l border-line-soft px-2";

/**
 * The Science code cell of a row with hover actions (quick Delete + "..." menu):
 * actions sit over the cell's end and the cell smoothly makes room on hover,
 * focus, or while a menu is open. Touch screens always keep room.
 */
export const ROW_MENU_ROOM =
  "relative transition-[padding] duration-150 ease-out motion-reduce:transition-none pointer-fine:group-hover/row:pr-[4.5rem] pointer-fine:group-focus-within/row:pr-[4.5rem] pointer-fine:has-[[data-import-row-menu-active]]:pr-[4.5rem] pointer-coarse:pr-[5.75rem]";

/** Room for rows with only the "..." menu (Approved rows). */
export const ROW_SINGLE_MENU_ROOM =
  "relative transition-[padding] duration-150 ease-out motion-reduce:transition-none pointer-fine:group-hover/row:pr-11 pointer-fine:group-focus-within/row:pr-11 pointer-fine:has-[[data-import-row-menu-active]]:pr-11 pointer-coarse:pr-14";

/** 13/18, the sheet's body text. */
export const SHEET_TEXT = "text-[0.8125rem] leading-[calc(18/13)]";

/** 12/16, secondary words (code titles, year splits, "Being read"). */
export const SHEET_SMALL = "text-xs leading-[calc(4/3)]";

/** Amber words: only for something a person must do (the boards' #A8500F, the app's gap-text). */
export const AMBER = "text-gap-text";

/** A label cell's value (year, version, writer, code): secondary ink, as the boards draw it. */
export const CELL_INK = "text-ink-secondary";

/** A value inside a cell's control: secondary ink, ink while its picker is open (Files 5). */
export const CELL_WORDS = "truncate text-ink-secondary transition-colors duration-150 ease-out group-data-[state=open]/cell:text-ink motion-reduce:transition-none";

/** A "Show more" control: primary words at 500 on a compact row. */
export const SHOW_MORE =
  "inline-flex items-center gap-1 rounded-sm text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected transition-colors duration-150 ease-out hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:text-ink-muted motion-reduce:transition-none pointer-coarse:min-h-11";

/**
 * A disclosure button whose hit area covers its whole row (an `after:`
 * overlay), so the row's other words stay plain text but clicking anywhere
 * on it toggles. Later controls in the row sit above it with `relative z-[1]`.
 */
export const ROW_TOGGLE =
  "flex min-w-0 items-center rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-fir";

/**
 * An editable label cell's control (board ao5): the cell's words, the whole
 * cell to click, the primary wash on hover. While its picker is open it is
 * the boards' open cell (Files 5): white, a 1.5px primary-selected ring,
 * radius 7, 26px, the words in ink.
 */
export const CELL_BUTTON =
  "group/cell -mx-2 flex h-[1.625rem] min-w-0 flex-1 items-center gap-1.5 rounded-[0.4375rem] pr-[0.4375rem] pl-2 text-left outline-none transition-[background-color,box-shadow,color] duration-150 ease-out hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir data-[state=open]:bg-surface data-[state=open]:shadow-[inset_0_0_0_1.5px_var(--color-primary-selected)] motion-reduce:transition-none pointer-coarse:h-11";

/** The 11px caret at an editable cell's end, shown on hover, focus and while open. */
export const CELL_CARET =
  "ml-auto shrink-0 text-ink-muted opacity-0 transition-opacity duration-150 ease-out group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 group-data-[state=open]/cell:opacity-100 motion-reduce:transition-none";

/**
 * The amber control for a label a person must pick ("Choose writer",
 * "Pick a code", "Pick an industry"; Paper Files 1).
 */
export const PICK_CONTROL =
  "inline-flex h-[1.5rem] max-w-full min-w-0 items-center gap-1 rounded-lg bg-warning-surface pr-1.5 pl-2 text-xs leading-[calc(4/3)] text-gap-text shadow-[inset_0_0_0_1px_var(--color-import-pick-line)] outline-none transition-[background-color,box-shadow] duration-150 ease-out hover:bg-warning-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-warning-soft motion-reduce:transition-none pointer-coarse:h-11";

/** The 11px caret in a pick control. */
export const PICK_CARET_SIZE = "0.6875rem";

/** A popover card under a cell or over the bar. */
export const POPOVER_CARD = "z-[120] rounded-xl border border-line bg-surface shadow-popover outline-none";

/** A choice row inside a picker. */
export const CHOICE_ROW =
  "flex min-h-[1.875rem] w-full cursor-default items-center gap-2.5 rounded-md px-2 py-1 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink outline-none transition-colors duration-150 ease-out hover:bg-primary-wash focus-visible:bg-primary-wash data-[highlighted]:bg-primary-wash data-[selected]:bg-primary-wash aria-pressed:bg-primary-wash motion-reduce:transition-none pointer-coarse:min-h-11";

/** The confirm line under a picker over the bar ("Move 6 files to Transcripts", board ao6). */
export const CONFIRM_LINE =
  "flex min-h-9 w-full items-center justify-center rounded-md bg-primary-wash px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected transition-colors duration-150 ease-out hover:bg-chrome focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-60 motion-reduce:transition-none pointer-coarse:min-h-11";

/** Danger confirmation button inside delete popovers. */
export const DANGER_CONFIRM_LINE =
  "flex min-h-9 w-full items-center justify-center rounded-md bg-danger-surface px-3 text-[0.8125rem] leading-[calc(18/13)] font-medium text-danger-ink-muted transition-colors duration-150 ease-out hover:bg-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-60 motion-reduce:transition-none pointer-coarse:min-h-11";
