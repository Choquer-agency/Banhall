import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Auth lives in the Better Auth component (see convex/auth.ts). This app
  // users table stays authoritative for role/profile; synced via triggers.
  users: defineTable({
    // Better Auth component user._id; optional while legacy docs relink.
    authId: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(
      v.union(v.literal("writer"), v.literal("manager"), v.literal("admin"))
    ),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_authId", ["authId"]),

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
    // BNH-39: how the project started — generate a PD from a transcript
    // (default, absent on older projects) or review an existing written PD.
    mode: v.optional(v.union(v.literal("generate"), v.literal("review"))),
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
    .index("by_industry", ["industry"]),

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
    .index("by_projectId", ["projectId"]),

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
      v.literal("failed")
    ),
    requestedAt: v.optional(v.number()),
    requestedBy: v.optional(v.id("users")),
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
    .index("by_status_and_startedAt", ["status", "startedAt"]),

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

  // One row per tool call the assistant makes (proposeEdit / proposeReplacements
  // / highlightPassages). Same lifecycle semantics as chatMessages.proposedEdit.
  chatProposals: defineTable({
    agentThreadId: v.string(),
    messageId: v.optional(v.string()), // component message id of the tool call
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
    state: v.union(
      v.literal("pending"),
      v.literal("applied"),
      v.literal("rejected")
    ),
    createdAt: v.number(),
  }).index("by_agentThreadId", ["agentThreadId"]),

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
  }).index("by_projectId", ["projectId"]),

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
  }).index("by_projectId", ["projectId"]),

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
    content: v.string(), // exact prompt block injected into the agent
    sourceCount: v.number(), // feedback rows that informed this digest
    feedbackCutoff: v.number(), // newest feedback updatedAt included
    model: v.string(), // model that produced the digest
    createdAt: v.number(),
    // Per-writer flavor Phase B prep: absent = global digest (current
    // behavior); set = digest distilled from ONE writer's feedback only.
    // No reads use this yet.
    userId: v.optional(v.id("users")),
  })
    .index("by_kind", ["kind"])
    .index("by_kind_and_userId", ["kind", "userId"]),

  // ─── Per-writer flavor (Phase A): persistent custom writing instructions ───
  // One row per user; injected as a bounded, lowest-priority block into the
  // section-drafting prompts (convex/ai/pipeline.ts). Never overrides CRA
  // structure, phrasing rules, or length budgets.
  writerProfiles: defineTable({
    userId: v.id("users"),
    customInstructions: v.string(),
    enabled: v.boolean(),
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
    createdBy: v.id("users"),
  }).index("by_publishedAt", ["publishedAt"]),

  // Per-user read watermark for the changelog badge.
  changelogReads: defineTable({
    userId: v.id("users"),
    lastSeenAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Admin-tunable app settings, one row per key. Currently: "defaultModel" —
  // the generation model used when a writer doesn't pick one explicitly.
  appSettings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
