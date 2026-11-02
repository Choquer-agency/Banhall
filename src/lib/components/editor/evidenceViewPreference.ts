/**
 * Whether a person last left the Evidence view on (client request
 * 2026-11-02). Browser-local presentation only, one key per user, off by
 * default and when storage is blocked or holds anything unexpected.
 */

const KEY_PREFIX = "banhall.evidenceView.v1:";

export function evidenceViewKeyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadEvidenceViewPreference(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(evidenceViewKeyFor(userId)) === "on";
  } catch {
    return false;
  }
}

export function saveEvidenceViewPreference(userId: string | null | undefined, on: boolean): void {
  if (!userId) return;
  try {
    if (on) localStorage.setItem(evidenceViewKeyFor(userId), "on");
    else localStorage.removeItem(evidenceViewKeyFor(userId));
  } catch {
    // Storage blocked: the choice still holds for this page.
  }
}
