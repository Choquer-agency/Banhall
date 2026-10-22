/**
 * The LINE LENGTHS evidence block (owner, 2026-10-21): each Line's form
 * lines and words exactly as the editor's meters show them, so the
 * Assistant can answer a question about a meter ("why does 244 show +3
 * with gaps?") from the numbers on the writer's screen instead of guessing.
 *
 * It uses the editor's own measure (`reportSectionMetrics`), one parser and
 * one CRA line model, so the block and the meters can never disagree.
 */
import { GAP_MARKER_RE } from "../lib/lineLimits";
import { parseCanonicalReport, reportSectionMetrics } from "../../src/lib/reportSections";

const LINES = [
  ["s242", "242"],
  ["s244", "244"],
  ["s246", "246"],
] as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One sentence per Line, or null when the report is not a readable editor
 * document (the block is then left out, never guessed).
 */
export function lineLengthsText(reportContent: string | null): string | null {
  if (!reportContent) return null;
  const report = parseCanonicalReport(reportContent);
  if (report.diagnostics.some((d) => d.code === "MALFORMED_DOCUMENT")) return null;
  const metrics = reportSectionMetrics(reportContent);
  return LINES.map(([key, line]) => {
    const m = metrics[key];
    const gaps = [...report.sections[key].plainText.matchAll(GAP_MARKER_RE)].length;
    const over = [
      m.lines > m.limit ? `${plural(m.lines - m.limit, "form line", "form lines")} over` : null,
      m.words > m.wordCap ? `${plural(m.words - m.wordCap, "word", "words")} over` : null,
    ].filter(Boolean);
    const verdict = over.length ? `${over.join(" and ")} the CRA limit` : "within the CRA limits";
    const meter = `Line ${line}: ${m.lines} of ${m.limit} form lines and ${m.words} of ${m.wordCap} words, ${verdict}.`;
    if (gaps === 0) return `${meter} No [GAP] notes.`;
    const extraLines = m.rawLines - m.lines;
    const extraWords = m.rawWords - m.words;
    const shown = extraLines > 0 ? ` The meter shows this as "(+${extraLines} with gaps)".` : "";
    const notes = gaps === 1 ? "Its one [GAP] note is not counted; counted, it adds" : `Its ${gaps} [GAP] notes are not counted; counted, they add`;
    return `${meter} ${notes} ${plural(extraLines, "form line", "form lines")} and ${plural(extraWords, "word", "words")}.${shown}`;
  }).join("\n");
}

/**
 * What an edit would do to the meters (owner, 2026-10-21): one sentence per
 * Line whose counts change, returned to the model with the edit tool's
 * result. With it the model checks a trim against the real meter instead of
 * tallying words in its thinking, which had a trim think for over three
 * minutes. Null when no meter changes.
 */
export function lineLengthsAfterEdit(beforeContent: string, afterContent: string): string | null {
  const before = reportSectionMetrics(beforeContent);
  const after = reportSectionMetrics(afterContent);
  const changed = LINES.flatMap(([key, line]) => {
    const b = before[key];
    const a = after[key];
    if (a.lines === b.lines && a.words === b.words) return [];
    const verdict = a.lines > a.limit || a.words > a.wordCap ? "over a CRA limit" : "within the CRA limits";
    return [
      `Line ${line} would have ${a.words} of ${a.wordCap} words (now ${b.words}) and ${a.lines} of ${a.limit} form lines (now ${b.lines}), ${verdict}.`,
    ];
  });
  return changed.length ? `Once applied, ${changed.join(" ")}` : null;
}
