/**
 * Review D-3: while a page saves something that must not be left half done
 * (the New project wizard creating and copying a project), it holds in-app
 * navigation. Other `beforeNavigate` hooks, such as the root layout's
 * deploy-update reload, ask here so they do not undo that hold. Kit gives a
 * callback no way to see that another one cancelled the navigation.
 */
const holds = new Set<() => boolean>();

/**
 * Registers a check that says whether the page is saving right now. Returns
 * the function that removes it; call it when the page is destroyed.
 */
export function registerSaveHold(isSaving: () => boolean): () => void {
  holds.add(isSaving);
  return () => {
    holds.delete(isSaving);
  };
}

/** Whether any mounted page is holding navigation for a save. */
export function saveInProgress(): boolean {
  for (const isSaving of holds) {
    if (isSaving()) return true;
  }
  return false;
}

/**
 * How long a save holds navigation before the writer is offered a way to
 * leave anyway. A normal save takes seconds; this is for one that stalled,
 * for example offline, where queued requests wait for the connection.
 */
export const SAVE_HOLD_ESCAPE_MS = 30_000;

/**
 * The root layout's deploy-update rule: after a new deploy, a client-side
 * navigation becomes a full page load so the browser gets fresh chunks. Not
 * while a save holds navigation: that page cancels it, and a full load
 * would leave anyway.
 */
export function shouldReloadForUpdate(
  updated: boolean,
  navigation: { willUnload: boolean; to: { url: URL } | null }
): boolean {
  return updated && !navigation.willUnload && !!navigation.to?.url && !saveInProgress();
}
