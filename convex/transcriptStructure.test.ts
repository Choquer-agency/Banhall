/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { TURN_BATCH_SIZE } from "./lib/transcriptStructure";
import { inferSpeakerRoles, labelNamesPerson } from "./lib/transcriptSpeakers";
import { parseTranscriptTurns } from "../shared/transcriptParse";

const modules = import.meta.glob("./**/*.ts");

const INTERVIEW = [
  "Dana Whitfield: Thanks for joining. What did you set out to build?",
  "Priya Shah: A predictive controller for feeder voltage.",
  "Dana Whitfield: What made that hard?",
  "Priya Shah: We could not forecast net load fast enough when cloud cover changed.",
].join("\n\n");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup(contents: string[], project: { interviewer?: string; interviewees?: string[] } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "ts-writer", role: "writer", firstName: "Wren" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid",
      status: "draft",
      createdBy: writerId,
      shareToken: "ts-token",
      createdAt: now,
      updatedAt: now,
      ...project,
    });
    const transcriptIds: Id<"transcripts">[] = [];
    for (const [position, content] of contents.entries()) {
      transcriptIds.push(
        await ctx.db.insert("transcripts", { projectId, content, createdAt: now + position, position })
      );
    }
    return { writerId, projectId, transcriptIds };
  });
  return { t, ...ids };
}

async function turnsOf(t: Awaited<ReturnType<typeof setup>>["t"], transcriptId: Id<"transcripts">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("transcriptTurns")
      .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", transcriptId))
      .collect()
  );
}

async function speakersOf(t: Awaited<ReturnType<typeof setup>>["t"], transcriptId: Id<"transcripts">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("transcriptSpeakers")
      .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", transcriptId))
      .collect()
  );
}

describe("backfill of turns and speaker roles", () => {
  it("parses legacy rows into turns whose spans slice the stored text, with no model call", async () => {
    const f = await setup([INTERVIEW, "Just notes.\n\nSecond paragraph."], {
      interviewer: "Dana Whitfield",
      interviewees: ["Priya Shah"],
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    const turns = await turnsOf(f.t, f.transcriptIds[0]);
    expect(turns.map((turn) => turn.speakerLabel)).toEqual([
      "Dana Whitfield",
      "Priya Shah",
      "Dana Whitfield",
      "Priya Shah",
    ]);
    for (const turn of turns) {
      expect(turn.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
      expect(INTERVIEW.slice(turn.charStart, turn.charEnd).length).toBeGreaterThan(0);
    }
    expect(INTERVIEW.slice(turns[1].charStart, turns[1].charEnd)).toBe(
      "A predictive controller for feeder voltage."
    );

    const speakers = await speakersOf(f.t, f.transcriptIds[0]);
    expect(speakers.map((row) => [row.label, row.role, row.roleSource])).toEqual([
      ["Dana Whitfield", "interviewer", "heuristic"],
      ["Priya Shah", "client", "heuristic"],
    ]);
    const rows = await f.t.run(async (ctx) => Promise.all(f.transcriptIds.map((id) => ctx.db.get(id))));
    expect(rows[0]?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
    expect(rows[0]?.speakerStatus).toBe("needs_check");
    // Paragraph notes name no one: nothing to check.
    expect(rows[1]?.speakerStatus).toBe("unchecked");
    expect((await turnsOf(f.t, f.transcriptIds[1])).map((turn) => turn.speakerLabel)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("is idempotent: a second run writes nothing new", async () => {
    const f = await setup([INTERVIEW]);
    await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const first = await turnsOf(f.t, f.transcriptIds[0]);
    const again = await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(again.scheduled).toBe(0);
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    const second = await turnsOf(f.t, f.transcriptIds[0]);
    expect(second.map((turn) => turn._id)).toEqual(first.map((turn) => turn._id));
  });

  it("writes a long transcript in bounded batches and converges after a partial run", async () => {
    const lines = Array.from({ length: TURN_BATCH_SIZE * 2 + 17 }, (_, i) =>
      `${i % 2 === 0 ? "Dana" : "Priya"}: Turn number ${i}.`
    ).join("\n");
    const f = await setup([lines]);
    // One step only: the first batch is written, the rest is scheduled.
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    expect((await turnsOf(f.t, f.transcriptIds[0])).length).toBe(TURN_BATCH_SIZE);
    // Replaying a step of the same chain inserts only what is missing.
    const buildId = (await f.t.run((ctx) => ctx.db.get(f.transcriptIds[0])))?.structureBuildId;
    expect(buildId).toBeTypeOf("string");
    for (let replay = 0; replay < 2; replay += 1) {
      await f.t.mutation(internal.transcripts.buildTranscriptStructure, {
        transcriptId: f.transcriptIds[0],
        fromIndex: TURN_BATCH_SIZE,
        buildId,
      });
    }
    expect((await turnsOf(f.t, f.transcriptIds[0])).length).toBe(TURN_BATCH_SIZE * 2);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const turns = await turnsOf(f.t, f.transcriptIds[0]);
    expect(turns.length).toBe(TURN_BATCH_SIZE * 2 + 17);
    expect(new Set(turns.map((turn) => turn.index)).size).toBe(turns.length);
  });

  it("never marks a transcript current with turns missing when two build chains overlap", async () => {
    // 900 turns: more than one delete batch (500) and three insert batches.
    const total = 900;
    const lines = Array.from({ length: total }, (_, i) => `${i % 2 === 0 ? "Dana" : "Priya"}: Turn number ${i}.`).join(
      "\n"
    );
    const f = await setup([lines]);
    const id = f.transcriptIds[0];
    // Chain A (an upload) writes turns 0 to 399, then 400 to 799.
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: id });
    vi.runOnlyPendingTimers();
    await f.t.finishInProgressScheduledFunctions();
    expect((await turnsOf(f.t, id)).length).toBe(TURN_BATCH_SIZE * 2);
    // Chain B (the backfill, run while A is still going) starts from zero.
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: id });
    // Both chains run to the end, interleaved.
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const turns = await turnsOf(f.t, id);
    const row = await f.t.run((ctx) => ctx.db.get(id));
    expect(row?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
    expect(row?.structureBuildId).toBeUndefined();
    expect(turns.length).toBe(total);
    expect(turns.map((turn) => turn.index)).toEqual(Array.from({ length: total }, (_, i) => i));
  });

  it("stops a chain whose build another chain took over, without writing", async () => {
    const lines = Array.from({ length: 450 }, (_, i) => `${i % 2 === 0 ? "Dana" : "Priya"}: Turn ${i}.`).join("\n");
    const f = await setup([lines]);
    const id = f.transcriptIds[0];
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: id });
    const first = (await f.t.run((ctx) => ctx.db.get(id)))?.structureBuildId;
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: id });
    const second = (await f.t.run((ctx) => ctx.db.get(id)))?.structureBuildId;
    expect(second).not.toBe(first);
    const before = (await turnsOf(f.t, id)).map((turn) => turn._id);
    // The first chain's next step finds the other chain's id and stops.
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, {
      transcriptId: id,
      fromIndex: TURN_BATCH_SIZE,
      buildId: first,
    });
    expect((await turnsOf(f.t, id)).map((turn) => turn._id)).toEqual(before);
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.parserVersion).toBeUndefined();
  });

  it("converges when the backfill runs twice over a long transcript", async () => {
    const total = 1_234;
    const lines = Array.from({ length: total }, (_, i) => `${i % 2 === 0 ? "Dana" : "Priya"}: Turn ${i}.`).join("\n");
    const f = await setup([lines]);
    await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
    vi.runOnlyPendingTimers();
    await f.t.finishInProgressScheduledFunctions();
    await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const turns = await turnsOf(f.t, f.transcriptIds[0]);
    expect(turns.map((turn) => turn.index)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect((await f.t.run((ctx) => ctx.db.get(f.transcriptIds[0])))?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
  });

  it("keeps a consultant's role through a parser rebuild", async () => {
    const f = await setup([INTERVIEW]);
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    await f.t.run(async (ctx) => {
      const rows = await ctx.db
        .query("transcriptSpeakers")
        .withIndex("by_transcriptId_and_label", (q) =>
          q.eq("transcriptId", f.transcriptIds[0]).eq("label", "Priya Shah")
        )
        .collect();
      await ctx.db.patch(rows[0]._id, { role: "other", roleSource: "consultant" });
      await ctx.db.patch(f.transcriptIds[0], { parserVersion: "0" });
    });
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const speakers = await speakersOf(f.t, f.transcriptIds[0]);
    expect(speakers.find((row) => row.label === "Priya Shah")).toMatchObject({
      role: "other",
      roleSource: "consultant",
    });
    expect((await turnsOf(f.t, f.transcriptIds[0])).length).toBe(4);
  });

  it("skips a project that is being deleted", async () => {
    const f = await setup([INTERVIEW]);
    await f.t.run(async (ctx) => ctx.db.patch(f.projectId, { deletionStartedAt: Date.now() }));
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    expect(await turnsOf(f.t, f.transcriptIds[0])).toEqual([]);
  });
});

describe("speaker role rules", () => {
  const turns = parseTranscriptTurns(INTERVIEW);

  it("places names from the project record and the roster first", () => {
    expect(
      inferSpeakerRoles(turns, { staffNames: ["Dana Whitfield"], clientNames: [] }).map((g) => [g.label, g.role, g.confidence])
    ).toEqual([
      ["Dana Whitfield", "interviewer", 0.95],
      ["Priya Shah", "client", 0.75],
    ]);
  });

  it("reads label hints such as Interviewer (Dana)", () => {
    const hinted = parseTranscriptTurns(
      "Interviewer (Dana): What did you try?\n\nSubject (Marcus Lindqvist, CTO): A test rig."
    );
    expect(inferSpeakerRoles(hinted, { staffNames: [], clientNames: [] }).map((g) => [g.label, g.role])).toEqual([
      ["Dana", "interviewer"],
      ["Marcus Lindqvist", "client"],
    ]);
  });

  it("falls back to question share and talk share, with low confidence", () => {
    const guesses = inferSpeakerRoles(turns, { staffNames: [], clientNames: [] });
    expect(guesses.map((g) => g.role)).toEqual(["interviewer", "client"]);
    expect(guesses.every((g) => g.confidence < 0.7)).toBe(true);
  });

  it("matches a first name against a full name", () => {
    expect(labelNamesPerson("Dana", "Dana Whitfield")).toBe(true);
    expect(labelNamesPerson("Dan", "Dana Whitfield")).toBe(false);
  });
});
