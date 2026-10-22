// Shared classes for buttons in the standard top bar (PageTopBar), so every
// screen's header actions match: 38px, radius 9, 15/20 500, no icons
// (owner, 2026-10-19). The filled main action is PageTopBar's
// `primaryAction`; any other header button uses `topBarSecondary`.
export const topBarSecondary =
  "inline-flex h-[2.375rem] shrink-0 items-center rounded-[0.5625rem] border border-line bg-surface px-4 text-[0.9375rem] font-medium leading-[calc(4/3)] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11";

/** The content inset inside the white work panel on every screen (Projects' main column). */
export const workPanelPadding = "px-4 pb-8 pt-5 sm:px-6";
