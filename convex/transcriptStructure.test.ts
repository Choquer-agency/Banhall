/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { MAX_TURN_CHARS, TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { FROZEN_TRANSCRIPT_CHARS, STRUCTURE_BUILD_STALE_MS, newStructureBuildId } from "./lib/transcripts";
import { factRunIsCurrent } from "./lib/transcriptFactRows";
import { FACTS_VERSION } from "./lib/transcriptFacts";
import { sha256 } from "./lib/contracts";
import { TURN_BATCH_SIZE } from "./lib/transcriptStructure";
import { MODEL_ROLE_THRESHOLD, inferSpeakerRoles, labelNamesPerson, needsModelRole } from "./lib/transcriptSpeakers";
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

async function setup(
  contents: string[],
  project: { interviewer?: string; interviewees?: string[] } = {},
  options: { limits?: boolean } = {}
) {
  // `limits` makes convex-test enforce the per-transaction limits.
  const t = options.limits
    ? convexTest({ schema, modules, transactionLimits: true })
    : convexTest(schema, modules);
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
    return { writerId, projectId };
  });
  // One transaction per row, so large legacy rows fit the write limit.
  const transcriptIds: Id<"transcripts">[] = [];
  for (const [position, content] of contents.entries()) {
    transcriptIds.push(
      await t.run((ctx) =>
        ctx.db.insert("transcripts", { projectId: ids.projectId, content, createdAt: position, position })
      )
    );
  }
  return { t, ...ids, transcriptIds };
}

/** A row written before the per-transcript cap: no blank line, no speaker. */
function legacyRow(tag: number, length = 900_000): string {
  return `Legacy notes ${tag}. `.repeat(Math.ceil(length / 17)).slice(0, length);
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

  it("builds a row longer than the frozen slice into small turns inside that slice", async () => {
    const f = await setup([legacyRow(1)], {}, { limits: true });
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const turns = await turnsOf(f.t, f.transcriptIds[0]);
    expect(turns.length).toBeGreaterThan(1);
    for (const turn of turns) {
      expect(turn.charEnd).toBeLessThanOrEqual(FROZEN_TRANSCRIPT_CHARS);
      expect(turn.cleanText.length).toBeLessThanOrEqual(MAX_TURN_CHARS);
    }
    expect(turns[turns.length - 1].charEnd).toBeGreaterThan(FROZEN_TRANSCRIPT_CHARS - MAX_TURN_CHARS);
    expect((await f.t.run((ctx) => ctx.db.get(f.transcriptIds[0])))?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
  });

  it("backfills pages of large rows inside the read limit", async () => {
    // Twenty rows of 900,000 characters: one page of twenty would read
    // about 18 MB, over the 16 MiB a transaction may read.
    const f = await setup(
      Array.from({ length: 20 }, (_, i) => legacyRow(i)),
      {},
      { limits: true }
    );
    await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of f.transcriptIds) {
      // One row per read: twenty of them would pass the read limit here too.
      expect((await f.t.run((ctx) => ctx.db.get(id)))?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
    }
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

  /**
   * As if an older parser had built the transcript with these speaker rows
   * (review 2026-09-25, P2-1): the turns are marked old and the rows replaced.
   */
  async function asBuiltByOlderParser(
    f: Awaited<ReturnType<typeof setup>>,
    rows: Array<{ label: string; role: "interviewer" | "client" | "other"; roleSource: "consultant" | "model" | "heuristic"; confidence: number }>
  ) {
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    await f.t.run(async (ctx) => {
      for (const row of await ctx.db
        .query("transcriptSpeakers")
        .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", f.transcriptIds[0]))
        .collect()) {
        await ctx.db.delete(row._id);
      }
      for (const row of rows) {
        await ctx.db.insert("transcriptSpeakers", {
          transcriptId: f.transcriptIds[0],
          projectId: f.projectId,
          turnCount: 1,
          ...row,
          ...(row.roleSource === "consultant" ? { confirmedBy: f.writerId, confirmedAt: 5 } : {}),
        });
      }
      await ctx.db.patch(f.transcriptIds[0], { parserVersion: "3", speakerStatus: "confirmed" });
    });
    await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    return {
      speakers: await speakersOf(f.t, f.transcriptIds[0]),
      transcript: await f.t.run((ctx) => ctx.db.get(f.transcriptIds[0])),
    };
  }

  it("carries a consultant's role on a label the new parser reads differently to the new label", async () => {
    const f = await setup([
      [
        "Dana Whitfield: What did you build?",
        "Priya Shah (Guest): A predictive controller.",
        "Dana Whitfield: What made it hard?",
        "Priya Shah (Guest): The forecast lagged.",
      ].join("\n\n"),
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      // v3 read "Priya Shah (Guest)" as "Guest"; a consultant set it and Dana.
      const { speakers, transcript } = await asBuiltByOlderParser(f, [
        { label: "Dana Whitfield", role: "interviewer", roleSource: "consultant", confidence: 1 },
        { label: "Guest", role: "client", roleSource: "consultant", confidence: 1 },
      ]);
      expect(speakers.map((row) => [row.label, row.role, row.roleSource, row.confidence, row.confirmedBy])).toEqual([
        ["Dana Whitfield", "interviewer", "consultant", 1, f.writerId],
        ["Priya Shah", "client", "consultant", 1, f.writerId],
      ]);
      expect(transcript?.speakerStatus).toBe("confirmed");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("gives each person of a label the new parser splits the old role as a guess to check", async () => {
    const f = await setup([
      [
        "Jordan Ellis (he/him): What did you test?",
        "Raj Patel (he/him): We tested four low-temperature adhesives and two held.",
        "Priya Shah (she/her): The second one held at 120C.",
      ].join("\n\n"),
    ]);
    // v3 merged Jordan and Raj into "he/him"; the model called it client.
    const { speakers, transcript } = await asBuiltByOlderParser(f, [
      { label: "he/him", role: "client", roleSource: "model", confidence: 0.8 },
      { label: "she/her", role: "client", roleSource: "consultant", confidence: 1 },
    ]);
    const byLabel = new Map(speakers.map((row) => [row.label, row]));
    // One old label, one new: kept as it was.
    expect(byLabel.get("Priya Shah")).toMatchObject({ role: "client", roleSource: "consultant", confidence: 1 });
    // One old label, two new people: the old answer, as a guess below the
    // model threshold where the rules could not place them.
    for (const label of ["Jordan Ellis", "Raj Patel"]) {
      expect(byLabel.get(label), label).toMatchObject({ role: "client", roleSource: "heuristic", confidence: 0.6 });
    }
    expect(transcript?.speakerStatus).toBe("needs_check");
  });

  it("keeps a new rule's confident role over a split old role", async () => {
    const f = await setup(
      [
        [
          "Jordan Ellis (he/him): What did you test?",
          "Raj Patel (he/him): We tested four low-temperature adhesives and two held.",
        ].join("\n\n"),
      ],
      { interviewer: "Jordan Ellis", interviewees: ["Raj Patel"] }
    );
    const { speakers } = await asBuiltByOlderParser(f, [
      { label: "he/him", role: "interviewer", roleSource: "consultant", confidence: 1 },
    ]);
    expect(speakers.map((row) => [row.label, row.role, row.roleSource])).toEqual([
      ["Jordan Ellis", "interviewer", "heuristic"],
      ["Raj Patel", "client", "heuristic"],
    ]);
  });

  it("marks the transcript for a speaker check when a consultant's role has no label left to go to", async () => {
    const f = await setup([INTERVIEW]);
    const { speakers, transcript } = await asBuiltByOlderParser(f, [
      { label: "Dana Whitfield", role: "interviewer", roleSource: "consultant", confidence: 1 },
      { label: "Priya Shah", role: "client", roleSource: "consultant", confidence: 1 },
      // A heading an older parser read as a speaker.
      { label: "Result", role: "client", roleSource: "consultant", confidence: 1 },
    ]);
    expect(speakers.map((row) => row.label)).toEqual(["Dana Whitfield", "Priya Shah"]);
    expect(speakers.every((row) => row.roleSource === "consultant")).toBe(true);
    expect(transcript?.speakerStatus).toBe("needs_check");
  });

  it("skips a project that is being deleted", async () => {
    const f = await setup([INTERVIEW]);
    await f.t.run(async (ctx) => ctx.db.patch(f.projectId, { deletionStartedAt: Date.now() }));
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    expect(await turnsOf(f.t, f.transcriptIds[0])).toEqual([]);
  });
});

describe("cue renders and other transcripts", () => {
  const CUE_TEXT = "Priya Shah [00:00:01]: We built a rig.\n\n[00:00:03] We tested two options: the first failed.";

  it("gives an unnamed cue its own turn only when the row came from VTT, SRT or a cue-timed Teams export", async () => {
    const f = await setup([CUE_TEXT, CUE_TEXT, CUE_TEXT]);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.transcriptIds[0], { sourceFormat: "vtt" });
      await ctx.db.patch(f.transcriptIds[1], { sourceFormat: "teams_docx" });
      await ctx.db.patch(f.transcriptIds[2], { sourceFormat: "paste" });
    });
    await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of f.transcriptIds.slice(0, 2)) {
      expect((await turnsOf(f.t, id)).map((turn) => [turn.speakerLabel, turn.startMs])).toEqual([
        ["Priya Shah", 1_000],
        [undefined, 3_000],
      ]);
    }
    // Pasted text: the timestamped paragraph continues Priya's turn.
    const pasted = await turnsOf(f.t, f.transcriptIds[2]);
    expect(pasted.map((turn) => turn.speakerLabel)).toEqual(["Priya Shah"]);
    expect(CUE_TEXT.slice(pasted[0].charStart, pasted[0].charEnd)).toBe(
      "We built a rig.\n\n[00:00:03] We tested two options: the first failed."
    );
  });
});

describe("the model's look at speakers after a takeover", () => {
  const UNPLACED = Array.from({ length: 900 }, (_, i) =>
    i % 2 === 0 ? `Speaker 1: Question number ${i}?` : `Speaker 2: Answer number ${i} about the rig and the feeder.`
  ).join("\n");

  async function classifyJobs(t: Awaited<ReturnType<typeof setup>>["t"]) {
    return (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((job) =>
      job.name.includes("classifySpeakerRoles")
    );
  }

  it("the backfill leaves an upload's build alone, and a chain that takes it over still asks the model", async () => {
    const f = await setup([]);
    const writer = f.t.withIdentity({ subject: "ts-writer" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    try {
      const id = await writer.mutation(api.transcripts.addTranscript, { projectId: f.projectId, content: UNPLACED });
      // The upload's chain writes its first batch.
      vi.runOnlyPendingTimers();
      await f.t.finishInProgressScheduledFunctions();
      expect((await turnsOf(f.t, id)).length).toBe(TURN_BATCH_SIZE);
      // The backfill does not start a second chain for a row a build holds.
      expect((await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {})).scheduled).toBe(0);
      // A chain that asks nothing of the model takes the build over anyway.
      await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: id });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await classifyJobs(f.t)).toHaveLength(1);
      const row = await f.t.run((ctx) => ctx.db.get(id));
      expect(row?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
      expect(row?.structureModelRoles).toBeUndefined();
      expect(row?.structureBuildId).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a rule-only rebuild never asks the model", async () => {
    const f = await setup([UNPLACED]);
    await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {});
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await classifyJobs(f.t)).toHaveLength(0);
  });
});

describe("turns an older parser built", () => {
  async function olderParserRow() {
    const f = await setup([INTERVIEW]);
    const id = f.transcriptIds[0];
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: id });
    // As if parser version 1 had built them.
    await f.t.run(async (ctx) => {
      await ctx.db.patch(id, { parserVersion: "1" });
      for (const turn of await ctx.db
        .query("transcriptTurns")
        .withIndex("by_transcriptId_and_index", (q) => q.eq("transcriptId", id))
        .collect()) {
        await ctx.db.patch(turn._id, { parserVersion: "1" });
      }
      await ctx.db.insert("appSettings", {
        key: "transcripts.factsMode",
        value: "long",
        updatedBy: f.writerId,
        updatedAt: 1,
      });
    });
    return { f, id };
  }

  async function buildJobs(t: Awaited<ReturnType<typeof setup>>["t"]) {
    return (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
      (job) => job.name.includes("buildTranscriptStructure") && job.state.kind === "pending"
    );
  }

  it("are not ready for facts, and a facts request rebuilds them once", async () => {
    const { f, id } = await olderParserRow();
    expect((await f.t.query(internal.transcripts.factsInput, { transcriptId: id }))?.structureReady).toBe(false);
    const writer = f.t.withIdentity({ subject: "ts-writer" });
    await writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: id });
    await writer.mutation(api.transcripts.requestTranscriptFacts, { transcriptId: id });
    expect(await buildJobs(f.t)).toHaveLength(1);
    // No extraction is queued for turns that are not ready.
    const extractions = (await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter(
      (job) => job.name.includes("extractTranscriptFactsInBackground")
    );
    expect(extractions).toHaveLength(0);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const input = await f.t.query(internal.transcripts.factsInput, { transcriptId: id });
    expect(input?.structureReady).toBe(true);
    expect(input?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);
  });

  it("are rebuilt by the backfill once, and again only when their build stopped long ago", async () => {
    const { f, id } = await olderParserRow();
    expect((await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {})).scheduled).toBe(1);
    expect((await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {})).scheduled).toBe(0);
    // A build that never finished stops holding the row after a while.
    await f.t.run((ctx) =>
      ctx.db.patch(id, { structureBuildId: newStructureBuildId(Date.now() - STRUCTURE_BUILD_STALE_MS - 1) })
    );
    expect((await f.t.mutation(internal.transcripts.backfillTranscriptStructure, {})).scheduled).toBe(1);
  });

  it("make a ready fact run drawn from them stale", async () => {
    const { f, id } = await olderParserRow();
    const current = await f.t.run(async (ctx) => {
      const runId = await ctx.db.insert("transcriptFactRuns", {
        transcriptId: id,
        projectId: f.projectId,
        sourceContentHash: await sha256(INTERVIEW),
        factsVersion: FACTS_VERSION,
        model: "model",
        adapter: "structured",
        status: "ready",
        counts: { proposed: 0, verified: 0, dropped: 0 },
        startedAt: 1,
        parserVersion: "1",
      });
      return await factRunIsCurrent(ctx, (await ctx.db.get(runId))!);
    });
    expect(current).toBe(false);
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

  it("never places a client at the threshold for sharing a first name with someone on the roster (review 2026-09-25)", () => {
    const client = parseTranscriptTurns(
      [
        "Jordan Ellis: What did you set out to build?",
        "Dana: A predictive controller for feeder voltage, which we tested on two feeders over the summer.",
        "Jordan Ellis: What made that hard?",
        "Dana: We could not forecast net load fast enough when cloud cover changed during the afternoon.",
      ].join("\n\n")
    );
    const roles = (context: Parameters<typeof inferSpeakerRoles>[1]) =>
      inferSpeakerRoles(client, context).map((g) => [g.label, g.role, g.confidence]);
    // No interviewees on the project, and staff member Dana Whitfield on the roster.
    const rosterOnly = roles({ staffNames: [], clientNames: [], rosterNames: ["Dana Whitfield"] });
    expect(rosterOnly).toEqual([
      ["Jordan Ellis", "interviewer", 0.6],
      ["Dana", "client", 0.55],
    ]);
    // The project's own interviewer is matched first; Dana is the other speaker.
    expect(roles({ staffNames: ["Jordan Ellis"], clientNames: [], rosterNames: ["Dana Whitfield", "Jordan Ellis"] })).toEqual([
      ["Jordan Ellis", "interviewer", 0.95],
      ["Dana", "client", 0.75],
    ]);
    // A full name on the roster alone places Jordan too.
    expect(roles({ staffNames: [], clientNames: [], rosterNames: ["Dana Whitfield", "Jordan Ellis"] })[0]).toEqual([
      "Jordan Ellis",
      "interviewer",
      0.95,
    ]);
    // The project's interviewees come before the roster.
    expect(roles({ staffNames: [], clientNames: ["Dana Rao"], rosterNames: ["Dana Whitfield"] })[1]).toEqual([
      "Dana",
      "client",
      0.95,
    ]);

    // A staff member who is named only by a first name still leans interviewer, below the threshold.
    const staff = parseTranscriptTurns(
      "Dana: What did you build?\n\nPriya Shah: A controller.\n\nDana: Why?\n\nPriya Shah: The load moved."
    );
    const staffGuess = inferSpeakerRoles(staff, { staffNames: [], clientNames: [], rosterNames: ["Dana Whitfield"] })[0];
    expect(staffGuess.role).toBe("interviewer");
    expect(staffGuess.confidence).toBeLessThan(MODEL_ROLE_THRESHOLD);
    expect(needsModelRole(staffGuess)).toBe(true);
    // With the full name on the label, the roster places them outright.
    const fullStaff = parseTranscriptTurns("Dana Whitfield: What did you build?\n\nPriya Shah: A controller.");
    expect(inferSpeakerRoles(fullStaff, { staffNames: [], clientNames: [], rosterNames: ["Dana Whitfield"] })[0]).toMatchObject({
      role: "interviewer",
      confidence: 0.95,
    });
  });

  it("places a speaker from the roster outright only when the label holds the whole name (fix-e review P2-1)", () => {
    const interview = (client: string) =>
      parseTranscriptTurns(
        [
          "Jordan: What did you set out to build?",
          `${client}: A predictive controller for feeder voltage, which we tested on two feeders over the summer.`,
          "Jordan: What made that hard?",
          `${client}: We could not forecast net load fast enough when cloud cover changed during the afternoon.`,
        ].join("\n\n")
      );
    const roles = (client: string, rosterNames: string[]) =>
      inferSpeakerRoles(interview(client), { staffNames: [], clientNames: [], rosterNames }).map((g) => [
        g.label,
        g.role,
        g.confidence,
      ]);
    // A compound first name, a one-word roster name, a roster initial, and a
    // bracketed company after a one-word roster name: never a full name, so
    // the client is at most a first-name lean and nobody is placed at the
    // threshold on the roster match.
    for (const [client, roster] of [
      ["Jean-Philippe", "Jean-Philippe Roy"],
      ["Mary Anne", "Mary Anne Smith"],
      ["Dana Rao", "Dana"],
      ["Dana Rao", "Dana W."],
      ["Dana (Acme)", "Dana"],
    ] as const) {
      const guesses = roles(client, [roster]);
      const label = client.replace(/\s*\(.*\)$/, "");
      expect(guesses.map(([name]) => name), `${client} / ${roster}`).toEqual(["Jordan", label]);
      for (const [name, role, confidence] of guesses) {
        expect(
          role === "unknown" || (confidence as number) < MODEL_ROLE_THRESHOLD,
          `${name} placed ${role} at ${confidence} (${client} / ${roster})`
        ).toBe(true);
      }
    }
    // The whole two-part name on the label, however it is written, still places the speaker outright.
    for (const label of ["Jean-Philippe Roy", "Roy, Jean-Philippe", "Jean-Philippe ROY", "Dr. Jean-Philippe Roy"]) {
      expect(roles(label, ["Jean-Philippe Roy"])[1], label).toEqual([
        expect.any(String),
        "interviewer",
        0.95,
      ]);
    }
    expect(roles("Dana Whitfield", ["Dana Whitfield"])[1]).toEqual(["Dana Whitfield", "interviewer", 0.95]);
  });

  it("builds a client named like a roster member as a client whose words stay evidence", async () => {
    const content = [
      "Jordan Ellis: What did you set out to build?",
      "Dana: A predictive controller for feeder voltage, which we tested on two feeders over the summer.",
      "Jordan Ellis: What made that hard?",
      "Dana: We could not forecast net load fast enough when cloud cover changed during the afternoon.",
    ].join("\n\n");
    const f = await setup([content]);
    await f.t.run((ctx) =>
      ctx.db.insert("users", { authId: "ts-dana", role: "writer", firstName: "Dana", lastName: "Whitfield" })
    );
    await f.t.mutation(internal.transcripts.buildTranscriptStructure, { transcriptId: f.transcriptIds[0] });
    const rows = await f.t.run((ctx) =>
      ctx.db
        .query("transcriptSpeakers")
        .withIndex("by_transcriptId_and_label", (q) => q.eq("transcriptId", f.transcriptIds[0]))
        .collect()
    );
    const dana = rows.find((row) => row.label === "Dana");
    expect(dana?.role).not.toBe("interviewer");
    expect(dana?.confidence ?? 0).toBeLessThan(MODEL_ROLE_THRESHOLD);
  });

  it("matches a first name against a full name", () => {
    expect(labelNamesPerson("Dana", "Dana Whitfield")).toBe(true);
    expect(labelNamesPerson("Dan", "Dana Whitfield")).toBe(false);
  });
});
