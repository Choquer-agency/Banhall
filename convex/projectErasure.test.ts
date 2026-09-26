/// <reference types="vite/client" />
/**
 * Story 0 (AD-19): the project-scoped table registry and the paginated
 * erasure it drives.
 *
 * 1. Completeness walk: every `v.id("projects")` field in the schema (optional,
 *    nested in unions, differently named) has a registry entry, every entry
 *    still exists, and the indexes the purge relies on lead with the field.
 * 2. Purge: one row in EVERY registry entry (delete, detach, keep), a stored
 *    blob and an in-flight generation; after the scheduler drains, delete
 *    rows and the blob are gone, detach fields cleared, keep rows intact,
 *    project gone. Page, budget, redelivery and shared-blob cases separately.
 * 3. Barrier: late claims, the post-QA entry and the post-QA save write nothing.
 * 4. Authorization and open-work refusal write nothing.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenericDatabaseReader, GenericDataModel } from "convex/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  PROJECT_PURGE_PAGE_SIZE,
  SCHEDULED_CHILD_CLEANUP_TABLES,
  purgePosition,
} from "./projects";
import {
  PROJECT_SCOPED_TABLES,
  PROJECT_SELF_REFERENCE,
  type ProjectScopedTable,
} from "./lib/projectScopedTables";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ─── 1. Completeness walk ────────────────────────────────────────────────────

type ValidatorJson =
  | { type: "id"; tableName: string }
  | { type: "object"; value: Record<string, { fieldType: ValidatorJson; optional: boolean }> }
  | { type: "union"; value: ValidatorJson[] }
  | { type: "array"; value: ValidatorJson }
  | { type: "record"; keys: ValidatorJson; values: { fieldType: ValidatorJson; optional: boolean } }
  | { type: string };

/** Top-level field paths whose validator targets `v.id("projects")`, anywhere in the shape. */
function projectReferenceFields(json: ValidatorJson, path: string, out: Set<string>) {
  switch (json.type) {
    case "id":
      if ((json as { tableName: string }).tableName === "projects") out.add(path);
      return;
    case "object":
      for (const [name, field] of Object.entries(
        (json as { value: Record<string, { fieldType: ValidatorJson }> }).value
      )) {
        projectReferenceFields(field.fieldType, path ? `${path}.${name}` : name, out);
      }
      return;
    case "union":
      for (const member of (json as { value: ValidatorJson[] }).value) {
        projectReferenceFields(member, path, out);
      }
      return;
    case "array":
      projectReferenceFields((json as { value: ValidatorJson }).value, `${path}[]`, out);
      return;
    case "record":
      projectReferenceFields(
        (json as { values: { fieldType: ValidatorJson } }).values.fieldType,
        `${path}[*]`,
        out
      );
      return;
    default:
      return;
  }
}

type TableExport = { indexes: { indexDescriptor: string; fields: string[] }[] };
type TableDef = { validator: { json: ValidatorJson }; export(): TableExport };
const tables = schema.tables as unknown as Record<string, TableDef>;

function topLevelFields(table: string): Set<string> {
  const json = tables[table].validator.json;
  const out = new Set<string>();
  const visit = (node: ValidatorJson) => {
    if (node.type === "object") {
      for (const name of Object.keys((node as { value: Record<string, unknown> }).value)) out.add(name);
    } else if (node.type === "union") {
      for (const member of (node as { value: ValidatorJson[] }).value) visit(member);
    }
  };
  visit(json);
  return out;
}

function schemaProjectReferences(): Set<string> {
  const found = new Set<string>();
  for (const [table, def] of Object.entries(tables)) {
    const fields = new Set<string>();
    projectReferenceFields(def.validator.json, "", fields);
    for (const field of fields) found.add(`${table}.${field}`);
  }
  return found;
}

const registry: readonly ProjectScopedTable[] = [...PROJECT_SCOPED_TABLES, PROJECT_SELF_REFERENCE];
const refKey = (entry: ProjectScopedTable) => `${entry.table}.${entry.field}`;
const SEED_TABLES = [
  "seedSubsections",
  "seedBatches",
  "seedBatchContext",
  "seeds",
  "seedProvenance",
  "seedSelections",
  "seedFeedbackRequests",
  "seedStaleEpisodes",
  "summaryVersions",
  "summaryItems",
  "seedDecisionEvents",
] as const;

function indexFields(table: string, index: string): string[] | undefined {
  return tables[table]?.export().indexes.find((i) => i.indexDescriptor === index)?.fields;
}

describe("project-scoped table registry", () => {
  it("lists every v.id(\"projects\") field in the schema, and nothing else", () => {
    const found = schemaProjectReferences();
    // The walk must actually see the tricky shapes, not pass on an empty set.
    expect(found.size).toBeGreaterThanOrEqual(50);
    expect(found).toContain("projects.sourceProjectId"); // optional self-reference
    expect(found).toContain("aiUsage.projectId"); // optional
    expect(found).toContain("workItemEvents.projectId"); // union of objects
    expect(found).toContain("ingestionItems.portedProjectId"); // differently named
    expect(found).toContain("brainSources.sourceProjectId");

    const registered = new Set(registry.map(refKey));
    const unlisted = [...found].filter((ref) => !registered.has(ref)).sort();
    expect(
      unlisted,
      `Add a PROJECT_SCOPED_TABLES entry (delete / detach / keep) for: ${unlisted.join(", ")}`
    ).toEqual([]);
    const stale = [...registered].filter((ref) => !found.has(ref)).sort();
    expect(stale, `Registry entries with no schema field: ${stale.join(", ")}`).toEqual([]);
    expect(registry.length).toBe(registered.size); // no duplicate entries
  });

  it("gives every delete/detach entry an index that leads with its field", () => {
    for (const entry of registry) {
      if (entry.disposition === "keep") {
        expect(entry.children, `${entry.table}: keep entries carry no children`).toBeUndefined();
        expect(entry.clearWith, `${entry.table}: keep entries clear nothing`).toBeUndefined();
        continue;
      }
      expect(entry.index, `${refKey(entry)} needs an index`).toBeDefined();
      const fields = indexFields(entry.table, entry.index!);
      expect(fields, `${entry.table}.${entry.index} is not a schema index`).toBeDefined();
      expect(fields![0], `${entry.table}.${entry.index} must lead with ${entry.field}`).toBe(entry.field);
      for (const child of entry.children ?? []) {
        expect(entry.disposition, `${entry.table}: only delete entries have children`).toBe("delete");
        const childFields = indexFields(child.table, child.index);
        expect(childFields, `${child.table}.${child.index} is not a schema index`).toBeDefined();
        expect(childFields![0]).toBe(child.field);
        if (child.cleanup === "scheduled") {
          expect(SCHEDULED_CHILD_CLEANUP_TABLES as readonly string[]).toContain(child.table);
        }
      }
      for (const sibling of entry.clearWith ?? []) {
        expect(entry.disposition, `${entry.table}: only detach entries clear siblings`).toBe("detach");
        expect(topLevelFields(entry.table), `${entry.table}.${sibling} is not a schema field`).toContain(sibling);
      }
      if (entry.blob) {
        const json = tables[entry.table].validator.json as {
          value: Record<string, { fieldType: { type: string; tableName?: string } }>;
        };
        expect(json.value[entry.blob].fieldType).toEqual({ type: "id", tableName: "_storage" });
      }
    }
    expect(PROJECT_SCOPED_TABLES.map((e) => e.table)).not.toContain("projects");
  });

  it("registers all eleven seed tables for indexed deletion", () => {
    for (const table of SEED_TABLES) {
      expect(PROJECT_SCOPED_TABLES).toContainEqual(
        expect.objectContaining({
          table,
          field: "projectId",
          disposition: "delete",
          index: "by_projectId",
        })
      );
    }
  });
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

type Db = GenericDatabaseReader<GenericDataModel>;
type DbId = Parameters<Db["get"]>[0];

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const creatorId = await ctx.db.insert("users", { authId: "erasure-creator", role: "writer" });
    const otherId = await ctx.db.insert("users", { authId: "erasure-other", role: "writer" });
    await ctx.db.insert("users", { authId: "erasure-admin", role: "admin" });
    const base = { clientName: "Erasure Co", status: "draft" as const, createdAt: 1, updatedAt: 1 };
    const projectId = await ctx.db.insert("projects", {
      ...base,
      title: "Doomed",
      createdBy: creatorId,
      ownerId: creatorId,
      shareToken: "erasure-doomed",
      workflowStage: "intake",
      dashboardCompanyKey: "erasure co",
      dashboardCompanyCounted: true,
    });
    const retainedProjectId = await ctx.db.insert("projects", {
      ...base,
      title: "Retained",
      createdBy: otherId,
      shareToken: "erasure-retained",
    });
    // Seeded at 2 so the company row survives one decrement (it is deleted at 0).
    await ctx.db.insert("dashboardCompanies", {
      companyKey: "erasure co",
      clientName: "Erasure Co",
      projectCount: 2,
      stageCounts: { intake: 2 },
      updatedAt: 1,
    });
    return { creatorId, otherId, projectId, retainedProjectId };
  });
  return {
    t,
    ...ids,
    creator: t.withIdentity({ subject: "erasure-creator" }),
    other: t.withIdentity({ subject: "erasure-other" }),
    admin: t.withIdentity({ subject: "erasure-admin" }),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/**
 * One row in every registry entry (delete, detach, keep) plus the self
 * reference, for `projectId`. `byRef` maps "table.field" to the id of that
 * row so detach/keep assertions can read the exact row back.
 */
async function seedProjectRows(
  s: Setup,
  projectId: Id<"projects">,
  options: { storageId?: Id<"_storage"> } = {}
) {
  return await s.t.run(async (ctx) => {
    const userId = s.creatorId;
    const now = 1000;
    const byRef: Record<string, string> = {};
    const storageId = options.storageId ?? (await ctx.storage.store(new Blob(["doomed bytes"])));

    await ctx.db.insert("projectEvents", { projectId, type: "stage_changed", actorId: userId, at: now, to: "intake" });
    const workItemId = await ctx.db.insert("workItems", {
      projectId, kind: "internal_review", assigneeId: userId, assignerId: userId, instructions: "x",
      blocking: false, status: "completed", version: 1, createRequestId: "r", createRequestFingerprint: "f",
      createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("workItemEvents", {
      workItemId, projectId, type: "created", actorId: userId, at: now, itemVersion: 0,
      detail: { kind: "internal_review", assigneeId: userId, blocking: false },
    });
    await ctx.db.insert("workItemOversight", {
      viewerId: userId, workItemId, projectId, assigneeId: userId, dueSortAt: now,
      sourceAssigner: true, sourceOwner: false, updatedAt: now,
    });
    const rebuildId = await ctx.db.insert("oversightRebuilds", {
      projectId, reason: "repair", toOwnerId: userId, status: "completed", attempts: 0, startedAt: now, updatedAt: now,
    });
    await ctx.db.insert("oversightSyncing", { viewerId: userId, projectId, rebuildId, startedAt: now });
    // 2026-09-24: the transcript owns its uploaded original, and its derived
    // turn, speaker, fact and fact-run rows go with the project.
    const transcriptBlobId = await ctx.storage.store(new Blob(["original transcript bytes"]));
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId, content: "Interview", createdAt: now, originalStorageId: transcriptBlobId,
    });
    await ctx.db.insert("transcriptTurns", {
      transcriptId, projectId, parserVersion: "1", index: 0, charStart: 0, charEnd: 9, cleanText: "Interview",
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Priya", role: "client", roleSource: "heuristic", confidence: 0.9, turnCount: 1,
    });
    await ctx.db.insert("transcriptFacts", {
      transcriptId, projectId, sourceContentHash: "h", factsVersion: "1", key: "F1-1", type: "context", claim: "c",
      turnIndexes: [0], quotes: [], confidence: 0.5,
    });
    await ctx.db.insert("transcriptFactRuns", {
      transcriptId, projectId, sourceContentHash: "h", factsVersion: "1", model: "m", status: "ready",
      counts: { proposed: 1, verified: 1, dropped: 0 }, startedAt: now,
    });
    await ctx.db.insert("transcriptDigests", {
      transcriptId, projectId, sourceContentHash: "h", condenseVersion: "1", content: "d", structured: "{}",
      model: "m", promptVersion: "p", charCount: 1, originalLength: 9, createdAt: now,
    });
    const reportId = await ctx.db.insert("reports", { projectId, content: "Report", version: 1, generatedAt: now, updatedAt: now });
    // A live iterative generation with a scheduled job and a running post-QA
    // attempt, a queued ghost candidate run with its own job, and a queued
    // section run. The jobs are stand-ins (a no-op cleanup on a live report)
    // that deleteProject must cancel.
    const generationJobId = await ctx.scheduler.runAfter(
      60_000, internal.projects.cleanupDeletedReportQaFindings, { reportId }
    );
    const generationId = await ctx.db.insert("generations", {
      projectId, transcriptId, status: "awaiting_input", candidateMode: "iterative", agentOutputs: "{}",
      startedAt: now, scheduledJobId: generationJobId, postQaStatus: "running", postQaStartedAt: now,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    await ctx.db.patch(reportId, { generationId });
    const candidateJobId = await ctx.scheduler.runAfter(
      60_000, internal.projects.cleanupDeletedReportQaFindings, { reportId }
    );
    const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
      generationId, projectId, model: "m", label: "A", status: "queued", ghost: true,
      queuedAt: now, scheduledJobId: candidateJobId,
    });
    const sectionRunId = await ctx.db.insert("generationSectionRuns", {
      generationId, projectId, section: "s242", status: "queued", model: "m", label: "A", attempt: 1, queuedAt: now,
    });
    await ctx.db.insert("generationArtifacts", { generationId, kind: "analysis", content: "{}" });
    const candidateId = await ctx.db.insert("reportCandidates", {
      projectId, generationId, model: "m", label: "A", content: "c", agentOutputs: "{}", createdAt: now,
    });
    await ctx.db.insert("candidateScores", {
      projectId, generationId, candidateId, optionPosition: 1, model: "m", label: "A", userId: "u", score: 5, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("modelSelections", { projectId, generationId, userId: "u", model: "m", label: "A", createdAt: now });
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert("qaFindings", { reportId, revisionNumber: i, contentHash: `c${i}`, check: "because_clause", message: "m", blocking: true });
    }
    await ctx.db.insert("comments", {
      projectId, reportId, commenterId: "c", commenterType: "writer", highlightFrom: 0, highlightTo: 1,
      highlightText: "R", body: "b", resolved: false, createdAt: now,
    });
    await ctx.db.insert("commenters", { projectId, name: "n", color: "#000", createdAt: now });
    await ctx.db.insert("reportViews", { projectId, viewerName: "v", viewerType: "writer", viewedAt: now });
    const uploadId = await ctx.db.insert("financialUploads", { projectId, fileName: "t.csv", fileType: "timesheet", content: "c", createdAt: now });
    await ctx.db.insert("timesheetEntries", {
      projectId, uploadId, personName: "p", date: "2026-01-01", hours: 1, description: "d", sredEligible: true, confidence: "high", source: "s",
    });
    await ctx.db.insert("financialSummaries", { projectId, totalHours: 1, sredHours: 1, nonSredHours: 0, personnelBreakdown: "{}", generatedAt: now });
    const threadId = await ctx.db.insert("chatThreads", { projectId, reportId, title: "t", createdAt: now });
    await ctx.db.insert("chatMessages", { threadId, projectId, reportId, role: "writer", content: "hi", status: "complete", createdAt: now });
    const agentThreadId = `agent-thread-${projectId}`;
    await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId, title: "t", createdAt: now });
    const turnId = await ctx.db.insert("chatTurns", { agentThreadId, promptMessageId: "p1", order: 0, status: "completed", stepCount: 1 });
    const proposalId = await ctx.db.insert("chatProposals", { agentThreadId, projectId, reportId, kind: "edit", state: "pending", createdAt: now });
    await ctx.db.insert("chatProposalItems", { proposalId, projectId, itemId: "1", status: "resolved", reason: "r", createdAt: now });
    await ctx.db.insert("chatAnswerFeedback", {
      turnId, userId, projectId, reportId, agentThreadId, promptMessageId: "p1", answerMessageId: "a1",
      promptText: "q", answerText: "a", vote: 1, createdAt: now,
    });
    await ctx.db.insert("proposalWordingEditEvents", { projectId, reportId, proposalId, userId, originalText: "o", editedText: "e", createdAt: now });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId, fileName: "doc.txt", fileType: "txt", content: "doc", storageId, source: "upload", uploadedBy: "u", createdAt: now,
    });
    await ctx.db.insert("documentUploadAttempts", {
      projectId, attemptKey: "11111111-1111-4111-8111-111111111111", fileName: "doc.txt", origin: "chat_upload",
      status: "succeeded", documentId, createdBy: userId, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("pdReviews", { projectId, documentId, sourceFileName: "doc.txt", status: "completed", createdBy: "u", createdAt: now });
    await ctx.db.insert("pdReviewEvents", { projectId, actor: "u", action: "review_started", at: now });
    const sessionId = await ctx.db.insert("researchSessions", {
      projectId, reportId, requestedBy: userId, selectedText: "s", selectionFrom: 0, selectionTo: 1, surroundingContext: "c",
      instruction: "i", externalBrief: "b", reportRevisionNumber: 0, status: "completed", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("researchRuns", { sessionId, projectId, provider: "gpt", model: "m", status: "completed", startedAt: now });
    await ctx.db.insert("researchSources", { sessionId, projectId, kind: "external", title: "t", verification: "provider_cited", createdAt: now });
    await ctx.db.insert("researchClaims", { sessionId, projectId, text: "t", evidenceKind: "external", support: "supported", sourceIds: [], createdAt: now });
    await ctx.db.insert("sectionEditEvents", { projectId, generationId, section: "s242", draftText: "d", approvedText: "a", editRatio: 0, createdAt: now });
    await ctx.db.insert("generationProgress", { projectId, generationId, at: now, message: "Queued", kind: "info" });
    await ctx.db.insert("generationQaResults", {
      projectId, generationId, reportId, revisionNumber: 0, contentHash: "h", status: "done", completedAt: now,
    });
    await ctx.db.insert("complianceNotes", {
      projectId, generationId, section: "242", source: "deterministic", instruction: "i", outcome: "applied", tier: "locked", reason: "r", repaired: false,
    });
    const snapshotId = await ctx.db.insert("reportSnapshots", { projectId, reportId, content: "c", reason: "manual", createdByRole: "writer", createdAt: now });
    const provenanceId = await ctx.db.insert("reportProvenance", { projectId, contentHash: "h", status: "approved", claims: [], createdAt: now });
    await ctx.db.insert("reportExports", {
      projectId, reportId, reportVersion: 1, revisionNumber: 0, snapshotId, provenanceId, contentHash: "h",
      templateVersion: "1", actorId: userId, status: "completed", authorizedAt: now,
    });
    await ctx.db.insert("projectIdentityEvidence", {
      projectId, subjectName: "s", relationship: "claimant", evidenceKind: "other", sourceDescription: "d", status: "pending", createdAt: now, updatedAt: now,
    });
    const sourceId = await ctx.db.insert("generationSources", {
      generationId, projectId, kind: "transcript", label: "l", content: "c", contentHash: "h", truncated: false, originalLength: 1, capturedAt: now,
    });
    const briefId = await ctx.db.insert("generationBriefs", { projectId, generationId, inputsHash: "h", version: 1, origin: "derived", storylineText: "s", createdAt: now });
    await ctx.db.insert("generationBriefEntries", {
      briefId, projectId, group: "storyline", text: "t", sourceId, sourceContentHash: "h", startOffset: 0, endOffset: 1, exactExcerpt: "c", createdAt: now,
    });
    await ctx.db.insert("generationReadingFacts", {
      generationId, projectId, seq: 1, chip: "Fact", quote: "q", sourceLabel: "Priya, line 1", createdAt: now,
    });
    // One schema-populated row in every seed table proves both the AD-33 shape
    // and the registry-driven purge. These rows exercise optional references;
    // they are not intended to model one semantically valid workflow episode.
    // The retained project's duplicate fixture proves erasure stays scoped.
    const batchId = await ctx.db.insert("seedBatches", {
      projectId, generationId, roleId: "company_context", operation: "feedback",
      dedupeKey: `seed-dedupe-${projectId}`, commandId: `seed-command-${projectId}`,
      attemptId: `seed-attempt-${projectId}`, consumedContextRevision: "context-r1",
      briefVersionId: briefId, settingsHash: "settings-hash", status: "shown",
      deliveredLateAt: now + 4, queuedAt: now, leaseExpiresAt: now + 600_000,
      startedAt: now + 1, completedAt: now + 2, model: "m",
      slot: "generation:seedFeedback:company_context", promptVersion: "prompt-v1",
      requestsReserved: 2, requestsMade: 1, settledAt: now + 3, seedsDropped: 0,
      error: "bounded fixture error",
    });
    const seedId = await ctx.db.insert("seeds", {
      projectId, generationId, batchId, roleId: "company_context", order: 1,
      bullets: ["A concise seed."], tags: ["technical"],
      support: "source_supported", originalSupport: "source_supported",
    });
    const feedbackRequestId = await ctx.db.insert("seedFeedbackRequests", {
      projectId, generationId, roleId: "company_context", targetSeedId: seedId,
      targetWording: ["A concise seed."], instruction: "Make it more precise",
      status: "withdrawn", withdrawnAt: now + 5, batchId,
    });
    await ctx.db.patch(batchId, { feedbackRequestId });
    await ctx.db.patch(seedId, {
      revisionOfSeedId: seedId,
      feedbackRequestId,
      uncertaintySeedId: seedId,
      experimentSeedIds: [seedId],
    });
    const staleEpisodeId = await ctx.db.insert("seedStaleEpisodes", {
      projectId, generationId, roleId: "company_context", openedAt: now,
      reasons: ["company_context"], disposedAt: now + 6, disposition: "resolved",
      freshAttemptCompleted: true, freshSeedsInSnapshot: true,
      olderSelectionsConfirmed: true,
    });
    await ctx.db.insert("seedSubsections", {
      projectId, generationId, roleId: "company_context", kind: "standard",
      state: "approved", currentContextRevision: "context-r1",
      selectionRevision: "selection-r1", shownBatchId: batchId,
      pendingBatchId: batchId, priorState: "in_progress", consecutiveFailures: 1,
      activeStaleEpisodeId: staleEpisodeId, approvedBy: userId,
      approvedAt: now + 7, approvedSelectionRevision: "selection-r1",
      approvedContextRevision: "context-r1", approvedWithConfirmation: true,
      exclusionAcknowledgedAt: now + 8,
    });
    await ctx.db.insert("seedBatchContext", {
      projectId, generationId, batchId, roleId: "company_context", kind: "target",
      sourceRoleId: "company_context", seedId, feedbackRequestId,
      bullets: ["A concise seed."], text: "Make it more precise", order: 1,
      contributionHash: "contribution-hash",
    });
    await ctx.db.insert("seedProvenance", {
      seedId, projectId, generationId, sourceId, sourceContentHash: "h",
      startOffset: 0, endOffset: 1, exactExcerpt: "c",
    });
    await ctx.db.insert("seedSelections", {
      projectId, generationId, seedId, roleId: "company_context", selected: true,
      editedBullets: ["A writer-edited seed."], editedBy: userId, editedAt: now + 9,
      selectedAt: now, version: 1,
    });
    const summaryVersionId = await ctx.db.insert("summaryVersions", {
      projectId, generationId, version: 1, originGenerationId: generationId,
      briefVersionId: briefId, settingsHash: "settings-hash", skippedRoleIds: [],
      readiness: true, signedOffBy: userId, signedOffAt: now + 10,
    });
    await ctx.db.insert("summaryItems", {
      projectId, generationId, summaryVersionId, roleId: "company_context",
      kind: "standard", order: 1, seedId, bullets: ["A writer-edited seed."],
      support: "writer_asserted", tags: ["technical"], uncertaintySeedId: seedId,
      experimentSeedIds: [seedId],
    });
    await ctx.db.insert("seedDecisionEvents", {
      projectId, generationId, kind: "approve", roleId: "company_context", at: now + 11,
      actorUserId: userId, batchId, attemptId: `seed-attempt-${projectId}`,
      feedbackRequestId, seedId, contextRevision: "context-r1",
      selectionRevision: "selection-r1",
      contributionHashes: [{ roleId: "company_context", contributionHash: "contribution-hash" }],
      outcome: "approved", staleEpisodeId, editRatio: 0.25, confirmed: true,
      snapshot: { items: [{ seedId, wordingHash: "wording-hash", selectionVersion: 1 }] },
    });
    await ctx.db.insert("settingsDocumentAnalyses", { projectId, contentHash: "h", classifierVersion: "1", addressedCategories: [], analyzedAt: now });
    // Detach rows.
    byRef["aiUsage.projectId"] = await ctx.db.insert("aiUsage", { projectId, callSite: "chat", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0, createdAt: now });
    byRef["brainFeedbackQueue.projectId"] = await ctx.db.insert("brainFeedbackQueue", { fromUserId: "u", projectId, body: "b", status: "pending", createdAt: now });
    // A fully populated port record: the document link and stamp die with the project, the actor stays.
    byRef["ingestionItems.portedProjectId"] = await ctx.db.insert("ingestionItems", {
      driveItemId: `d-${projectId}`, path: "/p", name: "n", docKind: "pd", size: 1, lastModifiedAt: now, contentHash: "h",
      status: "approved", pairGroupKey: "g", updatedAt: now,
      portedProjectId: projectId, portedDocumentId: documentId, portedAt: now, portedBy: "porter",
    });
    byRef["projects.sourceProjectId"] = await ctx.db.insert("projects", {
      title: "Review of doomed", clientName: "Erasure Co", status: "draft", createdAt: now, updatedAt: now,
      createdBy: userId, shareToken: `review-${projectId}`, mode: "review", sourceProjectId: projectId,
    });
    // Keep rows.
    byRef["writerReviews.projectId"] = await ctx.db.insert("writerReviews", { projectId, reportId, userId, score: 80, createdAt: now, updatedAt: now });
    byRef["comparisons.projectId"] = await ctx.db.insert("comparisons", {
      projectId, reportId, revisionNumber: 0, contentHash: "h", banhallModel: "m", baselineProduct: "p", baselineModel: "b",
      modelCaveat: "c", judgeUserId: userId, preference: "banhall", deviationsBanhall: 0, deviationsBaseline: 0, countingMethod: "m",
      correctionsBanhall: 0, correctionsBaseline: 0, usedInDevelopment: false, recordedAt: now,
      banhallDraftText: "a", baselineDraftText: "b", draftTextMatches: true,
    });
    byRef["reviewDecisions.projectId"] = await ctx.db.insert("reviewDecisions", {
      projectId, reportId, reviewerId: userId, revisionNumber: 0, contentHash: "h", decision: "approve", toStage: "edits", createdAt: now,
    });
    byRef["qaItemFeedback.projectId"] = await ctx.db.insert("qaItemFeedback", {
      targetKey: "k", projectId, itemKey: "i", itemKind: "issue", section: "242", itemText: "t", userId: "u", createdAt: now, updatedAt: now,
    });
    byRef["reportEditDistance.projectId"] = await ctx.db.insert("reportEditDistance", { reportId, projectId, revisionNumber: 0, ped: 0, computedAt: now, trigger: "milestone" });
    byRef["brainSources.sourceProjectId"] = await ctx.db.insert("brainSources", {
      kind: "pd_pair", status: "approved", title: "t", industry: "software", writerTier: 1, docType: "pd", content: "c",
      ragKey: `rag-${projectId}`, sourceHash: `sh-${projectId}`, sourceProjectId: projectId, createdBy: "u", createdAt: now,
    });
    return {
      storageId, transcriptBlobId, generationId, generationJobId, candidateRunId, candidateJobId, sectionRunId, reportId, documentId, agentThreadId, byRef,
    };
  });
}

/** Rows in `entry.table` still referencing `projectId`, through the registry's own index. */
async function rowsReferencing(s: Setup, entry: ProjectScopedTable, projectId: Id<"projects">) {
  return await s.t.run(async (ctx) => {
    const db = ctx.db as unknown as Db;
    return await db
      .query(entry.table)
      .withIndex(entry.index!, (q) => q.eq(entry.field, projectId))
      .collect();
  });
}

async function rowById(s: Setup, id: string): Promise<Record<string, unknown> | null> {
  return await s.t.run(async (ctx) => {
    const db = ctx.db as unknown as Db;
    return (await db.get(id as DbId)) as Record<string, unknown> | null;
  });
}

async function scheduledJobState(s: Setup, jobId: Id<"_scheduled_functions">) {
  return await s.t.run(async (ctx) => (await ctx.db.system.get(jobId))?.state.kind);
}

async function pendingJobs(s: Setup) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.state.kind === "pending")
  );
}

async function drain(s: Setup) {
  await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

const blobStored = (s: Setup, storageId: Id<"_storage">) =>
  s.t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null);

const indexedEntries = registry.filter((e) => e.disposition !== "keep");
const keepEntries = registry.filter((e) => e.disposition === "keep");
const detachEntries = registry.filter((e) => e.disposition === "detach");
const deleteEntries = registry.filter((e) => e.disposition === "delete");
const entryIndexOf = (table: string) => PROJECT_SCOPED_TABLES.findIndex((e) => e.table === table);

describe("deleteProject erasure", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("purges delete rows and blobs, clears detach fields, keeps keep rows, deletes the project last", async () => {
    const s = await setup();
    const seeded = await seedProjectRows(s, s.projectId);
    const retained = await seedProjectRows(s, s.retainedProjectId);
    // The fixture reaches EVERY registry entry: a row referencing the project
    // exists through each delete/detach index, and each keep row by id.
    for (const entry of indexedEntries) {
      expect((await rowsReferencing(s, entry, s.projectId)).length, `${refKey(entry)} not seeded`).toBeGreaterThan(0);
    }
    for (const entry of [...keepEntries, ...detachEntries]) {
      expect(seeded.byRef[refKey(entry)], `${refKey(entry)} row id not recorded`).toBeDefined();
    }

    await s.admin.mutation(api.projects.deleteProject, { projectId: s.projectId });

    // Barrier set, bucket decremented once, live work terminalized — all in
    // the authorized transaction, before any purge page runs.
    const afterEntry = await s.t.run(async (ctx) => ({
      project: await ctx.db.get(s.projectId),
      company: await ctx.db.query("dashboardCompanies").withIndex("by_companyKey", (q) => q.eq("companyKey", "erasure co")).unique(),
      generation: await ctx.db.get(seeded.generationId),
      candidateRun: await ctx.db.get(seeded.candidateRunId),
      sectionRun: await ctx.db.get(seeded.sectionRunId),
    }));
    expect(afterEntry.project?.deletionStartedAt).toBeTypeOf("number");
    expect(afterEntry.project?.dashboardCompanyCounted).toBe(false);
    expect(afterEntry.company?.projectCount).toBe(1);
    expect(afterEntry.company?.stageCounts).toEqual({ intake: 1 });
    expect(afterEntry.generation?.status).toBe("failed");
    expect(afterEntry.generation?.postQaStatus).toBe("failed");
    expect(afterEntry.candidateRun?.status).toBe("failed");
    expect(afterEntry.sectionRun?.status).toBe("failed");
    expect(await scheduledJobState(s, seeded.generationJobId)).toBe("canceled");
    expect(await scheduledJobState(s, seeded.candidateJobId)).toBe("canceled");

    // A second delete while the purge is pending decrements nothing again.
    await s.creator.mutation(api.projects.deleteProject, { projectId: s.projectId });
    const companyAgain = await s.t.run((ctx) =>
      ctx.db.query("dashboardCompanies").withIndex("by_companyKey", (q) => q.eq("companyKey", "erasure co")).unique()
    );
    expect(companyAgain?.projectCount).toBe(1);
    expect(companyAgain?.stageCounts).toEqual({ intake: 1 });

    await drain(s);

    // Delete: nothing references the project any more, children included.
    for (const entry of deleteEntries) {
      expect(await rowsReferencing(s, entry, s.projectId), `${entry.table} rows survived`).toEqual([]);
    }
    const children = await s.t.run(async (ctx) => ({
      qaFindings: await ctx.db.query("qaFindings")
        .withIndex("by_reportId_and_revisionNumber_and_contentHash_and_findingKey", (q) => q.eq("reportId", seeded.reportId)).collect(),
      artifacts: await ctx.db.query("generationArtifacts")
        .withIndex("by_generationId_and_kind", (q) => q.eq("generationId", seeded.generationId)).collect(),
      turns: await ctx.db.query("chatTurns")
        .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", seeded.agentThreadId)).collect(),
    }));
    expect(children.qaFindings).toEqual([]);
    expect(children.artifacts).toEqual([]);
    expect(children.turns).toEqual([]);
    expect(await blobStored(s, seeded.storageId)).toBe(false);
    expect(await blobStored(s, seeded.transcriptBlobId)).toBe(false);
    expect(await blobStored(s, retained.transcriptBlobId)).toBe(true);
    // Detach: every row survives with the reference (and its siblings) cleared.
    for (const entry of detachEntries) {
      expect(await rowsReferencing(s, entry, s.projectId), `${refKey(entry)} still referenced`).toEqual([]);
      const row = await rowById(s, seeded.byRef[refKey(entry)]);
      expect(row, `${refKey(entry)} row was deleted`).not.toBeNull();
      expect(row![entry.field], `${refKey(entry)} not cleared`).toBeUndefined();
      for (const sibling of entry.clearWith ?? []) {
        expect(row![sibling], `${entry.table}.${sibling} not cleared`).toBeUndefined();
      }
    }
    const port = await rowById(s, seeded.byRef["ingestionItems.portedProjectId"]);
    expect(port).toMatchObject({ portedBy: "porter", status: "approved" });
    expect(port!.portedDocumentId).toBeUndefined();
    expect(port!.portedAt).toBeUndefined();
    // Keep: every row still points at the deleted project.
    for (const entry of keepEntries) {
      const row = await rowById(s, seeded.byRef[refKey(entry)]);
      expect(row, `${refKey(entry)} row was deleted`).not.toBeNull();
      expect(row![entry.field], `${refKey(entry)} was cleared`).toBe(s.projectId);
    }
    // The project row is gone; the neighbour project and its rows are untouched.
    const after = await s.t.run(async (ctx) => ({
      project: await ctx.db.get(s.projectId),
      retainedProject: await ctx.db.get(s.retainedProjectId),
      retainedGeneration: await ctx.db.get(retained.generationId),
    }));
    expect(after.project).toBeNull();
    expect(after.retainedProject).not.toBeNull();
    expect(after.retainedGeneration?.status).toBe("awaiting_input");
    expect(await blobStored(s, retained.storageId)).toBe(true);
    for (const entry of indexedEntries) {
      expect((await rowsReferencing(s, entry, s.retainedProjectId)).length, `${refKey(entry)} of the retained project`).toBeGreaterThan(0);
    }
    for (const entry of keepEntries) {
      expect((await rowById(s, retained.byRef[refKey(entry)]))?.[entry.field]).toBe(s.retainedProjectId);
    }
    expect(await pendingJobs(s)).toEqual([]);
  });

  it("keeps a blob another project's document still references", async () => {
    const s = await setup();
    const shared = await s.t.run((ctx) => ctx.storage.store(new Blob(["shared bytes"])));
    const seeded = await seedProjectRows(s, s.projectId, { storageId: shared });
    await s.t.run((ctx) => ctx.db.insert("projectDocuments", {
      projectId: s.retainedProjectId, fileName: "same.txt", fileType: "txt", content: "same", storageId: shared,
      source: "upload", uploadedBy: "u", createdAt: 1,
    }));
    await s.admin.mutation(api.projects.deleteProject, { projectId: s.projectId });
    await drain(s);
    expect(await s.t.run((ctx) => ctx.db.get(seeded.documentId))).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.get(s.projectId))).toBeNull();
    expect(await blobStored(s, shared)).toBe(true);
  });

  it("refuses while open work exists, before any write", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.insert("workItems", {
      projectId: s.projectId, kind: "internal_review", assigneeId: s.creatorId, assignerId: s.creatorId, instructions: "x",
      blocking: false, status: "open", version: 0, createRequestId: "r", createRequestFingerprint: "f", createdAt: 1, updatedAt: 1,
    }));
    await expect(s.admin.mutation(api.projects.deleteProject, { projectId: s.projectId })).rejects.toThrow(/INVALID_STATE|open work/i);
    const after = await s.t.run(async (ctx) => ({
      project: await ctx.db.get(s.projectId),
      company: await ctx.db.query("dashboardCompanies").withIndex("by_companyKey", (q) => q.eq("companyKey", "erasure co")).unique(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(after.project?.deletionStartedAt).toBeUndefined();
    expect(after.company?.projectCount).toBe(2);
    expect(after.jobs).toEqual([]);
  });

  it("refuses a non-creator consultant and writes nothing", async () => {
    const s = await setup();
    const seeded = await seedProjectRows(s, s.projectId);
    await expect(s.other.mutation(api.projects.deleteProject, { projectId: s.projectId })).rejects.toThrow(/NOT_AUTHORIZED/);
    await drain(s);
    const after = await s.t.run(async (ctx) => ({
      project: await ctx.db.get(s.projectId),
      report: await ctx.db.get(seeded.reportId),
      generation: await ctx.db.get(seeded.generationId),
    }));
    expect(after.project?.deletionStartedAt).toBeUndefined();
    expect(after.report).not.toBeNull();
    expect(after.generation?.status).toBe("awaiting_input");
    expect(await blobStored(s, seeded.storageId)).toBe(true);
  });
});

async function seedTranscripts(s: Setup, projectId: Id<"projects">, count: number) {
  await s.t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("transcripts", { projectId, content: `t${i}`, createdAt: i });
    }
  });
}
const transcriptCount = (s: Setup, projectId: Id<"projects">) =>
  s.t.run(async (ctx) =>
    (await ctx.db.query("transcripts").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()).length
  );
const setBarrier = (s: Setup) => s.t.run((ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: 1 }));

describe("purgeProjectPage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const transcriptsEntry = entryIndexOf("transcripts");
  const agentThreadsEntry = entryIndexOf("agentChatThreads");



  it("reads one bounded page per transaction and the scheduled continuation alone finishes the table", async () => {
    const s = await setup();
    await seedTranscripts(s, s.projectId, PROJECT_PURGE_PAGE_SIZE + 50);
    await setBarrier(s);

    await s.t.mutation(internal.projects.purgeProjectPage, { projectId: s.projectId, ...purgePosition(transcriptsEntry, null) });
    expect(await transcriptCount(s, s.projectId)).toBe(50);
    const continuation = await pendingJobs(s);
    expect(continuation).toHaveLength(1);
    expect(continuation[0].args[0]).toMatchObject({ entryIndex: transcriptsEntry, table: "transcripts", field: "projectId" });
    expect((continuation[0].args[0] as { cursor: unknown }).cursor).toBeTypeOf("string");

    await drain(s);
    expect(await transcriptCount(s, s.projectId)).toBe(0);
    expect(await s.t.run((ctx) => ctx.db.get(s.projectId))).toBeNull();
  });

  it("tolerates the scheduler redelivering a page it already ran", async () => {
    const s = await setup();
    await seedTranscripts(s, s.projectId, PROJECT_PURGE_PAGE_SIZE + 50);
    await setBarrier(s);
    const page = { projectId: s.projectId, ...purgePosition(transcriptsEntry, null) };
    await s.t.mutation(internal.projects.purgeProjectPage, page);
    expect(await transcriptCount(s, s.projectId)).toBe(50);
    // Redelivered: nothing to re-delete from the first page; the rest follow.
    await s.t.mutation(internal.projects.purgeProjectPage, page);
    expect(await transcriptCount(s, s.projectId)).toBe(0);
    await drain(s);
    expect(await s.t.run((ctx) => ctx.db.get(s.projectId))).toBeNull();
  });

  it("keeps a parent whose inline children outnumber one batch until they are all gone", async () => {
    const s = await setup();
    const agentThreadId = "big-thread";
    const parentId = await s.t.run(async (ctx) => {
      const reportId = await ctx.db.insert("reports", { projectId: s.projectId, content: "r", version: 1, generatedAt: 1, updatedAt: 1 });
      const id = await ctx.db.insert("agentChatThreads", { projectId: s.projectId, reportId, agentThreadId, title: "t", createdAt: 1 });
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("chatTurns", { agentThreadId, promptMessageId: `p${i}`, order: i, status: "completed", stepCount: 1 });
      }
      return id;
    });
    await setBarrier(s);
    const turnCount = () => s.t.run(async (ctx) =>
      (await ctx.db.query("chatTurns").withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", agentThreadId)).collect()).length
    );

    await s.t.mutation(internal.projects.purgeProjectPage, { projectId: s.projectId, ...purgePosition(agentThreadsEntry, null) });
    expect(await turnCount()).toBe(1);
    expect(await s.t.run((ctx) => ctx.db.get(parentId))).not.toBeNull();
    const retry = await pendingJobs(s);
    expect(retry).toHaveLength(1);
    expect(retry[0].args[0]).toMatchObject({ entryIndex: agentThreadsEntry, table: "agentChatThreads", cursor: null });

    await drain(s);
    expect(await turnCount()).toBe(0);
    expect(await s.t.run((ctx) => ctx.db.get(parentId))).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.get(s.projectId))).toBeNull();
  });

  it("restarts safely when a continuation names an entry the registry no longer has at that index", async () => {
    const s = await setup();
    await seedTranscripts(s, s.projectId, 3);
    await setBarrier(s);
    // A legacy or moved continuation restarts the complete walk without reusing its cursor.
    await s.t.mutation(internal.projects.purgeProjectPage, {
      projectId: s.projectId, entryIndex: transcriptsEntry + 1, table: "transcripts", field: "projectId", cursor: null,
    });
    expect(await transcriptCount(s, s.projectId)).toBe(3);
    // Vanished entry: the walk restarts from the first entry and still completes.
    await s.t.mutation(internal.projects.purgeProjectPage, {
      projectId: s.projectId, entryIndex: 0, table: "noSuchTable", field: "projectId", cursor: null,
    });
    await drain(s);
    expect(await s.t.run((ctx) => ctx.db.get(s.projectId))).toBeNull();
  });

  it("refuses to purge a project that never entered deletion", async () => {
    const s = await setup();
    await seedTranscripts(s, s.projectId, 3);
    await s.t.mutation(internal.projects.purgeProjectPage, { projectId: s.projectId, ...purgePosition(transcriptsEntry, null) });
    await s.t.mutation(internal.projects.purgeProjectPage, { projectId: s.projectId, ...purgePosition(PROJECT_SCOPED_TABLES.length, null) });
    await drain(s);
    expect(await transcriptCount(s, s.projectId)).toBe(3);
    expect(await s.t.run((ctx) => ctx.db.get(s.projectId))).not.toBeNull();
  });
});

describe("deletion barrier", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("late candidate and section claims return without writing", async () => {
    const s = await setup();
    const seeded = await seedProjectRows(s, s.projectId);
    // A generation still running when the barrier lands (claims race the
    // terminalization only if scheduled before it; the barrier alone must hold).
    await s.t.run(async (ctx) => {
      await ctx.db.patch(seeded.generationId, { status: "running" });
      await ctx.db.patch(s.projectId, { deletionStartedAt: 1 });
    });
    expect(await s.t.mutation(internal.generations.claimCandidateRun, { candidateRunId: seeded.candidateRunId })).toBeNull();
    expect(await s.t.mutation(internal.generations.claimSectionRun, { generationId: seeded.generationId, section: "s242" })).toBeNull();
    const runs = await s.t.run(async (ctx) => ({
      candidate: await ctx.db.get(seeded.candidateRunId),
      section: await ctx.db.get(seeded.sectionRunId),
    }));
    expect(runs.candidate?.status).toBe("queued");
    expect(runs.candidate?.startedAt).toBeUndefined();
    expect(runs.section?.status).toBe("queued");
  });

  it("the post-QA entry returns before any provider call once the project is deleting", async () => {
    const s = await setup();
    const seeded = await seedProjectRows(s, s.projectId);
    await s.t.run((ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: 1 }));
    const attempt = await s.t.query(internal.generations.getPostQaAttempt, { generationId: seeded.generationId });
    expect(attempt).toMatchObject({ projectDeleting: true });
    await s.t.action(internal.ai.postQa.runReportQa, { generationId: seeded.generationId, attemptStartedAt: 1000 });
    const after = await s.t.run(async (ctx) => ({
      generation: await ctx.db.get(seeded.generationId),
      usage: await ctx.db.query("aiUsage").withIndex("by_projectId", (q) => q.eq("projectId", s.projectId)).collect(),
    }));
    expect(after.generation?.postQaStatus).toBe("running"); // untouched: no write
    expect(after.usage).toHaveLength(1); // only the seeded row
  });

  it("a post-QA save that started before the deletion persists nothing", async () => {
    const s = await setup();
    const seeded = await seedProjectRows(s, s.projectId);
    const findings = () => s.t.run((ctx) => ctx.db.query("qaFindings")
      .withIndex("by_reportId_and_revisionNumber_and_contentHash_and_findingKey", (q) => q.eq("reportId", seeded.reportId)).collect());
    // The action read its attempt while the project was still live...
    const attempt = await s.t.query(internal.generations.getPostQaAttempt, { generationId: seeded.generationId });
    expect(attempt).toMatchObject({ startedAt: 1000, projectDeleting: false });
    // ...then the deletion started while the provider call was in flight.
    await s.t.run((ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: 1 }));
    const before = await s.t.run((ctx) => ctx.db.get(seeded.generationId));
    await s.t.mutation(internal.generations.saveReportQa, {
      generationId: seeded.generationId,
      attemptStartedAt: attempt!.startedAt,
      qa: JSON.stringify({ score: 50, issues: [] }),
      qaScore: 50,
    });
    const after = await s.t.run((ctx) => ctx.db.get(seeded.generationId));
    expect(after).toEqual(before);
    expect(await findings()).toHaveLength(3); // the seeded rows only
    // The failed path writes nothing either.
    await s.t.mutation(internal.generations.saveReportQa, {
      generationId: seeded.generationId, attemptStartedAt: attempt!.startedAt, failed: true,
    });
    expect(await s.t.run((ctx) => ctx.db.get(seeded.generationId))).toEqual(before);
  });

  it("claims proceed normally on a project that is not deleting", async () => {
    const s = await setup();
    const seeded = await seedProjectRows(s, s.projectId);
    const claimed = await s.t.mutation(internal.generations.claimCandidateRun, { candidateRunId: seeded.candidateRunId });
    expect(claimed).toMatchObject({ generationId: seeded.generationId, projectId: s.projectId });
  });
});


describe("erasure deployment and late-writer regressions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refuses an upload after the document purge page without recreating a row", async () => {
    const s = await setup();
    const storageId = await s.t.run(ctx => ctx.storage.store(new Blob(["late upload"])));
    await setBarrier(s);
    await s.t.mutation(internal.projects.purgeProjectPage, {
      projectId: s.projectId, ...purgePosition(entryIndexOf("projectDocuments"), null),
    });
    await expect(s.creator.mutation(api.documents.uploadDocument, {
      projectId: s.projectId, fileName: "late.txt", fileType: "txt", content: "late", storageId,
    })).rejects.toThrow("Project is being deleted");
    expect(await s.t.run(ctx => ctx.db.query("projectDocuments").collect())).toHaveLength(0);
    await drain(s);
    expect(await s.t.run(ctx => ctx.db.get(s.projectId))).toBeNull();
  });

  it.each([false, true])("does not recreate generation artifacts after erasure (parent removed: %s)", async (removeParent) => {
    const s = await setup();
    const generationId = await s.t.run(ctx => ctx.db.insert("generations", {
      projectId: s.projectId, status: "running", startedAt: 1, agentOutputs: "{}",
    }));
    await setBarrier(s);
    if (removeParent) await s.t.run(async ctx => {
      await ctx.db.delete(generationId);
      await ctx.db.delete(s.projectId);
    });
    await s.t.mutation(internal.generations.saveIterativeArtifacts, {
      generationId, analysis: "late analysis", brainBlocks: "{}",
    });
    expect(await s.t.run(ctx => ctx.db.query("generationArtifacts").collect())).toHaveLength(0);
  });

  it("does not recount a deleting project during dashboard rebuild", async () => {
    const s = await setup();
    await s.admin.mutation(api.projects.deleteProject, { projectId: s.projectId });
    // Model the rebuild's reset pass, then run its project page in the purge window.
    await s.t.run(async ctx => {
      for (const company of await ctx.db.query("dashboardCompanies").collect()) {
        await ctx.db.delete(company._id);
      }
    });
    await s.t.mutation(internal.dashboardBackfill.processBatch, {
      cursor: null, dryRun: false, scanned: 0, patched: 0,
    });
    expect((await s.t.run(ctx => ctx.db.get(s.projectId)))?.dashboardCompanyCounted).toBe(false);
    await drain(s);
    const companies = await s.t.run(ctx => ctx.db.query("dashboardCompanies").collect());
    expect(companies.reduce((sum, company) => sum + company.projectCount, 0)).toBe(1);
  });

  it("restarts before an unchanged later entry when the registry version differs", async () => {
    const s = await setup();
    await seedTranscripts(s, s.projectId, 1);
    await setBarrier(s);
    await s.t.mutation(internal.projects.purgeProjectPage, {
      projectId: s.projectId, ...purgePosition(entryIndexOf("reports"), null),
      registryVersion: "registry-before-a-table-was-added",
    });
    expect(await s.t.run(ctx => ctx.db.get(s.projectId))).not.toBeNull();
    await drain(s);
    expect(await transcriptCount(s, s.projectId)).toBe(0);
    expect(await s.t.run(ctx => ctx.db.get(s.projectId))).toBeNull();
  });

  it.each(["legacy", "changed"])("restarts a %s finalization continuation before deleting the project", async (kind) => {
    const s = await setup();
    await seedTranscripts(s, s.projectId, 1);
    await setBarrier(s);
    const position = purgePosition(PROJECT_SCOPED_TABLES.length, null);
    await s.t.mutation(internal.projects.purgeProjectPage, {
      projectId: s.projectId, ...position,
      ...(kind === "changed" ? { registryVersion: "previous-registry" } : { registryVersion: undefined }),
    });
    expect(await s.t.run(ctx => ctx.db.get(s.projectId))).not.toBeNull();
    await drain(s);
    expect(await transcriptCount(s, s.projectId)).toBe(0);
    expect(await s.t.run(ctx => ctx.db.get(s.projectId))).toBeNull();
  });
});

// ─── Transaction limits (2026-09-25 review round 2) ─────────────────────────
// Generation rows are light since phase 4, and their artifacts carry the
// heavy bytes; older rows backfilled by generations:backfillGenerationOutputs
// carry their outputs twice (row field kept, artifact copy added). These
// fixtures run the purge with Convex's transaction limits enforced, so a page
// that reads (including the second read of every delete) or writes past a
// limit throws instead of passing.

describe("purgeProjectPage under enforced transaction limits", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const generationsEntry = entryIndexOf("generations");

  async function limitedProject() {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const projectId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "limits-creator", role: "writer" });
      return await ctx.db.insert("projects", {
        title: "Heavy",
        clientName: "Heavy Co",
        status: "draft",
        createdBy: userId,
        shareToken: "limits-heavy",
        createdAt: 1,
        updatedAt: 1,
        deletionStartedAt: 1,
      });
    });
    return { t, projectId };
  }
  type Limited = Awaited<ReturnType<typeof limitedProject>>;

  /** One generation per transaction, so seeding stays under the write limit. */
  async function seedGenerations(
    f: Limited,
    count: number,
    shape: { rowOutputs?: number; artifacts: Array<["agent_outputs" | "analysis" | "brain_blocks" | "brain_retrieval_brief", number]> }
  ) {
    for (let i = 0; i < count; i++) {
      await f.t.run(async (ctx) => {
        const generationId = await ctx.db.insert("generations", {
          projectId: f.projectId,
          status: "completed",
          startedAt: i,
          ...(shape.rowOutputs !== undefined
            ? { agentOutputs: `${i}:${"o".repeat(shape.rowOutputs)}`, outputsInArtifactsAt: 2 }
            : { outputsInArtifactsAt: 1 }),
        });
        for (const [kind, size] of shape.artifacts) {
          await ctx.db.insert("generationArtifacts", { generationId, kind, content: `${i}:${"c".repeat(size)}` });
        }
      });
    }
  }

  /** Row counts, read in small pages: the limits apply to test reads too. */
  async function countRows(f: Limited, table: "generations" | "generationArtifacts") {
    let total = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: { page: unknown[]; isDone: boolean; continueCursor: string } = await f.t.run((ctx) =>
        ctx.db.query(table).paginate({ cursor, numItems: 4, maximumBytesRead: 8 * (1 << 20) })
      );
      total += page.page.length;
      if (page.isDone) return total;
      cursor = page.continueCursor;
    }
  }
  const counts = async (f: Limited) => ({
    generations: await countRows(f, "generations"),
    artifacts: await countRows(f, "generationArtifacts"),
  });

  /** Run the generations entry page by page. Every page must stay under the
   * limits (an overrun throws here) and remove at least one row. */
  async function purgeGenerations(f: Limited) {
    let position: ReturnType<typeof purgePosition> = purgePosition(generationsEntry, null);
    const pages: Array<{ generations: number; artifacts: number }> = [];
    let before = await counts(f);
    while (position.table === "generations") {
      await f.t.mutation(internal.projects.purgeProjectPage, { projectId: f.projectId, ...position });
      const after = await counts(f);
      expect(after.generations + after.artifacts).toBeLessThan(before.generations + before.artifacts);
      pages.push(after);
      before = after;
      const jobs = await f.t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.state.kind === "pending")
      );
      expect(jobs).toHaveLength(1);
      await f.t.run((ctx) => ctx.scheduler.cancel(jobs[0]._id));
      position = jobs[0].args[0] as ReturnType<typeof purgePosition>;
      expect(pages.length).toBeLessThan(200);
    }
    return { pages, next: position };
  }

  async function expectFullyPurged(f: Limited, next: ReturnType<typeof purgePosition>) {
    expect(await counts(f)).toEqual({ generations: 0, artifacts: 0 });
    await f.t.mutation(internal.projects.purgeProjectPage, { projectId: f.projectId, ...next });
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toBeNull();
  }

  it("backfilled older generations (outputs on the row and in an artifact copy) purge without overrunning", async () => {
    const f = await limitedProject();
    await seedGenerations(f, 40, {
      rowOutputs: 200_000,
      artifacts: [["agent_outputs", 200_000], ["analysis", 35_000], ["brain_blocks", 30_000]],
    });
    const { pages, next } = await purgeGenerations(f);
    expect(pages.length).toBeGreaterThan(1);
    await expectFullyPurged(f, next);
  });

  it("older generations with near-maximum rows and children purge without overrunning", async () => {
    const f = await limitedProject();
    await seedGenerations(f, 12, {
      rowOutputs: 1_000_000,
      artifacts: [["agent_outputs", 1_000_000], ["analysis", 1_000_000]],
    });
    const { pages, next } = await purgeGenerations(f);
    expect(pages.length).toBeGreaterThan(1);
    await expectFullyPurged(f, next);
  });

  it("one generation whose artifacts exceed a page keeps its parent until page two", async () => {
    const f = await limitedProject();
    await seedGenerations(f, 1, { artifacts: Array.from({ length: 8 }, () => ["agent_outputs", 1_000_000] as ["agent_outputs", number]) });
    const { pages, next } = await purgeGenerations(f);
    // Page one deleted some children and kept the parent with the rest.
    expect(pages[0].generations).toBe(1);
    expect(pages[0].artifacts).toBeGreaterThan(0);
    expect(pages[0].artifacts).toBeLessThan(8);
    expect(pages).toHaveLength(2);
    await expectFullyPurged(f, next);
  });

  it("the pre-phase-4 shape (100 older generations with row outputs) purges without overrunning", async () => {
    const f = await limitedProject();
    await seedGenerations(f, 100, {
      rowOutputs: 60_000,
      artifacts: [["analysis", 35_000], ["brain_blocks", 30_000]],
    });
    const { next } = await purgeGenerations(f);
    await expectFullyPurged(f, next);
  });

  it("light new generations with heavy artifacts purge without overrunning", async () => {
    const f = await limitedProject();
    await seedGenerations(f, 30, { artifacts: [["agent_outputs", 600_000], ["brain_retrieval_brief", 300_000]] });
    const { pages, next } = await purgeGenerations(f);
    expect(pages.length).toBeGreaterThan(1);
    await expectFullyPurged(f, next);
  });
});
