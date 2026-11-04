/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { copyTranscriptRow, insertTranscriptRow } from "./lib/transcripts";
import { stubFetchStreaming } from "./anthropicSse.fixture";

const modules = import.meta.glob("./**/*.ts");
const CONTENT = [
  "Dana Whitfield: What made the forecast hard?",
  "Priya Shah: We could not forecast net load fast enough when cloud cover changed.",
].join("\n\n");

beforeAll(async () => { await import("./providerCredit"); });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "arrival-test-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup(mode: "off" | "all" = "all", evaluation = false) {
  const t = convexTest(schema, modules);
  const { writerId, projectId } = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "arrival-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Forecast", clientName: "Verdant Grid", status: "draft", createdBy: writerId,
      ownerId: writerId, shareToken: "arrival-token", createdAt: 1, updatedAt: 1,
      interviewer: "Dana Whitfield", interviewees: ["Priya Shah"],
      ...(evaluation ? { evaluation: { markedAt: 1 } } : {}),
    });
    await ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: mode, updatedBy: writerId, updatedAt: 1 });
    return { writerId, projectId };
  });
  return { t, writerId, projectId, writer: t.withIdentity({ subject: "arrival-writer" }) };
}

function factResponse() {
  return Response.json({
    id: "msg_arrival", type: "message", role: "assistant", model: "claude-sonnet-5",
    content: [
      { type: "text", text: "uncertainty | " },
      { type: "text", text: "They could not forecast net load fast enough when cloud cover changed", citations: [{
        type: "content_block_location", cited_text: "We could not forecast net load fast enough when cloud cover changed.",
        document_index: 0, document_title: "Interview transcript window", start_block_index: 1, end_block_index: 2,
      }] },
    ],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 30 },
  });
}

async function factJobs(t: ReturnType<typeof convexTest<typeof schema.tables>>, transcriptId: Id<"transcripts">) {
  return await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter(
    (job) => job.name === "ai/condense:extractTranscriptFactsInBackground" && job.args[0]?.transcriptId === transcriptId
  ));
}

describe("transcript facts on arrival", () => {
  it("queues one extraction for an upload and reuses it when opened", async () => {
    const s = await setup();
    const fetchMock = vi.fn(async () => factResponse());
    stubFetchStreaming(vi, fetchMock);
    const transcriptId = await s.writer.mutation(api.transcripts.addTranscript, { projectId: s.projectId, content: CONTENT });
    expect((await s.t.run((ctx) => ctx.db.get(transcriptId)))?.factsStatus).toBe("queued");
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await s.t.run((ctx) => ctx.db.query("transcriptFactRuns").collect()))).toHaveLength(1);
    await s.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("copies ready facts for a duplicate project and a same-text upload", async () => {
    const s = await setup();
    const fetchMock = vi.fn(async () => factResponse());
    stubFetchStreaming(vi, fetchMock);
    const sourceId = await s.writer.mutation(api.transcripts.addTranscript, { projectId: s.projectId, content: CONTENT });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const copyProjectId = await s.t.run((ctx) => ctx.db.insert("projects", {
      title: "Forecast copy", clientName: "Verdant Grid", status: "draft", createdBy: s.writerId,
      ownerId: s.writerId, shareToken: "copy-token", createdAt: 1, updatedAt: 1,
      interviewer: "Dana Whitfield", interviewees: ["Priya Shah"],
    }));
    const source = await s.t.run((ctx) => ctx.db.get(sourceId));
    expect(source).not.toBeNull();
    const copyId = await s.t.run((ctx) => copyTranscriptRow(ctx, source!, { projectId: copyProjectId, position: 0 }));
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await s.t.run((ctx) => ctx.db.get(copyId)))?.factsStatus).toBe("ready");
    const uploadProjectId = await s.t.run((ctx) => ctx.db.insert("projects", {
      title: "Forecast upload", clientName: "Verdant Grid", status: "draft", createdBy: s.writerId,
      ownerId: s.writerId, shareToken: "upload-token", createdAt: 1, updatedAt: 1,
      interviewer: "Dana Whitfield", interviewees: ["Priya Shah"],
    }));
    const uploadedId = await s.writer.mutation(api.transcripts.addTranscript, { projectId: uploadProjectId, content: CONTENT });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await s.t.run((ctx) => ctx.db.get(uploadedId)))?.factsStatus).toBe("ready");
  });

  it("waits for a queued source instead of extracting the same text twice", async () => {
    const s = await setup();
    const fetchMock = vi.fn(async () => factResponse());
    stubFetchStreaming(vi, fetchMock);
    const sourceId = await s.writer.mutation(api.transcripts.addTranscript, { projectId: s.projectId, content: CONTENT });
    const projectId = await s.t.run((ctx) => ctx.db.insert("projects", {
      title: "Pending copy", clientName: "Verdant Grid", status: "draft", createdBy: s.writerId,
      ownerId: s.writerId, shareToken: "pending-token", createdAt: 1, updatedAt: 1,
      interviewer: "Dana Whitfield", interviewees: ["Priya Shah"],
    }));
    const source = await s.t.run((ctx) => ctx.db.get(sourceId));
    expect(source).not.toBeNull();
    const copyId = await s.t.run((ctx) => copyTranscriptRow(ctx, source!, { projectId, position: 0 }));
    expect(await s.t.run((ctx) => ctx.db.get(copyId))).toMatchObject({
      factsStatus: "queued", factsCopyFromTranscriptId: sourceId,
    });
    const nextProjectId = await s.t.run((ctx) => ctx.db.insert("projects", {
      title: "Pending upload", clientName: "Verdant Grid", status: "draft", createdBy: s.writerId,
      ownerId: s.writerId, shareToken: "next-token", createdAt: 1, updatedAt: 1,
      interviewer: "Dana Whitfield", interviewees: ["Priya Shah"],
    }));
    const nextId = await s.writer.mutation(api.transcripts.addTranscript, { projectId: nextProjectId, content: CONTENT });
    expect((await s.t.run((ctx) => ctx.db.get(nextId)))?.factsCopyFromTranscriptId).toBe(copyId);
    await s.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: nextId });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await s.t.run((ctx) => ctx.db.get(copyId)))?.factsStatus).toBe("ready");
    expect((await s.t.run((ctx) => ctx.db.get(nextId)))?.factsStatus).toBe("ready");
  });

  it("falls back to its own extraction if a copy source disappears", async () => {
    const s = await setup();
    const sourceId = await s.writer.mutation(api.transcripts.addTranscript, { projectId: s.projectId, content: CONTENT });
    const projectId = await s.t.run((ctx) => ctx.db.insert("projects", {
      title: "Source gone", clientName: "Verdant Grid", status: "draft", createdBy: s.writerId,
      ownerId: s.writerId, shareToken: "gone-token", createdAt: 1, updatedAt: 1,
      interviewer: "Dana Whitfield", interviewees: ["Priya Shah"],
    }));
    const source = await s.t.run((ctx) => ctx.db.get(sourceId));
    expect(source).not.toBeNull();
    const copyId = await s.t.run((ctx) => copyTranscriptRow(ctx, source!, { projectId, position: 0 }));
    await s.t.run((ctx) => ctx.db.delete(sourceId));
    await s.t.mutation(internal.transcripts.copyTranscriptFacts, { fromTranscriptId: sourceId, toTranscriptId: copyId });
    expect((await s.t.run((ctx) => ctx.db.get(copyId)))?.factsCopyFromTranscriptId).toBeUndefined();
    await s.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: copyId });
    expect(await factJobs(s.t, copyId)).toHaveLength(1);
  });

  it("skips empty text and disabled facts, and follows the open trigger for evaluation projects", async () => {
    const s = await setup("off");
    const empty = await s.t.run((ctx) => insertTranscriptRow(ctx, { projectId: s.projectId, content: "  ", position: 0 }));
    expect(empty).toBeNull();
    const disabled = await s.t.run((ctx) => insertTranscriptRow(ctx, { projectId: s.projectId, content: CONTENT, position: 0 }));
    expect(disabled).not.toBeNull();
    await s.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: disabled! });
    expect(await factJobs(s.t, disabled!)).toHaveLength(0);

    const e = await setup("all", true);
    const id = await e.t.run((ctx) => insertTranscriptRow(ctx, { projectId: e.projectId, content: CONTENT, position: 0 }));
    expect(id).not.toBeNull();
    await e.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: id! });
    expect(await factJobs(e.t, id!)).toHaveLength(1);
    await e.t.run((ctx) => ctx.db.patch(id!, { archivedAt: Date.now() }));
    await e.t.mutation(internal.transcripts.finishArrivalSpeakerRoles, { transcriptId: id! });
    expect(await factJobs(e.t, id!)).toHaveLength(1);
  });

  it("waits for the speaker look and rechecks the facts switch", async () => {
    const s = await setup();
    const content = "Speaker 1: What failed?\n\nSpeaker 2: The cold test failed after 20 cycles.";
    const id = await s.t.run((ctx) => insertTranscriptRow(ctx, { projectId: s.projectId, content, position: 0 }));
    expect(id).not.toBeNull();
    await s.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: id! });
    const speakerJobs = await s.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name === "ai/condense:classifySpeakerRoles" && job.args[0]?.transcriptId === id
    ));
    expect(speakerJobs).toHaveLength(1);
    expect(await factJobs(s.t, id!)).toHaveLength(0);
    await s.t.mutation(internal.transcripts.finishArrivalSpeakerRoles, { transcriptId: id! });
    expect(await factJobs(s.t, id!)).toHaveLength(1);

    const switched = await setup();
    const other = await switched.t.run((ctx) => insertTranscriptRow(ctx, { projectId: switched.projectId, content: CONTENT, position: 0 }));
    expect(other).not.toBeNull();
    await switched.t.run(async (ctx) => {
      const setting = await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", "transcripts.factsMode")).unique();
      if (setting) await ctx.db.patch(setting._id, { value: "off" });
    });
    await switched.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: other! });
    expect(await factJobs(switched.t, other!)).toHaveLength(0);
  });
});
