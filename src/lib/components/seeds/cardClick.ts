/**
 * A click on a seed card's body toggles its pick like the checkbox (owner,
 * 2026-09-28), but only when it is a single click (Greptile G5). The first
 * click of a double click arrives before any text is selected, so acting on
 * it at once would change the pick; the gate holds a single click for the
 * double-click window and drops it when a second click, a drag or a text
 * selection follows. The checkbox and the keyboard never pass through here.
 */

/** About the platform double-click window. */
export const CARD_CLICK_DELAY_MS = 250;

/** Pointer travel, in pixels, that turns a press into a drag. */
const DRAG_DISTANCE = 4;

export type CardClickGate = {
  /** A press inside the card body: a pending click is dropped (a second
   * click or the start of a drag), and a new gesture starts here. */
  pointerDown(x: number, y: number): void;
  /** Pointer travel while pressed: past a few pixels it is a drag. */
  pointerMove(x: number, y: number): void;
  /** A click on the body that passed the card's own checks. `detail` is the
   * click count; the last click of a double or triple click never acts. */
  click(detail: number): void;
  /** Drops a pending click (the card closed or stopped toggling). */
  cancel(): void;
  /** Whether a click is waiting for the double-click window to end. */
  readonly pending: boolean;
};

export function createCardClickGate(
  act: () => void,
  options: { delay?: number; textSelected?: () => boolean } = {}
): CardClickGate {
  const delay = options.delay ?? CARD_CLICK_DELAY_MS;
  const textSelected = options.textSelected ?? (() => false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let dragged = false;

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return {
    pointerDown(x, y) {
      cancel();
      start = { x, y };
      dragged = false;
    },
    pointerMove(x, y) {
      if (start && Math.hypot(x - start.x, y - start.y) > DRAG_DISTANCE) dragged = true;
    },
    click(detail) {
      const wasDrag = dragged;
      start = null;
      dragged = false;
      if (detail > 1 || wasDrag || textSelected()) {
        cancel();
        return;
      }
      cancel();
      timer = setTimeout(() => {
        timer = null;
        // A selection made during the window (a slow second click) still wins.
        if (!textSelected()) act();
      }, delay);
    },
    cancel,
    get pending() {
      return timer !== null;
    },
  };
}
