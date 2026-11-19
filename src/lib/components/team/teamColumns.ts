// The Team people grid (C1), shared by the members table and Past writers
// (owner, 2026-11-17: "same layout as above") so their columns cannot
// drift: Name (260), Initials (56), Email (flex), Role (120), Last active
// (110), with the Admin's 28px row menu over the right end of Last active.
// 36px header (12/16 muted on canvas), 48px rows, 13/19 cells.

/** The table's own width before it scrolls sideways. */
export const PEOPLE_TABLE = "min-w-[44rem]";
/** The table's frame (a 10px-radius soft border, scrolling sideways on a narrow window). */
export const PEOPLE_FRAME = "flex shrink-0 scroll-mt-4 flex-col overflow-x-auto rounded-[0.625rem] border border-line-soft";

export const PEOPLE_HEADER_ROW =
  "flex h-9 items-center gap-4 border-b border-line-soft bg-canvas px-4 text-xs leading-[calc(4/3)] text-ink-muted";
export const PEOPLE_ROW = "relative flex h-12 items-center gap-4 border-b border-line-soft px-4 last:border-b-0";

export const NAME_COLUMN = "w-[16.25rem] shrink-0";
export const INITIALS_COLUMN = "w-[3.5rem] shrink-0";
export const EMAIL_COLUMN = "min-w-0 flex-1";
export const ROLE_COLUMN = "w-[7.5rem] shrink-0";
export const LAST_ACTIVE_COLUMN = "w-[6.875rem] shrink-0";
/** Room for the row menu at the right end of Last active. */
export const MENU_ROOM = "pr-8";
/** Where the 28px row menu sits. */
export const MENU_CELL = "absolute right-4 top-1/2 flex w-7 -translate-y-1/2 justify-end";

/** A name: 13/19, weight 500, ink. */
export const NAME_TEXT = "truncate text-[0.8125rem] leading-[calc(19/13)] font-medium text-ink";
/** Initials and email: 13/19, secondary ink. */
export const QUIET_TEXT = "truncate text-[0.8125rem] leading-[calc(19/13)] text-ink-secondary";
/** Last active: 13/19, muted ink. */
export const MUTED_TEXT = "truncate text-[0.8125rem] leading-[calc(19/13)] text-ink-muted";

/**
 * A quiet tag in the role chip's place and size (RoleChip "md": 20px,
 * radius 5, 12/16 weight 500), neutral: "No login" on a past writer.
 */
export const NEUTRAL_CHIP =
  "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-[0.3125rem] bg-chrome px-[0.4375rem] text-xs leading-[calc(4/3)] font-medium text-ink-secondary";
