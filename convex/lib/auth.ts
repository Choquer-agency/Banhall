import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  domainError,
  type FilingReadiness,
  type FilingBlockerCode,
} from "./contracts";

type Ctx = QueryCtx | MutationCtx;
type ProjectAccess =
  | { kind: "internal"; project: Doc<"projects">; user: Doc<"users"> }
  | { kind: "client_review"; project: Doc<"projects"> }
  | { kind: "denied" };

export async function getCurrentUserOrNull(ctx: Ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.get(userId);
}

export async function requireCurrentUser(ctx: Ctx) {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) domainError("NOT_AUTHENTICATED", "Authentication required");
  return user;
}


export async function getInternalProjectAccessOrNull(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) return null;
  const project = await ctx.db.get(projectId);
  if (!project) return null;
  return { project, user };
}

export async function requireInternalProjectAccess(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  const user = await requireCurrentUser(ctx);
  const project = await ctx.db.get(projectId);
  if (!project) domainError("NOT_FOUND", "Project not found");
  return { project, user };
}

export async function requireProjectCreator(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  const access = await requireInternalProjectAccess(ctx, projectId);
  if (access.project.createdBy !== access.user._id) {
    domainError("NOT_AUTHORIZED", "Project creator access required");
  }
  return access;
}

export async function requireProjectCreatorOrAdmin(
  ctx: Ctx,
  projectId: Id<"projects">
) {
  const access = await requireInternalProjectAccess(ctx, projectId);
  if (
    access.project.createdBy !== access.user._id &&
    access.user.role !== "admin"
  ) {
    domainError("NOT_AUTHORIZED", "Project creator or admin access required");
  }
  return access;
}

export async function requireRole(
  ctx: Ctx,
  roles: Array<"writer" | "manager" | "admin">
) {
  const user = await requireCurrentUser(ctx);
  if (!user.role || !roles.includes(user.role)) {
    domainError("NOT_AUTHORIZED", "This action requires an elevated role");
  }
  return user;
}

export async function getProjectAccess(
  ctx: Ctx,
  projectId: Id<"projects">,
  shareToken?: string
): Promise<ProjectAccess> {
  const user = await getCurrentUserOrNull(ctx);
  const project = await ctx.db.get(projectId);
  if (!project) return { kind: "denied" };
  if (user) {
    return { kind: "internal", project, user };
  }
  if (
    shareToken &&
    project.shareToken === shareToken &&
    project.sharedReportId
  ) {
    return { kind: "client_review", project };
  }
  return { kind: "denied" };
}


export async function getFilingReadiness(
  ctx: Ctx,
  project: Doc<"projects">,
  report: Doc<"reports"> | null
): Promise<FilingReadiness> {
  const blockers: FilingReadiness["blockers"] = [];
  const add = (code: FilingBlockerCode, message: string, claimId?: string) =>
    blockers.push({ code, message, ...(claimId ? { claimId } : {}) });

  const evidence = await ctx.db
    .query("projectIdentityEvidence")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .take(250);
  const verified = evidence.filter((row) => row.status === "verified");
  const verifiedClaimants = verified.filter(
    (row) => row.relationship === "claimant"
  );
  if (verifiedClaimants.length === 0) {
    add(
      "IDENTITY_EVIDENCE_REQUIRED",
      "Verified legal claimant evidence is required. Names and AI output are not evidence."
    );
  }
  const unresolvedContractors = evidence.filter(
    (row) => row.relationship === "contractor" && row.status !== "verified"
  );
  if (unresolvedContractors.length > 0) {
    add(
      "CONTRACTOR_EVIDENCE_REQUIRED",
      "Every contractor represented in the report needs verified relationship evidence."
    );
  }
  const newestEvidenceAt = evidence.reduce(
    (newest, row) => Math.max(newest, row.updatedAt),
    0
  );

  let provenanceStatus: FilingReadiness["provenanceStatus"] =
    "unavailable_legacy";
  let provenance: Doc<"reportProvenance"> | null = null;
  if (!report?.provenanceId) {
    add(
      "PROVENANCE_UNAVAILABLE",
      "This report revision has no claim-level source record."
    );
  } else {
    provenance = await ctx.db.get(report.provenanceId);
    if (!provenance || provenance.projectId !== project._id) {
      add(
        "PROVENANCE_UNAVAILABLE",
        "The report provenance record is missing or belongs to another project."
      );
    } else {
      provenanceStatus = provenance.status;
      if (provenance.status !== "approved") {
        add(
          "PROVENANCE_REVIEW_REQUIRED",
          "A human must approve the source mapping for this exact revision."
        );
      }
      for (const claim of provenance.claims) {
        if (claim.material && claim.state === "unsupported") {
          add(
            "UNSUPPORTED_CLAIM",
            "A material claim is unsupported by the frozen project sources.",
            claim.claimId
          );
        } else if (claim.material && claim.state !== "approved") {
          add(
            "PROVENANCE_REVIEW_REQUIRED",
            "A material claim still needs human source review.",
            claim.claimId
          );
        }
      }
    }
  }

  const revisionNumber = report?.revisionNumber ?? 0;
  const attestation = project.filingAttestation;
  let attestationStatus: FilingReadiness["attestationStatus"] = "absent";
  if (!attestation) {
    add(
      "ATTESTATION_REQUIRED",
      "A manager or administrator must attest the evidence and exact report revision."
    );
  } else if (attestation.status === "blocked") {
    attestationStatus = "blocked";
    add("ATTESTATION_REQUIRED", "The current filing attestation is blocked.");
  } else {
    const stale =
      newestEvidenceAt > attestation.evidenceCutoffAt ||
      attestation.reportId !== report?._id ||
      attestation.revisionNumber !== revisionNumber ||
      (provenance?.reviewedAt ?? 0) > attestation.evidenceCutoffAt;
    attestationStatus = stale ? "stale" : "approved";
    if (stale) {
      add(
        "ATTESTATION_STALE",
        "Evidence or report content changed after the filing attestation."
      );
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    attestationStatus,
    verifiedIdentityCount: verifiedClaimants.length,
    provenanceStatus,
    evaluatedReportRef: report
      ? {
          reportId: report._id,
          reportVersion: report.version,
          revisionNumber,
        }
      : null,
  };
}

export async function requireFilingReady(
  ctx: Ctx,
  project: Doc<"projects">,
  report: Doc<"reports"> | null
) {
  const readiness = await getFilingReadiness(ctx, project, report);
  if (!readiness.ready) {
    // Newline-joined so the export dialog can list each blocker separately.
    domainError(
      "EVIDENCE_REQUIRED",
      readiness.blockers.map((blocker) => blocker.message).join("\n")
    );
  }
  return readiness;
}
