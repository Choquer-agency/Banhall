export interface ScoredQaIssue {
  text: string;
  severity: "deduction" | "warning";
  deduction?: number;
}

export interface QaSectionScore {
  score: number;
  issues: ScoredQaIssue[];
}

/**
 * Older scorecards sometimes embedded the deduction only in prose. Accept only
 * the explicit "Deduct N point(s)" form so unrelated numbers are never scored.
 */
export function issueDeduction(issue: ScoredQaIssue): number {
  if (
    issue.severity === "deduction" &&
    typeof issue.deduction === "number" &&
    Number.isFinite(issue.deduction) &&
    issue.deduction > 0
  ) {
    return issue.deduction;
  }
  if (issue.severity !== "deduction") return 0;
  const legacy = issue.text.match(/\bDeduct\s+(\d+(?:\.\d+)?)\s+points?\b/i);
  return legacy ? Number(legacy[1]) : 0;
}

export function adjustedQaScores(
  overallScore: number,
  sections: Record<string, QaSectionScore>,
  effectiveSeverity: (section: string, index: number, issue: ScoredQaIssue) => "deduction" | "warning"
): { overall: number; sections: Record<string, number> } {
  let totalRestored = 0;
  const adjustedSections: Record<string, number> = {};

  for (const [sectionKey, section] of Object.entries(sections)) {
    let restored = 0;
    section.issues.forEach((issue, index) => {
      if (issue.severity === "deduction" && effectiveSeverity(sectionKey, index, issue) === "warning") {
        restored += issueDeduction(issue);
      }
    });
    totalRestored += restored;
    adjustedSections[sectionKey] = Math.min(100, section.score + restored);
  }

  return {
    overall: Math.min(100, overallScore + totalRestored),
    sections: adjustedSections,
  };
}
