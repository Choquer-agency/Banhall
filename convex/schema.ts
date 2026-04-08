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
    resolved: v.boolean(),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  commenters: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
    createdAt: v.number(),
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
});
