/**
 * Owner 2026-10-28 (Paper O4, "Get started"): a new conversation's options,
 * built from the report and shown only when a Line is over its CRA limit:
 * one "Shorten Line N" option for each such Line, in build order. Picking
 * one sends it as the writer's message.
 */
import { reportSectionMetrics } from "$lib/reportSections";

const LINES = ["242", "244", "246"] as const;

export function startOptions(content: string | null | undefined): string[] {
  if (!content) return [];
  const metrics = reportSectionMetrics(content);
  return LINES.flatMap((line) => {
    const metric = metrics[`s${line}`];
    if (metric.words > metric.wordCap) return [`Shorten Line ${line} to ${metric.wordCap} words`];
    if (metric.lines > metric.limit) return [`Shorten Line ${line} to ${metric.limit} form lines`];
    return [];
  });
}
