/**
 * Compact "N ago" phrasing for metadata lines (My Work cards, Home recents).
 * Truthful and coarse on purpose: minutes under an hour, hours under a day,
 * then whole days. Future timestamps (clock skew) collapse to "just now".
 */
function coarseAgo(elapsed: number): string {
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatUpdatedRelative(updatedAt: number, now: number): string {
  return `Updated ${coarseAgo(now - updatedAt)}`;
}

export function formatOpenedRelative(openedAt: number, now: number): string {
  return `Opened ${coarseAgo(now - openedAt)}`;
}
