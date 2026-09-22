import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  complianceTierValidator,
  sectionNumberValidator,
  type ComplianceTier,
  type SectionNumber,
} from "./orderedChain";
import { PD_SUBSECTIONS } from "../../shared/pdSubsections";

const planRoleIdValidator = v.union(
  ...PD_SUBSECTIONS.map((subsection) => v.literal(subsection.roleId))
);

export const compliancePlanRefValidator = v.object({
  summaryVersionId: v.id("summaryVersions"),
  itemId: v.optional(v.id("summaryItems")),
  skippedRoleId: v.optional(planRoleIdValidator),
  mergedItemIds: v.array(v.id("summaryItems")),
});
export type CompliancePlanRef = Infer<typeof compliancePlanRefValidator>;

/**
 * Story 2 (CAP-7, AD-25): Compliance Notes are rows, one per decision, in the
 * `complianceNotes` table. These are the typed builders the section-chain
 * mutations share; there is no JSON aggregate anywhere.
 */

export const complianceNoteSourceValidator = v.union(
  v.literal("deterministic"),
  v.literal("model")
);

export const complianceOutcomeValidator = v.union(
  v.literal("applied"),
  v.literal("not_applied")
);

/** The per-decision fields; the table adds its owner ids. */
export const complianceNoteDraftValidator = v.object({
  section: sectionNumberValidator,
  paragraphIndex: v.optional(v.number()),
  source: complianceNoteSourceValidator,
  instruction: v.string(),
  outcome: complianceOutcomeValidator,
  tier: complianceTierValidator,
  reason: v.string(),
  repaired: v.boolean(),
  planRef: v.optional(compliancePlanRefValidator),
});
export type ComplianceNoteDraft = Infer<typeof complianceNoteDraftValidator>;

/** One `complianceNotes` insert, matching the table validator. */
export type ComplianceNoteRow = ComplianceNoteDraft & {
  projectId: Id<"projects">;
  generationId: Id<"generations">;
  candidateRunId?: Id<"generationCandidateRuns">;
};

const MAX_TEXT_CHARS = 1000;

function bounded(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_TEXT_CHARS
    ? `${trimmed.slice(0, MAX_TEXT_CHARS - 1)}…`
    : trimmed;
}

export function noteDraft(fields: {
  section: SectionNumber;
  paragraphIndex?: number;
  source: "deterministic" | "model";
  instruction: string;
  outcome: "applied" | "not_applied";
  tier: ComplianceTier;
  reason: string;
  repaired?: boolean;
  planRef?: CompliancePlanRef;
}): ComplianceNoteDraft {
  return {
    section: fields.section,
    ...(fields.paragraphIndex !== undefined
      ? { paragraphIndex: fields.paragraphIndex }
      : {}),
    source: fields.source,
    instruction: bounded(fields.instruction),
    outcome: fields.outcome,
    tier: fields.tier,
    reason: bounded(fields.reason),
    repaired: fields.repaired ?? false,
    ...(fields.planRef ? { planRef: fields.planRef } : {}),
  };
}

/** Attach the owner ids a chain mutation knows; nothing else is added. */
export function complianceNoteRow(
  draft: ComplianceNoteDraft,
  owner: {
    projectId: Id<"projects">;
    generationId: Id<"generations">;
    candidateRunId?: Id<"generationCandidateRuns">;
  }
): ComplianceNoteRow {
  return {
    projectId: owner.projectId,
    generationId: owner.generationId,
    ...(owner.candidateRunId ? { candidateRunId: owner.candidateRunId } : {}),
    ...draft,
  };
}

/** Per-section Self-check outcome stored on the section run (JSON summary). */
export type SelfCheckStatus = "pass" | "repair_attempted" | "repair_failed";

export type SelfCheckSummary = {
  status: SelfCheckStatus;
  repairAttempted: boolean;
  /** Rows that were not_applied before any repair. */
  failedChecks: number;
  /** Deterministic rows still not_applied after the (re-)check. */
  remainingFailures: number;
  /** Whether the structured model Self-check call returned verdicts. */
  modelCheck: "ok" | "failed";
  /** Final durable Summary-plan evidence, separate from prose repair state. */
  planCoverage?: {
    status: "complete" | "incomplete" | "unavailable";
    applied: number;
    total: number;
  };
};
