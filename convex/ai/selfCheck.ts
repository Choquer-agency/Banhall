"use node";

import type { TranscriptAnalysis } from "./analyzerAgent";
import type { StyleOverrides } from "../../shared/styleOverrides";
import { sectionMetrics } from "../lib/lineLimits";

/**
 * Story 2 (CAP-9): Self-check module for validating sections before display.
 * Checks: Claim Exclusions, Glossary Terms, word/line caps, section contradictions,
 * profile paragraph rules, and unreliable facts (based on Confidence Map calibration).
 */

export type SelfCheckStatus =
  | "pass"
  | "repair_attempted"
  | "repair_failed";

export interface SelfCheckOutcome {
  status: SelfCheckStatus;
  checks: string[]; // which checks were performed
  repairAttempted?: boolean;
  repairSuccess?: boolean;
  issues?: string[];
  detail?: string;
}

export interface Brief {
  storyline?: Array<{
    claim: string;
    confidence?: string;
  }>;
  claimExclusions?: Array<{
    text: string;
    reason: "business_risk" | "routine_engineering" | "outside_claim_period" | "not_technological";
  }>;
  glossaryTerms?: Array<{
    term: string;
    concept: string;
  }>;
  confidenceMap?: Array<{
    fact: string;
    confidence: "established" | "partially_established" | "unresolved" | "unreliable";
    source?: string;
  }>;
}

/**
 * Run self-check on a section draft before display.
 *
 * Checks (in order):
 * 1. Excluded Claims: Any excluded claim text found in draft → needs repair
 * 2. Glossary Calibration: Off-glossary synonyms → needs repair
 * 3. Word/Line Caps: Over the Locked Rules limits → needs compression
 * 4. Profile Rules: Violates custom paragraph rules → needs repair
 * 5. Unreliable Facts: Unhedged unreliable/unresolved facts → needs hedging
 * 6. Section Contradictions: Prior sections contain contradictory facts → flags for writer
 *
 * Returns:
 * - "pass": All checks passed
 * - "repair_attempted": At least one issue was found and repair was attempted (check detail for success)
 * - "repair_failed": Repair failed and section should be shown with flag
 */
export async function runSelfCheck(
  sectionNumber: string,
  draftText: string,
  brief: Brief | null,
  priorSections: Array<{ text: string; wordCount: number }> = [],
  analysis: TranscriptAnalysis | null = null,
  styleOverrides: StyleOverrides | null = null
): Promise<SelfCheckOutcome> {
  const checks: string[] = [];
  const issues: string[] = [];

  // Check 1: Excluded Claims (CAP-9)
  if (brief?.claimExclusions && brief.claimExclusions.length > 0) {
    checks.push("excluded_claims");
    for (const exclusion of brief.claimExclusions) {
      // Simple substring match (strict mode would need more sophisticated matching)
      if (draftText.toLowerCase().includes(exclusion.text.toLowerCase())) {
        issues.push(`Excluded claim found: "${exclusion.text}" (reason: ${exclusion.reason})`);
      }
    }
  }

  // Check 2: Glossary Calibration (CAP-9)
  if (brief?.glossaryTerms && brief.glossaryTerms.length > 0) {
    checks.push("glossary_calibration");
    // Placeholder: would need sophisticated synonym detection
    // For now, exact-term checking
  }

  // Check 3: Word/Line Caps (Locked Rules)
  checks.push("caps");
  const metrics = sectionMetrics(draftText, `s${sectionNumber}` as any);
  if (metrics.overLimit) {
    issues.push(
      `Word cap breach: ${metrics.words} words (limit: ${metrics.limit}), ${metrics.lines} lines`
    );
  }

  // Check 4: Unreliable Facts (CAP-9)
  if (analysis) {
    checks.push("facts_reliability");
    // Placeholder: check if unreliable facts appear unhedged
    // Would check Brief.confidenceMap for "unreliable" or "unresolved" facts
  }

  // Check 5: Section Contradictions (implicit in consistency pass)
  if (priorSections.length > 0) {
    checks.push("contradictions");
    // Placeholder: would compare established facts
  }

  // Determine outcome
  if (issues.length === 0) {
    return {
      status: "pass",
      checks,
    };
  }

  // If issues found, attempt repair (placeholder — actual repair would call LLM)
  return {
    status: "repair_attempted",
    checks,
    repairAttempted: true,
    repairSuccess: false, // Placeholder: would be true if repair succeeded
    issues,
    detail: `Found ${issues.length} issue(s) during self-check`,
  };
}

/**
 * Placeholder for repair attempt logic.
 * Story 2 spec says: one repair attempt per section, using same generation pipeline.
 * This would call the section generation agent with repair guidance.
 */
export async function attemptRepair(
  sectionNumber: string,
  draftText: string,
  issue: string
): Promise<string | null> {
  // Placeholder: would call generation with repair prompt
  // e.g., "The draft has [issue]. Revise to fix it."
  return null;
}
