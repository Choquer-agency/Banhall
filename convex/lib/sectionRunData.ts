import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";

/**
 * Typed forms of the JSON-in-string columns on `generationSectionRuns`
 * (`metrics`, `qa`, `selfCheck`, `slotCounts`) and `transcriptDigests`
 * (`structured`). 2026-09-25 widen: the typed fields are optional, written next
 * to the string on every new row (dual write) and filled on old rows by the
 * batched backfills. Readers take the typed field first and parse the string
 * only when it is absent (dual read).
 *
 * A typed value is only ever an exact copy of its string: parsing is strict,
 * so a string with a key or a value type the validator does not know yields no
 * typed value and the row keeps being read from its string.
 */

export const sectionMetricsValidator = v.object({
  lines: v.number(),
  words: v.number(),
  paragraphs: v.optional(v.number()),
  limit: v.number(),
  wordCap: v.number(),
  overLimit: v.boolean(),
  rawLines: v.optional(v.number()),
  rawWords: v.optional(v.number()),
  overLimitWithGaps: v.optional(v.boolean()),
});
export type SectionMetricsData = Infer<typeof sectionMetricsValidator>;

export const sectionQaFindingsValidator = v.array(
  v.object({ check: v.string(), message: v.string() })
);
export type SectionQaFindingsData = Infer<typeof sectionQaFindingsValidator>;

export const selfCheckSummaryValidator = v.object({
  status: v.union(
    v.literal("pass"),
    v.literal("repair_attempted"),
    v.literal("repair_failed")
  ),
  repairAttempted: v.boolean(),
  failedChecks: v.number(),
  remainingFailures: v.number(),
  modelCheck: v.union(v.literal("ok"), v.literal("failed")),
  // Why the Summary Self-check was rejected: clause, index and byte counts
  // or app-supplied ids only, never model text (plan coverage, 2026-09-25).
  modelCheckDetail: v.optional(v.string()),
  planCoverage: v.optional(
    v.object({
      status: v.union(
        v.literal("complete"),
        v.literal("incomplete"),
        v.literal("unavailable")
      ),
      applied: v.number(),
      total: v.number(),
    })
  ),
});
export type SelfCheckSummaryData = Infer<typeof selfCheckSummaryValidator>;

export const slotCountsValidator = v.record(v.string(), v.number());
export type SlotCountsData = Infer<typeof slotCountsValidator>;

export const transcriptDigestWindowValidator = v.object({
  participants: v.array(v.string()),
  timeline: v.array(v.string()),
  technologicalUncertainties: v.array(v.string()),
  hypotheses: v.array(v.string()),
  experiments: v.array(
    v.object({
      problem: v.string(),
      approach: v.string(),
      result: v.string(),
      conclusion: v.string(),
      dates: v.string(),
    })
  ),
  resultsAndNumbers: v.array(v.string()),
  namesAndSystems: v.array(v.string()),
  keyQuotes: v.array(v.string()),
});
export const transcriptDigestStructuredValidator = v.array(transcriptDigestWindowValidator);
export type TranscriptDigestStructuredData = Infer<typeof transcriptDigestStructuredValidator>;

// ─── Strict parsing ──────────────────────────────────────────────────────────

type Plain = Record<string, unknown>;

function parseJson(value: string | undefined | null): unknown {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Plain {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Plain, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const METRICS_KEYS = [
  "lines",
  "words",
  "paragraphs",
  "limit",
  "wordCap",
  "overLimit",
  "rawLines",
  "rawWords",
  "overLimitWithGaps",
] as const;

export function toSectionMetricsData(value: unknown): SectionMetricsData | undefined {
  if (!isPlainObject(value) || !onlyKeys(value, METRICS_KEYS)) return undefined;
  const { lines, words, paragraphs, limit, wordCap, overLimit, rawLines, rawWords, overLimitWithGaps } =
    value;
  if (
    !isFiniteNumber(lines) ||
    !isFiniteNumber(words) ||
    !isFiniteNumber(limit) ||
    !isFiniteNumber(wordCap) ||
    typeof overLimit !== "boolean" ||
    (paragraphs !== undefined && !isFiniteNumber(paragraphs)) ||
    (rawLines !== undefined && !isFiniteNumber(rawLines)) ||
    (rawWords !== undefined && !isFiniteNumber(rawWords)) ||
    (overLimitWithGaps !== undefined && typeof overLimitWithGaps !== "boolean")
  ) {
    return undefined;
  }
  return {
    lines,
    words,
    ...(paragraphs !== undefined ? { paragraphs } : {}),
    limit,
    wordCap,
    overLimit,
    ...(rawLines !== undefined ? { rawLines } : {}),
    ...(rawWords !== undefined ? { rawWords } : {}),
    ...(overLimitWithGaps !== undefined ? { overLimitWithGaps } : {}),
  };
}

export function toSectionQaFindingsData(value: unknown): SectionQaFindingsData | undefined {
  if (!Array.isArray(value)) return undefined;
  const findings: SectionQaFindingsData = [];
  for (const item of value) {
    if (
      !isPlainObject(item) ||
      !onlyKeys(item, ["check", "message"]) ||
      typeof item.check !== "string" ||
      typeof item.message !== "string"
    ) {
      return undefined;
    }
    findings.push({ check: item.check, message: item.message });
  }
  return findings;
}

const SELF_CHECK_KEYS = [
  "status",
  "repairAttempted",
  "failedChecks",
  "remainingFailures",
  "modelCheck",
  "modelCheckDetail",
  "planCoverage",
] as const;

export function toSelfCheckSummaryData(value: unknown): SelfCheckSummaryData | undefined {
  if (!isPlainObject(value) || !onlyKeys(value, SELF_CHECK_KEYS)) return undefined;
  const { status, repairAttempted, failedChecks, remainingFailures, modelCheck, modelCheckDetail, planCoverage } = value;
  if (
    (status !== "pass" && status !== "repair_attempted" && status !== "repair_failed") ||
    typeof repairAttempted !== "boolean" ||
    !isFiniteNumber(failedChecks) ||
    !isFiniteNumber(remainingFailures) ||
    (modelCheck !== "ok" && modelCheck !== "failed") ||
    (modelCheckDetail !== undefined && typeof modelCheckDetail !== "string")
  ) {
    return undefined;
  }
  let coverage: SelfCheckSummaryData["planCoverage"];
  if (planCoverage !== undefined) {
    if (
      !isPlainObject(planCoverage) ||
      !onlyKeys(planCoverage, ["status", "applied", "total"]) ||
      (planCoverage.status !== "complete" &&
        planCoverage.status !== "incomplete" &&
        planCoverage.status !== "unavailable") ||
      !isFiniteNumber(planCoverage.applied) ||
      !isFiniteNumber(planCoverage.total)
    ) {
      return undefined;
    }
    coverage = {
      status: planCoverage.status,
      applied: planCoverage.applied,
      total: planCoverage.total,
    };
  }
  return {
    status,
    repairAttempted,
    failedChecks,
    remainingFailures,
    modelCheck,
    ...(typeof modelCheckDetail === "string" ? { modelCheckDetail } : {}),
    ...(coverage ? { planCoverage: coverage } : {}),
  };
}

/** Record keys Convex accepts: non-empty ASCII not starting with `$` or `_`. */
function isStorableRecordKey(key: string): boolean {
  return key.length > 0 && /^[\x20-\x7e]+$/.test(key) && !key.startsWith("$") && !key.startsWith("_");
}

export function toSlotCountsData(value: unknown): SlotCountsData | undefined {
  if (!isPlainObject(value)) return undefined;
  const counts: SlotCountsData = {};
  for (const [key, count] of Object.entries(value)) {
    if (!isStorableRecordKey(key) || !isFiniteNumber(count)) return undefined;
    counts[key] = count;
  }
  return counts;
}

const DIGEST_KEYS = [
  "participants",
  "timeline",
  "technologicalUncertainties",
  "hypotheses",
  "experiments",
  "resultsAndNumbers",
  "namesAndSystems",
  "keyQuotes",
] as const;
const EXPERIMENT_KEYS = ["problem", "approach", "result", "conclusion", "dates"] as const;

export function toTranscriptDigestStructuredData(
  value: unknown
): TranscriptDigestStructuredData | undefined {
  if (!Array.isArray(value)) return undefined;
  const windows: TranscriptDigestStructuredData = [];
  for (const item of value) {
    if (!isPlainObject(item) || !onlyKeys(item, DIGEST_KEYS)) return undefined;
    const stringFields = [
      "participants",
      "timeline",
      "technologicalUncertainties",
      "hypotheses",
      "resultsAndNumbers",
      "namesAndSystems",
      "keyQuotes",
    ] as const;
    if (!stringFields.every((field) => isStringArray(item[field]))) return undefined;
    const experiments = item.experiments;
    if (!Array.isArray(experiments)) return undefined;
    const typedExperiments: TranscriptDigestStructuredData[number]["experiments"] = [];
    for (const experiment of experiments) {
      if (
        !isPlainObject(experiment) ||
        !onlyKeys(experiment, EXPERIMENT_KEYS) ||
        !EXPERIMENT_KEYS.every((field) => typeof experiment[field] === "string")
      ) {
        return undefined;
      }
      typedExperiments.push({
        problem: experiment.problem as string,
        approach: experiment.approach as string,
        result: experiment.result as string,
        conclusion: experiment.conclusion as string,
        dates: experiment.dates as string,
      });
    }
    windows.push({
      participants: item.participants as string[],
      timeline: item.timeline as string[],
      technologicalUncertainties: item.technologicalUncertainties as string[],
      hypotheses: item.hypotheses as string[],
      experiments: typedExperiments,
      resultsAndNumbers: item.resultsAndNumbers as string[],
      namesAndSystems: item.namesAndSystems as string[],
      keyQuotes: item.keyQuotes as string[],
    });
  }
  return windows;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

type SectionRunJson = {
  metrics?: string;
  qa?: string;
  selfCheck?: string;
  slotCounts?: string;
};

export type SectionRunTypedFields = {
  metricsData?: SectionMetricsData;
  qaData?: SectionQaFindingsData;
  selfCheckData?: SelfCheckSummaryData;
  slotCountsData?: SlotCountsData;
};

/** The typed fields to write next to the given JSON strings. A string that
 * does not parse strictly contributes nothing. */
export function sectionRunTypedFields(json: SectionRunJson): SectionRunTypedFields {
  const metricsData = toSectionMetricsData(parseJson(json.metrics));
  const qaData = toSectionQaFindingsData(parseJson(json.qa));
  const selfCheckData = toSelfCheckSummaryData(parseJson(json.selfCheck));
  const slotCountsData = toSlotCountsData(parseJson(json.slotCounts));
  return {
    ...(metricsData ? { metricsData } : {}),
    ...(qaData ? { qaData } : {}),
    ...(selfCheckData ? { selfCheckData } : {}),
    ...(slotCountsData ? { slotCountsData } : {}),
  };
}

/** Backfill patch for one row: the typed field of every string that has one
 * and does not carry it yet. Empty when the row is done or cannot convert. */
export function missingSectionRunTypedFields(
  row: Doc<"generationSectionRuns">
): SectionRunTypedFields {
  const typed = sectionRunTypedFields({
    ...(row.metricsData === undefined && row.metrics !== undefined ? { metrics: row.metrics } : {}),
    ...(row.qaData === undefined && row.qa !== undefined ? { qa: row.qa } : {}),
    ...(row.selfCheckData === undefined && row.selfCheck !== undefined
      ? { selfCheck: row.selfCheck }
      : {}),
    ...(row.slotCountsData === undefined && row.slotCounts !== undefined
      ? { slotCounts: row.slotCounts }
      : {}),
  });
  return typed;
}

export function transcriptDigestStructuredData(
  structured: string
): TranscriptDigestStructuredData | undefined {
  return toTranscriptDigestStructuredData(parseJson(structured));
}

// ─── Reads (typed first, string second) ──────────────────────────────────────

/** The section's metrics as stored: typed when present, else the parsed
 * string (any JSON value, as legacy readers saw it), else null. */
export function sectionRunMetrics(
  row: Pick<Doc<"generationSectionRuns">, "metrics" | "metricsData">
): unknown {
  return row.metricsData ?? parseJson(row.metrics) ?? null;
}

export function sectionRunQa(
  row: Pick<Doc<"generationSectionRuns">, "qa" | "qaData">
): unknown {
  return row.qaData ?? parseJson(row.qa) ?? null;
}

export function sectionRunSelfCheck(
  row: Pick<Doc<"generationSectionRuns">, "selfCheck" | "selfCheckData">
): unknown {
  return row.selfCheckData ?? parseJson(row.selfCheck) ?? null;
}

export function sectionRunSlotCounts(
  row: Pick<Doc<"generationSectionRuns">, "slotCounts" | "slotCountsData">
): unknown {
  return row.slotCountsData ?? parseJson(row.slotCounts) ?? null;
}

/** The JSON string form a reader that still takes strings expects: the
 * stored string, or the typed value serialized when only that exists. */
export function sectionRunJson(
  row: Doc<"generationSectionRuns">,
  field: "metrics" | "selfCheck" | "slotCounts"
): string | null {
  const stored = row[field];
  if (stored !== undefined) return stored;
  const typed =
    field === "metrics"
      ? row.metricsData
      : field === "selfCheck"
        ? row.selfCheckData
        : row.slotCountsData;
  return typed === undefined ? null : JSON.stringify(typed);
}
