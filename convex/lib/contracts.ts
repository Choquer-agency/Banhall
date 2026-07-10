import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";

export const domainErrorCodes = [
  "NOT_AUTHENTICATED",
  "NOT_AUTHORIZED",
  "NOT_FOUND",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_UNAVAILABLE",
  "GENERATION_ACTIVE",
  "TRANSCRIPT_PROJECT_MISMATCH",
  "STALE_REVISION",
  "EVIDENCE_REQUIRED",
  "PROVENANCE_REVIEW_REQUIRED",
  "REPORT_NOT_PUBLISHED",
  "EXPORT_NOT_AUTHORIZED",
  "INVALID_STATE",
  "INVALID_INPUT",
] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];

export function domainError(code: DomainErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}

export const projectStatusValidator = v.union(
  v.literal("draft"),
  v.literal("generating"),
  v.literal("review"),
  v.literal("client_review"),
  v.literal("final")
);

export const generationStatusValidator = v.union(
  v.literal("reserved"),
  v.literal("running"),
  v.literal("awaiting_selection"),
  v.literal("completed"),
  v.literal("failed")
);

export const revisionRefValidator = v.object({
  reportId: v.id("reports"),
  reportVersion: v.number(),
  revisionNumber: v.number(),
  kind: v.union(v.literal("current"), v.literal("snapshot")),
  snapshotId: v.optional(v.id("reportSnapshots")),
});

export type ReportRevisionRef = {
  reportId: Id<"reports">;
  reportVersion: number;
  revisionNumber: number;
  kind: "current" | "snapshot";
  snapshotId?: Id<"reportSnapshots">;
};

export const sourceCitationValidator = v.object({
  generationSourceId: v.id("generationSources"),
  sourceContentHash: v.string(),
  exactExcerpt: v.string(),
  startOffset: v.number(),
  endOffset: v.number(),
  speaker: v.optional(v.string()),
  timestampStart: v.optional(v.string()),
  timestampEnd: v.optional(v.string()),
});

export const claimCitationValidator = v.object({
  claimId: v.string(),
  section: v.union(v.literal("242"), v.literal("244"), v.literal("246")),
  material: v.boolean(),
  claimText: v.string(),
  claimTextHash: v.string(),
  state: v.union(
    v.literal("needs_review"),
    v.literal("approved"),
    v.literal("unsupported")
  ),
  sources: v.array(sourceCitationValidator),
});

export type FilingBlockerCode =
  | "IDENTITY_EVIDENCE_REQUIRED"
  | "CONTRACTOR_EVIDENCE_REQUIRED"
  | "EVIDENCE_STALE"
  | "ATTESTATION_REQUIRED"
  | "ATTESTATION_STALE"
  | "PROVENANCE_UNAVAILABLE"
  | "PROVENANCE_REVIEW_REQUIRED"
  | "UNSUPPORTED_CLAIM"
  | "REPORT_REVISION_MISMATCH";

export type FilingReadiness = {
  ready: boolean;
  blockers: Array<{
    code: FilingBlockerCode;
    message: string;
    claimId?: string;
  }>;
  attestationStatus: "absent" | "blocked" | "approved" | "stale";
  verifiedIdentityCount: number;
  provenanceStatus: "unavailable_legacy" | "needs_review" | "approved" | "rejected";
  evaluatedReportRef: {
    reportId: Id<"reports">;
    reportVersion: number;
    revisionNumber: number;
  } | null;
};

export const filingReadinessValidator = v.object({
  ready: v.boolean(),
  blockers: v.array(
    v.object({
      code: v.string(),
      message: v.string(),
      claimId: v.optional(v.string()),
    })
  ),
  attestationStatus: v.union(
    v.literal("absent"),
    v.literal("blocked"),
    v.literal("approved"),
    v.literal("stale")
  ),
  verifiedIdentityCount: v.number(),
  provenanceStatus: v.union(
    v.literal("unavailable_legacy"),
    v.literal("needs_review"),
    v.literal("approved"),
    v.literal("rejected")
  ),
  evaluatedReportRef: v.union(
    v.null(),
    v.object({
      reportId: v.id("reports"),
      reportVersion: v.number(),
      revisionNumber: v.number(),
    })
  ),
});

export type ProviderCapabilityState =
  | "configured"
  | "unconfigured"
  | "degraded"
  | "unknown";

export type ProviderCapabilities = {
  generation: ProviderCapabilityState;
  review: ProviderCapabilityState;
  chat: ProviderCapabilityState;
  financial: ProviderCapabilityState;
  brain: ProviderCapabilityState;
  anthropicMessage: string;
  brainMessage: string;
  candidateModels: string[];
  checkedAt?: number;
};

export const providerCapabilitiesValidator = v.object({
  generation: v.string(),
  review: v.string(),
  chat: v.string(),
  financial: v.string(),
  brain: v.string(),
  anthropicMessage: v.string(),
  brainMessage: v.string(),
  candidateModels: v.array(v.string()),
  checkedAt: v.optional(v.number()),
});

export const MAX_CLAIMS_PER_REVISION = 150;
export const MAX_SOURCES_PER_CLAIM = 12;
export const MAX_CLAIM_TEXT_LENGTH = 4_000;
export const MAX_EXCERPT_LENGTH = 8_000;

export function assertBoundedCitations(
  claims: Array<{
    claimText: string;
    sources: Array<{ exactExcerpt: string }>;
  }>
): void {
  if (claims.length > MAX_CLAIMS_PER_REVISION) {
    domainError("INVALID_INPUT", "Too many claims in one report revision");
  }
  for (const claim of claims) {
    if (claim.claimText.length > MAX_CLAIM_TEXT_LENGTH) {
      domainError("INVALID_INPUT", "Claim text exceeds the supported limit");
    }
    if (claim.sources.length > MAX_SOURCES_PER_CLAIM) {
      domainError("INVALID_INPUT", "Too many sources attached to one claim");
    }
    if (claim.sources.some((source) => source.exactExcerpt.length > MAX_EXCERPT_LENGTH)) {
      domainError("INVALID_INPUT", "A source excerpt exceeds the supported limit");
    }
  }
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
