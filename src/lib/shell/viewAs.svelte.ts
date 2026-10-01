/**
 * View as store (round 2, D1 to D5). Presentation only: see `viewAsModel.ts`.
 * The chosen role lives in sessionStorage under `banhall.viewAs.v1`, so it is
 * tab-scoped and survives a reload. Sign-out clears it. Consumers call
 * `effectiveViewer(user)` and never read the raw user for rail or gate
 * decisions.
 */
import {
  VIEW_AS_STORAGE_KEY,
  effectiveViewer as resolveEffectiveViewer,
  enterViewAs,
  exitViewAs,
  parseViewAsRole,
  undoViewAs,
  type EffectiveViewer,
  type RealViewer,
  type ViewAsRole,
  type ViewAsState,
} from "./viewAsModel";

export * from "./viewAsModel";

function readStored(): ViewAsRole | null {
  try {
    return parseViewAsRole(sessionStorage.getItem(VIEW_AS_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeStored(role: ViewAsRole | null) {
  try {
    if (role) sessionStorage.setItem(VIEW_AS_STORAGE_KEY, role);
    else sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
  } catch {
    // Storage blocked: the in-memory choice still applies for this page.
  }
}

class ViewAsStore {
  #state = $state<ViewAsState>({ role: typeof window === "undefined" ? null : readStored() });
  /** Set by the shell so the dialog can be opened from the menu or Shift V. */
  dialogOpen = $state(false);

  get role(): ViewAsRole | null {
    return this.#state.role;
  }

  get canUndo(): boolean {
    return this.#state.previous !== undefined;
  }

  #apply(next: ViewAsState) {
    this.#state = next;
    writeStored(next.role);
  }

  enter(role: ViewAsRole) {
    this.#apply(enterViewAs(this.#state, role));
  }

  switchTo(role: ViewAsRole) {
    this.#apply(enterViewAs(this.#state, role));
  }

  exit() {
    this.#apply(exitViewAs(this.#state));
  }

  undo() {
    this.#apply(undoViewAs(this.#state));
  }

  /** Sign-out: forget the view entirely (no undo). */
  clear() {
    this.#apply({ role: null });
  }

  /** Test hook: re-read storage as a fresh page load would. */
  reload() {
    this.#state = { role: readStored() };
  }
}

export const viewAs = new ViewAsStore();

/** The viewer for rail and gate decisions: the View as role for developers. */
export function effectiveViewer(user: RealViewer): EffectiveViewer {
  return resolveEffectiveViewer(user, viewAs.role);
}
