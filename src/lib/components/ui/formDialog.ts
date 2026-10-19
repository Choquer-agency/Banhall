// Shared classes for FormDialog hosts (Paper Z7m, 2026-10-19), so Edit
// details, bulk edit, New client and Merge clients read as one frame.

/** A field label: 13/16 500, secondary ink. */
export const formLabel = "text-[0.8125rem] leading-4 font-medium text-ink-secondary";

/** A text input or picker trigger: 36px, radius 8, 14px text (add `field-control`). */
export const formField =
  "h-9 w-full rounded-lg px-3 text-sm leading-[1.125rem] text-ink placeholder:text-ink-muted pointer-coarse:h-11";

/** A picker trigger button laid out like a field (add `field-control`). */
export const formPicker = `${formField} flex items-center gap-2 text-left`;

/** SelectInput / IndustrySelect sized like the other fields. */
export const formSelect =
  "[&_input]:h-9! [&_input]:rounded-lg! [&_input]:px-3! [&_input]:text-sm! [&_input]:placeholder:text-ink-muted! pointer-coarse:[&_input]:h-11! [&_button]:right-1!";

/** A field's error line. */
export const formError = "text-[0.8125rem] leading-[1.125rem] text-danger-ink-muted";

/** The footer's Cancel: white with a line border. */
export const formCancel =
  "flex h-9 shrink-0 items-center rounded-lg border border-line bg-surface px-3.5 text-sm leading-[1.125rem] font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11";

/** The footer's main action. */
export const formPrimary =
  "flex h-9 shrink-0 items-center rounded-lg bg-primary-selected px-3.5 text-sm leading-[1.125rem] font-medium text-white transition-colors hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11";

/** A small text action under a field, on the right (bulk edit's Reset). */
export const formFieldAction =
  "rounded text-xs leading-4 font-medium text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy pointer-coarse:min-h-11";
