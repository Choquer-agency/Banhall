// Copy and dates for the Projects page card (Paper Z11a, 2026-10-19).
import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";

/** A full date, "October 14, 2026", as the cards show Created and Updated. */
export function longDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** What the person is doing, by the handoff kind label (shared/workItems.ts). */
const HANDOFF_PHRASES: Record<string, string | undefined> = {
  "Internal review": "internal review",
  Revision: "revisions",
  "Interview follow-up": "an interview follow-up",
  "Delivery preparation": "delivery preparation",
  Financial: "the financial review",
};

const AI_LINES = {
  generating: "AI is writing the report",
  awaiting_selection: "Drafts ready to choose from",
  awaiting_input: "A section needs your review",
} as const;

/**
 * The card's footer line: what is happening now, or nothing. AI work comes
 * first (with the AI mark), then the open blocking handoff ("With Maya Chen
 * for internal review").
 */
export function cardStatusLine(row: Pick<ProjectsTableRow, "generationActivity" | "handoff">): { text: string; ai: boolean } | null {
  if (row.generationActivity) return { text: AI_LINES[row.generationActivity], ai: true };
  if (row.handoff) {
    const due = row.handoff.dueDate ? `, due ${row.handoff.dueDate}` : "";
    const what = HANDOFF_PHRASES[row.handoff.kindLabel];
    return { text: `With ${row.handoff.assigneeLabel}${what ? ` for ${what}` : ""}${due}`, ai: false };
  }
  return null;
}
