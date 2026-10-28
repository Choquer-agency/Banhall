// Shared classes for buttons in the standard top bar (PageTopBar), so every
// screen's header actions match: 38px, radius 9, 15/20 500, no icons
// (owner, 2026-10-19). The filled main action is PageTopBar's
// `primaryAction`; any other header button uses `topBarSecondary`.
export const topBarSecondary =
  "inline-flex h-[2.375rem] shrink-0 items-center rounded-[0.5625rem] border border-line bg-surface px-4 text-[0.9375rem] font-medium leading-[calc(4/3)] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11";

/** The page bar's one filled main button (`primaryAction`): 38px, radius 9, 15/20 500. */
export const topBarPrimary =
  "inline-flex h-[2.375rem] shrink-0 items-center rounded-[0.5625rem] bg-primary-selected px-4 text-[0.9375rem] font-medium leading-[calc(4/3)] text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11";

/**
 * The content inset inside the white card on every screen (the page frame,
 * owner 2026-10-28; Paper S9 and S11): the page top bar and the content share
 * one edge, 32px in from the card or its sidebar on a desktop (the boards'
 * 24px main column plus 8px), 24px on a tablet and 16px on a phone. The bar
 * sits inside the card, so the content starts 4px under it.
 */
export const workPanelPadding = "px-4 pb-8 pt-1 sm:px-6 lg:px-8";

/** The same side inset for a bar or row that pads itself. */
export const workPanelInline = "px-4 sm:px-6 lg:px-8";
