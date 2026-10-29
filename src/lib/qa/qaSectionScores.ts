import { qaScorecardSchema } from "../../../shared/qaScorecard";
import { issueDeduction } from "$lib/qaScoring";

/**
 * Maps a stored QA scorecard to the rows of the "QA finished" notice
 * (ui-design-final.md section 7, board 4.5).
 *
 * Scorecards are stored under `agentOutputs.qa` (convex/ai/qaAgent.ts,
 * `QAScorecard`): `overall_score` plus `section_scores` keyed by T661 line
 * ("242", "244", "246"). The model may omit a section, so rows come from the
 * entries that exist, in line order. Scores are the stored ones; the QA panel
 * applies writer severity overrides on top, which a fresh result never has.
 */
export interface QaSectionScoreRow {
  key: string;
  /** "242" */
  number: string;
  /** Short name for the notice: "Uncertainty", "Work performed", "Advancement". */
  name: string;
  score: number;
}

export interface QaSectionScores {
  overall: number;
  sections: QaSectionScoreRow[];
}

const SECTION_NAMES: Record<string, string> = {
  "242": "Uncertainty",
  "244": "Work performed",
  "246": "Advancement",
};

function lineNumber(key: string): string {
  const match = key.match(/\d{3}/);
  return match ? match[0] : key;
}

function unwrap(input: unknown): unknown {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  // Accept the whole agentOutputs object as well as the scorecard itself.
  if (
    value &&
    typeof value === "object" &&
    !("overall_score" in value) &&
    "qa" in value
  ) {
    return unwrap((value as { qa: unknown }).qa);
  }
  return value;
}

/**
 * @param agentOutputsQa the scorecard (`agentOutputs.qa`), or the raw
 *   `agentOutputs` JSON string / object that contains it.
 * @returns null when there is no readable scorecard.
 */
export function qaSectionScores(agentOutputsQa: unknown): QaSectionScores | null {
  const raw = unwrap(agentOutputsQa);
  if (raw == null) return null;
  const parsed = qaScorecardSchema.safeParse(raw);
  if (!parsed.success) return null;
  const sections = Object.entries(parsed.data.section_scores)
    .map(([key, section]) => {
      const number = lineNumber(key);
      return {
        key,
        number,
        name: SECTION_NAMES[number] ?? `Section ${number}`,
        score: Math.round(section.score),
      };
    })
    .sort((a, b) => {
      const na = Number.parseInt(a.number, 10);
      const nb = Number.parseInt(b.number, 10);
      const oa = Number.isNaN(na) ? Number.MAX_SAFE_INTEGER : na;
      const ob = Number.isNaN(nb) ? Number.MAX_SAFE_INTEGER : nb;
      return oa - ob || a.key.localeCompare(b.key);
    });
  return { overall: Math.round(parsed.data.overall_score), sections };
}

/** "Just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function qaFinishedAgo(completedAt: number | null | undefined, now: number): string {
  if (completedAt == null) return "Just now";
  const elapsed = now - completedAt;
  if (elapsed < 60_000) return "Just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export interface QaTopIssue {
  /** "242" */
  line: "242" | "244" | "246";
  /** The issue's first sentence, at most 160 characters. */
  text: string;
}

const QA_LINES = new Set(["242", "244", "246"]);
const ISSUE_TEXT_MAX = 160;

/** The first sentence, without an older scorecard's "Deduct N points" lead, cut on a word. */
function issueSummary(text: string): string {
  const plain = text
    .replace(/\bDeduct\s+\d+(?:\.\d+)?\s+points?\b[:.]?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain;
  if (sentence.length <= ISSUE_TEXT_MAX) return sentence;
  const cut = sentence.slice(0, ISSUE_TEXT_MAX + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut.slice(0, ISSUE_TEXT_MAX)).replace(/[\s,;:]+$/, "")}…`;
}

/**
 * Owner 2026-10-29: a new conversation's options name the last QA run's
 * issues. One per Line, its costliest deduction (warnings and zero-point
 * issues cost nothing and are left out), costliest Line first. The writer's
 * own severity overrides are not read here; the QA panel applies them.
 */
export function qaTopIssues(agentOutputsQa: unknown): QaTopIssue[] {
  const raw = unwrap(agentOutputsQa);
  if (raw == null) return [];
  const parsed = qaScorecardSchema.safeParse(raw);
  if (!parsed.success) return [];
  const top: Array<QaTopIssue & { points: number }> = [];
  for (const [key, section] of Object.entries(parsed.data.section_scores)) {
    const line = lineNumber(key);
    if (!QA_LINES.has(line)) continue;
    let best: { text: string; points: number } | null = null;
    for (const issue of section.issues) {
      const points = issueDeduction(issue);
      if (points > 0 && (!best || points > best.points)) best = { text: issue.text, points };
    }
    const text = best ? issueSummary(best.text) : "";
    if (best && text) top.push({ line: line as QaTopIssue["line"], text, points: best.points });
  }
  return top
    .sort((a, b) => b.points - a.points || a.line.localeCompare(b.line))
    .map(({ line, text }) => ({ line, text }));
}
