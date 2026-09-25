/// <reference types="vite/client" />

/**
 * Readers of verified facts outside the drafting pipeline (phase 3, plan
 * step 8): report chat reads the frozen packs of the report's generation,
 * and the PD review reads live packs when every transcript has them, behind
 * placeholders, with the HTTP transport stubbed.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { PD_REVIEW_FACTS_HEADING } from "./ai/reviewAgent";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

const CONTENT = [
  "Dana Whitfield: What made the forecast hard?",
  "Priya Shah: We couldn't forecast net load fast enough when cloud cover changed.",
].join("\n\n");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-consumers-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("report chat reads the frozen fact packs of its own generation", () => {
  async function chatFixture(t: T, packs: "all" | "partial" | "none", transcriptFacts = true) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId: "cf-writer", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Helios",
        clientName: "Verdant Grid",
        status: "review",
        createdBy: userId,
        shareToken: crypto.randomUUID(),
        createdAt: 1,
        updatedAt: 1,
      });
      const first = await ctx.db.insert("transcripts", { projectId, content: CONTENT, createdAt: 1 });
      const second = await ctx.db.insert("transcripts", { projectId, content: "Priya Shah: Second call.", createdAt: 2 });
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId: first,
        transcriptIds: [first, second],
        ...(transcriptFacts ? { transcriptFacts: true } : {}),
        status: "completed",
        agentOutputs: JSON.stringify({ analyzer: { project_goal: "Forecast" } }),
        startedAt: 1,
      });
      const rows: Array<[Id<"transcripts">, string]> =
        packs === "all"
          ? [[second, "Transcript 2: Follow-up\n\n[F2-1] (result) Second."], [first, "Transcript 1: Kickoff\n\n[F1-1] (uncertainty) First."]]
          : packs === "partial"
            ? [[first, "Transcript 1: Kickoff\n\n[F1-1] (uncertainty) First."]]
            : [];
      for (const [transcriptId, content] of rows) {
        await ctx.db.insert("generationSources", {
          generationId,
          projectId,
          kind: "transcript_facts",
          transcriptId,
          label: "pack",
          content,
          contentHash: content,
          truncated: false,
          originalLength: content.length,
          capturedAt: 1,
        });
      }
      const reportId = await ctx.db.insert("reports", {
        projectId,
        generationId,
        content: JSON.stringify({ type: "doc", content: [] }),
        version: 1,
        generatedAt: 1,
        updatedAt: 1,
      });
      return { reportId };
    });
  }

  it("returns every pack in transcript order", async () => {
    const t = convexTest(schema, modules);
    const { reportId } = await chatFixture(t, "all");
    const context = await t.query(internal.chatV2.getChatContextV2, { reportId, agentThreadId: "thread" });
    expect(context.transcriptFacts?.map((pack) => pack.split("\n")[0])).toEqual([
      "Transcript 1: Kickoff",
      "Transcript 2: Follow-up",
    ]);
  });

  it("returns none for a generation that fell back or never read facts", async () => {
    for (const [packs, flag] of [["partial", true], ["none", true], ["all", false]] as const) {
      const t = convexTest(schema, modules);
      const { reportId } = await chatFixture(t, packs, flag);
      const context = await t.query(internal.chatV2.getChatContextV2, { reportId, agentThreadId: "thread" });
      expect(context.transcriptFacts).toBeUndefined();
    }
  });
});

describe("the PD review reads live fact packs behind placeholders", () => {
  function factsAnswer() {
    return Response.json({
      id: "msg_review_facts",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [
        { type: "text", text: "uncertainty | " },
        {
          type: "text",
          text: "They could not forecast net load fast enough when cloud cover changed",
          citations: [
            {
              type: "content_block_location",
              cited_text: "We couldn't forecast net load fast enough when cloud cover changed.",
              document_index: 0,
              document_title: "Interview transcript window",
              start_block_index: 1,
              end_block_index: 2,
            },
          ],
        },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 20 },
    });
  }

  async function reviewFixture(mode: "off" | "all", extract: boolean) {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const writerId = await ctx.db.insert("users", { authId: "rf-writer", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Helios",
        clientName: "Verdant Grid",
        status: "draft",
        createdBy: writerId,
        shareToken: "rf-token",
        createdAt: 1,
        updatedAt: 1,
        interviewer: "Dana Whitfield",
        interviewees: ["Priya Shah"],
      });
      await ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: mode, updatedBy: writerId, updatedAt: 1 });
      const documentId = await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "pd.docx",
        fileType: "docx",
        content: "Priya Shah led the forecasting work at Verdant Grid.",
        source: "review_pd",
        uploadedBy: writerId,
        createdAt: 1,
      });
      return { writerId, projectId, documentId };
    });
    const writer = t.withIdentity({ subject: "rf-writer" });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
    const transcriptId = await writer.mutation(api.transcripts.addTranscript, { projectId: ids.projectId, content: CONTENT });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    if (extract) {
      vi.stubGlobal("fetch", vi.fn(async () => factsAnswer()));
      await writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }
    const reviewId = await t.run((ctx) =>
      ctx.db.insert("pdReviews", {
        projectId: ids.projectId,
        documentId: ids.documentId,
        sourceFileName: "pd.docx",
        status: "running",
        createdBy: ids.writerId,
        createdAt: Date.now(),
      })
    );
    return { t, reviewId, ...ids };
  }

  it("replaces the transcript text with the packs when every transcript has facts", async () => {
    const f = await reviewFixture("all", true);
    const input = await f.t.query(internal.pdReviews.getReviewInput, { reviewId: f.reviewId });
    expect(input?.transcriptKind).toBe("facts");
    expect(input?.transcript).toContain("[F1-1] (uncertainty)");
    expect(input?.transcript).not.toContain("What made the forecast hard?");

    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(await new Request(request, init).text());
        return Response.json({
          id: "msg_review",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [
            {
              type: "tool_use",
              id: "tool_review",
              name: "submit_pd_review",
              input: {
                summary: "[PERSON_2] is well supported.",
                qualitative_score: 78,
                score_rationale: "Evidence is cited.",
                strengths: ["Clear uncertainty."],
                risks: [],
                suggested_strengthening: [],
              },
            },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 50, output_tokens: 20 },
        });
      })
    );
    await f.t.action(internal.ai.reviewAgent.runPdReview, { reviewId: f.reviewId, projectId: f.projectId });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(PD_REVIEW_FACTS_HEADING.slice(0, 30));
    // Owner decision 26: no name leaves the app, and the stored review is restored.
    for (const name of ["Priya", "Dana", "Verdant"]) expect(bodies[0]).not.toContain(name);
    const review = await f.t.run((ctx) => ctx.db.get(f.reviewId));
    expect(review?.status).toBe("completed");
    expect(JSON.parse(review!.result!).summary).toBe("Priya Shah is well supported.");
  });

  it("reads the transcript text as before without facts, or with the setting off", async () => {
    for (const [mode, extract] of [["all", false], ["off", false]] as const) {
      const f = await reviewFixture(mode, extract);
      const input = await f.t.query(internal.pdReviews.getReviewInput, { reviewId: f.reviewId });
      expect(input?.transcriptKind).toBe("text");
      expect(input?.transcript).toContain("What made the forecast hard?");
    }
  });
});
