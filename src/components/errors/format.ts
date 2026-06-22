export type ErrorReportLike = {
  kind: "auto" | "manual";
  message: string;
  stack?: string;
  source?: string;
  url: string;
  userNote?: string;
  breadcrumbs: { type: string; label: string; detail?: string; at: number }[];
  userAgent?: string;
  userEmail?: string;
  createdAt: number;
};

const TYPE_ARROW: Record<string, string> = {
  nav: "→ navigated to",
  click: "clicked",
  network: "network",
  console: "console.error",
  error: "ERROR",
};

function formatTime(ts: number): string {
  // Stable, locale-independent-ish timestamp for the report body.
  return new Date(ts).toLocaleString();
}

/**
 * Render a report as a Claude-Code-ready markdown block: paste it straight into
 * a chat and it has everything needed to reproduce and fix the issue.
 */
export function formatReportMarkdown(r: ErrorReportLike): string {
  const lines: string[] = [];
  lines.push(
    `## ${r.kind === "manual" ? "Flagged issue" : "Error report"} — ${formatTime(r.createdAt)}`
  );
  lines.push("");
  lines.push(`**Page:** ${r.url}`);
  if (r.userEmail) lines.push(`**Reported by:** ${r.userEmail}`);
  lines.push(`**Message:** ${r.message || "(no error message — manual flag)"}`);
  if (r.source) lines.push(`**Source:** ${r.source}`);
  if (r.userNote) {
    lines.push("");
    lines.push(`**What the user said:**`);
    lines.push(`> ${r.userNote.replace(/\n/g, "\n> ")}`);
  }

  if (r.stack) {
    lines.push("");
    lines.push(`**Stack trace:**`);
    lines.push("```");
    lines.push(r.stack.trim());
    lines.push("```");
  }

  lines.push("");
  lines.push(`**Recent activity (most recent last):**`);
  if (r.breadcrumbs.length === 0) {
    lines.push("- (none captured)");
  } else {
    for (const b of r.breadcrumbs) {
      const verb = TYPE_ARROW[b.type] ?? b.type;
      const detail = b.detail ? ` — ${b.detail}` : "";
      lines.push(`- [${verb}] ${b.label}${detail}`);
    }
  }

  if (r.userAgent) {
    lines.push("");
    lines.push(`**User agent:** ${r.userAgent}`);
  }

  return lines.join("\n");
}
