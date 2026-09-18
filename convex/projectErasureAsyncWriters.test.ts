/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { WorkflowId } from "@convex-dev/workflow";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(deletion: "barrier" | "gone") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: `async-writer-${deletion}`,
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Async writer fence",
      clientName: "Fence Co",
      status: "draft",
      createdBy: userId,
      shareToken: `async-writer-${deletion}`,
      createdAt: 1,
      updatedAt: 1,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [] }),
      version: 1,
      generatedAt: 1,
      updatedAt: 1,
    });
    const agentThreadId = `thread-${deletion}`;
    await ctx.db.insert("agentChatThreads", {
      projectId,
      reportId,
      agentThreadId,
      title: "Late turn",
      createdAt: 1,
    });
    const turnId = await ctx.db.insert("chatTurns", {
      userId,
      agentThreadId,
      promptMessageId: "prompt-1",
      order: 1,
      status: "queued",
      stepCount: 0,
    });
    const sessionId = await ctx.db.insert("researchSessions", {
      projectId,
      reportId,
      requestedBy: userId,
      selectedText: "Selected",
      selectionFrom: 0,
      selectionTo: 8,
      surroundingContext: "Context",
      instruction: "Find evidence",
      externalBrief: "Brief",
      reportRevisionNumber: 0,
      status: "queued",
      createdAt: 1,
      updatedAt: 1,
    });
    const researcherRunId = await ctx.db.insert("researchRuns", {
      sessionId,
      projectId,
      provider: "gpt",
      model: "test",
      status: "running",
      startedAt: 1,
    });
    const reviewerRunId = await ctx.db.insert("researchRuns", {
      sessionId,
      projectId,
      provider: "reviewer",
      model: "test",
      status: "running",
      startedAt: 1,
    });
    const uploadId = await ctx.db.insert("financialUploads", {
      projectId,
      fileName: "timesheet.csv",
      fileType: "timesheet",
      content: "hours",
      createdAt: 1,
      processingStatus: "queued",
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview text",
      createdAt: 1,
    });
    const digestId = await ctx.db.insert("transcriptDigests", {
      transcriptId,
      projectId,
      sourceContentHash: "frozen-hash",
      condenseVersion: "fixture",
      content: "Digest text",
      structured: "{}",
      model: "test",
      promptVersion: "test",
      charCount: 11,
      originalLength: 14,
      createdAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "running",
      startedAt: 1,
    });
    await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      transcriptId,
      label: "Interview transcript",
      content: "Interview text",
      contentHash: "source-hash",
      truncated: false,
      originalLength: 14,
      capturedAt: 1,
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "review.md",
      fileType: "md",
      content: "Review source",
      source: "review_pd",
      uploadedBy: userId,
      createdAt: 1,
    });
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId,
      documentId,
      sourceFileName: "review.md",
      status: "running",
      createdBy: userId,
      createdAt: 1,
    });
    if (deletion === "barrier") {
      await ctx.db.patch(projectId, { deletionStartedAt: 2 });
    } else {
      await ctx.db.delete(projectId);
    }
    return {
      userId,
      projectId,
      reportId,
      agentThreadId,
      turnId,
      sessionId,
      researcherRunId,
      reviewerRunId,
      uploadId,
      transcriptId,
      digestId,
      generationId,
      reviewId,
    };
  });
  return { t, ...ids };
}

async function exerciseLateWriters(deletion: "barrier" | "gone") {
  const f = await setup(deletion);

  expect(
    await f.t.mutation(internal.research.markResearchStarted, {
      sessionId: f.sessionId,
    })
  ).toBe(false);
  expect(
    await f.t.mutation(internal.research.markResearchReviewing, {
      sessionId: f.sessionId,
    })
  ).toBe(false);
  await f.t.mutation(internal.research.collectProjectEvidence, {
    sessionId: f.sessionId,
  });
  await expect(
    f.t.mutation(internal.research.reserveRun, {
      sessionId: f.sessionId,
      provider: "perplexity",
      model: "test",
    })
  ).rejects.toThrow("Research project is being deleted");
  await f.t.mutation(internal.research.completeResearcherRun, {
    runId: f.researcherRunId,
    provider: "gpt",
    responseText: "late response",
    citations: [{ url: "https://example.com", title: "Example" }],
    inputTokens: 10,
    outputTokens: 5,
    webSearchRequests: 1,
  });
  await f.t.mutation(internal.research.failRun, {
    runId: f.researcherRunId,
    errorMessage: "late failure",
  });
  await f.t.mutation(internal.research.saveBrainEvidence, {
    sessionId: f.sessionId,
    degraded: false,
    sources: [{ title: "Pattern", excerpt: "Late evidence" }],
  });
  await f.t.mutation(internal.research.completeReviewerRun, {
    runId: f.reviewerRunId,
    responseText: "late review",
    inputTokens: 10,
    outputTokens: 5,
  });
  await f.t.mutation(internal.research.saveReviewResult, {
    sessionId: f.sessionId,
    answer: "late answer",
    evidenceBoundary: "late boundary",
    confidence: "high",
    warnings: [],
    claims: [],
    proposedText: "late proposal",
  });
  await f.t.mutation(internal.research.failSession, {
    sessionId: f.sessionId,
    errorMessage: "late failure",
  });
  await f.t.mutation(internal.research.completeResearchWorkflow, {
    workflowId: "late-workflow" as WorkflowId,
    result: { kind: "failed", error: "late workflow failure" },
    context: { sessionId: f.sessionId },
  });

  expect(
    await f.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: f.agentThreadId,
      promptMessageId: "prompt-1",
      startedAt: 2,
    })
  ).toEqual({ shouldRun: false, status: "failed" });
  await f.t.mutation(internal.chatV2.finishTurn, {
    agentThreadId: f.agentThreadId,
    promptMessageId: "prompt-1",
    requestedStatus: "completed",
    endedAt: 2,
    stepCount: 2,
  });
  await f.t.mutation(internal.chatV2.failStaleChatTurns, {
    olderThanMinutes: 0,
  });
  expect(
    await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: f.agentThreadId,
      promptMessageId: "prompt-1",
      kind: "edit",
      targetText: "old",
      newText: "new",
    })
  ).toMatchObject({ ok: false });

  expect(
    await f.t.mutation(internal.financial.markUploadRunning, {
      projectId: f.projectId,
      uploadId: f.uploadId,
    })
  ).toBe(false);
  await f.t.mutation(internal.financial.replaceTimesheetEntries, {
    projectId: f.projectId,
    uploadId: f.uploadId,
    entries: [
      {
        personName: "Late Writer",
        date: "2026-09-18",
        hours: 1,
        hoursBasis: "explicit",
        description: "Late work",
        sredEligible: true,
        confidence: "high",
        source: "fixture",
      },
    ],
  });
  await f.t.mutation(internal.financial.markUploadFailed, {
    projectId: f.projectId,
    uploadId: f.uploadId,
    error: "late failure",
  });

  await f.t.mutation(internal.pdReviews.completePdReview, {
    reviewId: f.reviewId,
    result: "late result",
    model: "test",
  });
  await f.t.mutation(internal.pdReviews.failPdReview, {
    reviewId: f.reviewId,
    error: "late failure",
  });
  expect(
    await f.t.mutation(internal.pdReviews.failStalePdReviews, {
      olderThanMinutes: 0,
    })
  ).toEqual({ failed: 0 });

  await expect(
    f.t.mutation(internal.transcriptDigests.recordDigest, {
      transcriptId: f.transcriptId,
      projectId: f.projectId,
      sourceContentHash: "late-hash",
      content: "Late digest",
      structured: "{}",
      model: "test",
      promptVersion: "test",
      originalLength: 14,
    })
  ).rejects.toThrow("Project is being deleted");
  await f.t.mutation(internal.transcriptDigests.freezeDigestSource, {
    generationId: f.generationId,
    transcriptId: f.transcriptId,
    digestId: f.digestId,
  });
  await f.t.mutation(internal.writerProfiles.recordSettingsAnalysis, {
    projectId: f.projectId,
    contentHash: "late-settings",
    classifierVersion: "test",
    addressedCategories: [],
  });
  await expect(
    f.t.mutation(internal.reports.createProvenance, {
      projectId: f.projectId,
      content: JSON.stringify({ type: "doc", content: [] }),
      claims: [],
    })
  ).rejects.toThrow("Project is being deleted");

  await f.t.mutation(internal.aiUsage.logUsage, {
    projectId: f.projectId,
    callSite: "late-writer-test",
    model: "test",
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 1.25,
  });
  await f.t.mutation(internal.aiUsage.logUsage, {
    agentThreadId: f.agentThreadId,
    callSite: "late-writer-inferred-test",
    model: "test",
    inputTokens: 3,
    outputTokens: 2,
    costUsd: 0.75,
  });

  const after = await f.t.run(async (ctx) => ({
    turn: await ctx.db.get(f.turnId),
    session: await ctx.db.get(f.sessionId),
    researcherRun: await ctx.db.get(f.researcherRunId),
    reviewerRun: await ctx.db.get(f.reviewerRunId),
    upload: await ctx.db.get(f.uploadId),
    generation: await ctx.db.get(f.generationId),
    review: await ctx.db.get(f.reviewId),
    researchSources: await ctx.db.query("researchSources").collect(),
    researchClaims: await ctx.db.query("researchClaims").collect(),
    proposals: await ctx.db.query("chatProposals").collect(),
    timesheets: await ctx.db.query("timesheetEntries").collect(),
    summaries: await ctx.db.query("financialSummaries").collect(),
    reviewEvents: await ctx.db.query("pdReviewEvents").collect(),
    digests: await ctx.db.query("transcriptDigests").collect(),
    generationSources: await ctx.db.query("generationSources").collect(),
    settings: await ctx.db.query("settingsDocumentAnalyses").collect(),
    provenance: await ctx.db.query("reportProvenance").collect(),
    usage: await ctx.db.query("aiUsage").collect(),
  }));

  expect(after.turn).toMatchObject({ status: "queued", stepCount: 0 });
  expect(after.session).toMatchObject({ status: "queued", updatedAt: 1 });
  expect(after.researcherRun).toMatchObject({ status: "running" });
  expect(after.reviewerRun).toMatchObject({ status: "running" });
  expect(after.upload).toMatchObject({ processingStatus: "queued" });
  expect(after.generation?.digestIds).toBeUndefined();
  expect(after.review).toMatchObject({ status: "running" });
  expect(after.researchSources).toEqual([]);
  expect(after.researchClaims).toEqual([]);
  expect(after.proposals).toEqual([]);
  expect(after.timesheets).toEqual([]);
  expect(after.summaries).toEqual([]);
  expect(after.reviewEvents).toEqual([]);
  expect(after.digests).toHaveLength(1);
  expect(after.generationSources).toHaveLength(1);
  expect(after.settings).toEqual([]);
  expect(after.provenance).toEqual([]);
  expect(after.usage).toHaveLength(2);
  expect(after.usage).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        callSite: "late-writer-test",
        costUsd: 1.25,
      }),
      expect.objectContaining({
        callSite: "late-writer-inferred-test",
        costUsd: 0.75,
      }),
    ])
  );
  expect(after.usage.every((usage) => usage.projectId === undefined)).toBe(true);
  const explicitUsage = after.usage.find(
    (usage) => usage.callSite === "late-writer-test"
  );
  expect(explicitUsage?.userId).toBe(
    deletion === "barrier" ? f.userId : undefined
  );
}

describe("project deletion fences asynchronous writers", () => {
  it("blocks late writes while the project barrier is present", async () => {
    await exerciseLateWriters("barrier");
  });

  it("blocks late writes after the project row is gone", async () => {
    await exerciseLateWriters("gone");
  });
});
