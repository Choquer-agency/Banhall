/**
 * Owner 2026-10-28 (Paper O4, "Get started") and 2026-10-29: a new
 * conversation's options, built from the report each time, most useful
 * first and at most three (the panel adds "Something else"):
 * 1. each Line over its CRA limit: "Shorten Line N";
 * 2. the last QA run's costliest issue per Line: "Fix the QA issue in Line N";
 * 3. each Line under half its word limit and half its form lines: "Add
 *    detail to Line N" (an empty one: "Draft Line N"), from the source files.
 * When none applies, one check of the report against its sources. Picking
 * one sends it as the writer's message.
 */
import { reportSectionMetrics } from "$lib/reportSections";
import type { QaTopIssue } from "$lib/qa/qaSectionScores";

const LINES = ["242", "244", "246"] as const;
const MAX_OPTIONS = 3;
export const CHECK_SOURCES_OPTION = "Check the report for claims the source files don't support";

export function startOptions(content: string | null | undefined, qaIssues: readonly QaTopIssue[] = []): string[] {
  if (!content) return [];
  const metrics = reportSectionMetrics(content);
  const shorten = LINES.flatMap((line) => {
    const metric = metrics[`s${line}`];
    if (metric.words > metric.wordCap) return [`Shorten Line ${line} to ${metric.wordCap} words`];
    if (metric.lines > metric.limit) return [`Shorten Line ${line} to ${metric.limit} form lines`];
    return [];
  });
  const fix = qaIssues.map((issue) => `Fix the QA issue in Line ${issue.line}: ${issue.text}`);
  const thin = LINES.flatMap((line) => {
    const metric = metrics[`s${line}`];
    if (metric.words === 0) return [`Draft Line ${line} from the source files`];
    // Many short lines can fill the form before the words do.
    if (metric.lines >= metric.limit / 2) return [];
    if (metric.words < metric.wordCap / 2) return [`Add detail to Line ${line} from the source files`];
    return [];
  });
  const options = [...shorten, ...fix, ...thin].slice(0, MAX_OPTIONS);
  return options.length > 0 ? options : [CHECK_SOURCES_OPTION];
}
