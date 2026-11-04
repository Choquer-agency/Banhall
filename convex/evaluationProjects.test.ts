/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EDIT_SIZE_BURST_MS } from "./lib/editDistance";
import { releaseEvalProjectTitle } from "../shared/releaseEval";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// E3 review: evaluation projects are made only on a local backend (or where
// allowed); these tests run as one.
beforeEach(() => vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210"));
afterEach(() => vi.unstubAllEnvs());

/**
 * 2026-10-27 (Phase E, E3): the release suite's evaluation projects never
 * feed learning, writer memory, edit size or Brain nomination. Every name
 * and passage here is fictional.
 */

const doc = (...paragraphs: string[]) =>
  JSON.stringify({ type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });
const DRAFT = doc("The team ran a controlled trial of the seal.", "Results were inconclusive at first.");
const LONG_FEEDBACK = "Lead every uncertainty with what was not known at the start, then the work done.";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "eval-writer", role: "writer", name: "Wren" });
    await ctx.db.insert("users", { authId: "eval-admin", role: "admin", name: "Ada" });
    const project = async (title: string, evaluation: boolean) => {
      const projectId = await ctx.db.insert("projects", {
        title,
        clientName: "Quillmere Analytics Ltd.",
        status: "review",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: `token-${title}`,
        createdAt: now,
        updatedAt: now,
        ...(evaluation ? { evaluation: { markedAt: now } } : {}),
      });
      const generationId = await ctx.db.insert("generations", {
        projectId,
        status: "completed",
        requestedBy: writerId,
        candidateMode: "single",
        startedAt: now,
      });
      const reportId = await ctx.db.insert("reports", {
        projectId,
        generationId,
        content: DRAFT,
        revisionNumber: 0,
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("reportSnapshots", {
        projectId,
        reportId,
        generationId,
        content: DRAFT,
        sourceRevisionNumber: 0,
        reason: "generated",
        label: "AI draft (single)",
        createdByRole: "system",
        createdAt: now,
      });
      return { projectId, generationId, reportId };
    };
    return {
      writerId,
      normal: await project("Burner model", false),
      evaluation: await project(releaseEvalProjectTitle("Burner model"), true),
    };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: "eval-writer" }), admin: t.withIdentity({ subject: "eval-admin" }) };
}
type Setup = Awaited<ReturnType<typeof setup>>;
type Ids = Setup["normal"];

describe("marking evaluation projects (Phase E, E3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("marks a release-eval project once, and refuses any other project", async () => {
    const s = await setup();
    const unmarked = await s.t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", {
        title: releaseEvalProjectTitle("Second"), clientName: "C", status: "draft", createdBy: s.writerId,
        shareToken: "second", createdAt: 1, updatedAt: 1,
      });
      return projectId;
    });
    await s.t.mutation(internal.seedPlanEval.markEvaluationProject, { projectId: unmarked });
    const first = (await s.t.run((ctx) => ctx.db.get(unmarked)))!.evaluation;
    expect(first?.markedAt).toBeTypeOf("number");
    await s.t.mutation(internal.seedPlanEval.markEvaluationProject, { projectId: unmarked });
    expect((await s.t.run((ctx) => ctx.db.get(unmarked)))!.evaluation).toEqual(first);

    await expect(s.t.mutation(internal.seedPlanEval.markEvaluationProject, { projectId: s.normal.projectId })).rejects.toThrow(
      /Not a release eval project/
    );
    expect((await s.t.run((ctx) => ctx.db.get(s.normal.projectId)))!.evaluation).toBeUndefined();
  });

  it("is refused on production", async () => {
    const s = await setup();
    const projectId = await s.t.run((ctx) =>
      ctx.db.insert("projects", {
        title: releaseEvalProjectTitle("Third"), clientName: "C", status: "draft", createdBy: s.writerId,
        shareToken: "third", createdAt: 1, updatedAt: 1,
      })
    );
    vi.stubEnv("CONVEX_CLOUD_URL", "https://energized-salamander-237.convex.cloud");
    // Even with the allow setting.
    vi.stubEnv("BANHALL_EVALUATION_PROJECTS", "allowed");
    await expect(s.t.mutation(internal.seedPlanEval.markEvaluationProject, { projectId })).rejects.toThrow(/never made on production/);
    expect((await s.t.run((ctx) => ctx.db.get(projectId)))!.evaluation).toBeUndefined();
  });

  it("is refused on a cloud deployment unless the owner allowed it there, and when the deployment is unknown (review)", async () => {
    const s = await setup();
    const projectId = await s.t.run((ctx) =>
      ctx.db.insert("projects", {
        title: releaseEvalProjectTitle("Fourth"), clientName: "C", status: "draft", createdBy: s.writerId,
        shareToken: "fourth", createdAt: 1, updatedAt: 1,
      })
    );
    for (const url of ["https://brave-otter-123.convex.cloud", ""]) {
      vi.stubEnv("CONVEX_CLOUD_URL", url);
      await expect(s.t.mutation(internal.seedPlanEval.markEvaluationProject, { projectId })).rejects.toThrow(/only on a local deployment/);
    }
    vi.stubEnv("CONVEX_CLOUD_URL", "https://brave-otter-123.convex.cloud");
    vi.stubEnv("BANHALL_EVALUATION_PROJECTS", "allowed");
    await s.t.mutation(internal.seedPlanEval.markEvaluationProject, { projectId });
    expect((await s.t.run((ctx) => ctx.db.get(projectId)))!.evaluation).toBeDefined();
  });
});

describe("evaluation projects are left out (Phase E, E3)", () => {
  it("of every lesson set input", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (const ids of [s.normal, s.evaluation]) {
        await ctx.db.insert("qaItemFeedback", {
          targetKey: "t", projectId: ids.projectId, itemKey: "k", itemKind: "issue", section: "242", itemText: "Vague claim.",
          vote: -1, userId: s.writerId, createdAt: 1, updatedAt: 1,
        });
        const candidateId = await ctx.db.insert("reportCandidates", {
          projectId: ids.projectId, generationId: ids.generationId, label: "A", model: "m", content: "", agentOutputs: "{}", createdAt: 1,
        });
        await ctx.db.insert("candidateScores", {
          projectId: ids.projectId, generationId: ids.generationId, candidateId, optionPosition: 1, model: "m", label: "A",
          userId: s.writerId, score: 7, createdAt: 1, updatedAt: 1,
        });
        const proposalId = await ctx.db.insert("chatProposals", {
          agentThreadId: "thread", projectId: ids.projectId, reportId: ids.reportId, kind: "edit", targetText: "a", newText: "b",
          state: "applied", createdAt: 1,
        });
        await ctx.db.insert("proposalWordingEditEvents", {
          projectId: ids.projectId, reportId: ids.reportId, proposalId, userId: s.writerId, originalText: "The team did it.", editedText: "We did it.", createdAt: 1,
        });
        await ctx.db.insert("sectionEditEvents", {
          projectId: ids.projectId, generationId: ids.generationId, section: "s242", draftText: "Long draft.", approvedText: "Short.",
          editRatio: 0.5, userId: s.writerId, createdAt: 1,
        });
        await ctx.db.insert("brainFeedbackQueue", {
          fromUserId: s.writerId, projectId: ids.projectId, body: LONG_FEEDBACK, status: "approved", createdAt: 1,
        });
      }
    });
    const readers = [
      internal.learning.getFeedbackForDigest,
      internal.learning.getCandidateFeedbackForDigest,
      internal.learning.getProposalWordingEditsForDigest,
      internal.learning.getSectionEditsForDigest,
      internal.learning.getApprovedBrainFeedbackForDigest,
    ];
    for (const reader of readers) {
      const rows = (await s.t.query(reader, { limit: 50 })) as Array<{ projectId: Id<"projects"> | null }>;
      expect(rows.map((row) => row.projectId)).toEqual([s.normal.projectId]);
    }
  });

  it("of chat answer votes (review)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (const ids of [s.normal, s.evaluation]) {
        const turnId = await ctx.db.insert("chatTurns", {
          userId: s.writerId, agentThreadId: `thread-${ids.projectId}`, promptMessageId: "prompt", order: 0, status: "completed", stepCount: 1,
        });
        await ctx.db.insert("chatAnswerFeedback", {
          turnId, userId: s.writerId, projectId: ids.projectId, reportId: ids.reportId, agentThreadId: `thread-${ids.projectId}`,
          promptMessageId: "prompt", answerMessageId: "answer", promptText: "Shorten Line 242.", answerText: "Here is a shorter Line 242.",
          learningSnapshot: { version: 2, promptText: "Shorten Line 242.", answerText: "Here is a shorter Line 242." },
          vote: 1, createdAt: 1,
        });
      }
    });
    const rows = await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 50 });
    expect(rows.map((row) => row.projectId)).toEqual([s.normal.projectId]);
  });

  it("of learning signals: none is made, and one made before the mark is no longer read", async () => {
    const s = await setup();
    const commentId = async (ids: Ids) =>
      await s.t.run((ctx) =>
        ctx.db.insert("comments", {
          projectId: ids.projectId, reportId: ids.reportId, commenterId: s.writerId, commenterType: "writer",
          highlightFrom: 1, highlightTo: 4, highlightText: "The", body: "Open with the uncertainty, not the team.", resolved: false, createdAt: 1,
        })
      );
    for (const ids of [s.normal, s.evaluation]) {
      await s.t.mutation(internal.learningSignals.capture, { commentId: await commentId(ids), producerId: s.writerId });
    }
    const signals = await s.t.run((ctx) => ctx.db.query("learningSignals").collect());
    expect(signals.map((row) => row.projectId)).toEqual([s.normal.projectId]);

    // Marked after its signal was made: the signal is no longer read.
    await s.t.run((ctx) => ctx.db.patch(s.normal.projectId, { evaluation: { markedAt: 2 } }));
    expect(await s.t.query(internal.learningSignals.getSignalsForDigest, { kind: signals[0]!.kind, limit: 50 })).toEqual([]);
  });

  it("of writer memory", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (const [index, ids] of [s.normal, s.evaluation].entries()) {
        for (const n of [0, 1]) {
          await ctx.db.insert("learningSignals", {
            kind: "seed_rewording", sourceKey: `seedSelection:${index}-${n}`, projectId: ids.projectId, producerId: s.writerId,
            payload: { before: "The team performed testing.", after: `We tested it ${index}-${n}.` }, at: 10 + index * 2 + n,
          });
        }
      }
    });
    const gathered = await s.t.query(internal.writerMemory.gatherForWriter, { userId: s.writerId, since: 0 });
    expect(gathered.active).toBe(true);
    if (!gathered.active) return;
    expect(gathered.signals.map((signal) => signal.projectId)).toEqual([s.normal.projectId, s.normal.projectId]);
  });

  describe("of edit size", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("records no reading for a save, a burst or a chat apply", async () => {
      const s = await setup();
      for (const ids of [s.normal, s.evaluation]) {
        await s.writer.mutation(api.reports.updateReportContent, {
          reportId: ids.reportId,
          content: doc("The team ran a controlled trial of the seal.", "Every word here changed."),
          expectedRevisionNumber: 0,
        });
      }
      vi.advanceTimersByTime(EDIT_SIZE_BURST_MS);
      await s.t.finishInProgressScheduledFunctions();
      const readings = await s.t.run((ctx) => ctx.db.query("reportEditDistance").collect());
      expect(readings.map((row) => row.projectId)).toEqual([s.normal.projectId]);
      expect(await s.t.run((ctx) => ctx.db.query("reportEditSizeDue").collect())).toEqual([]);

      // Review: a chat apply on the evaluation project records nothing either.
      const proposalId = await s.t.run(async (ctx) => {
        await ctx.db.insert("agentChatThreads", {
          projectId: s.evaluation.projectId, reportId: s.evaluation.reportId, agentThreadId: "eval-thread", title: "Chat", createdAt: 1,
        });
        await ctx.db.insert("chatTurns", {
          userId: s.writerId, agentThreadId: "eval-thread", promptMessageId: "eval-prompt", order: 0, status: "completed", stepCount: 1,
        });
        return await ctx.db.insert("chatProposals", {
          agentThreadId: "eval-thread", promptMessageId: "eval-prompt", projectId: s.evaluation.projectId, reportId: s.evaluation.reportId,
          kind: "edit", targetText: "Every word here changed.", newText: "Each word here changed.", state: "pending", createdAt: 1,
        });
      });
      expect(await s.writer.mutation(api.chatV2.applyProposal, { proposalId })).toMatchObject({ applied: true });
      expect((await s.t.run((ctx) => ctx.db.query("reportEditDistance").collect())).map((row) => row.projectId)).toEqual([s.normal.projectId]);
    });
  });

  it("of Brain nomination, from a rated report and from approved feedback", async () => {
    const s = await setup();
    for (const ids of [s.normal, s.evaluation]) {
      await s.t.mutation(internal.brain.nominateFromReport, { reportId: ids.reportId, score: 95 });
    }
    const sources = async () => await s.t.run((ctx) => ctx.db.query("brainSources").collect());
    expect((await sources()).map((row) => row.sourceProjectId)).toEqual([s.normal.projectId]);

    const feedbackIds = await s.t.run(async (ctx) => [
      await ctx.db.insert("brainFeedbackQueue", { fromUserId: s.writerId, projectId: s.normal.projectId, body: `${LONG_FEEDBACK} One.`, status: "pending", createdAt: 1 }),
      await ctx.db.insert("brainFeedbackQueue", { fromUserId: s.writerId, projectId: s.evaluation.projectId, body: `${LONG_FEEDBACK} Two.`, status: "pending", createdAt: 1 }),
    ]);
    for (const feedbackId of feedbackIds) {
      await s.admin.mutation(api.brain.reviewFeedback, { feedbackId, decision: "approved" });
    }
    const feedbackSources = (await sources()).filter((row) => row.kind === "writer_feedback");
    expect(feedbackSources.map((row) => row.sourceProjectId)).toEqual([s.normal.projectId]);
    // The decision itself is still recorded.
    expect((await s.t.run((ctx) => ctx.db.get(feedbackIds[1]!)))!.status).toBe("approved");
  });
});
