// C4 menu values shared by the Team row menus (pending invite and member).

/** 28px trigger, radius 6, the 16px more icon in ink-muted (C1, C4). */
export const ROW_MENU_TRIGGER =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-primary-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:size-11";

/** Menu card: 6px padding, radius 12, line border, the menu shadow. */
export const MENU_CONTENT = "z-[100] rounded-xl border border-line bg-surface p-1.5 shadow-menu outline-none";

/** 32px item, 8px sides, radius 6, 8px gap, 13/19 text; hover is the rail's selected fill. */
export const MENU_ITEM =
  "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[13px] leading-[19px] outline-none data-[highlighted]:bg-workspace-rail-selected";
