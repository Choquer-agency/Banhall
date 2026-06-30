import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(v.union(v.literal("writer"), v.literal("admin"))),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  projects: defineTable({
    // Plain-language internal title (set at the start; shown in lists).
    title: v.string(),
    // BNH-23: formal SR&ED / science title for the report (finalized at the end).
    sredTitle: v.optional(v.string()),
    clientName: v.string(),
    writer: v.optional(v.string()),
    interviewer: v.optional(v.string()),
    // BNH-36: client's fiscal year-end (timestamp) — drives company → fiscal-year
    // grouping on the dashboard. "Fiscal 2025" = the year of this date.
    fiscalYearEnd: v.optional(v.number()),
    status: v.union(
      v.literal("draft"),
      v.literal("generating"),
      v.literal("review"),
      v.literal("client_review"),
      v.literal("final")
    ),
    createdBy: v.id("users"),
    shareToken: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_createdBy", ["createdBy"])
    .index("by_shareToken", ["shareToken"]),

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
  }).index("by_projectId", ["projectId"]),

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
  }).index("by_projectId", ["projectId"]),

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
  }).index("by_projectId", ["projectId"]),

  timesheetEntries: defineTable({
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
    personName: v.string(),
    date: v.string(),
    hours: v.number(),
    description: v.string(),
    sredEligible: v.boolean(),
    sredReason: v.optional(v.string()),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    source: v.string(),
  }).index("by_projectId", ["projectId"]),

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
  }).index("by_projectId", ["projectId"]),

  generations: defineTable({
    projectId: v.id("projects"),
    transcriptId: v.id("transcripts"),
    status: v.union(
      v.literal("running"),
      v.literal("awaiting_selection"),
      v.literal("completed"),
      v.literal("failed")
    ),
    agentOutputs: v.optional(v.string()),
    currentStep: v.optional(v.string()),
    progressLog: v.optional(v.array(v.string())),
    // BNH-21: time-estimate + milestone progress for the loading screen.
    estimatedMs: v.optional(v.number()),
    totalCandidates: v.optional(v.number()),
    candidatesDone: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_projectId", ["projectId"]),

  // ─── BNH-15: model A/B testing ─────────────────────────────────────────────

  // One candidate report per model for a given generation; the writer picks one.
  reportCandidates: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    model: v.string(),
    label: v.string(),
    content: v.string(),
    agentOutputs: v.string(),
    createdAt: v.number(),
  })
    .index("by_generationId", ["generationId"])
    .index("by_projectId", ["projectId"]),

  // Logged model choices, for aggregate preference stats + recommendation.
  modelSelections: defineTable({
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    userId: v.string(),
    model: v.string(),
    label: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"]),

  // ─── AI Chat (document-scoped assistant) ───────────────────────────────────

  chatThreads: defineTable({
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    title: v.string(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_reportId", ["reportId"]),

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
      v.literal("pre_restore")
    ),
    label: v.optional(v.string()),
    createdByRole: v.union(v.literal("writer"), v.literal("system")),
    createdAt: v.number(),
  }).index("by_reportId", ["reportId"]),

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
});
