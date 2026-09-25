import { defineSchema, defineTable } from "convex/server";
import { briefOutcomeValidator } from "./lib/briefRender";
import { complianceNoteDraftValidator } from "./lib/complianceNote";
import {
  orderedPayloadValidator,
  sectionNumberValidator,
  selfCheckRuleValidator,
  styleCategoryValidator,
  writerSettingsValidator,
} from "./lib/orderedChain";
import { v } from "convex/values";
import {
  projectTypeValidator,
  workflowStageValidator,
  workItemKindValidator,
  workItemStatusValidator,
} from "./lib/contracts";
import { admissionValidator, attemptOutcomeValidator } from "./lib/learningAdmission";
import { styleOverridesValidator } from "./lib/styleOverrides";
import { brainProvenanceEntryValidator } from "./lib/generationOutputs";
import { draftingInputsFailureCodeValidator } from "./lib/draftingInputsFailure";
import {
  sectionMetricsValidator,
  sectionQaFindingsValidator,
  selfCheckSummaryValidator,
  slotCountsValidator,
  transcriptDigestStructuredValidator,
} from "./lib/sectionRunData";
import { PD_SUBSECTIONS } from "../shared/pdSubsections";
import {
  transcriptFactTypeValidator,
  transcriptSourceFormatValidator,
  transcriptSpeakerRoleValidator,
} from "./lib/transcriptValidators";
import {
  catalogFieldsValidator,
  catalogStatusValidator,
  costComparisonValidator,
  endpointSupportValidator,
  evalSummaryValidator,
  gateResultValidator,
  modelFreezeValidator,
  modelRoleValidator,
} from "./lib/modelCatalogValidators";

const seedRoleIdValidator = v.union(
  ...PD_SUBSECTIONS.map((subsection) => v.literal(subsection.roleId))
);
const seedSubsectionKindValidator = v.union(
  v.literal("standard"),
  v.literal("optional"),
  v.literal("multiple")
);
const seedSupportValidator = v.union(
  v.literal("source_supported"),
  v.literal("writer_asserted")
);
const seedGenerationEventKindValidator = v.union(
  v.literal("initialized"),
  v.literal("signOff"),
  v.literal("cancel"),
  // Stop after sign-off (PRD FR-43, CAP-17): drafted Sections are kept.
  v.literal("stop")
);
const seedRoleEventKindValidator = v.union(
  v.literal("batchDispatched"),
  v.literal("batchCompleted"),
  v.literal("batchFailed"),
  v.literal("batchLate"),
  v.literal("batchViewed"),
  v.literal("select"),
  v.literal("deselect"),
  v.literal("edit"),
  v.literal("restoreWording"),
  v.literal("feedbackRequested"),
  v.literal("feedbackWithdrawn"),
  v.literal("regenerate"),
  v.literal("retry"),
  v.literal("restoreBatch"),
  v.literal("skip"),
  v.literal("unskip"),
  v.literal("approve"),
  v.literal("staleOpened"),
  v.literal("staleDisposed")
);
const seedDecisionEventOptionalFields = {
  batchId: v.optional(v.id("seedBatches")),
  attemptId: v.optional(v.string()),
  feedbackRequestId: v.optional(v.id("seedFeedbackRequests")),
  seedId: v.optional(v.id("seeds")),
  contextRevision: v.optional(v.string()),
  selectionRevision: v.optional(v.string()),
  contributionHashes: v.optional(
    v.array(
      v.object({
        roleId: seedRoleIdValidator,
        contributionHash: v.string(),
      })
    )
  ),
  outcome: v.optional(v.string()),
  staleEpisodeId: v.optional(v.id("seedStaleEpisodes")),
  editRatio: v.optional(v.number()),
  confirmed: v.optional(v.boolean()),
  snapshot: v.optional(
    v.object({
      items: v.array(
        v.object({
          seedId: v.id("seeds"),
          wordingHash: v.string(),
          selectionVersion: v.number(),
        })
      ),
    })
  ),
};

export default defineSchema({
  // Auth lives in the Better Auth component (see convex/auth.ts). This app
  // users table stays authoritative for role/profile; synced via triggers.
  users: defineTable({
    // Better Auth component user._id; optional while legacy docs relink.
    authId: v.optional(v.string()),
    // Proper name fields (from the invite or /settings). Legacy single-field
    // `name` kept as display fallback — no migration.
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(
      v.union(v.literal("writer"), v.literal("manager"), v.literal("admin"))
    ),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Presentation exposure only. This does not grant a role or capability;
    // route and mutation authorization remain server-side and authoritative.
    isDeveloper: v.optional(v.boolean()),
    // 2026-08-19: workspace Owner exposure (product owner, e.g. Michael).
    // Same contract as isDeveloper — presentation only, not a role or
    // capability; distinct from a project's Owner. Reveals the admin
    // navigation and the Developer/Owner columns on /admin/users.
    isOwner: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_authId", ["authId"]),

  // ─── Invite-only membership: admin-issued signup tokens ────────────────────
  invites: defineTable({
    // Canonical trim+lowercase form at write; legacy rows are backfilled by
    // emailMigration while collision reports remain available for review.
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    role: v.union(v.literal("writer"), v.literal("manager"), v.literal("admin")),
    token: v.string(), // unguessable base64url; the /signup/<token> link
    invitedBy: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(), // createdAt + 7 days
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked")
    ),
    acceptedAt: v.optional(v.number()),
    acceptedUserId: v.optional(v.id("users")),
  })
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_email_and_status", ["email", "status"])
    .index("by_status", ["status"]),

  projects: defineTable({
    usedInDevelopment: v.optional(v.boolean()),
    // Plain-language internal title (set at the start; shown in lists).
    title: v.string(),
    // BNH-23: formal SR&ED / science title for the report (finalized at the end).
    sredTitle: v.optional(v.string()),
    clientName: v.string(),
    writer: v.optional(v.string()),
    interviewer: v.optional(v.string()),
    interviewerUserId: v.optional(v.id("users")),
    // BNH-22: client-side interview participants (names, free text).
    interviewees: v.optional(v.array(v.string())),
    // BNH-35: applied tags (admin-curated taxonomy in `tags`).
    tagIds: v.optional(v.array(v.id("tags"))),
    // BNH-36: client's fiscal year-end (timestamp) — drives company → fiscal-year
    // grouping on the dashboard. "Fiscal 2025" = the year of this date.
    fiscalYearEnd: v.optional(v.number()),
    // BNH-10: industry routes Brain retrieval to the matching namespace
    // ("use the software brain for software reports"). Optional until backfilled.
    industry: v.optional(v.string()),
    // BNH-54: CRA T4088 line 206 field of science or technology code.
    scienceCode: v.optional(v.string()),
    // 2026-08-11 amendment — per-company project numbering. Final projects
    // carry "1".."20" (sequential, no gaps per company); uncertain/draft
    // projects carry a letter "A".."Z" until converted. Conversion is a
    // label-only change; validation lives in projects.setProjectNumber.
    projectNumber: v.optional(v.string()),
    // PSOS-11 widen phase. These additive fields power bounded dashboard
    // projections without changing canonical project/workflow semantics.
    dashboardCompanyKey: v.optional(v.string()),
    dashboardFiscalYearRank: v.optional(v.number()),
    dashboardSearchText: v.optional(v.string()),
    dashboardCompanyCounted: v.optional(v.boolean()),
    generationActivity: v.optional(
      v.union(
        v.literal("generating"),
        v.literal("awaiting_selection"),
        v.literal("awaiting_input")
      )
    ),
    lastViewedAt: v.optional(v.number()),
    // BNH-39: how the project started — generate a PD from a transcript
    // (default, absent on older projects) or review an existing written PD.
    mode: v.optional(v.union(v.literal("generate"), v.literal("review"))),
    // 2026-08-14 widen: work-product identity. Legacy rows dual-read from
    // mode (review => review; otherwise writing) until the dashboard
    // backfill materializes this optional field.
    projectType: v.optional(projectTypeValidator),
    // 2026-08-11 (second) amendment — review projects created from an
    // existing project: on a review project, the source project whose report
    // snapshot is under review (review → source). Navigational association
    // only — no workflow, ownership, or outcome coupling crosses it. Set once
    // at creation by reviewFromProject.createReviewFromProject.
    sourceProjectId: v.optional(v.id("projects")),
    // Story 0 (AD-19) deletion barrier. Set once by projects.deleteProject in
    // the transaction that decrements the dashboard bucket and terminalizes
    // live generation work; the paginated purge then owns the row until it
    // deletes it last. Async writers (candidate/section claims, post-QA)
    // return early when it is set. Never cleared, never backfilled.
    deletionStartedAt: v.optional(v.number()),
    // PSOS-07 widen phase. Owner is durable accountability and never replaces
    // immutable createdBy. Human workflow remains separate from legacy status
    // and technical generation state. PSOS-08 owns backfill.
    ownerId: v.optional(v.id("users")),
    // PSOS-08: writer matching fell back to the immutable creator but an
    // administrator still needs to confirm or correct the accountable owner.
    ownerBackfillStatus: v.optional(v.literal("needs_review")),
    workflowStage: v.optional(workflowStageValidator),
    workflowStageRank: v.optional(v.number()),
    workflowUpdatedAt: v.optional(v.number()),
    // PSOS-09: monotonic OCC token shared by ownership and workflow-stage
    // mutations. Existing/backfilled rows omit it and therefore begin at 0.
    workflowVersion: v.optional(v.number()),
    // PSOS-12: denormalized pointer to the one open blocking work item.
    // Canonical details remain on workItems and are validated at read time.
    currentHandoffId: v.optional(v.id("workItems")),
    status: v.union(
      v.literal("draft"),
      v.literal("generating"),
      v.literal("review"),
      v.literal("client_review"),
      v.literal("final")
    ),
    // Active generation fencing and an explicitly published review revision.
    activeGenerationId: v.optional(v.id("generations")),
    sharedReportId: v.optional(v.id("reports")),
    // Filing approval is deliberately human-authored and becomes stale when
    // evidence or the approved report revision changes.
    filingAttestation: v.optional(
      v.object({
        status: v.union(v.literal("approved"), v.literal("blocked")),
        reviewedBy: v.id("users"),
        reviewedAt: v.number(),
        evidenceCutoffAt: v.number(),
        reportId: v.optional(v.id("reports")),
        revisionNumber: v.optional(v.number()),
        note: v.optional(v.string()),
      })
    ),
    createdBy: v.id("users"),
    shareToken: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // 2026-09-24 widen (transcript method): transcript rows archived by
    // Replace and Remove, kept for the generations that froze them. Counted
    // here so the transcript history cap never reads archived text; absent
    // means none.
    archivedTranscriptCount: v.optional(v.number()),
  })
    .index("by_createdBy", ["createdBy"])
    .index("by_status", ["status"])
    .index("by_shareToken", ["shareToken"])
    .index("by_industry", ["industry"])
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerBackfillStatus", ["ownerBackfillStatus"])
    .index("by_ownerId_and_workflowStage", ["ownerId", "workflowStage"])
    .index("by_ownerId_and_workflowStageRank_and_updatedAt", [
      "ownerId",
      "workflowStageRank",
      "updatedAt",
    ])
    .index("by_workflowStage", ["workflowStage"])
    .index("by_dashboardCompanyKey", ["dashboardCompanyKey"])
    .index("by_dashboardCompanyKey_and_dashboardFiscalYearRank", [
      "dashboardCompanyKey",
      "dashboardFiscalYearRank",
    ])
    // 2026-08-06 second amendment (Client → Status widen phase): per-client
    // stage-ordered pagination. Rank is the FROZEN persisted rank
    // (on_hold=7 before delivered=8); presentation re-maps complete runs
    // into WORKFLOW_STAGE_PIPELINE_ORDER. Rows with a missing rank sort
    // before all ranked rows — the rank-presence verification pass
    // (dashboardBackfill.verifyStageCounts Pass 0) must report zero before
    // consumers treat this index as complete.
    .index("by_dashboardCompanyKey_and_workflowStageRank_and_updatedAt", [
      "dashboardCompanyKey",
      "workflowStageRank",
      "updatedAt",
    ])
    .index("by_client_owner_stage_rank_updated", [
      "dashboardCompanyKey",
      "ownerId",
      "workflowStageRank",
      "updatedAt",
    ])
    .index("by_createdAt", ["createdAt"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_lastViewedAt", ["lastViewedAt"])
    // Story 0 (AD-19): review projects pointing at a deleted source are
    // detached by the purge's final page through this range.
    .index("by_sourceProjectId", ["sourceProjectId"])
    .searchIndex("search_dashboardSearchText", {
      searchField: "dashboardSearchText",
      filterFields: ["workflowStage", "ownerId", "industry", "scienceCode"],
    }),

  dashboardBackfillRuns: defineTable({
    runKey: v.string(),
    // "failed" (2026-08-06 correction): a live stageCounts run aborts —
    // rather than writing counts on an unverified base — when Pass 0 finds
    // projects with a missing workflowStageRank; the remediation is recorded
    // in `note`. Failed and completed runs can both be re-run.
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    dryRun: v.boolean(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    // 2026-08-06 second amendment: verification counters recorded by the
    // stageCounts backfill passes (rank-presence, patched companies,
    // verification mismatches, over-bound companies, projectCount-divergent
    // companies). Server-written only.
    stats: v.optional(v.record(v.string(), v.number())),
    // Human-readable failure/remediation note (server-written only).
    note: v.optional(v.string()),
  }).index("by_runKey", ["runKey"]),

  dashboardCompanies: defineTable({
    companyKey: v.string(),
    clientName: v.string(),
    projectCount: v.number(),
    // 2026-08-06 second amendment (widen phase): exact per-client stage
    // counts. Keys are canonical stage literals plus "legacy"; invariant
    // sum(stageCounts) === projectCount. Optional during widen — absent
    // means "not yet backfilled" and consumers MUST fail honest (loaded-only
    // counts, hide-empty disabled), never treat absence as zero. Maintained
    // in the same transaction as stage transitions, project create/delete,
    // and client-name reassignment; the verified backfill establishes it on
    // pre-widen rows. Written only by server mutations (never client input).
    stageCounts: v.optional(v.record(v.string(), v.number())),
    updatedAt: v.number(),
  })
    .index("by_companyKey", ["companyKey"])
    .index("by_companyKey_and_updatedAt", ["companyKey", "updatedAt"]),

  // PSOS-07: append-only project audit history. No update/delete API is
  // exported; later tickets widen this discriminated union for new event kinds.
  ownerBackfillRuns: defineTable({
    runKey: v.string(),
    actorId: v.id("users"),
    totals: v.object({
      scanned: v.number(),
      ownerFromWriter: v.number(),
      ownerFromCreator: v.number(),
      flaggedForReview: v.number(),
      stageDrafting: v.number(),
      stageIntake: v.number(),
      skippedOwner: v.number(),
      skippedStage: v.number(),
    }),
    completedAt: v.number(),
  }).index("by_runKey", ["runKey"]),

  projectEvents: defineTable(
    v.union(
      v.object({
        projectId: v.id("projects"),
        type: v.literal("ownership_transferred"),
        actorId: v.id("users"),
        at: v.number(),
        from: v.optional(v.id("users")),
        to: v.id("users"),
        note: v.optional(v.string()),
      }),
      v.object({
        projectId: v.id("projects"),
        type: v.literal("stage_changed"),
        actorId: v.id("users"),
        at: v.number(),
        from: v.optional(workflowStageValidator),
        to: workflowStageValidator,
        note: v.optional(v.string()),
      })
    )
  )
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_type", ["projectId", "type"])
    // Additive (2026-08-07): bounded newest-first activity reads for the
    // read-only project activity timeline. Widen-only — no data migration.
    .index("by_projectId_and_at", ["projectId", "at"]),

  workItems: defineTable({
    projectId: v.id("projects"),
    kind: workItemKindValidator,
    assigneeId: v.id("users"),
    assignerId: v.id("users"),
    dueAt: v.optional(v.number()),
    dueSortAt: v.optional(v.number()),
    instructions: v.string(),
    blocking: v.boolean(),
    status: workItemStatusValidator,
    completedAt: v.optional(v.number()),
    completedBy: v.optional(v.id("users")),
    resolutionNote: v.optional(v.string()),
    version: v.number(),
    createRequestId: v.string(),
    createRequestFingerprint: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_assigneeId_and_status", ["assigneeId", "status"])
    .index("by_assigneeId_and_status_and_dueAt", ["assigneeId", "status", "dueAt"])
    .index("by_assigneeId_and_status_and_kind_and_dueAt", [
      "assigneeId",
      "status",
      "kind",
      "dueAt",
    ])
    .index("by_assigneeId_and_status_and_dueSortAt", [
      "assigneeId",
      "status",
      "dueSortAt",
    ])
    .index("by_assigneeId_and_status_and_kind_and_dueSortAt", [
      "assigneeId",
      "status",
      "kind",
      "dueSortAt",
    ])
    .index("by_assignerId_and_status", ["assignerId", "status"])
    .index("by_assignerId_and_status_and_dueAt", ["assignerId", "status", "dueAt"])
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_projectId_and_status_and_blocking", ["projectId", "status", "blocking"])
    .index("by_projectId_and_status_and_dueAt", ["projectId", "status", "dueAt"])
    .index("by_status_and_dueAt", ["status", "dueAt"])
    .index("by_assignerId_and_createRequestId", ["assignerId", "createRequestId"]),

  workItemOversight: defineTable({
    viewerId: v.id("users"),
    workItemId: v.id("workItems"),
    projectId: v.id("projects"),
    assigneeId: v.id("users"),
    dueSortAt: v.number(),
    sourceAssigner: v.boolean(),
    sourceOwner: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_viewerId_and_dueSortAt", ["viewerId", "dueSortAt"])
    .index("by_viewerId_and_workItemId", ["viewerId", "workItemId"])
    .index("by_workItemId", ["workItemId"])
    .index("by_projectId_and_viewerId", ["projectId", "viewerId"]),

  oversightRebuilds: defineTable({
    projectId: v.id("projects"),
    reason: v.union(
      v.literal("ownership_transfer"),
      v.literal("owner_review_assign"),
      v.literal("repair")
    ),
    fromOwnerId: v.optional(v.id("users")),
    toOwnerId: v.id("users"),
    affectedViewerIds: v.optional(v.array(v.id("users"))),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("superseded"),
      v.literal("failed")
    ),
    cursor: v.optional(v.string()),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_fromOwnerId_and_status", ["fromOwnerId", "status"])
    .index("by_toOwnerId_and_status", ["toOwnerId", "status"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),

  oversightSyncing: defineTable({
    viewerId: v.id("users"),
    projectId: v.id("projects"),
    rebuildId: v.id("oversightRebuilds"),
    startedAt: v.number(),
  })
    .index("by_viewerId", ["viewerId"])
    .index("by_rebuildId", ["rebuildId"])
    .index("by_projectId", ["projectId"]),

  myWorkBackfillRuns: defineTable({
    runKey: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    phase: v.optional(v.union(v.literal("projects"), v.literal("workItems"), v.literal("verifyProjects"), v.literal("verifyWorkItems"))),
    dryRun: v.boolean(),
    cursor: v.optional(v.string()),
    scanned: v.number(),
    patched: v.number(),
    verificationMismatches: v.optional(v.number()),
    startedAt: v.number(),
    updatedAt: v.number(),
    verifiedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_runKey", ["runKey"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_status_and_dryRun_and_updatedAt", ["status", "dryRun", "updatedAt"]),

  workItemEvents: defineTable(
    v.union(
      v.object({
        workItemId: v.id("workItems"), projectId: v.id("projects"),
        type: v.literal("created"), actorId: v.id("users"), at: v.number(), itemVersion: v.number(),
        detail: v.object({ kind: workItemKindValidator, assigneeId: v.id("users"), blocking: v.boolean(), dueAt: v.optional(v.number()) }),
      }),
      v.object({
        workItemId: v.id("workItems"), projectId: v.id("projects"),
        type: v.literal("reassigned"), actorId: v.id("users"), at: v.number(), itemVersion: v.number(),
        detail: v.object({ fromAssigneeId: v.id("users"), toAssigneeId: v.id("users"), note: v.optional(v.string()) }),
      }),
      v.object({
        workItemId: v.id("workItems"), projectId: v.id("projects"),
        type: v.literal("blocking_changed"), actorId: v.id("users"), at: v.number(), itemVersion: v.number(),
        detail: v.object({ fromBlocking: v.boolean(), toBlocking: v.boolean(), note: v.optional(v.string()) }),
      }),
      v.object({
        workItemId: v.id("workItems"), projectId: v.id("projects"),
        type: v.literal("due_changed"), actorId: v.id("users"), at: v.number(), itemVersion: v.number(),
        detail: v.object({ fromDueAt: v.optional(v.number()), toDueAt: v.optional(v.number()), note: v.optional(v.string()) }),
      }),
      v.object({
        workItemId: v.id("workItems"), projectId: v.id("projects"),
        type: v.literal("completed"), actorId: v.id("users"), at: v.number(), itemVersion: v.number(),
        detail: v.object({ resolutionNote: v.optional(v.string()), onBehalfOfAssignee: v.boolean() }),
      }),
      v.object({
        workItemId: v.id("workItems"), projectId: v.id("projects"),
        type: v.literal("declined"), actorId: v.id("users"), at: v.number(), itemVersion: v.number(),
        detail: v.object({ reason: v.string() }),
      }),
      v.object({
        workItemId: v.id("workItems"), projectId: v.id("projects"),
        type: v.literal("canceled"), actorId: v.id("users"), at: v.number(), itemVersion: v.number(),
        detail: v.object({ reason: v.optional(v.string()) }),
      })
    )
  )
    .index("by_workItemId", ["workItemId"])
    .index("by_workItemId_and_itemVersion", ["workItemId", "itemVersion"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_at", ["projectId", "at"]),

  // ─── BNH-35: admin-curated project tags (nested via parentId) ──────────────
  tags: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("tags")),
    // "industry" (seeded taxonomy), "writer" (assignment), or "custom".
    kind: v.optional(
      v.union(v.literal("industry"), v.literal("writer"), v.literal("custom"))
    ),
    createdAt: v.number(),
  }).index("by_parentId", ["parentId"]),

  // ─── BNH-16: per-call AI token usage + estimated cost ───────────────────────
  aiUsage: defineTable({
    projectId: v.optional(v.id("projects")),
    generationId: v.optional(v.id("generations")),
    candidateRunId: v.optional(v.id("generationCandidateRuns")),
    durationMs: v.optional(v.number()),
    userId: v.optional(v.string()),
    writerName: v.optional(v.string()),
    agentThreadId: v.optional(v.string()),
    callSite: v.string(), // e.g. "generation:242", "chat", "financial"
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheCreationInputTokens: v.optional(v.number()),
    // 2026-09-24 widen: the part of cacheCreationInputTokens written with the
    // 1-hour TTL (2x input rather than 1.25x). Absent on older rows.
    cacheCreation1hInputTokens: v.optional(v.number()),
    cacheReadInputTokens: v.optional(v.number()),
    costUsd: v.number(),
    // 2026-09-24 widen: "native" when the provider reported the charge
    // (OpenRouter usage.cost), "estimated" when it came from
    // shared/modelPricing.ts. Absent on rows written before the field.
    costSource: v.optional(v.union(v.literal("native"), v.literal("estimated"))),
    // 2026-09-25 widen: why the provider stopped, as it reported it
    // (Anthropic `stop_reason`, OpenRouter `finish_reason`), so an answer
    // cut off at the output limit ("max_tokens", "length") is visible.
    // Absent on older rows and when the provider sent none.
    stopReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_createdAt", ["projectId", "createdAt"])
    .index("by_generationId", ["generationId"]),

  transcripts: defineTable({
    projectId: v.id("projects"),
    content: v.string(),
    createdAt: v.number(),
    // 2026-09-03 widen: multiple transcripts per project. Legacy rows have
    // none of the three; readers go through convex/lib/transcripts.ts, which
    // labels them "Interview transcript" and orders them by createdAt.
    label: v.optional(v.string()),
    position: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    // 2026-09-24 widen (transcript method, docs/product-domain.md): the
    // uploaded original, what the parser detected and read, archive state
    // for Replace and Remove, and the speaker and facts pipeline states.
    // `content` stays verbatim and immutable; every turn and fact offset
    // indexes into it.
    originalStorageId: v.optional(v.id("_storage")),
    sourceFormat: v.optional(transcriptSourceFormatValidator),
    parserVersion: v.optional(v.string()),
    // The turn build chain that owns this row's rebuild. A chain that finds
    // another id here stops, so two chains never interleave their writes.
    // The id carries its start time (`structureBuildStartedAt`).
    structureBuildId: v.optional(v.string()),
    // An upload asked for the model's look at speakers the rules could not
    // place. Kept on the row, so a chain that takes the build over still
    // asks; cleared when the build finishes.
    structureModelRoles: v.optional(v.boolean()),
    // 2026-09-25 widen (review): the names the speaker labels hold besides
    // the labels themselves, written by the build with `parserVersion`, so a
    // placeholder map built at generation start reads them instead of
    // parsing the text again. Absent when too many to keep; then the text
    // is parsed.
    speakerNames: v.optional(
      v.object({
        parserVersion: v.string(),
        otherNames: v.array(v.string()),
        organizations: v.array(v.string()),
      })
    ),
    archivedAt: v.optional(v.number()),
    supersededById: v.optional(v.id("transcripts")),
    speakerStatus: v.optional(
      v.union(v.literal("unchecked"), v.literal("needs_check"), v.literal("confirmed"))
    ),
    factsStatus: v.optional(
      v.union(v.literal("none"), v.literal("queued"), v.literal("ready"), v.literal("failed"))
    ),
    factsVersion: v.optional(v.string()),
  })
    .index("by_projectId", ["projectId"])
    // A project's active rows (archivedAt absent) without reading archived
    // text: every project transcript read goes through this index.
    .index("by_projectId_and_archivedAt", ["projectId", "archivedAt"])
    .index("by_originalStorageId", ["originalStorageId"])
    // Same text in another project: its roles and facts carry over.
    .index("by_contentHash", ["contentHash"]),

  // 2026-09-24 widen: one row per speaker turn of a transcript, parsed on
  // the server from the stored text (shared/transcriptParse.ts). Offsets
  // index the transcript's verbatim `content`.
  transcriptTurns: defineTable({
    transcriptId: v.id("transcripts"),
    projectId: v.id("projects"),
    parserVersion: v.string(),
    index: v.number(),
    speakerLabel: v.optional(v.string()),
    startMs: v.optional(v.number()),
    endMs: v.optional(v.number()),
    charStart: v.number(),
    charEnd: v.number(),
    cleanText: v.string(),
  })
    .index("by_transcriptId_and_index", ["transcriptId", "index"])
    // 2026-09-25: the turns a cited span touches, without reading the rest
    // (owner decision 25 outside facts mode, convex/lib/citationSpeakers.ts).
    .index("by_transcriptId_and_charStart", ["transcriptId", "charStart"])
    .index("by_projectId", ["projectId"]),

  // 2026-09-24 widen: one role per speaker label of a transcript. Roles are
  // joined to turns at render time, so a correction never rewrites turns.
  transcriptSpeakers: defineTable({
    transcriptId: v.id("transcripts"),
    projectId: v.id("projects"),
    label: v.string(),
    role: transcriptSpeakerRoleValidator,
    roleSource: v.union(v.literal("heuristic"), v.literal("model"), v.literal("consultant")),
    confidence: v.number(),
    turnCount: v.number(),
    sampleTurnIndex: v.optional(v.number()),
    confirmedBy: v.optional(v.id("users")),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_transcriptId_and_label", ["transcriptId", "label"])
    .index("by_projectId", ["projectId"]),

  // 2026-09-24 widen: verified SR&ED facts of one transcript text. Generation
  // input only, never report prose; each quote was located in the verbatim
  // transcript and byte-checked before the row was written.
  transcriptFacts: defineTable({
    transcriptId: v.id("transcripts"),
    projectId: v.id("projects"),
    sourceContentHash: v.string(),
    factsVersion: v.string(),
    key: v.string(),
    type: transcriptFactTypeValidator,
    claim: v.string(),
    turnIndexes: v.array(v.number()),
    quotes: v.array(
      v.object({
        charStart: v.number(),
        charEnd: v.number(),
        exactExcerpt: v.string(),
        match: v.union(v.literal("exact"), v.literal("normalized")),
      })
    ),
    speakerLabel: v.optional(v.string()),
    confidence: v.number(),
  })
    .index("by_transcriptId_and_factsVersion", ["transcriptId", "factsVersion"])
    .index("by_projectId", ["projectId"]),

  // 2026-09-24 widen: one row per extraction of a transcript text under a
  // FACTS_VERSION, so extraction runs once and a failure is visible.
  transcriptFactRuns: defineTable({
    transcriptId: v.id("transcripts"),
    projectId: v.id("projects"),
    sourceContentHash: v.string(),
    factsVersion: v.string(),
    model: v.string(),
    adapter: v.optional(v.union(v.literal("citations"), v.literal("structured"), v.literal("copy"))),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("ready"), v.literal("failed")),
    counts: v.object({ proposed: v.number(), verified: v.number(), dropped: v.number() }),
    usage: v.optional(
      v.object({ inputTokens: v.number(), outputTokens: v.number(), costUsd: v.optional(v.number()) })
    ),
    error: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    // 2026-09-25 widen: the speaker labels whose words were not evidence
    // when the facts were extracted (interviewer or other). A ready run goes
    // stale when one of them becomes client or unknown, so the next request
    // extracts again (review of step 5).
    excludedLabels: v.optional(v.array(v.string())),
    // 2026-09-25 widen: the parser version of the turns the facts index. A
    // ready run is stale once the transcript is rebuilt with another one.
    parserVersion: v.optional(v.string()),
  })
    .index("by_transcriptId_and_sourceContentHash_and_factsVersion", [
      "transcriptId",
      "sourceContentHash",
      "factsVersion",
    ])
    .index("by_projectId", ["projectId"]),

  // 2026-09-03 widen: multiple transcripts per project. Condensed stand-in for
  // one transcript, reused across generations. Keyed by the transcript, the
  // hash of the text it was built from and CONDENSE_VERSION, so a re-condense
  // happens only when the text or the condense contract changes.
  transcriptDigests: defineTable({
    transcriptId: v.id("transcripts"),
    projectId: v.id("projects"),
    sourceContentHash: v.string(),
    condenseVersion: v.string(),
    // Rendered text fed to the prompt.
    content: v.string(),
    // JSON string of the validated digest object.
    structured: v.string(),
    // 2026-09-25 widen: the same windows typed (dual write; filled on older
    // rows by transcriptDigests.backfillStructuredData). Readers take this
    // first. `structured` stays written for code that predates it.
    structuredData: v.optional(transcriptDigestStructuredValidator),
    model: v.string(),
    promptVersion: v.string(),
    charCount: v.number(),
    originalLength: v.number(),
    createdAt: v.number(),
  })
    .index("by_transcriptId_and_sourceContentHash_and_condenseVersion", [
      "transcriptId",
      "sourceContentHash",
      "condenseVersion",
    ])
    .index("by_projectId", ["projectId"]),

  qaFindings: defineTable({
    section: v.optional(v.string()),
    findingKey: v.optional(v.string()),
    reportId: v.id("reports"),
    revisionNumber: v.number(),
    contentHash: v.string(),
    check: v.string(),
    message: v.string(),
    blocking: v.boolean(),
  })
    .index("by_reportId_and_revisionNumber_and_contentHash_and_findingKey", ["reportId", "revisionNumber", "contentHash", "findingKey"])
    // 2026-09-25: replaces the index that carried the finding message text;
    // the message is matched on the (few) rows of one check instead.
    .index("by_reportId_and_contentHash_and_check_and_blocking", ["reportId", "contentHash", "check", "blocking"])
    .index("by_reportId_and_revisionNumber_and_contentHash_and_blocking", ["reportId", "revisionNumber", "contentHash", "blocking"]),

  reports: defineTable({
    projectId: v.id("projects"),
    content: v.string(),
    version: v.number(),
    generatedAt: v.number(),
    updatedAt: v.number(),
    generationId: v.optional(v.id("generations")),
    sourceTranscriptId: v.optional(v.id("transcripts")),
    // 2026-09-03 widen: the full ordered set; sourceTranscriptId stays the first.
    sourceTranscriptIds: v.optional(v.array(v.id("transcripts"))),
    provenanceId: v.optional(v.id("reportProvenance")),
    revisionNumber: v.optional(v.number()),
    contentHash: v.optional(v.string()),
  })
    .index("by_projectId", ["projectId"])
    .index("by_generationId", ["generationId"]),

  comments: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    commenterId: v.string(),
    commenterType: v.union(v.literal("client"), v.literal("writer")),
    highlightFrom: v.number(),
    highlightTo: v.number(),
    highlightText: v.string(),
    body: v.string(),
    suggestedEdit: v.optional(v.string()),
    resolved: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_reportId", ["reportId"]),

  commenters: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  financialUploads: defineTable({
    projectId: v.id("projects"),
    fileName: v.string(),
    fileType: v.union(
      v.literal("slack_export"),
      v.literal("whatsapp_chat"),
      v.literal("git_log"),
      v.literal("timesheet"),
      v.literal("trial_balance"),
      v.literal("general_ledger"),
      v.literal("other")
    ),
    content: v.string(),
    createdAt: v.number(),
    processingStatus: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed")
      )
    ),
    processingError: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  }).index("by_projectId", ["projectId"]),

  timesheetEntries: defineTable({
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
    personName: v.string(),
    date: v.string(),
    hours: v.number(),
    hoursBasis: v.optional(v.union(v.literal("explicit"), v.literal("estimated"))),
    description: v.string(),
    sredEligible: v.boolean(),
    sredReason: v.optional(v.string()),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    source: v.string(),
    reviewStatus: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))
    ),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_projectId", ["projectId"])
    .index("by_uploadId", ["uploadId"]),

  financialSummaries: defineTable({
    projectId: v.id("projects"),
    totalHours: v.number(),
    sredHours: v.number(),
    nonSredHours: v.number(),
    personnelBreakdown: v.string(),
    generatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  reportViews: defineTable({
    projectId: v.id("projects"),
    viewerName: v.string(),
    viewerType: v.union(v.literal("client"), v.literal("writer")),
    viewedAt: v.number(),
    reportId: v.optional(v.id("reports")),
    reportVersion: v.optional(v.number()),
    revisionNumber: v.optional(v.number()),
    snapshotId: v.optional(v.id("reportSnapshots")),
    contentHash: v.optional(v.string()),
  }).index("by_projectId", ["projectId"]),

  generations: defineTable({
    projectId: v.id("projects"),
    // 2026-09-03 widen: absent when the project has no transcript (docs-only
    // generation).
    transcriptId: v.optional(v.id("transcripts")),
    // 2026-09-03 widen: multiple transcripts per project. The frozen set in
    // position order, how it was fed to the model, and the digests used when
    // inputMode is "digest".
    transcriptIds: v.optional(v.array(v.id("transcripts"))),
    inputMode: v.optional(v.union(v.literal("full"), v.literal("digest"))),
    digestIds: v.optional(v.array(v.id("transcriptDigests"))),
    // 2026-09-24 widen (transcript method): whether this generation reads
    // fact packs in place of digests or full text (the transcripts.factsMode
    // setting applied at reservation), and the frozen, reversible name
    // placeholder map every generation-owned provider call uses.
    transcriptFacts: v.optional(v.boolean()),
    placeholders: v.optional(v.array(v.object({ token: v.string(), value: v.string() }))),
    status: v.union(
      v.literal("reserved"),
      v.literal("running"),
      v.literal("awaiting_selection"),
      // Iterative mode: a section draft is waiting on the writer's
      // review/approval. Writer thinking time is unbounded — never reaped.
      v.literal("awaiting_input"),
      v.literal("completed"),
      v.literal("failed"),
      // Sprint 1 story 8 (CAP-7): a partial generation whose failed
      // candidates were retried into a linked recovery generation. Terminal;
      // excluded from history and stats; never "completed" without a report.
      v.literal("superseded")
    ),
    requestedAt: v.optional(v.number()),
    requestedBy: v.optional(v.id("users")),
    // Stable deployment-level prompt program and the exact learned guidance
    // disclosed through generation-owned provider calls. Optional for legacy
    // rows; learningDigestIds presence marks a reservation created after this
    // provenance contract shipped.
    promptVersion: v.optional(v.string()),
    learningDigestIds: v.optional(v.array(v.id("learningDigests"))),
    lengthTarget: v.optional(
      v.union(v.literal("concise"), v.literal("standard"), v.literal("full"))
    ),
    candidateMode: v.optional(
      v.union(
        v.literal("compare"),
        v.literal("single"),
        // Section-by-section drafting with writer approval between sections;
        // a background one-shot "ghost" draft runs for comparison only.
        v.literal("iterative")
      )
    ),
    // Step-by-step seeds story 1 (AD-31/33/40). Optional on this existing
    // table so pre-feature generations remain valid without a backfill.
    gatedWorkflow: v.optional(v.union(v.literal("sections"), v.literal("seeds"))),
    seedStageError: v.optional(v.string()),
    // undefined = not pinned; null = derive only from frozen startup sources.
    seedBriefPin: v.optional(v.union(v.id("generationBriefs"), v.null())),
    seedBriefInputsHash: v.optional(v.string()),
    seedStageVersion: v.optional(v.number()),
    briefVersionId: v.optional(v.id("generationBriefs")),
    summaryVersionId: v.optional(v.id("summaryVersions")),
    originGenerationId: v.optional(v.id("generations")),
    sourceIdMap: v.optional(
      v.array(
        v.object({
          originSourceId: v.id("generationSources"),
          recoverySourceId: v.id("generationSources"),
        })
      )
    ),
    seedRequestsReserved: v.optional(v.number()),
    singleModelId: v.optional(v.string()),
    // 2026-09-24 widen (model catalog): every model this generation uses,
    // frozen at reservation. Absent on older rows, which resolve from the
    // seed registry exactly as before.
    modelFreeze: v.optional(modelFreezeValidator),
    // Compare mode's persisted model pair (exactly 2 ids). Absent on legacy
    // rows, which fall back to the full candidate roster.
    compareModelIds: v.optional(v.array(v.string())),
    retryOfGenerationId: v.optional(v.id("generations")),
    // A recovery generation can rerun only the failed models while carrying
    // successful candidates forward. The full compare pair remains in
    // compareModelIds for provenance; this bounded subset drives scheduling.
    retryModelIds: v.optional(v.array(v.string())),
    seededCandidates: v.optional(v.number()),
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
    previousProjectStatus: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("generating"),
        v.literal("review"),
        v.literal("client_review"),
        v.literal("final")
      )
    ),
    // Legacy home of the agent outputs JSON. Since 2026-09-25 it, and
    // `brainProvenance` and `brainRetrievalBrief` below, live in
    // `generationArtifacts` rows once `outputsInArtifactsAt` is set (every new
    // generation, older ones after generations.backfillGenerationOutputs or
    // their first output write); the row fields are then never written again
    // and never read (convex/lib/generationOutputs.ts).
    agentOutputs: v.optional(v.string()),
    outputsInArtifactsAt: v.optional(v.number()),
    currentStep: v.optional(v.string()),
    // Legacy progress narration. Since 2026-09-25 new lines are rows of
    // `generationProgress`; this array is only read (dual read) and never
    // written again. `progressLogCopiedAt` marks a row whose array
    // generations.backfillGenerationProgress has copied into child rows, so
    // readers stop reading the array.
    progressLog: v.optional(v.array(v.string())),
    progressLogCopiedAt: v.optional(v.number()),
    // BNH-21: time-estimate + milestone progress for the loading screen.
    estimatedMs: v.optional(v.number()),
    totalCandidates: v.optional(v.number()),
    candidatesDone: v.optional(v.number()),
    candidatesFailed: v.optional(v.number()),
    // Post-assembly QA pass (iterative mode): survives panel close/reopen so
    // the UI can't re-trigger a pass that is already running.
    postQaStatus: v.optional(
      v.union(v.literal("running"), v.literal("done"), v.literal("failed"))
    ),
    // When the current post-QA pass flipped to "running" — the stale-pass
    // reaper's clock. Absent on rows from before the reaper existed (treated
    // as already stale, since nothing can still be running them).
    postQaStartedAt: v.optional(v.number()),
    // When the latest post-QA pass settled (done or failed). The report page
    // keys its browser-local "QA result seen" state on it (CAP-18).
    postQaCompletedAt: v.optional(v.number()),
    // Overall score from the post-assembly QA pass (one-shot modes carry the
    // score inside agentOutputs.qa instead).
    qaScore: v.optional(v.number()),
    // BNH-10 flywheel: which Brain exemplars fed this generation (provenance
    // for usefulness analytics; entryId FKs into the RAG component, sourceId
    // into brainSources). `section` says which consumer used it (analyzer/
    // 242/244/246); searchScore/rerankScore keep the raw signals separate
    // from the final blended score.
    brainProvenance: v.optional(v.array(brainProvenanceEntryValidator)),
    // The Haiku-extracted retrieval brief (JSON) behind the section queries —
    // kept for retrieval-quality evals.
    brainRetrievalBrief: v.optional(v.string()),
    // Story 1 (CAP-1/2/4): the generation's Brief (Storyline, Claim Exclusions,
    // Confidence Map, Glossary Terms). Optional; keyed to inputs via inputsHash
    // so identical inputs reuse the same Brief.
    briefId: v.optional(v.id("generationBriefs")),
    // DW-109/DW-120: what this generation's Brief stage attempt did (derived,
    // reused, no_evidence, or failed with a provider code and bounded raw
    // detail for ops). Written only by generations.recordBriefOutcome; never
    // backfilled. Absent means no outcome was recorded (a legacy row, or the
    // stage was never reached). Independent of briefId.
    briefOutcome: v.optional(briefOutcomeValidator),
    // Story 2 (CAP-5, AD-24): ordered, ungated generation in single/compare.
    // The writer's stop request (stopOrderedGeneration), the section the
    // chain stopped after when fewer than all sections were drafted, and the
    // Build Order actually run. Compliance Notes live in their own table.
    stopRequestedAt: v.optional(v.number()),
    stoppedAfterSection: v.optional(sectionNumberValidator),
    productionOrder: v.optional(v.array(sectionNumberValidator)),
    // Redraft after Stop (owner decision 20, PRD FR-43): a signed-off seed
    // generation stays `completed`; this sub-state tracks drafting only its
    // "Not drafted" Sections into the same report. `attemptStartedAt` fences
    // every redraft write, so a stale action cannot touch a newer attempt.
    redraft: v.optional(
      v.object({
        status: v.union(
          v.literal("running"),
          v.literal("completed"),
          v.literal("failed")
        ),
        attemptStartedAt: v.number(),
        requestedBy: v.id("users"),
        sections: v.array(sectionNumberValidator),
        lastProgressAt: v.number(),
        completedAt: v.optional(v.number()),
        filledSections: v.optional(v.array(sectionNumberValidator)),
        error: v.optional(v.string()),
      })
    ),
    // 2026-09-25 (owner decision 32): the analysis and Brain retrieval a
    // Step-by-step generation prepares in the background while the writer
    // works the Seeds. Sign-off needs `ready`. `attempt` fences every write,
    // so a stale action cannot settle a newer attempt. Written only through
    // transitionDraftingInputs; absent on generations started before the
    // reorder, which froze both inputs before their seed stage opened.
    draftingInputs: v.optional(
      v.object({
        status: v.union(
          v.literal("preparing"),
          v.literal("ready"),
          v.literal("failed")
        ),
        attempt: v.number(),
        startedAt: v.number(),
        settledAt: v.optional(v.number()),
        // Why the attempt failed, as a normalized code only (never provider
        // or model text). Set on `failed` only.
        failureCode: v.optional(draftingInputsFailureCodeValidator),
        // Set once an attempt was cut off at the analyzer's output limit:
        // every later attempt asks for a shorter analysis.
        shorterAnalysis: v.optional(v.boolean()),
      })
    ),
    // Story 3 (CAP-8, AD-26): the Writer Profile this generation ran under —
    // saved profile, or a settings document supplied as Writer's Notes or an
    // attachment — and the save offer. Written only by
    // generations.recordWriterSettings; absent on legacy rows.
    writerSettings: v.optional(writerSettingsValidator),
    // DW-119: when the ordered chain last made progress (a section run
    // created, claimed or drafted). failStaleGenerations ages a running
    // single/compare generation from this stamp instead of startedAt, so a
    // slow but live chain is never reaped while a chain whose action died
    // stops stamping and is. Absent on iterative and legacy rows.
    lastProgressAt: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_projectId", ["projectId"])
    .index("by_retryOfGenerationId", ["retryOfGenerationId"])
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_status_and_startedAt", ["status", "startedAt"])
    .index("by_startedAt", ["startedAt"])
    .index("by_postQaStatus", ["postQaStatus"]),

  // 2026-09-25: one row per progress narration line of a generation (the
  // live "thinking" log), in place of the unbounded array on the generation
  // row. `kind` is derived from the line's leading check or cross.
  generationProgress: defineTable({
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    at: v.number(),
    message: v.string(),
    kind: v.union(v.literal("info"), v.literal("success"), v.literal("failure")),
  })
    .index("by_generationId_and_at", ["generationId", "at"])
    .index("by_projectId", ["projectId"]),

  // ─── Step-by-step idea seeds (AD-33/39) ───────────────────────────────────
  // All eleven tables are project-scoped. Core fields are required for new
  // rows; only fields marked optional in AD-33 are optional here.

  seedSubsections: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    roleId: seedRoleIdValidator,
    kind: seedSubsectionKindValidator,
    state: v.union(
      v.literal("untouched"),
      v.literal("generating"),
      v.literal("in_progress"),
      v.literal("approved"),
      v.literal("skipped"),
      v.literal("failed")
    ),
    currentContextRevision: v.string(),
    selectionRevision: v.string(),
    shownBatchId: v.optional(v.id("seedBatches")),
    pendingBatchId: v.optional(v.id("seedBatches")),
    priorState: v.optional(
      v.union(
        v.literal("untouched"),
        v.literal("generating"),
        v.literal("in_progress"),
        v.literal("approved"),
        v.literal("skipped"),
        v.literal("failed")
      )
    ),
    // Bounded causal evidence while a pending attempt temporarily hides approval.
    pendingApprovalReasons: v.optional(v.array(seedRoleIdValidator)),
    consecutiveFailures: v.number(),
    activeStaleEpisodeId: v.optional(v.id("seedStaleEpisodes")),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    approvedSelectionRevision: v.optional(v.string()),
    approvedContextRevision: v.optional(v.string()),
    approvedWithConfirmation: v.optional(v.boolean()),
    exclusionAcknowledgedAt: v.optional(v.number()),
  })
    .index("by_generationId", ["generationId"])
    .index("by_generationId_and_roleId", ["generationId", "roleId"])
    .index("by_projectId", ["projectId"]),

  seedBatches: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    roleId: seedRoleIdValidator,
    operation: v.union(
      v.literal("open"),
      v.literal("prefetch"),
      v.literal("retry"),
      v.literal("regenerate"),
      v.literal("feedback")
    ),
    dedupeKey: v.string(),
    commandId: v.string(),
    attemptId: v.string(),
    feedbackRequestId: v.optional(v.id("seedFeedbackRequests")),
    consumedContextRevision: v.string(),
    briefVersionId: v.id("generationBriefs"),
    settingsHash: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("shown"),
      v.literal("superseded"),
      v.literal("failed")
    ),
    deliveredLateAt: v.optional(v.number()),
    queuedAt: v.number(),
    leaseExpiresAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    model: v.string(),
    slot: v.string(),
    promptVersion: v.string(),
    roleOpen: v.optional(v.boolean()),
    requestsReserved: v.number(),
    requestsMade: v.optional(v.number()),
    settledAt: v.optional(v.number()),
    seedsDropped: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_generationId_and_roleId", ["generationId", "roleId"])
    .index("by_status_and_leaseExpiresAt", ["status", "leaseExpiresAt"])
    .index("by_generationId_and_dedupeKey", ["generationId", "dedupeKey"])
    .index("by_generationId_and_status", ["generationId", "status"])
    .index("by_generationId_and_roleId_and_commandId", ["generationId", "roleId", "commandId"])
    .index("by_projectId", ["projectId"]),

  seedBatchContext: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    batchId: v.id("seedBatches"),
    roleId: seedRoleIdValidator,
    kind: v.union(
      v.literal("selection"),
      v.literal("skip"),
      v.literal("feedback"),
      v.literal("ownFeedback"),
      v.literal("target")
    ),
    sourceRoleId: seedRoleIdValidator,
    seedId: v.optional(v.id("seeds")),
    feedbackRequestId: v.optional(v.id("seedFeedbackRequests")),
    bullets: v.optional(v.array(v.string())),
    text: v.optional(v.string()),
    order: v.number(),
    contributionHash: v.string(),
  })
    .index("by_batchId", ["batchId"])
    .index("by_projectId", ["projectId"]),

  seeds: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    batchId: v.id("seedBatches"),
    roleId: seedRoleIdValidator,
    order: v.number(),
    bullets: v.array(v.string()),
    tags: v.array(v.string()),
    support: seedSupportValidator,
    originalSupport: seedSupportValidator,
    revisionOfSeedId: v.optional(v.id("seeds")),
    feedbackRequestId: v.optional(v.id("seedFeedbackRequests")),
    uncertaintySeedId: v.optional(v.id("seeds")),
    experimentSeedIds: v.optional(v.array(v.id("seeds"))),
  })
    .index("by_batchId", ["batchId"])
    .index("by_generationId_and_roleId", ["generationId", "roleId"])
    .index("by_projectId", ["projectId"]),

  seedProvenance: defineTable({
    seedId: v.id("seeds"),
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    sourceId: v.id("generationSources"),
    sourceContentHash: v.string(),
    startOffset: v.number(),
    endOffset: v.number(),
    exactExcerpt: v.string(),
    // Stamped at write time from a frozen transcript source: the excerpt's
    // 1-based line and, when the transcript names one, its speaker. Absent on
    // older rows and on citations of non-transcript sources.
    speaker: v.optional(v.string()),
    line: v.optional(v.number()),
    // 2026-09-24 widen: stamped from the cited transcript turn when a Seed
    // cites a verified fact.
    factKey: v.optional(v.string()),
    role: v.optional(transcriptSpeakerRoleValidator),
    startMs: v.optional(v.number()),
    // 2026-09-25 widen: the cited turn's speaker had no role when the Seed
    // was written, so the quote needs a speaker check (decisions 24, 25).
    needsSpeakerCheck: v.optional(v.boolean()),
  })
    .index("by_seedId", ["seedId"])
    .index("by_generationId_and_seedId", ["generationId", "seedId"])
    .index("by_projectId", ["projectId"]),

  seedSelections: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    seedId: v.id("seeds"),
    roleId: seedRoleIdValidator,
    selected: v.boolean(),
    editedBullets: v.optional(v.array(v.string())),
    editedBy: v.optional(v.id("users")),
    editedAt: v.optional(v.number()),
    selectedAt: v.number(),
    version: v.number(),
    orderKey: v.optional(v.string()),
  })
    .index("by_generationId_and_roleId", ["generationId", "roleId"])
    .index("by_generationId_and_roleId_and_selected_and_orderKey", ["generationId", "roleId", "selected", "orderKey"])
    .index("by_generationId_and_selected_and_roleId", [
      "generationId",
      "selected",
      "roleId",
    ])
    .index("by_seedId", ["seedId"])
    .index("by_projectId", ["projectId"]),

  seedFeedbackRequests: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    roleId: seedRoleIdValidator,
    targetSeedId: v.id("seeds"),
    targetWording: v.array(v.string()),
    instruction: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("suspendedBySkip"),
      v.literal("withdrawn")
    ),
    withdrawnAt: v.optional(v.number()),
    commandId: v.optional(v.string()),
    firstApproveExposure: v.optional(v.object({
      approveEventId: v.id("seedDecisionEvents"),
      outcome: v.union(v.literal("selected"), v.literal("not_selected"), v.literal("response_not_available")),
    })),
    eligibleScore: v.optional(v.object({
      approveEventId: v.id("seedDecisionEvents"), selected: v.boolean(),
    })),
    batchId: v.optional(v.id("seedBatches")),
  })
    .index("by_generationId_and_roleId", ["generationId", "roleId"])
    .index("by_generationId_and_status_and_roleId", [
      "generationId",
      "status",
      "roleId",
    ])
    .index("by_generationId_and_roleId_and_commandId", ["generationId", "roleId", "commandId"])
    .index("by_targetSeedId", ["targetSeedId"])
    .index("by_projectId", ["projectId"]),

  seedStaleEpisodes: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    roleId: seedRoleIdValidator,
    openedAt: v.number(),
    reasons: v.array(seedRoleIdValidator),
    disposedAt: v.optional(v.number()),
    disposition: v.optional(v.union(v.literal("resolved"), v.literal("bypassed"))),
    freshAttemptCompleted: v.optional(v.boolean()),
    freshSeedsInSnapshot: v.optional(v.boolean()),
    olderSelectionsConfirmed: v.optional(v.boolean()),
  })
    .index("by_generationId_and_roleId", ["generationId", "roleId"])
    .index("by_projectId", ["projectId"]),

  summaryVersions: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    version: v.number(),
    originGenerationId: v.id("generations"),
    briefVersionId: v.id("generationBriefs"),
    // Content metadata is frozen with the signed plan. Recoveries reuse this
    // row instead of reading mutable project prose at finalization time.
    reportTitle: v.optional(v.string()),
    settingsHash: v.string(),
    skippedRoleIds: v.array(seedRoleIdValidator),
    readiness: v.boolean(),
    signedOffBy: v.id("users"),
    signedOffAt: v.number(),
  })
    .index("by_generationId", ["generationId"])
    .index("by_projectId", ["projectId"]),

  summaryItems: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    summaryVersionId: v.id("summaryVersions"),
    roleId: seedRoleIdValidator,
    kind: seedSubsectionKindValidator,
    order: v.number(),
    seedId: v.id("seeds"),
    bullets: v.array(v.string()),
    support: seedSupportValidator,
    tags: v.array(v.string()),
    uncertaintySeedId: v.optional(v.id("seeds")),
    experimentSeedIds: v.optional(v.array(v.id("seeds"))),
    // The writer explicitly acknowledged a frozen Brief Claim Exclusion for
    // this role before sign-off. Drafting still follows the signed plan; the
    // conflict is retained as unrepaired compliance evidence.
    confirmedExclusion: v.optional(v.boolean()),
    // The writer changed this Seed's wording (the selection carried
    // `editedBullets` at sign-off), even when the text matches the generated
    // wording. Absent on rows frozen before 2026-09-24; the reader falls back
    // to comparing wording for those.
    edited: v.optional(v.boolean()),
  })
    .index("by_summaryVersionId_and_order", ["summaryVersionId", "order"])
    .index("by_generationId", ["generationId"])
    .index("by_projectId", ["projectId"]),

  seedDecisionEvents: defineTable(
    v.union(
      v.object({
        projectId: v.id("projects"),
        generationId: v.id("generations"),
        kind: seedGenerationEventKindValidator,
        at: v.number(),
        actorUserId: v.id("users"),
        ...seedDecisionEventOptionalFields,
      }),
      v.object({
        projectId: v.id("projects"),
        generationId: v.id("generations"),
        kind: seedGenerationEventKindValidator,
        at: v.number(),
        actorSystem: v.literal(true),
        ...seedDecisionEventOptionalFields,
      }),
      v.object({
        projectId: v.id("projects"),
        generationId: v.id("generations"),
        kind: seedRoleEventKindValidator,
        roleId: seedRoleIdValidator,
        at: v.number(),
        actorUserId: v.id("users"),
        ...seedDecisionEventOptionalFields,
      }),
      v.object({
        projectId: v.id("projects"),
        generationId: v.id("generations"),
        kind: seedRoleEventKindValidator,
        roleId: seedRoleIdValidator,
        at: v.number(),
        actorSystem: v.literal(true),
        ...seedDecisionEventOptionalFields,
      })
    )
  )
    .index("by_generationId_and_at", ["generationId", "at"])
    .index("by_at", ["at"])
    .index("by_generationId_and_roleId_and_kind_and_at", ["generationId", "roleId", "kind", "at"])
    .index("by_batchId_and_actorUserId_and_kind", ["batchId", "actorUserId", "kind"])
    .index("by_projectId", ["projectId"]),

  // ─── BNH-15: model A/B testing ─────────────────────────────────────────────

  // One candidate report per model for a given generation; the writer picks one.
  reportCandidates: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    model: v.string(),
    label: v.string(),
    content: v.string(),
    agentOutputs: v.string(),
    provenanceId: v.optional(v.id("reportProvenance")),
    createdAt: v.number(),
  })
    .index("by_generationId", ["generationId"])
    .index("by_projectId", ["projectId"])
    .index("by_generationId_and_model", ["generationId", "model"]),

  // BNH-48: writer's 1–10 score per candidate option. Candidate rows are
  // deleted once a draft is chosen, so model/label/position/AI-score are
  // copied here — the row must stand alone for the post-selection comparison
  // view and model A/B analytics.
  candidateScores: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    candidateId: v.id("reportCandidates"),
    optionPosition: v.number(), // 1-based blind position the writer saw
    model: v.string(),
    label: v.string(),
    qaScore: v.optional(v.number()), // AI QA score at scoring time, for gap analytics
    userId: v.string(),
    score: v.number(), // writer's 1–10
    comment: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_generationId", ["generationId"])
    .index("by_projectId", ["projectId"])
    .index("by_user_and_candidateId", ["userId", "candidateId"])
    .index("by_model_and_updatedAt", ["model", "updatedAt"]),

  // Logged model choices, for aggregate preference stats + recommendation.
  modelSelections: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    userId: v.string(),
    candidateId: v.optional(v.id("reportCandidates")),
    model: v.string(),
    label: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_generationId", ["projectId", "generationId"]),

  // ─── AI Chat (document-scoped assistant) ───────────────────────────────────

  chatThreads: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    title: v.string(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_reportId", ["reportId"]),

  // ─── Agent-based chat (BNH-10 P2 — @convex-dev/agent parallel-run) ─────────
  // The agent component owns its own thread/message/stream tables; these map a
  // report to its component thread and hold the app-side state the component
  // can't: proposed report edits and their applied/rejected lifecycle.
  agentChatThreads: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    agentThreadId: v.string(), // component thread id
    title: v.string(),
    createdAt: v.number(),
  })
    .index("by_reportId", ["reportId"])
    .index("by_agentThreadId", ["agentThreadId"])
    .index("by_projectId", ["projectId"]),

  // The agent UIMessage cannot durably express turn start/end, so app-owned
  // timing keeps queued and terminal states stable across reloads and races.
  chatTurns: defineTable({
    userId: v.optional(v.id("users")),
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    order: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("aborted"),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    stepCount: v.number(),
    // The report text the writer highlighted for this prompt, as editor
    // positions. Proposals from the turn that target it are judged by where
    // it sits: a Section heading or the title is never edited.
    highlight: v.optional(v.object({ text: v.string(), from: v.number(), to: v.number() })),
  })
    .index("by_agentThreadId_and_promptMessageId", [
      "agentThreadId",
      "promptMessageId",
    ])
    .index("by_agentThreadId_and_order", ["agentThreadId", "order"])
    .index("by_userId_and_status", ["userId", "status"])
    // Stale-turn reaper: sweep queued/running rows regardless of thread.
    .index("by_status", ["status"]),

  // Immutable first vote per viewer and durable completed answer.
  chatAnswerFeedback: defineTable({
    turnId: v.id("chatTurns"),
    userId: v.id("users"),
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    answerMessageId: v.string(),
    promptText: v.string(),
    answerText: v.string(),
    learningSnapshot: v.optional(v.object({
      version: v.literal(1),
      promptText: v.string(),
      answerText: v.string(),
    })),
    vote: v.union(v.literal(1), v.literal(-1)),
    createdAt: v.number(),
  })
    .index("by_turnId_and_userId", ["turnId", "userId"])
    .index("by_projectId", ["projectId"]),

  // One row per tool call the assistant makes (proposeEdit / proposeReplacements
  // / highlightPassages). Same lifecycle semantics as chatMessages.proposedEdit.
  chatProposals: defineTable({
    agentThreadId: v.string(),
    // Stable association with the assistant tool part. `messageId` is retained
    // for legacy rows created before tool-call grouping was available.
    toolCallId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    kind: v.union(
      v.literal("edit"), // single passage: targetText → newText
      v.literal("replacements"), // multi-instance find/replace list
      v.literal("references") // locate/highlight only — no state machine
    ),
    targetText: v.optional(v.string()),
    newText: v.optional(v.string()),
    replacements: v.optional(
      v.array(v.object({ find: v.string(), replaceWith: v.string() }))
    ),
    references: v.optional(v.array(v.string())),
    // Set when the proposal came from Contextual Research. This survives the
    // proposal lifecycle and links an accepted edit back to its evidence.
    researchSessionId: v.optional(v.id("researchSessions")),
    // Producer-declared safety property: this proposal targets exactly one
    // occurrence, so apply must refuse when the passage is no longer unique.
    // Any single-target producer (research today, QA/review agents later)
    // sets this instead of applyProposal special-casing its origin.
    requireUniqueTarget: v.optional(v.boolean()),
    // A coordinated revision: every passage must still match exactly once.
    requireUniqueTargets: v.optional(v.boolean()),
    // Writer-authored wording revisions made directly in the proposal card.
    // The canonical target never changes; these fields make the learning event
    // auditable without conflating it with model-generated candidates.
    wordingEditedBy: v.optional(v.id("users")),
    wordingEditedAt: v.optional(v.number()),
    wordingEditCount: v.optional(v.number()),
    state: v.union(
      v.literal("pending"),
      v.literal("applied"),
      v.literal("rejected"),
      v.literal("stale")
    ),
    createdAt: v.number(),
  })
    .index("by_agentThreadId", ["agentThreadId"])
    // Exact per-turn proposal reads for chatV2.listProposals, which joins
    // proposals to the chatTurns window through promptMessageId. Rows without
    // that anchor (legacy) are unreachable from the windowed read by design.
    .index("by_agentThreadId_and_promptMessageId", [
      "agentThreadId",
      "promptMessageId",
    ])
    .index("by_agentThreadId_and_toolCallId", ["agentThreadId", "toolCallId"])
    .index("by_projectId", ["projectId"]),

  // Story 5 (CAP-13, AD-28): the Completion Report. One child row per item of a
  // Coordinated Revision, written ONLY by internal.chatV2.saveProposal in the
  // same transaction as its `chatProposals` parent, and never mutated after.
  // Carries projectId directly (AD-19).
  //
  // The first block is the AD-28 row shape verbatim. `section`,
  // `paragraphNumber`, `kind` and `rule` are the CAP-12 paragraph anchor, added
  // as optional fields (AD-10 widen), never a rename of an AD-28 field. The
  // shape is authored once in `convex/lib/completionReport.ts`
  // (`completionReportItemValidator`), which `saveProposal` validates against;
  // it is spelled out here rather than imported so the schema module stays free
  // of the tool's zod dependency.
  chatProposalItems: defineTable({
    proposalId: v.id("chatProposals"),
    projectId: v.id("projects"),
    // The id the Deviation Inventory (or the Reference PD comparison) produced,
    // preserved verbatim so the writer's list and the rows use one numbering.
    itemId: v.string(),
    status: v.union(
      v.literal("resolved"),
      v.literal("blocked"),
      v.literal("conflicting")
    ),
    reason: v.string(),
    // `blocked` carries both; `conflicting` carries the locked rule and an
    // alternative. The tool schema refuses a status without its evidence.
    missingFact: v.optional(v.string()),
    missingFactSource: v.optional(v.string()),
    lockedRule: v.optional(v.string()),
    alternative: v.optional(v.string()),
    section: v.optional(sectionNumberValidator),
    // 1-BASED paragraph within the section: the number the writer sees and the
    // number the checklist line echoes. Named `paragraphNumber`, not
    // `paragraphIndex`, precisely so it can never be joined against the 0-based
    // `complianceNotes.paragraphIndex` by name; the inventory converts once,
    // where the notes are read.
    paragraphNumber: v.optional(v.number()),
    kind: v.optional(
      v.union(v.literal("rule"), v.literal("content"), v.literal("reference"))
    ),
    rule: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_proposalId", ["proposalId"])
    // Enumerating a project's items without a table scan: the AD-19 cascade
    // when it lands, and any later reader of the Completion Report.
    .index("by_projectId", ["projectId"]),

  chatMessages: defineTable({
    threadId: v.id("chatThreads"),
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    role: v.union(v.literal("writer"), v.literal("assistant")),
    content: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("complete"),
      v.literal("error")
    ),
    // Optional excerpt the writer pasted in from the editor (highlight → chat).
    highlight: v.optional(
      v.object({
        text: v.string(),
        from: v.number(),
        to: v.number(),
      })
    ),
    // Documents referenced by this message (uploaded via the paperclip).
    attachmentIds: v.optional(v.array(v.id("projectDocuments"))),
    // BNH-25: passages the assistant located for a "find/show/highlight" request
    // (no edit) — drives scroll-and-highlight in the document panel.
    references: v.optional(v.array(v.string())),
    // A proposed edit the assistant wants to make to the report. Either a single
    // passage replacement (targetText → newText) or, for multi-instance edits
    // like pronoun normalization, a list of find/replace pairs applied to every
    // occurrence (BNH-27).
    proposedEdit: v.optional(
      v.object({
        targetText: v.optional(v.string()),
        targetFrom: v.optional(v.number()),
        targetTo: v.optional(v.number()),
        newText: v.optional(v.string()),
        replacements: v.optional(
          v.array(v.object({ find: v.string(), replaceWith: v.string() }))
        ),
        summaryBefore: v.optional(v.string()),
        summaryAfter: v.optional(v.string()),
        state: v.union(
          v.literal("pending"),
          v.literal("applied"),
          v.literal("rejected")
        ),
      })
    ),
    createdAt: v.number(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_projectId", ["projectId"]),

  // Documents uploaded as context (chat paperclip now; Phase-2 documentation
  // input later). Text is extracted client-side before upload.
  projectDocuments: defineTable({
    projectId: v.id("projects"),
    reportId: v.optional(v.id("reports")),
    fileName: v.string(),
    fileType: v.union(
      v.literal("txt"),
      v.literal("md"),
      v.literal("pdf"),
      v.literal("docx"),
      v.literal("msg"),
      v.literal("eml"),
      v.literal("xlsx"),
      v.literal("image"),
      v.literal("other")
    ),
    content: v.string(),
    // Original file bytes in Convex storage (for preview/download).
    storageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    // BNH-24: archived files stay visible to reviewers but are excluded from
    // AI context (generation + chat).
    archived: v.optional(v.boolean()),
    // PSOS-04: per-file processing outcome, derived server-side in
    // uploadDocument from observable extraction facts (shared/documentStatus.ts).
    // Optional during widen → backfill; narrowing is a separate work item.
    processingStatus: v.optional(
      v.union(
        v.literal("ready"),
        v.literal("ready_truncated"),
        v.literal("reference_only"),
        v.literal("could_not_read"),
        v.literal("skipped_unsupported")
      )
    ),
    // Machine reason code ONLY — never free text, so no provider or internal
    // error string can reach a user through this field. Deliberately NOT the
    // financialUploads.processingError shape.
    processingDetail: v.optional(
      v.union(
        v.literal("text_extracted"),
        v.literal("text_truncated"),
        v.literal("image_reference"),
        v.literal("no_text_extracted"),
        v.literal("parse_failed"),
        v.literal("unsupported_extension"),
        v.literal("pasted_text")
      )
    ),
    // Contextual-input category (BNH-9) used for SR&ED weighting at generation.
    category: v.optional(
      v.union(
        v.literal("previous_pd"),
        v.literal("scoping_notes"),
        v.literal("writer_notes"),
        v.literal("background"),
        v.literal("other")
      )
    ),
    source: v.string(),
    uploadedBy: v.string(),
    // CAP-3: the internal role of the user who uploaded this document, frozen
    // at write time. `uploadedBy` is a free-form string (a user id on one path,
    // a display label on three others) so it is NOT a usable join key to
    // `users`; the role has to be a stored fact. ABSENT MEANS CLIENT TRUST:
    // every row predating this field, and any row whose writer is unknown, is
    // presented to the analyzer as ordinary client evidence. Never backfilled.
    // On a duplicated project this describes the ORIGIN row's uploader and is
    // carried forward verbatim, while `uploadedBy` names whoever duplicated;
    // the two fields may describe different people by design.
    uploaderRole: v.optional(
      v.union(v.literal("writer"), v.literal("manager"), v.literal("admin"))
    ),
    createdAt: v.number(),
  })
    .index("by_storageId", ["storageId"])
    .index("by_projectId", ["projectId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["projectId"],
    }),

  // PSOS-04: durable record of upload attempts that never produced a
  // projectDocuments row (storage/network failure, client-side type rejection).
  // A failed upload has no document to carry a status, so the audit trail lives
  // here. `upload_failed` is never a projectDocuments.processingStatus value.
  documentUploadAttempts: defineTable({
    projectId: v.id("projects"),
    // Client-generated UUID; the idempotency key for retry and outbox flush.
    // Format-validated server-side so no prose can flow through it.
    attemptKey: v.string(),
    // The user's own file name (already stored on projectDocuments), capped.
    fileName: v.string(),
    fileSizeBytes: v.optional(v.number()),
    origin: v.union(
      v.literal("chat_upload"),
      v.literal("context_input"),
      v.literal("review_pd")
    ),
    status: v.union(
      v.literal("in_progress"),
      v.literal("failed"),
      // Resolved to a document row in the same transaction as its insert;
      // excluded from the receipt so a file can never show twice.
      v.literal("succeeded"),
      // User removed the row; kept for audit until pruned.
      v.literal("dismissed")
    ),
    // Machine codes only — never a raw error.
    failureCode: v.optional(
      v.union(v.literal("rejected_unsupported"), v.literal("upload_failed"))
    ),
    documentId: v.optional(v.id("projectDocuments")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    // Drives read-time staleness derivation for abandoned in_progress rows.
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_attemptKey", ["projectId", "attemptKey"]),

  // ─── Contextual Research: selected text → two researchers → review ──────
  // Large/unbounded evidence is split into child tables so the session remains
  // a small, reactive status document throughout a long-running workflow.
  researchSessions: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    requestedBy: v.id("users"),
    selectedText: v.string(),
    selectionFrom: v.number(),
    selectionTo: v.number(),
    surroundingContext: v.string(),
    instruction: v.string(),
    // Redacted prompt shared with external research providers. Private project
    // documents are only supplied to the final reviewer.
    externalBrief: v.string(),
    reportRevisionNumber: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("researching"),
      v.literal("reviewing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    workflowId: v.optional(v.string()),
    brainStatus: v.optional(
      v.union(v.literal("complete"), v.literal("empty"), v.literal("degraded"))
    ),
    answer: v.optional(v.string()),
    evidenceBoundary: v.optional(v.string()),
    // Non-brain source count, computed once at review time; copied onto the
    // version-history checkpoint when the proposal is applied.
    evidenceSourceCount: v.optional(v.number()),
    confidence: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low"))
    ),
    warnings: v.optional(v.array(v.string())),
    proposalId: v.optional(v.id("chatProposals")),
    // One writer rating per session, persisted so a remounted panel can't
    // queue duplicate Brain feedback rows.
    feedback: v.optional(
      v.object({
        rating: v.union(v.literal("helpful"), v.literal("not_helpful")),
        submittedBy: v.id("users"),
        submittedAt: v.number(),
      })
    ),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_reportId", ["reportId"])
    .index("by_reportId_and_requestedBy", ["reportId", "requestedBy"])
    .index("by_projectId", ["projectId"]),

  researchRuns: defineTable({
    sessionId: v.id("researchSessions"),
    projectId: v.id("projects"),
    provider: v.union(
      v.literal("gpt"),
      v.literal("perplexity"),
      v.literal("reviewer")
    ),
    model: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    responseText: v.optional(v.string()),
    providerResponseId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    webSearchRequests: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_sessionId_and_provider", ["sessionId", "provider"])
    .index("by_projectId", ["projectId"]),

  researchSources: defineTable({
    sessionId: v.id("researchSessions"),
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("external"),
      v.literal("project_document"),
      v.literal("brain_pattern")
    ),
    title: v.string(),
    canonicalUrl: v.optional(v.string()),
    domain: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    projectDocumentId: v.optional(v.id("projectDocuments")),
    brainSourceId: v.optional(v.id("brainSources")),
    citedByGpt: v.optional(v.boolean()),
    citedByPerplexity: v.optional(v.boolean()),
    verification: v.union(
      v.literal("provider_cited"),
      v.literal("cross_provider"),
      v.literal("project_evidence"),
      v.literal("brain_pattern")
    ),
    createdAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_projectId", ["projectId"]),

  researchClaims: defineTable({
    sessionId: v.id("researchSessions"),
    projectId: v.id("projects"),
    text: v.string(),
    evidenceKind: v.union(
      v.literal("external"),
      v.literal("project"),
      v.literal("mixed")
    ),
    support: v.union(
      v.literal("supported"),
      v.literal("qualified"),
      v.literal("conflicting"),
      v.literal("unsupported")
    ),
    sourceIds: v.array(v.id("researchSources")),
    createdAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_projectId", ["projectId"]),

  // ─── Error reporting (in-app "we noticed an error" + manual flag) ──────────
  // One row per reported issue. Captures everything Claude Code needs to debug:
  // the error message/stack, the page, the user's note, and a breadcrumb trail
  // of the last actions taken before the report. Breadcrumbs are a small bounded
  // list (capped client-side) so storing them inline is safe.
  errorReports: defineTable({
    // "auto" = surfaced by the error banner; "manual" = user clicked "Flag issue".
    kind: v.union(v.literal("auto"), v.literal("manual")),
    // BNH-38: bug report vs. feature request (auto-captured errors are always bugs).
    reportType: v.optional(v.union(v.literal("bug"), v.literal("feature"))),
    message: v.string(),
    stack: v.optional(v.string()),
    source: v.optional(v.string()),
    url: v.string(),
    userNote: v.optional(v.string()),
    breadcrumbs: v.array(
      v.object({
        type: v.string(),
        label: v.string(),
        detail: v.optional(v.string()),
        at: v.number(),
      })
    ),
    userAgent: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    userEmail: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
    // Jul 17: feature requests are visible to all writers; +1s are stored
    // inline (tiny volume — a handful of writers).
    upvoterIds: v.optional(v.array(v.id("users"))),
  }).index("by_status", ["status"]),

  // Non-destructive version history of the report (Google-Docs-style restore).
  reportSnapshots: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    content: v.string(),
    reason: v.union(
      v.literal("pre_chat_edit"),
      // Sprint 1 story 4 (CAP-4a): taken in the same transaction as
      // comments.acceptEdit, so accepting a client's suggested edit is
      // restorable to the exact pre-accept text.
      v.literal("pre_client_edit"),
      v.literal("manual"),
      v.literal("periodic"),
      v.literal("pre_restore"),
      v.literal("milestone"),
      // Untouched AI draft frozen at candidate selection — the post-edit
      // distance baseline (BNH-10 flywheel).
      v.literal("generated")
    ),
    // Stable key for workflow-labelled snapshots (e.g. R0/R1/R4/R5).
    milestoneKey: v.optional(v.string()),
    label: v.optional(v.string()),
    createdByRole: v.union(v.literal("writer"), v.literal("system")),
    createdAt: v.number(),
    provenanceId: v.optional(v.id("reportProvenance")),
    sourceRevisionNumber: v.optional(v.number()),
    generationId: v.optional(v.id("generations")),
    sourceTranscriptId: v.optional(v.id("transcripts")),
    // 2026-09-03 widen: the full ordered set; sourceTranscriptId stays the first.
    sourceTranscriptIds: v.optional(v.array(v.id("transcripts"))),
    contentHash: v.optional(v.string()),
    // Present on the checkpoint captured before a research-backed edit, keeping
    // the source trail attached to version history.
    researchSessionId: v.optional(v.id("researchSessions")),
    researchSourceCount: v.optional(v.number()),
  })
    .index("by_reportId", ["reportId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_milestoneKey", ["projectId", "milestoneKey"]),

  // Terminal operational observations, independent of billing. No retrieval text.
  rerankOutcomes: defineTable({
    operationId: v.string(),
    observedAt: v.number(),
    callSite: v.string(),
    outcome: v.union(v.literal("success"), v.literal("fallback"), v.literal("skip"), v.literal("search_error")),
  })
    .index("by_operationId", ["operationId"])
    .index("by_observedAt", ["observedAt"]),

  // BNH-10 flywheel (CAP-2): post-edit distance frozen at the three milestones
  // where the writer's divergence from the AI draft is meaningful. Rows are
  // append-only readings; the read surface is index-only per report and per
  // accountable writer (projects.ownerId, PSOS-07 — never createdBy).
  reportEditDistance: defineTable({
    reportId: v.id("reports"),
    projectId: v.id("projects"),
    generationId: v.optional(v.id("generations")),
    // projects.ownerId at the time of the reading; optional because ownerId is
    // still optional on legacy projects (those rows never appear per-writer).
    writerUserId: v.optional(v.id("users")),
    revisionNumber: v.number(),
    /** 0 = untouched draft, 1 = fully rewritten. */
    ped: v.number(),
    computedAt: v.number(),
    trigger: v.union(
      v.literal("candidate_selection"),
      v.literal("milestone"),
      v.literal("client_publish")
    ),
  })
    .index("by_reportId", ["reportId"])
    .index("by_projectId", ["projectId"])
    .index("by_writerUserId_and_computedAt", ["writerUserId", "computedAt"])
    .index("by_computedAt", ["computedAt"]),

  // Human-verified claimant/participant identity and relationship evidence.
  // Rows are retained and rejected/superseded rather than deleted.
  projectIdentityEvidence: defineTable({
    projectId: v.id("projects"),
    subjectName: v.string(),
    relationship: v.union(
      v.literal("claimant"),
      v.literal("employee"),
      v.literal("contractor"),
      v.literal("other")
    ),
    evidenceKind: v.union(
      v.literal("corporate_registry"),
      v.literal("contract"),
      v.literal("invoice"),
      v.literal("payroll"),
      v.literal("project_document"),
      v.literal("other")
    ),
    projectDocumentId: v.optional(v.id("projectDocuments")),
    sourceDescription: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("rejected")
    ),
    verifiedBy: v.optional(v.id("users")),
    verifiedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_relationship", ["projectId", "relationship"]),

  // One durable slot per configured model. State transitions are fenced by
  // generationId/model instead of callback counters.
  generationCandidateRuns: defineTable({
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    model: v.string(),
    label: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed")
    ),
    candidateId: v.optional(v.id("reportCandidates")),
    qaScore: v.optional(v.number()),
    error: v.optional(v.string()),
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
    // Iterative mode's background one-shot comparison draft. Ghost candidates
    // are peek-only: never selectable, never used as section context.
    ghost: v.optional(v.boolean()),
    queuedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    // Story 2 (AD-24): when this candidate's one assembled-draft consistency
    // pass was recorded. The last section in production order is withheld
    // from getOrderedSectionDrafts until it is set.
    consistencyCheckedAt: v.optional(v.number()),
  })
    .index("by_generationId", ["generationId"])
    .index("by_generationId_and_candidateId", ["generationId", "candidateId"])
    .index("by_generationId_and_model", ["generationId", "model"])
    .index("by_status_and_startedAt", ["status", "startedAt"])
    .index("by_projectId", ["projectId"]),

  // ─── Iterative (section-by-section) generation ─────────────────────────────
  // One row per T661 section per generation. The writer reviews/edits/approves
  // each drafted section before the next is generated with the approved text
  // as canonical context. State transitions are fenced like candidate runs.
  generationSectionRuns: defineTable({
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    section: v.union(v.literal("s242"), v.literal("s244"), v.literal("s246")),
    status: v.union(
      v.literal("pending"), // not yet reachable (prior section unapproved)
      v.literal("queued"), // scheduled for drafting
      v.literal("running"), // drafting in flight
      v.literal("awaiting_review"), // draft ready; writer reviewing
      v.literal("approved"), // writer approved (possibly edited) text
      v.literal("failed"), // drafting failed; writer can regenerate
      // Story 2 (AD-24): an ordered (single/compare) section finished its
      // draft, Self-check and at most one repair. Ungated: no writer review.
      v.literal("drafted")
    ),
    draftText: v.optional(v.string()), // what the model produced
    approvedText: v.optional(v.string()), // what the writer approved
    qa: v.optional(v.string()), // deterministic QA findings (JSON)
    metrics: v.optional(v.string()), // sectionMetrics (JSON)
    model: v.string(),
    label: v.string(),
    attempt: v.number(),
    guidance: v.optional(v.string()), // writer's regeneration guidance
    error: v.optional(v.string()),
    // Story 2 (AD-24): ordered-chain rows only. Iterative generations never
    // create these, so iterative's (generationId, section) lookups never meet
    // one. candidateRunId scopes the row to its compare/single candidate.
    candidateRunId: v.optional(v.id("generationCandidateRuns")),
    orderIndex: v.optional(v.number()), // position in the production order
    selfCheck: v.optional(v.string()), // SelfCheckSummary (JSON)
    slotCounts: v.optional(v.string()), // AD-27 per-slot call counts (JSON)
    // 2026-09-25 widen: typed copies of the four JSON strings above (dual
    // write; older rows filled by generations.backfillSectionRunData).
    // Readers take these first and parse the string only without them.
    metricsData: v.optional(sectionMetricsValidator),
    qaData: v.optional(sectionQaFindingsValidator),
    selfCheckData: v.optional(selfCheckSummaryValidator),
    slotCountsData: v.optional(slotCountsValidator),
    queuedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_generationId", ["generationId"])
    .index("by_generationId_and_section", ["generationId", "section"])
    .index("by_candidateRunId_and_section", ["candidateRunId", "section"])
    .index("by_projectId", ["projectId"]),

  // Frozen per-generation artifacts for the iterative flow (analysis JSON,
  // brain-block JSON). Kept out of the live-subscribed generations row so the
  // hot document stays light.
  generationArtifacts: defineTable({
    generationId: v.id("generations"),
    kind: v.union(
      v.literal("analysis"),
      v.literal("brain_blocks"),
      // 2026-09-25: the ordered chain's frozen payload, persisted once per
      // candidate chain (`candidateRunId`) and passed to the chain's
      // scheduled actions by id instead of in their arguments.
      v.literal("ordered_payload"),
      // 2026-09-25: the generation's outputs, off the live generation row
      // (convex/lib/generationOutputs.ts).
      v.literal("agent_outputs"),
      v.literal("brain_retrieval_brief"),
      v.literal("brain_provenance"),
      // 2026-09-25 (owner decision 32): the frozen writer style (the
      // `brain_blocks` shape without `blocks`), saved before the seed stage
      // opens so Seeds never wait for Brain retrieval. `brain_blocks` still
      // carries the same style next to the blocks for every drafting reader.
      v.literal("writer_style")
    ),
    // JSON text for `analysis`, `brain_blocks` and `writer_style`; empty for
    // kinds stored in a typed field below.
    content: v.string(),
    candidateRunId: v.optional(v.id("generationCandidateRuns")),
    orderedPayload: v.optional(orderedPayloadValidator),
    brainProvenance: v.optional(v.array(brainProvenanceEntryValidator)),
  }).index("by_generationId_and_kind", ["generationId", "kind"]),

  // 2026-09-25: one row per settled post-assembly QA pass that captured the
  // report revision it scored, keyed to that revision so a reader can tell a
  // result that no longer describes the report (convex/lib/qaResults.ts).
  // `qa` and `chronology` are the JSON the pass merged into agent outputs.
  generationQaResults: defineTable({
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    revisionNumber: v.number(),
    contentHash: v.string(),
    status: v.union(v.literal("done"), v.literal("failed")),
    qa: v.optional(v.string()),
    chronology: v.optional(v.string()),
    qaScore: v.optional(v.number()),
    attemptStartedAt: v.optional(v.number()),
    completedAt: v.number(),
  })
    .index("by_reportId_and_revisionNumber_and_contentHash", [
      "reportId",
      "revisionNumber",
      "contentHash",
    ])
    .index("by_generationId_and_completedAt", ["generationId", "completedAt"])
    .index("by_projectId", ["projectId"]),

  // Immutable source text captured before candidate fan-out.
  generationSources: defineTable({
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("transcript"),
      v.literal("project_document"),
      // 2026-09-03 widen: a digest enters the pipeline as its own frozen
      // source row, never as live text.
      v.literal("transcript_digest"),
      // Story 1 (CAP-1/2/4): writer-supplied Storyline frozen as a source row
      v.literal("writer_storyline"),
      // 2026-09-24 widen (transcript method): one rendered fact pack per
      // transcript, frozen next to that transcript's full-text row. Citations
      // always validate against the transcript row, never the pack.
      v.literal("transcript_facts")
    ),
    transcriptId: v.optional(v.id("transcripts")),
    digestId: v.optional(v.id("transcriptDigests")),
    // 2026-09-24 widen: the FACTS_VERSION a transcript_facts row was rendered
    // from, and the evidence behind each fact id in the pack: the verbatim
    // spans (client turns only, decision 25) in the transcript row frozen
    // next to it, with the speaker, role and time stamped at freeze.
    factsVersion: v.optional(v.string()),
    factSpans: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: transcriptFactTypeValidator,
          quotes: v.array(
            v.object({
              charStart: v.number(),
              charEnd: v.number(),
              speakerLabel: v.optional(v.string()),
              role: v.optional(transcriptSpeakerRoleValidator),
              startMs: v.optional(v.number()),
              // 2026-09-25: the turn's speaker has no role yet (decision 24).
              needsSpeakerCheck: v.optional(v.boolean()),
            })
          ),
        })
      )
    ),
    projectDocumentId: v.optional(v.id("projectDocuments")),
    label: v.string(),
    content: v.string(),
    contentHash: v.string(),
    truncated: v.boolean(),
    originalLength: v.number(),
    capturedAt: v.number(),
    // CAP-3: uploader role frozen off the `projectDocuments` row at
    // reservation, so the analyzer's trust decision is pinned to the
    // reservation rather than re-read live. ABSENT MEANS CLIENT TRUST (legacy
    // rows, transcript rows, and any document whose uploader role is unknown).
    uploaderRole: v.optional(
      v.union(v.literal("writer"), v.literal("manager"), v.literal("admin"))
    ),
    // Budget-application metadata, NOT capture metadata: what the analyzer's
    // context budget did with this row (see convex/ai/trustedContext.ts).
    // Written after the fact by generations.recordContextBudget; absent on
    // legacy rows, on any row whose generation predates the budget, and on
    // full-text transcript rows a digest-mode generation superseded with
    // transcript_digest rows (only the rows the analyzer read are recorded).
    // `content`/`contentHash`/`truncated`/`originalLength` above stay frozen.
    contextBudget: v.optional(
      v.object({
        budgetTokens: v.number(),
        included: v.boolean(),
        includedLength: v.number(),
        truncated: v.boolean(),
        // Story 4 (CAP-11): the document cap the budget ran under, so the
        // Brief's Inputs band can show "cap N". Absent on pre-feature rows.
        maxDocuments: v.optional(v.number()),
      })
    ),
    // Story 4 (CAP-11, AD-30): the one per-row inclusion outcome the Brief
    // reads. Written only by generations.recordContextBudget (from
    // `sourceInclusion` in convex/ai/trustedContext.ts); absent on legacy rows
    // and on any row the analyzer never read. Never backfilled.
    inclusion: v.optional(
      v.union(
        v.literal("included"),
        v.literal("condensed"),
        v.literal("not_included")
      )
    ),
  })
    .index("by_generationId", ["generationId"])
    .index("by_projectId_and_generationId", ["projectId", "generationId"]),

  // Immutable claim-to-source bundle for one exact report content hash.
  reportProvenance: defineTable({
    projectId: v.id("projects"),
    generationId: v.optional(v.id("generations")),
    sourceTranscriptId: v.optional(v.id("transcripts")),
    // 2026-09-03 widen: the full ordered set; sourceTranscriptId stays the
    // first. digestIds names the digests the claims were cited against.
    sourceTranscriptIds: v.optional(v.array(v.id("transcripts"))),
    digestIds: v.optional(v.array(v.id("transcriptDigests"))),
    contentHash: v.string(),
    status: v.union(
      v.literal("needs_review"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    claims: v.array(
      v.object({
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
        sources: v.array(
          v.object({
            generationSourceId: v.id("generationSources"),
            sourceContentHash: v.string(),
            exactExcerpt: v.string(),
            startOffset: v.number(),
            endOffset: v.number(),
            speaker: v.optional(v.string()),
            timestampStart: v.optional(v.string()),
            timestampEnd: v.optional(v.string()),
          })
        ),
      })
    ),
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
  })
    .index("by_projectId", ["projectId"])
    .index("by_contentHash", ["contentHash"]),

  // Official export authorization/completion audit for one immutable revision.
  reportExports: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    reportVersion: v.number(),
    revisionNumber: v.number(),
    snapshotId: v.optional(v.id("reportSnapshots")),
    provenanceId: v.optional(v.id("reportProvenance")),
    contentHash: v.string(),
    canonicalDtoHash: v.optional(v.string()),
    templateVersion: v.string(),
    actorId: v.id("users"),
    status: v.union(
      v.literal("authorized"),
      v.literal("completed"),
      v.literal("failed")
    ),
    authorizedAt: v.number(),
    completedAt: v.optional(v.number()),
    documentHash: v.optional(v.string()),
    failureCode: v.optional(v.string()),
  })
    .index("by_projectId", ["projectId"])
    .index("by_reportId", ["reportId"])
    .index("by_status_and_authorizedAt", ["status", "authorizedAt"]),

  // ─── BNH-29: writer's human QA score + feedback on a generated report ───────
  // One review per writer per report version. Surfaced to the admin alongside
  // the AI QA score; NEVER auto-applied to the brain (manual review only).
  writerReviews: defineTable({
    // New judgments pin content; baseline revision is 0. Historical rows may lack both.
    revisionNumber: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    reportVersion: v.optional(v.number()),
    userId: v.id("users"),
    writerName: v.optional(v.string()),
    score: v.number(), // writer's 0–100 quality score
    comment: v.optional(v.string()),
    aiScore: v.optional(v.number()), // AI QA score at submit, for gap analytics
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_reportId", ["reportId"])
    .index("by_user_report", ["userId", "reportId"])
    .index("by_projectId", ["projectId"]),

  // ─── AD-29 (story 6, CAP-16): Paired Comparison records ────────────────────
  // The Success signal's only durable home. Every judgement field is entered by
  // a human judge; nothing here is ever derived from tool output
  // (`chatProposalItems`, `complianceNotes`, `generations.qa`, `writerReviews`).
  // Pinned to the exact report revision the judge read, exactly like
  // `writerReviews` and `reviewDecisions`. A recorded row is never patched or
  // deleted: the only correction path is a new row whose `voidsComparisonId`
  // names the row it replaces. `generationId` is optional because a
  // hand-written report has none. Carries `projectId` directly (AD-19).
  comparisons: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    revisionNumber: v.number(),
    contentHash: v.string(),
    generationId: v.optional(v.id("generations")),
    banhallModel: v.string(),
    baselineProduct: v.string(),
    baselineModel: v.string(),
    // Q15 is unresolved; the model-equivalence caveat is stored per record.
    modelCaveat: v.string(),
    judgeUserId: v.id("users"),
    preference: v.union(
      v.literal("banhall"),
      v.literal("baseline"),
      v.literal("tie")
    ),
    deviationsBanhall: v.number(),
    deviationsBaseline: v.number(),
    countingMethod: v.string(),
    correctionsBanhall: v.number(),
    correctionsBaseline: v.number(),
    usedInDevelopment: v.boolean(),
    recordedAt: v.number(),
    voidsComparisonId: v.optional(v.id("comparisons")),
    // The stripped plain texts the judge actually read.
    banhallDraftText: v.string(),
    baselineDraftText: v.string(),
    // Evidence, never a gate: a false is stored and surfaced, and the record
    // still lands.
    draftTextMatches: v.boolean(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_recordedAt", ["recordedAt"]),

  // ─── Reviewer decision recorded when a project leaves internal review ──────
  // Required (fail-closed, typed REVIEW_DECISION_REQUIRED) on the two
  // internal-review completion edges — `internal_review` → `edits` and
  // `internal_review` → `ready_for_delivery` — and written by
  // `setWorkflowStage` in the same transaction as the stage patch and the
  // `stage_changed` event. The row pins the judgement to the exact report
  // revision that was read (`revisionNumber` + `contentHash`), so "the review
  // is done" is an audited fact rather than an unattributed stage flip.
  // `toStage` is inlined rather than imported from lib/contracts to keep the
  // schema free of runtime imports; only the two completion destinations are
  // representable.
  reviewDecisions: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    reviewerId: v.id("users"),
    revisionNumber: v.number(),
    contentHash: v.string(),
    decision: v.union(v.literal("approve"), v.literal("return")),
    toStage: v.union(v.literal("edits"), v.literal("ready_for_delivery")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_reportId", ["reportId"]),

  // Per-writer feedback on individual generated QA observations. Target keys
  // survive candidate deletion after selection; item text is copied for admin review.
  qaItemFeedback: defineTable({
    // New judgments pin content; baseline revision is 0. Historical rows may lack both.
    revisionNumber: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    targetKey: v.string(),
    projectId: v.id("projects"),
    reportId: v.optional(v.id("reports")),
    candidateId: v.optional(v.id("reportCandidates")),
    generationId: v.optional(v.id("generations")),
    itemKey: v.string(),
    itemKind: v.union(v.literal("issue"), v.literal("strength")),
    section: v.string(),
    itemText: v.string(),
    originalSeverity: v.optional(v.union(v.literal("deduction"), v.literal("warning"))),
    overrideSeverity: v.optional(v.union(v.literal("deduction"), v.literal("warning"))),
    vote: v.optional(v.union(v.literal(-1), v.literal(1))),
    userId: v.string(),
    writerName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_targetKey", ["targetKey"])
    .index("by_user_target_item", ["userId", "targetKey", "itemKey"])
    .index("by_projectId", ["projectId"]),

  // ─── BNH-10: The Brain — curated, governed cross-project knowledge ──────────
  // The RAG component holds the vectors; THESE tables are the source of truth
  // for governance. The Brain index only ever contains APPROVED knowledge:
  // approve → ingest (embedSource), revoke → confirmed erasure. Nothing is ever
  // auto-applied — the admin gatekeeps every entry ("treat the brain sacred").
  brainSources: defineTable({
    kind: v.union(
      v.literal("pd_pair"), // a gold transcript→PD pair (the training corpus)
      v.literal("cra_letter"), // CRA audit response (negative-signal source, BNH-18)
      v.literal("writer_feedback") // promoted writer feedback / global rule (BNH-3/29)
    ),
    status: v.union(
      v.literal("pending"), // in the queue, NOT yet in the Brain
      v.literal("approved"), // ingested & retrievable
      v.literal("revoked") // unlearned — erasure requested; ragEntryId, if retained, is failure evidence
    ),
    title: v.string(),
    industry: v.string(), // → RAG namespace
    scienceCode: v.optional(v.string()),
    writerName: v.optional(v.string()),
    writerTier: v.number(), // 0..1 → RAG `importance` (Tracy 1.0 / next tier ~0.7 / other ~0.4)
    docType: v.string(), // "pd" | "transcript" | "cra_letter"
    fiscalYear: v.optional(v.number()),
    craOutcome: v.optional(
      v.union(v.literal("approved"), v.literal("rejected"), v.literal("disputed"))
    ),
    content: v.string(), // extracted text (the retrievable knowledge)
    ragKey: v.string(), // stable key for replace/unlearn
    ragEntryId: v.optional(v.string()), // set by ingestOnComplete (provenance)
    sourceHash: v.string(), // dedup (BNH-17)
    storageId: v.optional(v.id("_storage")), // original bytes, if any
    sourceProjectId: v.optional(v.id("projects")), // if promoted from a live project
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_storageId", ["storageId"])
    .index("by_status", ["status"])
    .index("by_hash", ["sourceHash"])
    .index("by_ragKey", ["ragKey"])
    .index("by_industry", ["industry"])
    .index("by_scienceCode", ["scienceCode"]),

  // ─── BNH-39: PD review mode — AI review of an existing written PD ──────────
  // One row per review run. The uploaded PD lives in projectDocuments
  // (source "review_pd"); `result` holds the structured feedback report JSON
  // (strengths / risks / suggested strengthening / qualitative score).
  pdReviews: defineTable({
    // New judgments pin content; baseline revision is 0. Historical rows may lack both.
    revisionNumber: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    projectId: v.id("projects"),
    documentId: v.id("projectDocuments"),
    sourceFileName: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    result: v.optional(v.string()),
    model: v.optional(v.string()),
    error: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_projectId", ["projectId"])
    // Stale-review reaper: running rows older than the cutoff.
    .index("by_status_and_createdAt", ["status", "createdAt"]),

  // BNH-39: timestamped audit trail of the review + reviewer interactions,
  // surfaced on the project card.
  pdReviewEvents: defineTable({
    projectId: v.id("projects"),
    reviewId: v.optional(v.id("pdReviews")),
    actor: v.string(),
    action: v.union(
      v.literal("review_started"),
      v.literal("review_completed"),
      v.literal("review_failed"),
      v.literal("review_viewed"),
      v.literal("generate_from_review")
    ),
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("by_projectId", ["projectId"]),

  // BNH-39: writer → admin conduit. Writers flag feedback; the admin gatekeeps
  // what actually reaches the Brain. Never auto-applied.
  brainFeedbackQueue: defineTable({
    fromUserId: v.string(),
    fromName: v.optional(v.string()),
    reportId: v.optional(v.id("reports")),
    projectId: v.optional(v.id("projects")),
    body: v.string(),
    suggestedRule: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected")
    ),
    reviewedBy: v.optional(v.string()),
    reviewNote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    // Story 0 (AD-19): project deletion detaches the optional project link.
    .index("by_projectId", ["projectId"]),

  // BNH-39: full audit trail + revert log. Every approve/revoke/reweight/unlearn
  // is recorded so the admin can see (and undo) what changed the Brain.
  brainAuditLog: defineTable({
    action: v.union(
      v.literal("ingest"),
      v.literal("approve"),
      v.literal("reject"),
      v.literal("revoke"),
      v.literal("reweight"),
      v.literal("revert"),
      // Confirmed erasure evidence (CAP-10). `revoke` is intent only; these
      // two record the outcome of the confirmed-erasure action.
      v.literal("unlearn_confirmed"),
      v.literal("unlearn_failed")
    ),
    sourceId: v.optional(v.id("brainSources")),
    feedbackId: v.optional(v.id("brainFeedbackQueue")),
    actorId: v.string(),
    reason: v.optional(v.string()),
    revertOf: v.optional(v.id("brainAuditLog")),
    at: v.number(),
  })
    .index("by_source", ["sourceId"])
    // Approval-time lookup for the distillation stream: the audit row is the
    // only record of WHEN feedback was decided (the queue row has no
    // reviewedAt), and freshness must key off approval, not submission.
    .index("by_feedbackId", ["feedbackId"])
    .index("by_at", ["at"]),

  // ─── Learning loop: distilled human-feedback digests injected into agents ───
  // Written by the scheduled summarization action (convex/ai/learning.ts). The
  // newest row per kind is the active digest; older rows are kept as an audit
  // trail of exactly what the system "learned" and when.
  // Edit-mining events from section-by-section drafting: what the model
  // drafted vs what the writer approved (after editing), plus the one-shot
  // ghost's take on the same section for contrast. Distilled into the
  // draft_style digest — a continuous learning loop that needs no manual
  // scoring: every iterative session contributes automatically.
  proposalWordingEditEvents: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    proposalId: v.id("chatProposals"),
    userId: v.id("users"),
    originalText: v.string(),
    editedText: v.string(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_userId", ["userId"]),

  sectionEditEvents: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    section: v.union(v.literal("s242"), v.literal("s244"), v.literal("s246")),
    draftText: v.string(), // model's draft (capped)
    approvedText: v.string(), // writer-approved text (capped)
    ghostText: v.optional(v.string()), // one-shot ghost's same section (capped)
    /** 0..1 — rough share of the draft the writer changed (word-level). */
    editRatio: v.number(),
    userId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_generationId", ["generationId"])
    .index("by_projectId", ["projectId"]),

  learningDigests: defineTable({
    kind: v.union(v.literal("qa_calibration"), v.literal("draft_style")),
    admission: v.optional(admissionValidator), // absent on historical candidates
    content: v.string(), // immutable candidate prompt block
    sourceCount: v.number(), // feedback rows that informed this digest
    feedbackCutoff: v.number(), // newest feedback updatedAt included
    model: v.string(), // model that produced the digest
    createdAt: v.number(),
    // Per-writer flavor Phase B prep. Global publication rejects these rows
    // until per-writer activation semantics are separately approved.
    userId: v.optional(v.id("users")),
  })
    .index("by_kind", ["kind"])
    .index("by_kind_and_userId", ["kind", "userId"]),

  // Latest operational outcome per global kind, separate from immutable candidates.
  learningDigestAttempts: defineTable({
    kind: v.union(v.literal("qa_calibration"), v.literal("draft_style")),
    attemptedAt: v.number(),
    outcome: attemptOutcomeValidator,
    admission: admissionValidator,
  }).index("by_kind", ["kind"]),

  // Append-only publication ledger. Automatic distillation only creates
  // immutable candidates; an authorized administrator explicitly selects the
  // one that may affect prompts. Selecting an older digest is a rollback and
  // selecting null is the operational kill switch.
  learningDigestSelections: defineTable({
    kind: v.union(v.literal("qa_calibration"), v.literal("draft_style")),
    selectedDigestId: v.union(v.id("learningDigests"), v.null()),
    previousSelectionId: v.optional(v.id("learningDigestSelections")),
    actorKind: v.union(v.literal("system"), v.literal("user")),
    actorUserId: v.optional(v.id("users")),
    action: v.union(
      v.literal("compatibility_freeze"),
      v.literal("select"),
      v.literal("disable")
    ),
    reason: v.optional(v.string()),
    selectedAt: v.number(),
  }).index("by_kind", ["kind"]),

  // ─── Per-writer flavor (Phase A): persistent custom writing instructions ───
  // One row per user; injected into the section-drafting prompts
  // (convex/ai/pipeline.ts). Never overrides CRA structure or length budgets.
  // 2026-08-24 widen (PSOS-49): optional styleOverrides — per-category waivers
  // of the default house-style rules (shared/styleOverrides.ts). A waived
  // category means the writer's own instructions govern that area (rule text
  // omitted from prompts, scrub/QA scans skipped). Legacy rows without the
  // field normalize to all-false, i.e. the pre-override behavior. Only takes
  // effect while `enabled` is true.
  writerProfiles: defineTable({
    userId: v.id("users"),
    customInstructions: v.string(),
    enabled: v.boolean(),
    styleOverrides: v.optional(styleOverridesValidator),
    // Story 2 (CAP-5): custom section generation order, stored as sent
    // (trimmed) and validated on read (convex/lib/orderedChain.ts
    // resolveBuildOrder); an invalid order falls back to 242 → 244 → 246.
    buildOrder: v.optional(v.array(v.string())),
    // Story 2 (CAP-9): per-paragraph / per-section Self-check rules.
    selfCheckRules: v.optional(v.array(selfCheckRuleValidator)),
    updatedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ─── Jul 17: in-app changelog ──────────────────────────────────────────────
  // Dated entries so non-early-adopter writers can see what changed since they
  // last looked. Authored by admins (AI-drafted from commits is fine —
  // authorship happens outside the app; this is just storage + display).
  changelogEntries: defineTable({
    title: v.string(),
    // Markdown body: features + fixes for the release.
    body: v.string(),
    kind: v.union(v.literal("feature"), v.literal("fix"), v.literal("mixed")),
    publishedAt: v.number(),
    // Admin-authored entries carry the author; pipeline entries don't.
    createdBy: v.optional(v.id("users")),
    // Jul 20 pipeline: one auto entry per work day ("2026-07-19"). Re-running
    // the pipeline for a day replaces its entry instead of duplicating, and
    // commitHashes records exactly which commits the summary covers.
    workDay: v.optional(v.string()),
    commitHashes: v.optional(v.array(v.string())),
  })
    .index("by_publishedAt", ["publishedAt"])
    .index("by_workDay", ["workDay"]),

  // Per-user read watermark for the changelog badge.
  changelogReads: defineTable({
    userId: v.id("users"),
    lastSeenAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Workspace dashboard preview pilot: one row per user, admin-managed.
  // Fail-closed — a user without an enabled row never sees the preview, and
  // the global "workspace.dashboard.v1.enabled" appSettings master switch
  // must also be on. Never store this allowlist inside appSettings.
  workspaceDashboardAccess: defineTable({
    userId: v.id("users"),
    enabled: v.boolean(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
    // Optimistic-concurrency version for public admin mutations. Optional so
    // pre-versioning rows stay valid; treated as 0 when absent.
    version: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  // Append-only audit trail for workspace dashboard rollout configuration
  // changes (master switch + per-user access). Rows are never patched or
  // deleted — duplicate-row repair on the config tables never touches this
  // history.
  workspaceDashboardRolloutEvents: defineTable({
    actorId: v.id("users"),
    scope: v.union(v.literal("master"), v.literal("user_access")),
    targetUserId: v.optional(v.id("users")),
    enabled: v.boolean(),
    previousEnabled: v.optional(v.boolean()),
    via: v.union(v.literal("public"), v.literal("internal")),
    occurredAt: v.number(),
  })
    .index("by_occurredAt", ["occurredAt"])
    .index("by_targetUserId_and_occurredAt", ["targetUserId", "occurredAt"]),

  // ─── BNH-17: OneDrive bulk ingestion (staging, human-in-the-loop) ─────────
  // The client's historical corpus lives in OneDrive under
  // `Applications/<Client>/<Fiscal year>/…` — PDs as Word docs in one of ~4
  // submission folders, interview transcripts under `WIP/Technical/Audio`
  // (Jun 19 meeting). The Graph delta sync discovers files into
  // ingestionItems; NOTHING reaches the Brain from here without an explicit
  // admin approval (the Brain is sacred — same gate as brainSources).
  //
  // Item lifecycle: discovered → fetched → extracted → pending_review →
  // approved | rejected, with `failed` for fetch/extract errors. Admins can
  // move non-approved rows to `deleted`; that queue action is reversible and
  // never deletes the OneDrive original. Approval creates a brainSources row
  // (already approved) and links it back.

  // Singleton delta cursor for the Graph sync ("key" is always "onedrive").
  // `nextLink` checkpoints a partially walked delta feed so a large initial
  // crawl resumes mid-walk instead of replaying from the last deltaLink.
  oneDriveSyncState: defineTable({
    key: v.string(),
    deltaLink: v.optional(v.string()),
    nextLink: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // One row per sync run — the admin-visible sync log.
  oneDriveSyncRuns: defineTable({
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    triggeredBy: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    discovered: v.number(), // new/changed files seen this run
    processed: v.number(), // fetched + extracted this run
    skipped: v.number(), // unsupported type / too large / folder
    // Heartbeat patched on every progress update — the stale-run guard keys
    // off this (not startedAt) so healthy long continuation chains aren't
    // treated as crashed.
    lastProgressAt: v.optional(v.number()),
  }).index("by_startedAt", ["startedAt"]),

  ingestionItems: defineTable({
    driveItemId: v.string(), // Graph item id — stable upsert key
    path: v.string(), // human-readable path under the sync root
    name: v.string(),
    // Inferred from `<root>/<Client>/<Fiscal year>/…` folder convention.
    clientName: v.optional(v.string()),
    fiscalYearLabel: v.optional(v.string()), // folder name, e.g. "2025 - Dec 31"
    fiscalYear: v.optional(v.number()),
    docKind: v.union(
      v.literal("pd"), // Word doc in a Submitted/To be submitted folder
      v.literal("transcript"), // under WIP/Technical/Audio
      v.literal("supporting"),
      v.literal("unknown")
    ),
    size: v.number(),
    lastModifiedAt: v.number(),
    contentHash: v.string(), // Graph quickXorHash, else sha256 of bytes
    storageId: v.optional(v.id("_storage")), // original bytes once fetched
    // Short extract preview for list/detail UI. The FULL extracted text lives
    // in storage (textStorageId) so pair/list queries never read megabytes of
    // transcript per row (Convex 16MiB read limit).
    text: v.optional(v.string()),
    textStorageId: v.optional(v.id("_storage")),
    extractNote: v.optional(v.string()), // e.g. "pdf — text extraction pending"
    status: v.union(
      v.literal("discovered"),
      v.literal("fetched"),
      v.literal("pending_review"), // extracted, waiting on the admin
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("failed"),
      v.literal("deleted")
    ),
    error: v.optional(v.string()),
    // Pair bookkeeping per client+fiscal-year group. Gaps are a feature, not
    // an error — "we need to get the transcript for this one" (Jun 19).
    pairGroupKey: v.string(), // `${clientName}::${fiscalYearLabel}`
    pairStatus: v.optional(
      v.union(
        v.literal("paired"),
        v.literal("missing_transcript"), // PD with no transcript in group
        v.literal("missing_pd"), // transcript with no PD in group
        v.literal("ambiguous_pd") // >1 PD candidate — admin picks one
      )
    ),
    brainSourceId: v.optional(v.id("brainSources")), // set on approve
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    // 2026-08-18 amendment — historical projects ported from ingestion.
    // Navigational association only (like projects.sourceProjectId); widen
    // fields, no backfill. Set by ingestionPort.portItemToProject. Indexed
    // since story 0 (AD-19) so project deletion can detach it without a scan.
    portedProjectId: v.optional(v.id("projects")),
    portedDocumentId: v.optional(v.id("projectDocuments")),
    portedAt: v.optional(v.number()),
    portedBy: v.optional(v.string()),
    // Soft deletion keeps review decisions reversible and auditable. Only
    // terminal queue states can be removed; approved Brain sources are
    // governed from the Brain admin instead.
    deletedFromStatus: v.optional(
      v.union(
        v.literal("pending_review"),
        v.literal("rejected"),
        v.literal("failed")
      )
    ),
    deletedBy: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_storageId", ["storageId"])
    .index("by_textStorageId", ["textStorageId"])
    .index("by_driveItemId", ["driveItemId"])
    .index("by_status", ["status"])
    .index("by_pairGroupKey", ["pairGroupKey"])
    .index("by_pairStatus", ["pairStatus"])
    .index("by_portedProjectId", ["portedProjectId"]),

  // ─── Story 1 (CAP-1/2/4): Generation Brief ────────────────────────────────
  // Stores the Brief: Storyline, Claim Exclusions, Confidence Map, Glossary Terms.
  // Keyed by (projectId, inputsHash); reused across generations with identical inputs.
  generationBriefs: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    // Hash over frozen generationSources rows (excluding writer_storyline and
    // transcript_digest kinds) to detect when inputs change. Determines reuse.
    inputsHash: v.string(),
    // Version for this (projectId, inputsHash): starts at 1, increments on edits
    version: v.number(),
    // Origin of the Storyline: writer-supplied, derived from analysis, or
    // writer-edited after derivation.
    origin: v.union(
      v.literal("writer"),
      v.literal("derived"),
      v.literal("edited")
    ),
    // The Storyline text (writer-supplied or derived). Updated only on origin=writer
    // or when an edit changes the Storyline itself (story 4 mutation).
    storylineText: v.string(),
    // When origin=edited, the edit magnitude (changed entries count + Storyline edit distance).
    editMagnitude: v.optional(
      v.object({
        changedEntriesCount: v.number(),
        storylineEditDistance: v.number(),
      })
    ),
    // Count of derived entries whose citation failed byte-match validation
    // and were dropped rather than inserted (Block-If: the drop is counted
    // on the Brief, the generation continues). Absent on a writer-edited
    // version, where no re-derivation ran.
    droppedEntryCount: v.optional(v.number()),
    // Story 4: who last shaped `storylineText` — `writer` when typed into an
    // empty Storyline, `edited` after any other Storyline change, otherwise
    // carried over. Absent on pre-story-4 rows, where `origin` stands in.
    storylineOrigin: v.optional(
      v.union(v.literal("writer"), v.literal("derived"), v.literal("edited"))
    ),
    createdAt: v.number(),
  })
    .index("by_projectId_and_inputsHash", ["projectId", "inputsHash"])
    .index("by_generationId", ["generationId"])
    // Latest-brief-for-project lookup (any inputsHash), used to diff a
    // re-derivation's entries against whatever the project last had.
    .index("by_projectId", ["projectId"]),

  // Child rows of generationBriefs: individual entries (Storyline questions,
  // Claim Exclusions, Confidence Map items, Glossary Terms). Never stored as
  // arrays on the parent (Convex guideline).
  generationBriefEntries: defineTable({
    briefId: v.id("generationBriefs"),
    projectId: v.id("projects"),
    // Entry group: storyline (primary narrative), storylineQuestion (Self-check
    // raises these), claimExclusion (eligibility reason required), confidenceMap
    // (confidence classification + source), glossaryTerm (rule-based matcher + model).
    group: v.union(
      v.literal("storyline"),
      v.literal("storylineQuestion"),
      v.literal("claimExclusion"),
      v.literal("confidenceMap"),
      v.literal("glossaryTerm")
    ),
    // Entry text content (the Storyline claim, exclusion statement, etc.)
    text: v.string(),
    // For claimExclusion: the eligibility reason (one of the fixed set)
    reason: v.optional(
      v.union(
        v.literal("business_risk"),
        v.literal("routine_engineering"),
        v.literal("outside_claim_period"),
        v.literal("not_technological")
      )
    ),
    // For confidenceMap: the confidence level of the fact
    confidence: v.optional(
      v.union(
        v.literal("established"),
        v.literal("partial"),
        v.literal("unresolved"),
        v.literal("unreliable")
      )
    ),
    // The frozen generationSources row this entry cites
    sourceId: v.id("generationSources"),
    // Byte-match validation: the source's contentHash
    sourceContentHash: v.string(),
    // Exact passage range in the source (byte offsets)
    startOffset: v.number(),
    endOffset: v.number(),
    // The exact excerpt from the source (for validation)
    exactExcerpt: v.string(),
    // When re-deriving (inputs changed), mark whether this entry was added,
    // removed, or unchanged compared to the previous version.
    change: v.optional(
      v.union(
        v.literal("added"),
        v.literal("removed"),
        v.literal("unchanged")
      )
    ),
    // For storylineQuestion group: the question text and resolution state
    // (story 2's Self-check raises these; story 4's saveEntryEdit resolves them)
    question: v.optional(
      v.object({
        questionText: v.string(),
        // Set when the question is resolved via saveEntryEdit (story 4)
        resolvedBy: v.optional(
          v.union(
            v.literal("use_evidence"),
            v.literal("keep_storyline")
          )
        ),
        // Storyline text when resolvedBy=use_evidence (the evidence-based alternative)
        alternativeText: v.optional(v.string()),
      })
    ),
    // Story 4: true on the copy of an entry a writer changed through
    // briefs.saveEntryEdit (the *edited* origin chip). Absent = derived.
    edited: v.optional(v.boolean()),
    // Generated Self-check output stays visible with the Brief but is not
    // part of the immutable input admitted at Summary sign-off.
    generatedOutput: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_briefId", ["briefId"])
    .index("by_briefId_and_generatedOutput", ["briefId", "generatedOutput"])
    .index("by_projectId", ["projectId"]),

  // Story 2 (CAP-7, AD-25): one row per Self-check / consistency decision for
  // one section of one generation (and, per candidate, its candidateRunId).
  // Written only by the ordered section-chain mutations in generations.ts;
  // read only through complianceNotes.listForGeneration.
  complianceNotes: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    candidateRunId: v.optional(v.id("generationCandidateRuns")),
    ...complianceNoteDraftValidator.fields,
  })
    .index("by_generationId_and_section", ["generationId", "section"])
    .index("by_generationId_and_candidateRunId_and_section", [
      "generationId",
      "candidateRunId",
      "section",
    ])
    .index("by_projectId", ["projectId"]),

  // Story 3 (CAP-8, AD-26/27): the House Rule categories a settings document
  // legislates, from the PSOS-50 style classifier, cached so a document costs
  // one `generation:settings` call per (projectId, contentHash) for a given
  // classifier version and none after. A row with a different
  // `classifierVersion` is never served. Written only by
  // writerProfiles.recordSettingsAnalysis. Carries projectId directly (AD-19).
  settingsDocumentAnalyses: defineTable({
    projectId: v.id("projects"),
    contentHash: v.string(),
    classifierVersion: v.string(),
    addressedCategories: v.array(styleCategoryValidator),
    analyzedAt: v.number(),
  }).index("by_projectId_and_contentHash_and_classifierVersion", [
    "projectId",
    "contentHash",
    "classifierVersion",
  ]),
  // DW-119 review: the single owner of the stale-generation scan
  // (generations.failStaleGenerations). One row, keyed by a constant. `scan`
  // is a sequence number every continuation page carries as its fence;
  // `continuationJobId` is that scan's pending page, inspected by id on each
  // cron tick so a second chain never starts while one is live. Cleared when
  // the scan's last page runs.
  staleGenerationScans: defineTable({
    key: v.string(),
    scan: v.number(),
    cutoff: v.number(),
    continuationJobId: v.optional(v.id("_scheduled_functions")),
    startedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // Admin-tunable app settings, one row per key. Currently: "defaultModel" —
  // the generation model used when a writer doesn't pick one explicitly.
  // ─── Model catalog (owner decision 21, 2026-09-24) ─────────────────────────
  // Every model the app can run or evaluate, refreshed daily from OpenRouter
  // and seeded from shared/generationModels.ts CANDIDATE_MODELS. Benchmark
  // scores are Artificial Analysis data: internal use only, admin reads only.
  modelCatalog: defineTable({
    ...catalogFieldsValidator,
    status: catalogStatusValidator,
    source: v.union(v.literal("seed"), v.literal("openrouter")),
    endpointSupport: v.optional(endpointSupportValidator),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    missingSince: v.optional(v.number()),
    renamedFrom: v.optional(v.string()),
    // Set when an admin notice for this row's expiry or removal was raised,
    // so the daily job raises each notice once.
    expiryNoticeFor: v.optional(v.string()),
    goneNoticeAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_modelId", ["modelId"])
    .index("by_gateway_and_canonicalSlug", ["gateway", "canonicalSlug"])
    .index("by_status", ["status"]),

  // The current model per named role, plus the model it replaced (the
  // one-call rollback target). History lives in modelSwitchEvents.
  modelRoleAssignments: defineTable({
    role: modelRoleValidator,
    modelId: v.string(),
    previousModelId: v.optional(v.string()),
    assignedAt: v.number(),
    assignedBy: v.union(v.literal("system"), v.literal("user")),
    assignedByUserId: v.optional(v.id("users")),
    // Last admin notice about this role's production error rate, so a
    // failing model with automatic switching off is announced once a day.
    errorNoticeAt: v.optional(v.number()),
    // "role_split": copied from the role this one was split out of
    // (shared/modelCatalog ROLE_PREDECESSORS), not chosen for it. Cleared
    // by the role's first real switch.
    origin: v.optional(v.literal("role_split")),
    // Written once when a split role gets its first assignment: the
    // predecessor's switch events up to `until` stay part of this role's
    // history, so a rollback made before the split keeps that model out of
    // this role's evaluations. No switch ever changes it.
    inheritedHistory: v.optional(v.object({ role: modelRoleValidator, until: v.number() })),
  }).index("by_role", ["role"]),

  // Append-only audit log of every role switch, automatic or manual.
  modelSwitchEvents: defineTable({
    role: modelRoleValidator,
    fromModelId: v.optional(v.string()),
    toModelId: v.string(),
    kind: v.union(
      v.literal("promotion"),
      v.literal("rollback"),
      v.literal("manual")
    ),
    reason: v.string(),
    evaluationId: v.optional(v.id("modelEvaluations")),
    evalResults: v.optional(
      v.object({
        candidate: evalSummaryValidator,
        incumbent: evalSummaryValidator,
        gates: v.array(gateResultValidator),
      })
    ),
    costComparison: v.optional(costComparisonValidator),
    errorRate: v.optional(
      v.object({ calls: v.number(), failures: v.number(), errorRate: v.number() })
    ),
    actor: v.union(v.literal("system"), v.literal("user")),
    actorUserId: v.optional(v.id("users")),
    at: v.number(),
  })
    .index("by_role_and_at", ["role", "at"])
    .index("by_at", ["at"])
    // Whether a role was ever rolled back from a model (up to a time), read
    // as one row however long the role's history is.
    .index("by_role_and_kind_and_fromModelId_and_at", ["role", "kind", "fromModelId", "at"]),

  // One candidate evaluated for one role against the incumbent on the fixed
  // eval set. Pending rows are queued or running; the rest carry results.
  modelEvaluations: defineTable({
    role: modelRoleValidator,
    modelId: v.string(),
    incumbentModelId: v.string(),
    evalSetVersion: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("passed"),
      v.literal("failed"),
      // A judge grade was missing on either side: never promotes.
      v.literal("incomplete"),
      v.literal("error")
    ),
    // The scheduled run, written in the same transaction as the row so a
    // queued evaluation is never left without one.
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
    // Spend held against the monthly budget while it runs: the most its
    // full request envelope can cost. Released to evalCostUsd at the end.
    reservedCostUsd: v.optional(v.number()),
    // The part of evalCostUsd that is the reserved maximum of requests that
    // were sent but never reported a charge (lost response, timeout).
    unsettledCostUsd: v.optional(v.number()),
    // Set when the claim refused the run for the monthly budget: the
    // reservation it needed. Planning treats the candidate as costing at
    // least this, so it waits until the budget can cover it.
    requiredCostUsd: v.optional(v.number()),
    // When the row's spend counts against a monthly budget: created, then
    // claimed, then settled. Monthly accounting reads this, not createdAt.
    accountedAt: v.optional(v.number()),
    benchmarkScore: v.optional(v.number()),
    incumbentBenchmarkScore: v.optional(v.number()),
    estimatedCostUsd: v.number(),
    candidate: v.optional(evalSummaryValidator),
    incumbent: v.optional(evalSummaryValidator),
    gates: v.optional(v.array(gateResultValidator)),
    // Everything the evaluation spent: candidate, incumbent and judge.
    evalCostUsd: v.optional(v.number()),
    // What happened after the gates: "promoted", or why it was not.
    outcome: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_role_and_modelId", ["role", "modelId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_accountedAt", ["accountedAt"]),

  // Exact per-model, per-hour request outcomes for the production
  // error-rate rollback: one terminal outcome per request, counted apart
  // from billing (a billed malformed response is one failure, never also a
  // success). Billing, auth, rate-limit and network failures are not
  // counted: they say nothing about the model.
  modelCallBuckets: defineTable({
    model: v.string(),
    hourStart: v.number(),
    successes: v.number(),
    failures: v.number(),
    lastFailureCode: v.optional(v.string()),
    lastFailureCallSite: v.optional(v.string()),
  }).index("by_model_and_hourStart", ["model", "hourStart"]),

  // The same outcomes one row per request, kept two days, so the partial
  // hours at the edges of a window are counted to the exact millisecond.
  modelCallOutcomes: defineTable({
    model: v.string(),
    at: v.number(),
    outcome: v.union(v.literal("success"), v.literal("failure")),
  })
    .index("by_model_and_at", ["model", "at"])
    .index("by_at", ["at"]),

  appSettings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
    // Optimistic-concurrency version, used only by the workspace rollout
    // master-switch key today. Optional: other settings rows never set it.
    version: v.optional(v.number()),
  }).index("by_key", ["key"]),

  // 2026-09-25 (transcript method): one row per run of the daily sweep of
  // stored files no row holds (`transcripts.sweepUnreferencedStorage`). In
  // "report" mode (the default) it only counts what it would delete; admins
  // read the latest run through `transcripts.getStorageSweepStatus`.
  storageSweepRuns: defineTable({
    mode: v.union(v.literal("report"), v.literal("delete")),
    // Files created before this were looked at.
    before: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    checked: v.number(),
    // Files no row holds (the ones "delete" removes).
    unreferenced: v.number(),
    unreferencedBytes: v.number(),
    oldestCreatedAt: v.optional(v.number()),
    newestCreatedAt: v.optional(v.number()),
    // A capped sample, as plain strings: a report of files no row holds,
    // deliberately not a storage reference (a v.id("_storage") here would
    // keep them alive).
    sampleFileIds: v.array(v.string()),
    deleted: v.number(),
  }).index("by_startedAt", ["startedAt"]),
});
