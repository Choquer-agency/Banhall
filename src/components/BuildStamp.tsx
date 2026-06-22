"use client";

/**
 * BNH-28: shows the last published date/time so users can tell whether they're
 * looking at the most recently deployed version. The value is baked in at build
 * time (see `env.NEXT_PUBLIC_BUILD_TIME` in next.config.ts) and refreshes on each
 * Vercel deployment. Formatting is pinned to a fixed timezone so the server and
 * client render the same string (no hydration mismatch).
 */

const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME;
const TIME_ZONE = "America/Vancouver";

function formatBuildTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(d);
  return `${date} at ${time}`;
}

export function BuildStamp({ className = "" }: { className?: string }) {
  if (!BUILD_TIME) return null;
  const formatted = formatBuildTime(BUILD_TIME);
  if (!formatted) return null;

  return (
    <span
      title={`Last updated: ${formatted}`}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${className}`}
    >
      <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>Last updated: {formatted}</span>
    </span>
  );
}
