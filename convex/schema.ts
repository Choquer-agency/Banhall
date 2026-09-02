import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  projectTypeValidator,
  workflowStageValidator,
  workItemKindValidator,
  workItemStatusValidator,
} from "./lib/contracts";
import { styleOverridesValidator } from "./lib/styleOverrides";

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
    cacheReadInputTokens: v.optional(v.number()),
    costUsd: v.number(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_projectId", ["projectId"])
    .index("by_generationId", ["generationId"]),

  transcripts: defineTable({
    projectId: v.id("projects"),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  reports: defineTable({
    projectId: v.id("projects"),
    content: v.string(),
    version: v.number(),
    generatedAt: v.number(),
    updatedAt: v.number(),
    generationId: v.optional(v.id("generations")),
    sourceTranscriptId: v.optional(v.id("transcripts")),
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
    transcriptId: v.id("transcripts"),
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
    singleModelId: v.optional(v.string()),
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
    agentOutputs: v.optional(v.string()),
    currentStep: v.optional(v.string()),
    progressLog: v.optional(v.array(v.string())),
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
    // Overall score from the post-assembly QA pass (one-shot modes carry the
    // score inside agentOutputs.qa instead).
    qaScore: v.optional(v.number()),
    // BNH-10 flywheel: which Brain exemplars fed this generation (provenance
    // for usefulness analytics; entryId FKs into the RAG component, sourceId
    // into brainSources). `section` says which consumer used it (analyzer/
    // 242/244/246); searchScore/rerankScore keep the raw signals separate
    // from the final blended score.
    brainProvenance: v.optional(
      v.array(
        v.object({
          entryId: v.string(),
          score: v.number(),
          title: v.optional(v.string()),
          writerName: v.optional(v.string()),
          section: v.optional(v.string()),
          sourceId: v.optional(v.string()),
          searchScore: v.optional(v.number()),
          rerankScore: v.optional(v.number()),
        })
      )
    ),
    // The Haiku-extracted retrieval brief (JSON) behind the section queries —
    // kept for retrieval-quality evals.
    brainRetrievalBrief: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_status_and_startedAt", ["status", "startedAt"])
    .index("by_postQaStatus", ["postQaStatus"]),

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
    .index("by_user_and_candidateId", ["userId", "candidateId"]),

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
    .index("by_agentThreadId", ["agentThreadId"]),

  // The agent UIMessage cannot durably express turn start/end, so app-owned
  // timing keeps queued and terminal states stable across reloads and races.
  chatTurns: defineTable({
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
  })
    .index("by_agentThreadId_and_promptMessageId", [
      "agentThreadId",
      "promptMessageId",
    ])
    .index("by_agentThreadId_and_order", ["agentThreadId", "order"])
    // Stale-turn reaper: sweep queued/running rows regardless of thread.
    .index("by_status", ["status"]),

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
    .index("by_agentThreadId_and_toolCallId", ["agentThreadId", "toolCallId"]),

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
    createdAt: v.number(),
  })
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
    .index("by_reportId_and_requestedBy", ["reportId", "requestedBy"]),

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
    .index("by_sessionId_and_provider", ["sessionId", "provider"]),

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
  }).index("by_sessionId", ["sessionId"]),

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
  }).index("by_sessionId", ["sessionId"]),

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
    contentHash: v.optional(v.string()),
    // Present on the checkpoint captured before a research-backed edit, keeping
    // the source trail attached to version history.
    researchSessionId: v.optional(v.id("researchSessions")),
    researchSourceCount: v.optional(v.number()),
  })
    .index("by_reportId", ["reportId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_milestoneKey", ["projectId", "milestoneKey"]),

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
  })
    .index("by_generationId", ["generationId"])
    .index("by_generationId_and_model", ["generationId", "model"])
    .index("by_status_and_startedAt", ["status", "startedAt"]),

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
      v.literal("failed") // drafting failed; writer can regenerate
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
    queuedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_generationId", ["generationId"])
    .index("by_generationId_and_section", ["generationId", "section"]),

  // Frozen per-generation artifacts for the iterative flow (analysis JSON,
  // brain-block JSON). Kept out of the live-subscribed generations row so the
  // hot document stays light.
  generationArtifacts: defineTable({
    generationId: v.id("generations"),
    kind: v.union(v.literal("analysis"), v.literal("brain_blocks")),
    content: v.string(),
  }).index("by_generationId_and_kind", ["generationId", "kind"]),

  // Immutable source text captured before candidate fan-out.
  generationSources: defineTable({
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    kind: v.union(v.literal("transcript"), v.literal("project_document")),
    transcriptId: v.optional(v.id("transcripts")),
    projectDocumentId: v.optional(v.id("projectDocuments")),
    label: v.string(),
    content: v.string(),
    contentHash: v.string(),
    truncated: v.boolean(),
    originalLength: v.number(),
    capturedAt: v.number(),
  })
    .index("by_generationId", ["generationId"])
    .index("by_projectId_and_generationId", ["projectId", "generationId"]),

  // Immutable claim-to-source bundle for one exact report content hash.
  reportProvenance: defineTable({
    projectId: v.id("projects"),
    generationId: v.optional(v.id("generations")),
    sourceTranscriptId: v.optional(v.id("transcripts")),
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
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    reportVersion: v.optional(v.number()),
    userId: v.string(),
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

  // Per-writer feedback on individual generated QA observations. Target keys
  // survive candidate deletion after selection; item text is copied for admin review.
  qaItemFeedback: defineTable({
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
  // approve → ingest (embedSource), revoke → deleteByKey. Nothing is ever
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
      v.literal("revoked") // unlearned — deleted from the RAG
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
  }).index("by_status", ["status"]),

  // BNH-39: full audit trail + revert log. Every approve/revoke/reweight/unlearn
  // is recorded so the admin can see (and undo) what changed the Brain.
  brainAuditLog: defineTable({
    action: v.union(
      v.literal("ingest"),
      v.literal("approve"),
      v.literal("reject"),
      v.literal("revoke"),
      v.literal("reweight"),
      v.literal("revert")
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
  }).index("by_generationId", ["generationId"]),

  learningDigests: defineTable({
    kind: v.union(v.literal("qa_calibration"), v.literal("draft_style")),
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
    // fields, no backfill, no index. Set by ingestionPort.portItemToProject.
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
    .index("by_driveItemId", ["driveItemId"])
    .index("by_status", ["status"])
    .index("by_pairGroupKey", ["pairGroupKey"])
    .index("by_pairStatus", ["pairStatus"]),

  // Admin-tunable app settings, one row per key. Currently: "defaultModel" —
  // the generation model used when a writer doesn't pick one explicitly.
  appSettings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
    // Optimistic-concurrency version, used only by the workspace rollout
    // master-switch key today. Optional: other settings rows never set it.
    version: v.optional(v.number()),
  }).index("by_key", ["key"]),
});
