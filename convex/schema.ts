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
    title: v.string(),
    clientName: v.string(),
    writer: v.optional(v.string()),
    interviewer: v.optional(v.string()),
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
      v.literal("completed"),
      v.literal("failed")
    ),
    agentOutputs: v.optional(v.string()),
    currentStep: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_projectId", ["projectId"]),

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
    // A proposed edit the assistant wants to make to the report.
    proposedEdit: v.optional(
      v.object({
        targetText: v.string(),
        targetFrom: v.optional(v.number()),
        targetTo: v.optional(v.number()),
        newText: v.string(),
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
      v.literal("other")
    ),
    content: v.string(),
    // Original file bytes in Convex storage (for preview/download).
    storageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    source: v.string(),
    uploadedBy: v.string(),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"]),

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
});
