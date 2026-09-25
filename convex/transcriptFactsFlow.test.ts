/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { FACTS_VERSION } from "./lib/transcriptFacts";
import { SPEAKER_ROLES_REQUEST, SPEAKER_ROLES_SCHEMA, SPEAKER_ROLES_SYSTEM_PROMPT } from "./ai/speakerRolesAgent";
import { sha256 } from "./lib/contracts";

const modules = import.meta.glob("./**/*.ts");

const CONTENT = [
  "Dana Whitfield: What made the forecast hard?",
  "Priya Shah: We couldn't forecast net load fast enough when cloud cover changed.",
  "Dana Whitfield: And the result?",
  "Priya Shah: The model hit 71 percent accuracy on sunny days and 38 percent on cloudy days.",
].join("\n\n");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-flow-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function factsResponse() {
  return Response.json({
    id: "msg_flow",
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
      { type: "text", text: "\nresult | " },
      {
        type: "text",
        text: "Accuracy was 71 percent on sunny days and 38 percent on cloudy days",
        citations: [
          {
            type: "content_block_location",
            cited_text: "hit 71 percent accuracy on sunny days and 38 percent on cloudy days",
            document_index: 0,
            document_title: "Interview transcript window",
            start_block_index: 3,
            end_block_index: 4,
          },
        ],
      },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 700, output_tokens: 60 },
  });
}

async function setup(mode: "off" | "long" | "all" = "long") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "ff-writer", role: "writer", firstName: "Wren" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      status: "draft",
      createdBy: writerId,
      shareToken: "ff-token",
      createdAt: 1,
      updatedAt: 1,
      interviewer: "Dana Whitfield",
      interviewees: ["Priya Shah"],
    });
    await ctx.db.insert("appSettings", { key: "transcripts.factsMode", value: mode, updatedBy: writerId, updatedAt: 1 });
    return { writerId, projectId };
  });
  const writer = t.withIdentity({ subject: "ff-writer" });
  // Roles are placed by the project record, so no speaker call is made.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  const transcriptId = await writer.mutation(api.transcripts.addTranscript, {
    projectId: ids.projectId,
    content: CONTENT,
    label: "call.txt",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, ...ids, writer, transcriptId };
}

async function factsOf(t: Awaited<ReturnType<typeof setup>>["t"], transcriptId: Id<"transcripts">) {
  return await t.run((ctx) =>
    ctx.db
      .query("transcriptFacts")
      .withIndex("by_transcriptId_and_factsVersion", (q) => q.eq("transcriptId", transcriptId).eq("factsVersion", FACTS_VERSION))
      .collect()
  );
}

describe("fact extraction runs once per text and version", () => {
  it("extracts in the background when a consultant opens the transcript, then reuses the result", async () => {
    const f = await setup("long");
    const fetchMock = vi.fn(async () => factsResponse());
    vi.stubGlobal("fetch", fetchMock);
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const facts = await factsOf(f.t, f.transcriptId);
    expect(facts.map((fact) => [fact.key, fact.type])).toEqual([
      ["F1", "uncertainty"],
      ["F2", "result"],
    ]);
    for (const fact of facts) {
      for (const quote of fact.quotes) expect(CONTENT.slice(quote.charStart, quote.charEnd)).toBe(quote.exactExcerpt);
    }
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list[0].factsStatus).toBe("ready");
    const runs = await f.t.run((ctx) => ctx.db.query("transcriptFactRuns").collect());
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "ready", adapter: "citations", counts: { proposed: 2, verified: 2, dropped: 0 } });

    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extracts again after a speaker is moved away from interviewer (review 2026-09-25)", async () => {
    const f = await setup("long");
    const fetchMock = vi.fn(async () => factsResponse());
    vi.stubGlobal("fetch", fetchMock);
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstRun = await f.t.run(async (ctx) => (await ctx.db.query("transcriptFactRuns").collect())[0]);
    expect(firstRun.excludedLabels).toEqual(["Dana Whitfield"]);

    // Confirming the detected roles changes nothing.
    await f.writer.mutation(api.transcripts.confirmSpeakers, { transcriptId: f.transcriptId });
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Dana's words were left out as the interviewer's; making her a client
    // makes the ready facts stale, and the next request extracts again.
    await f.writer.mutation(api.transcripts.setSpeakerRole, {
      transcriptId: f.transcriptId,
      label: "Dana Whitfield",
      role: "client",
    });
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list[0].factsStatus).toBe("none");
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const runs = await f.t.run((ctx) => ctx.db.query("transcriptFactRuns").collect());
    expect(runs.map((run) => run.status)).toEqual(["ready", "ready"]);
    expect(runs[1].excludedLabels).toEqual([]);

    // Moving a speaker to interviewer needs no new extraction: that is
    // filtered when a pack is rendered.
    await f.writer.mutation(api.transcripts.setSpeakerRole, {
      transcriptId: f.transcriptId,
      label: "Priya Shah",
      role: "interviewer",
    });
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keys facts on the parser version of the turns they index (2026-09-25)", async () => {
    const f = await setup("long");
    const fetchMock = vi.fn(async () => factsResponse());
    vi.stubGlobal("fetch", fetchMock);
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { transcript, run } = await f.t.run(async (ctx) => ({
      transcript: (await ctx.db.get(f.transcriptId))!,
      run: (await ctx.db.query("transcriptFactRuns").collect())[0],
    }));
    expect(run.parserVersion).toBe(transcript.parserVersion);

    // A rebuild in progress: some turns already carry a newer parser version
    // while the transcript still names the old one. Nothing extracts from
    // half a structure, and no pack mixes the two.
    await f.t.run(async (ctx) => {
      const turns = await ctx.db
        .query("transcriptTurns")
        .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", f.transcriptId))
        .collect();
      await ctx.db.patch(turns[turns.length - 1]._id, { parserVersion: "rebuilt" });
    });
    const midRebuild = await f.t.query(internal.transcripts.factsInput, { transcriptId: f.transcriptId });
    expect(midRebuild?.structureReady).toBe(false);
    const generationId = await f.t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: f.projectId,
        transcriptId: f.transcriptId,
        transcriptIds: [f.transcriptId],
        transcriptFacts: true,
        status: "running",
        startedAt: 1,
      });
      await ctx.db.insert("generationSources", {
        generationId,
        projectId: f.projectId,
        kind: "transcript",
        transcriptId: f.transcriptId,
        label: "call.txt",
        content: CONTENT,
        contentHash: await sha256(CONTENT),
        truncated: false,
        originalLength: CONTENT.length,
        capturedAt: 1,
      });
      return generationId;
    });
    expect(await f.t.mutation(internal.transcriptDigests.freezeFactsSource, { generationId, transcriptId: f.transcriptId })).toBeNull();

    // The rebuild finishes: the facts, built on the old turns, are stale and
    // the next request extracts again on the new ones.
    await f.t.run(async (ctx) => {
      const turns = await ctx.db
        .query("transcriptTurns")
        .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", f.transcriptId))
        .collect();
      for (const turn of turns) await ctx.db.patch(turn._id, { parserVersion: "rebuilt" });
      await ctx.db.patch(f.transcriptId, { parserVersion: "rebuilt" });
    });
    expect(await f.t.mutation(internal.transcriptDigests.freezeFactsSource, { generationId, transcriptId: f.transcriptId })).toBeNull();
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const runs = await f.t.run((ctx) => ctx.db.query("transcriptFactRuns").collect());
    expect(runs.map((row) => [row.status, row.parserVersion])).toEqual([
      ["ready", transcript.parserVersion],
      ["ready", "rebuilt"],
    ]);
    expect(await f.t.mutation(internal.transcriptDigests.freezeFactsSource, { generationId, transcriptId: f.transcriptId })).not.toBeNull();
  });

  it("does nothing while the transcript method is off", async () => {
    const f = await setup("off");
    const fetchMock = vi.fn(async () => factsResponse());
    vi.stubGlobal("fetch", fetchMock);
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await factsOf(f.t, f.transcriptId)).toEqual([]);
  });

  it("records a failure and writes no facts", async () => {
    const f = await setup("all");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await factsOf(f.t, f.transcriptId)).toEqual([]);
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list[0].factsStatus).toBe("failed");
  });

  it("copies ready facts to the same text in another project with no model call", async () => {
    const f = await setup("long");
    vi.stubGlobal("fetch", vi.fn(async () => factsResponse()));
    await f.writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: f.transcriptId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const fetchMock = vi.fn(() => { throw new Error("no call expected"); });
    vi.stubGlobal("fetch", fetchMock);
    const otherProjectId = await f.t.run((ctx) =>
      ctx.db.insert("projects", {
        title: "Helios copy",
        clientName: "Verdant Grid",
        status: "draft",
        createdBy: f.writerId,
        shareToken: "ff-token-2",
        createdAt: 1,
        updatedAt: 1,
        interviewer: "Dana Whitfield",
        interviewees: ["Priya Shah"],
      })
    );
    const copyId = await f.writer.mutation(api.transcripts.addTranscript, { projectId: otherProjectId, content: CONTENT });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();
    const copied = await factsOf(f.t, copyId);
    expect(copied.map((fact) => [fact.key, fact.claim])).toEqual(
      (await factsOf(f.t, f.transcriptId)).map((fact) => [fact.key, fact.claim])
    );
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: otherProjectId });
    expect(list[0].factsStatus).toBe("ready");
  });

  it("an interrupted run can be claimed again once stale", async () => {
    const f = await setup("long");
    const claim = await f.t.mutation(internal.transcripts.claimFactRun, {
      transcriptId: f.transcriptId,
      sourceContentHash: await sha256(CONTENT),
      model: "claude-sonnet-5",
      adapter: "citations",
    });
    expect(claim.kind).toBe("claimed");
    const busy = await f.t.mutation(internal.transcripts.claimFactRun, {
      transcriptId: f.transcriptId,
      sourceContentHash: await sha256(CONTENT),
      model: "claude-sonnet-5",
      adapter: "citations",
    });
    expect(busy.kind).toBe("busy");
    vi.advanceTimersByTime(21 * 60_000);
    const again = await f.t.mutation(internal.transcripts.claimFactRun, {
      transcriptId: f.transcriptId,
      sourceContentHash: await sha256(CONTENT),
      model: "claude-sonnet-5",
      adapter: "citations",
    });
    expect(again.kind).toBe("claimed");
  });
});

describe("the speaker roles prompt is pinned", () => {
  /** 2026-09-24: first version (phase 3, the transcript method). */
  it("hashes the prompt, schema and request", async () => {
    const hash = await sha256(
      [SPEAKER_ROLES_SYSTEM_PROMPT, JSON.stringify(SPEAKER_ROLES_SCHEMA), JSON.stringify(SPEAKER_ROLES_REQUEST)].join("\n---\n")
    );
    expect(hash).toBe("ff6987389506716e11dae27fd8bbb2b1c94f95af84fba097eb77a80e7c0dc008");
  });
});
