/**
 * Story 2 (CAP-6/7): Compliance Note compilation.
 * Records per-section decisions: which profile instructions were applied,
 * which were not applied and why, and repair/consistency outcomes.
 */

export type ProfileTier = "locked_rules" | "house_rules" | "writer_profile" | "org_mode";

export type ReasonCode =
  | "cap_met"
  | "cap_breach"
  | "instruction_applied"
  | "instruction_waived"
  | "disabled_profile"
  | "missing_profile"
  | "override"
  | "conflict";

export interface AppliedInstruction {
  instruction: string;
  source: ProfileTier;
  appliedHow: string; // e.g., "applied fully", "applied up to cap"
}

export interface NotAppliedReason {
  instruction: string;
  reason: ReasonCode;
  detail: string; // e.g., "350/350 words", "profile disabled"
}

export interface SelfCheckRecord {
  status: "pass" | "repair_attempted" | "repair_failed";
  checks: string[]; // which checks ran
  issues: string[];
  repairOutcome?: string;
}

export interface ConsistencyFinding {
  type: "contradiction" | "storyline_deviation" | "unresolved_fact";
  description: string;
  location: string; // e.g., "S246 paragraph 2"
  evidence?: string;
}

export interface ComplianceRecord {
  section: string;
  appliedInstructions: AppliedInstruction[];
  notAppliedReasons: NotAppliedReason[];
  selfCheck: SelfCheckRecord;
  consistencyFindings?: ConsistencyFinding[];
}

export interface ComplianceNote {
  buildOrder: string[];
  buildOrderTier: ProfileTier;
  buildOrderValid: boolean;
  invalidBuildOrderReason?: string;
  sections: ComplianceRecord[];
  summaryIssues: string[]; // top-level findings
  generatedAt: number;
}

/**
 * Compile compliance note from generation artifacts.
 * Called once at the end of generation, before returning to the user.
 */
export function compileComplianceNote(
  buildOrder: string[],
  buildOrderTier: ProfileTier,
  buildOrderValid: boolean,
  invalidBuildOrderReason: string | undefined,
  sections: ComplianceRecord[]
): ComplianceNote {
  const summaryIssues: string[] = [];

  // Patch 5: Add fallback string if invalidBuildOrderReason is undefined
  if (!buildOrderValid) {
    summaryIssues.push(
      `Invalid Build Order: ${invalidBuildOrderReason || "validation failed"}`
    );
  }

  for (const section of sections) {
    // Patch 6: Use optional chaining to guard against undefined section.selfCheck
    if (section.selfCheck?.status === "repair_failed") {
      summaryIssues.push(
        `Section ${section.section}: self-check repair failed (${section.selfCheck?.issues?.join(", ")})`
      );
    }
    if (section.consistencyFindings && section.consistencyFindings.length > 0) {
      summaryIssues.push(
        `Section ${section.section}: ${section.consistencyFindings.length} consistency finding(s)`
      );
    }
  }

  return {
    buildOrder,
    buildOrderTier,
    buildOrderValid,
    invalidBuildOrderReason,
    sections,
    summaryIssues,
    generatedAt: Date.now(),
  };
}

/**
 * Serialize compliance note for storage in generation.complianceNotes.
 */
export function serializeComplianceNote(note: ComplianceNote): string {
  return JSON.stringify(note, null, 2);
}

/**
 * Deserialize compliance note from storage.
 * Patch 4: Wrap JSON.parse in try/catch for robustness.
 */
export function deserializeComplianceNote(json: string): ComplianceNote | null {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error("Failed to deserialize compliance note:", err);
    return null;
  }
}
