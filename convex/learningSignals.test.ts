/// <reference types="vite/client" />
/**
 * Phase E, E2b (part 6 of the first 2026-10-26 entry): Step-by-step choices
 * and reviewer outcomes become masked learning signals, each admitted to the
 * style lesson set on its own.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { removeCommentSignal } from "./learningSignals";
import { addDecisionSeed, decisionFixture, decisionMutation } from "./seedDecision.fixture";
import type { edit as editSeed } from "./seeds";
import type { MutationCtx } from "./_generated/server";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A Seed with the Brief and Batch it needs. */
async function insertSeed(
  ctx: MutationCtx,
  ids: { projectId: Id<"projects">; generationId: Id<"generations"> },
  bullets: string[],
  tags: string[],
  roleId: "company_context" | "project_status" = "company_context"
): Promise<Id<"seeds">> {
  const briefVersionId = await ctx.db.insert("generationBriefs", {
    generationId: ids.generationId, projectId: ids.projectId, inputsHash: "h", version: 1, origin: "derived", storylineText: "s", createdAt: 1,
  });
  const batchId = await ctx.db.insert("seedBatches", {
    projectId: ids.projectId, generationId: ids.generationId, roleId: "company_context", operation: "open",
    dedupeKey: crypto.randomUUID(), commandId: crypto.randomUUID(), attemptId: crypto.randomUUID(),
    consumedContextRevision: "r", briefVersionId, settingsHash: "settings", status: "shown", queuedAt: 1, leaseExpiresAt: 2,
    model: "model", slot: "generation:seeds:company_context", promptVersion: "prompt", requestsReserved: 2,
  });
  return await ctx.db.insert("seeds", {
    projectId: ids.projectId, generationId: ids.generationId, batchId, roleId, order: 0,
    bullets, tags, support: "source_supported", originalSupport: "source_supported",
  });
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "signal-writer", role: "writer", firstName: "Wren" });
    const reviewerId = await ctx.db.insert("users", { authId: "signal-reviewer", role: "manager", firstName: "Rae" });
    const projectId = await ctx.db.insert("projects", {
      title: "Pump seals", clientName: "Acme Pumps", status: "draft", createdBy: writerId, ownerId: writerId,
      shareToken: "signal-token", createdAt: 1, updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId, status: "awaiting_input", requestedBy: writerId, startedAt: 1,
      placeholders: [{ token: "[PERSON_1]", value: "Dana Whitlock" }],
    });
    const seedId = await insertSeed(ctx, { projectId, generationId }, ["Dana Whitlock led the seal trials at Acme Pumps."], ["technical"]);
    return { writerId, reviewerId, projectId, generationId, seedId };
  });
  return { t, ...ids };
}

async function signals(t: T) {
  return await t.run((ctx) => ctx.db.query("learningSignals").collect());
}

describe("learning signals from Step-by-step choices and reviews (Phase E, E2b)", () => {
  test("a reworded Seed becomes one masked signal, replaced by a later edit and removed by a restore", async () => {
    const s = await setup();
    const selectionId = await s.t.run((ctx) =>
      ctx.db.insert("seedSelections", {
        projectId: s.projectId, generationId: s.generationId, seedId: s.seedId, roleId: "company_context", selected: true,
        editedBullets: ["Dana Whitlock ran three seal trials for Acme Pumps."], editedBy: s.writerId, editedAt: 5, selectedAt: 1, version: 1,
      })
    );
    await s.t.mutation(internal.learningSignals.capture, { seedSelectionId: selectionId });
    // A later edit replaces the one signal (review: the test edits again).
    await s.t.run((ctx) => ctx.db.patch(selectionId, { editedBullets: ["Dana Whitlock ran four seal trials for Acme Pumps."], editedAt: 5 }));
    await s.t.mutation(internal.learningSignals.capture, { seedSelectionId: selectionId });
    const [signal, ...rest] = await signals(s.t);
    expect(signal!.payload.after).toContain("four seal trials");
    expect(rest).toEqual([]);
    expect(signal).toMatchObject({ kind: "seed_rewording", producerId: s.writerId, projectId: s.projectId, at: 5 });
    // The draft's map hides the person; the project record's company name is removed.
    expect(signal!.payload.before).toContain("[PERSON_1]");
    expect(signal!.payload.after).toContain("[PERSON_1]");
    expect(JSON.stringify(signal!.payload)).not.toContain("Dana Whitlock");
    expect(JSON.stringify(signal!.payload)).not.toContain("Acme Pumps");

    await s.t.run((ctx) => ctx.db.patch(selectionId, { editedBullets: undefined, editedBy: undefined, editedAt: undefined }));
    await s.t.mutation(internal.learningSignals.capture, { seedSelectionId: selectionId });
    expect(await signals(s.t)).toEqual([]);
  });

  test("Seed Feedback names its writer, is masked, and leaves when withdrawn; an older row finds its writer from the event", async () => {
    const s = await setup();
    const requestId = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("seedFeedbackRequests", {
        projectId: s.projectId, generationId: s.generationId, roleId: "company_context", targetSeedId: s.seedId,
        targetWording: ["Dana Whitlock led the seal trials."], instruction: "Say what Dana Whitlock measured, not who she is.", status: "active",
      });
      await ctx.db.insert("seedDecisionEvents", {
        projectId: s.projectId, generationId: s.generationId, kind: "feedbackRequested", roleId: "company_context",
        at: 2, actorUserId: s.writerId, feedbackRequestId: id,
      });
      return id;
    });
    await s.t.mutation(internal.learningSignals.capture, { seedFeedbackRequestId: requestId });
    const [signal] = await signals(s.t);
    expect(signal).toMatchObject({ kind: "seed_feedback", producerId: s.writerId });
    expect(signal!.payload.instruction).toBe("Say what [PERSON_1] measured, not who she is.");
    await s.t.run((ctx) => ctx.db.patch(requestId, { status: "withdrawn", withdrawnAt: 3 }));
    await s.t.mutation(internal.learningSignals.capture, { seedFeedbackRequestId: requestId });
    expect(await signals(s.t)).toEqual([]);
  });

  test("a sign-off's choices are counted by style from the signed-off plan, leaving skipped parts out (review)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const other = await insertSeed(ctx, s, ["A detailed idea."], ["detailed"]);
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId, generationId: s.generationId, seedId: other, roleId: "company_context", selected: true, selectedAt: 1, version: 1,
      });
      // A pick left in a part that was skipped does not count.
      const skippedSeed = await insertSeed(ctx, s, ["A skipped idea."], ["detailed"], "project_status");
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId, generationId: s.generationId, seedId: skippedSeed, roleId: "project_status", selected: true, selectedAt: 1, version: 1,
      });
      await ctx.db.insert("seedDecisionEvents", {
        projectId: s.projectId, generationId: s.generationId, kind: "regenerate", roleId: "company_context", at: 2, actorUserId: s.writerId,
      });
      // Skipped, restored and skipped again: one skipped part.
      for (const kind of ["skip", "unskip", "skip"] as const) {
        await ctx.db.insert("seedDecisionEvents", {
          projectId: s.projectId, generationId: s.generationId, kind, roleId: "project_status", at: 3, actorUserId: s.writerId,
        });
      }
      const briefVersionId = (await ctx.db.query("generationBriefs").first())!._id;
      const summaryVersionId = await ctx.db.insert("summaryVersions", {
        projectId: s.projectId, generationId: s.generationId, version: 1, originGenerationId: s.generationId, briefVersionId,
        settingsHash: "h", skippedRoleIds: ["project_status"], readiness: true, signedOffBy: s.writerId, signedOffAt: 77,
      } as never);
      await ctx.db.patch(s.generationId, { summaryVersionId });
    });
    await s.t.mutation(internal.learningSignals.capture, { seedChoicesGenerationId: s.generationId });
    const [signal] = await signals(s.t);
    expect(signal).toMatchObject({ producerId: s.writerId, at: 77 });
    expect(signal!.payload).toEqual({
      tags: [
        { tag: "detailed", offered: 1, chosen: 1 },
        { tag: "technical", offered: 1, chosen: 0 },
      ],
      newIdeas: 1,
      skipped: 1,
    });
  });

  test("a review decision keeps its note masked; an internal comment is a signal, a client comment is not, and a deleted one leaves", async () => {
    const s = await setup();
    const { decisionId, writerComment, clientComment } = await s.t.run(async (ctx) => {
      const reportId = await ctx.db.insert("reports", { projectId: s.projectId, content: "{}", version: 1, generatedAt: 1, updatedAt: 1 });
      const decisionId = await ctx.db.insert("reviewDecisions", {
        projectId: s.projectId, reportId, reviewerId: s.reviewerId, revisionNumber: 1, contentHash: "h",
        decision: "return", toStage: "edits", note: "Acme Pumps is named twice in Line 242; say what changed.", createdAt: 4,
      });
      const comment = (commenterType: "writer" | "client", commenterId: string) =>
        ctx.db.insert("comments", {
          projectId: s.projectId, reportId, commenterId, commenterType, highlightFrom: 0, highlightTo: 5,
          highlightText: "The team", body: "Lead with the result.", resolved: false, createdAt: 6,
        });
      return {
        decisionId,
        writerComment: await comment("writer", s.reviewerId),
        clientComment: await comment("client", "client-reviewer"),
      };
    });
    await s.t.mutation(internal.learningSignals.capture, { reviewDecisionId: decisionId });
    await s.t.mutation(internal.learningSignals.capture, { commentId: writerComment });
    await s.t.mutation(internal.learningSignals.capture, { commentId: clientComment });
    const rows = await signals(s.t);
    expect(rows.map((row) => [row.kind, row.producerId]).sort()).toEqual([
      ["review_comment", s.reviewerId],
      ["review_decision", s.reviewerId],
    ].sort());
    const decision = rows.find((row) => row.kind === "review_decision")!;
    expect(decision.payload.decision).toBe("return");
    expect(decision.payload.note).not.toContain("Acme Pumps");
    await s.t.run((ctx) => removeCommentSignal(ctx, writerComment));
    expect((await signals(s.t)).map((row) => row.kind)).toEqual(["review_decision"]);
  });

  test("adding an internal comment schedules its signal", async () => {
    vi.useFakeTimers();
    const s = await setup();
    const reportId = await s.t.run((ctx) => ctx.db.insert("reports", { projectId: s.projectId, content: "{}", version: 1, generatedAt: 1, updatedAt: 1 }));
    await s.t.withIdentity({ subject: "signal-writer" }).mutation(api.comments.addComment, {
      projectId: s.projectId, reportId, commenterId: "ignored", highlightFrom: 0, highlightTo: 8,
      highlightText: "The team", body: "Say what was uncertain first.",
    });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await signals(s.t)).map((row) => [row.kind, row.producerId])).toEqual([["review_comment", s.writerId]]);
  });

  test("the one-off pass makes signals for rows written before E2b", async () => {
    vi.useFakeTimers();
    const s = await setup();
    await s.t.run(async (ctx) => {
      const reportId = await ctx.db.insert("reports", { projectId: s.projectId, content: "{}", version: 1, generatedAt: 1, updatedAt: 1 });
      await ctx.db.insert("reviewDecisions", {
        projectId: s.projectId, reportId, reviewerId: s.reviewerId, revisionNumber: 1, contentHash: "h",
        decision: "approve", toStage: "ready_for_delivery", createdAt: 4,
      });
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId, generationId: s.generationId, seedId: s.seedId, roleId: "company_context", selected: true,
        editedBullets: ["Three trials."], editedBy: s.writerId, editedAt: 5, selectedAt: 1, version: 1,
      });
    });
    await s.t.mutation(internal.learningSignals.backfillLearningSignals, {});
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await signals(s.t)).map((row) => row.kind).sort()).toEqual(["review_decision", "seed_rewording"]);
  });

  test("each kind is admitted to the style lesson set on its own, and approvals never admit one reviewer's notes (review)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const otherProject = await ctx.db.insert("projects", {
        title: "Other", clientName: "Borealis", status: "draft", createdBy: s.reviewerId, ownerId: s.reviewerId,
        shareToken: "signal-token-2", createdAt: 1, updatedAt: 1,
      });
      const reportP1 = await ctx.db.insert("reports", { projectId: s.projectId, content: "{}", version: 1, generatedAt: 1, updatedAt: 1 });
      const reportP2 = await ctx.db.insert("reports", { projectId: otherProject, content: "{}", version: 1, generatedAt: 1, updatedAt: 1 });
      // Seed rewordings from two writers on two projects, each with its real Seed row.
      for (let index = 0; index < 6; index += 1) {
        const projectId = index % 2 ? otherProject : s.projectId;
        const writer = index % 2 ? s.reviewerId : s.writerId;
        const selectionId = await ctx.db.insert("seedSelections", {
          projectId, generationId: s.generationId, seedId: s.seedId, roleId: "company_context", selected: true,
          editedBullets: [`Short idea ${index}.`], editedBy: writer, editedAt: 10 + index, selectedAt: 1, version: 1,
        });
        await ctx.db.insert("learningSignals", {
          kind: "seed_rewording", sourceKey: `seedSelection:${selectionId}`, projectId, producerId: writer,
          payload: { before: "Long idea.", after: `Short idea ${index}.` }, at: 10 + index,
        });
      }
      // One reviewer returns five reports on one project; another only approves, elsewhere.
      for (let index = 0; index < 5; index += 1) {
        const decisionId = await ctx.db.insert("reviewDecisions", {
          projectId: s.projectId, reportId: reportP1, reviewerId: s.reviewerId, revisionNumber: 1, contentHash: "h",
          decision: "return", toStage: "edits", note: `Too long ${index}.`, createdAt: 10 + index,
        });
        await ctx.db.insert("learningSignals", {
          kind: "review_decision", sourceKey: `reviewDecision:${decisionId}`, projectId: s.projectId, producerId: s.reviewerId,
          payload: { decision: "return", note: `Too long ${index}.` }, at: 10 + index,
        });
      }
      const approvalId = await ctx.db.insert("reviewDecisions", {
        projectId: otherProject, reportId: reportP2, reviewerId: s.writerId, revisionNumber: 1, contentHash: "h",
        decision: "approve", toStage: "ready_for_delivery", createdAt: 20,
      });
      await ctx.db.insert("learningSignals", {
        kind: "review_decision", sourceKey: `reviewDecision:${approvalId}`, projectId: otherProject, producerId: s.writerId,
        payload: { decision: "approve" }, at: 20,
      });
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "tool", name: "submit_learned_rules", input: { rules: ["Keep each idea to one short sentence."] } }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await s.t.action(internal.ai.learning.generateDraftStyleDigest, {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse((fetchMock.mock.calls[0] as unknown as [unknown, { body: string }])[1].body);
    const prompt = request.messages[0].content as string;
    expect(prompt).toContain("Seed rewordings (AI idea vs writer rewording), newest first");
    expect(prompt).not.toContain("Review returns");
    expect(prompt).not.toContain("Too long");
    const [digest] = await s.t.run((ctx) => ctx.db.query("learningDigests").collect());
    const streams = Object.fromEntries(digest!.admission!.streams.map((stream) => [stream.stream, stream.admittedCount]));
    expect(streams["learningSignals:seed_rewording"]).toBe(6);
    expect(streams["learningSignals:review_decision"]).toBe(0);
  });

  test("a review note is masked with its report's draft map, else the project's map with a transcript's names (review)", async () => {
    const s = await setup();
    const { decisionWithDraft, decisionWithoutDraft } = await s.t.run(async (ctx) => {
      const reportWithDraft = await ctx.db.insert("reports", { projectId: s.projectId, content: "{}", version: 1, generatedAt: 1, updatedAt: 1, generationId: s.generationId });
      const reportWithout = await ctx.db.insert("reports", { projectId: s.projectId, content: "{}", version: 1, generatedAt: 1, updatedAt: 1 });
      await ctx.db.insert("transcripts", { projectId: s.projectId, content: "Priya Raman: We tuned the seal.\nJordan Ellis: Why?", label: "Interview", createdAt: 1 });
      const decision = (reportId: Id<"reports">, note: string) =>
        ctx.db.insert("reviewDecisions", {
          projectId: s.projectId, reportId, reviewerId: s.reviewerId, revisionNumber: 1, contentHash: "h",
          decision: "return", toStage: "edits", note, createdAt: 4,
        });
      return {
        decisionWithDraft: await decision(reportWithDraft, "Dana Whitlock is named in every Line."),
        decisionWithoutDraft: await decision(reportWithout, "Priya Raman is quoted too often."),
      };
    });
    await s.t.mutation(internal.learningSignals.capture, { reviewDecisionId: decisionWithDraft });
    await s.t.mutation(internal.learningSignals.capture, { reviewDecisionId: decisionWithoutDraft });
    const notes = (await signals(s.t)).map((row) => row.payload.note ?? "");
    expect(notes.join(" ")).not.toContain("Dana Whitlock");
    expect(notes.join(" ")).not.toContain("Priya Raman");
  });

  test("a capture during the project's erasure writes nothing, and a build skips signals of an erased project (review)", async () => {
    const s = await setup();
    const selectionId = await s.t.run((ctx) =>
      ctx.db.insert("seedSelections", {
        projectId: s.projectId, generationId: s.generationId, seedId: s.seedId, roleId: "company_context", selected: true,
        editedBullets: ["Three trials."], editedBy: s.writerId, editedAt: 5, selectedAt: 1, version: 1,
      })
    );
    await s.t.mutation(internal.learningSignals.capture, { seedSelectionId: selectionId });
    expect(await s.t.query(internal.learningSignals.getSignalsForDigest, { kind: "seed_rewording", limit: 10 })).toHaveLength(1);
    await s.t.run((ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: 9 }));
    expect(await s.t.query(internal.learningSignals.getSignalsForDigest, { kind: "seed_rewording", limit: 10 })).toEqual([]);
    await s.t.mutation(internal.learningSignals.capture, { seedSelectionId: selectionId });
    expect(await signals(s.t)).toEqual([]);
  });

  test("removing a signal moves the revision, so the next build is not taken for unchanged inputs (review)", async () => {
    const s = await setup();
    const selectionId = await s.t.run((ctx) =>
      ctx.db.insert("seedSelections", {
        projectId: s.projectId, generationId: s.generationId, seedId: s.seedId, roleId: "company_context", selected: true,
        editedBullets: ["Three trials."], editedBy: s.writerId, editedAt: 5, selectedAt: 1, version: 1,
      })
    );
    await s.t.mutation(internal.learningSignals.capture, { seedSelectionId: selectionId });
    const before = await s.t.query(internal.learning.getLearningFreshness, { kind: "draft_style", feedbackCutoff: 5 });
    await s.t.run((ctx) =>
      ctx.db.insert("learningDigests", {
        kind: "draft_style", content: "Rules", sourceCount: 5, feedbackCutoff: 5, model: "m", createdAt: 1, learningRevision: before.revision,
      })
    );
    expect((await s.t.query(internal.learning.getLearningFreshness, { kind: "draft_style", feedbackCutoff: 5 })).unchanged).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await s.t.run((ctx) => ctx.db.patch(selectionId, { editedBullets: undefined, editedBy: undefined }));
    await s.t.mutation(internal.learningSignals.capture, { seedSelectionId: selectionId });
    expect((await s.t.query(internal.learning.getLearningFreshness, { kind: "draft_style", feedbackCutoff: 5 })).unchanged).toBe(false);
  });

  test("the stream sent fits its budget as it is sent (review)", async () => {
    const { withinPromptBudget, STREAM_PROMPT_CHARS } = await import("./ai/learning");
    const long = Array.from({ length: 30 }, (_, index) => ({ payload: { note: "x".repeat(1_000), index } }));
    const kept = withinPromptBudget(long);
    expect(JSON.stringify(kept.map((row) => row.payload), null, 2).length).toBeLessThanOrEqual(STREAM_PROMPT_CHARS);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(long.length);
  });

  test("editing a Seed through its mutation makes the signal, and restoring its wording removes it (review)", async () => {
    vi.useFakeTimers();
    const s = await decisionFixture();
    const seed = await addDecisionSeed(s);
    const edit = decisionMutation<typeof editSeed>("seeds:edit");
    const base = { generationId: s.generationId, roleId: "company_context" as const };
    await s.writer.mutation(edit, { ...base, expectedSeedStageVersion: 0, seedId: seed.seedId, bullets: ["The writer's own wording."] });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await s.t.run((ctx) => ctx.db.query("learningSignals").collect())).map((row) => [row.kind, row.payload.after])).toEqual([
      ["seed_rewording", "The writer's own wording."],
    ]);
    await s.writer.mutation(edit, { ...base, expectedSeedStageVersion: 1, seedId: seed.seedId, bullets: ["Original frozen wording."] });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.t.run((ctx) => ctx.db.query("learningSignals").collect())).toEqual([]);
  });

  test("deleting a comment through its mutation removes its signal at once (review)", async () => {
    vi.useFakeTimers();
    const s = await setup();
    const reportId = await s.t.run((ctx) => ctx.db.insert("reports", { projectId: s.projectId, content: "{}", version: 1, generatedAt: 1, updatedAt: 1 }));
    const writer = s.t.withIdentity({ subject: "signal-writer" });
    const commentId = await writer.mutation(api.comments.addComment, {
      projectId: s.projectId, reportId, commenterId: "ignored", highlightFrom: 0, highlightTo: 8, highlightText: "The team", body: "Lead with the result.",
    });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await signals(s.t)).toHaveLength(1);
    await writer.mutation(api.comments.deleteComment, { commentId });
    expect(await signals(s.t)).toEqual([]);
  });
});

