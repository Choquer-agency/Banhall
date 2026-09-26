/**
 * Plain name for this browser's device, for the Settings "Signed in" line
 * (board I1: "This Mac and 1 other device."). Falls back to "device".
 */
type NavigatorLike = {
  platform?: string;
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean } | null;
};

export function deviceLabel(
  nav: NavigatorLike | undefined = typeof navigator !== "undefined"
    ? (navigator as NavigatorLike)
    : undefined
): string {
  const platform = `${nav?.userAgentData?.platform ?? ""} ${nav?.platform ?? ""}`.toLowerCase();
  const agent = (nav?.userAgent ?? "").toLowerCase();
  if (/iphone|ipod/.test(platform) || /iphone|ipod/.test(agent)) return "iPhone";
  // iPadOS reports "MacIntel" with touch points.
  if (/ipad/.test(platform) || /ipad/.test(agent)) return "iPad";
  if (/mac/.test(platform) && (nav?.maxTouchPoints ?? 0) > 1) return "iPad";
  if (/android/.test(platform) || /android/.test(agent)) return "Android phone";
  if (/mac/.test(platform)) return "Mac";
  if (/win/.test(platform)) return "Windows PC";
  if (/linux|x11|cros/.test(platform)) return "Linux computer";
  return "device";
}

/** "This Mac only.", "This Mac and 1 other device.", "... and 3 other devices." */
export function sessionsLine(device: string, otherSessions: number): string {
  if (otherSessions <= 0) return `This ${device} only.`;
  if (otherSessions === 1) return `This ${device} and 1 other device.`;
  return `This ${device} and ${otherSessions} other devices.`;
}
