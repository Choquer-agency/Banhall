/**
 * AD-29 (story 6): SM-1 / SM-2 arithmetic as a pure function — no Convex
 * imports, so the metric is testable without a database or a judge.
 *
 * `measurement-protocol.md`:
 *   SM-1 — Paired Comparison win: on >= 4 non-development projects (>= 1
 *          small), Banhall preferred in >= 3, with <= half the Deviations of
 *          the ChatGPT draft.
 *   SM-2 — Corrections-to-acceptable <= 1 on >= 3 of 4 non-development
 *          projects; the 16-item harness fixture reports 16/16 every run.
 *
 * Two clauses are NOT countable from `comparisons`: the ">= 1 small
 * (100–200-hour)" project (no project row carries claim hours, and
 * `financialSummaries` exists only where a financial upload ran) and the
 * harness's 16/16. `computedMet` therefore covers only the countable clauses,
 * and `manualConditions` names the rest. A `computedMet: true` that silently
 * swallowed an unverified clause is the one failure mode this metric cannot
 * afford.
 *
 * Every count comes from the judge-entered fields on `comparisons` rows.
 * Nothing here reads tool output.
 */

export type SuccessMetricRow = {
  projectId: string;
  preference: "banhall" | "baseline" | "tie";
  deviationsBanhall: number;
  deviationsBaseline: number;
  correctionsBanhall: number;
};

export type SuccessMetricSummary = {
  sm1: {
    eligibleProjects: number;
    preferredProjects: number;
    satisfyingProjects: number;
    computedMet: boolean;
    manualConditions: string[];
  };
  sm2: {
    eligibleProjects: number;
    satisfyingProjects: number;
    computedMet: boolean;
    manualConditions: string[];
  };
};

/** measurement-protocol.md: ">= 4 non-development projects ... preferred in >= 3". */
const MIN_ELIGIBLE_PROJECTS = 4;
const MIN_SATISFYING_PROJECTS = 3;

export const SM1_MANUAL_CONDITIONS = [
  "at least one 100–200-hour project among the four",
] as const;

export const SM2_MANUAL_CONDITIONS = [
  "the 16-item harness fixture reports 16/16 on every run",
] as const;

/**
 * Rows must already be the live, non-development set (voided and
 * `usedInDevelopment` rows are excluded by the caller). At most one live row
 * per project is enforced at write time; the dedup below is a defensive guard
 * against double-counting a project, keeping the first row for a project in
 * the order given (the caller passes rows newest-first).
 */
export function summarizeSuccessMetrics(
  rows: readonly SuccessMetricRow[]
): SuccessMetricSummary {
  const byProject = new Map<string, SuccessMetricRow>();
  for (const row of rows) {
    if (!byProject.has(row.projectId)) byProject.set(row.projectId, row);
  }
  const eligible = [...byProject.values()];
  const eligibleProjects = eligible.length;

  const preferredProjects = eligible.filter(
    (row) => row.preference === "banhall"
  ).length;
  // "Banhall preferred ... with <= half the Deviations of the ChatGPT draft."
  // Integer-safe form of `deviationsBanhall <= deviationsBaseline / 2`.
  const sm1Satisfying = eligible.filter(
    (row) =>
      row.preference === "banhall" &&
      row.deviationsBanhall * 2 <= row.deviationsBaseline
  ).length;
  const sm2Satisfying = eligible.filter(
    (row) => row.correctionsBanhall <= 1
  ).length;

  const met = (satisfying: number) =>
    eligibleProjects >= MIN_ELIGIBLE_PROJECTS &&
    satisfying >= MIN_SATISFYING_PROJECTS;

  return {
    sm1: {
      eligibleProjects,
      preferredProjects,
      satisfyingProjects: sm1Satisfying,
      computedMet: met(sm1Satisfying),
      manualConditions: [...SM1_MANUAL_CONDITIONS],
    },
    sm2: {
      eligibleProjects,
      satisfyingProjects: sm2Satisfying,
      computedMet: met(sm2Satisfying),
      manualConditions: [...SM2_MANUAL_CONDITIONS],
    },
  };
}
