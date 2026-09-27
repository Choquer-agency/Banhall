/// <reference types="vite/client" />
/**
 * Brief preparation, stage 2 (decision 65, the tenth amendment): the
 * private New project intake draft. Authorization, the masking gate, the
 * saved-while-typing preparation, promotion (idempotent, resumable, with
 * an exact source-key mapping) and adoption by the promoted project's run,
 * key hits and misses across intake edits and start-dialog leave-outs,
 * retention (discard, idle and absolute expiry), usage counted once, the
 * request at the SDK's HTTP boundary, and the Duplicate copy receipt.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { anthropicToolSse, sseResponse } from "./anthropicSse.fixture";
import { BRIEF_REQUEST } from "./lib/briefRequest";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";
import { INTAKE_DEBOUNCE_MS, INTAKE_IDLE_MS, INTAKE_LIFETIME_MS } from "./lib/intakeDrafts";
import { deriveOrAdoptSeedBrief, deriveOrReuseBrief } from "./ai/brief";
import { clientForStep, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { resolveGenerationStep } from "./lib/generationSteps";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";

const modules = import.meta.glob("./**/*.ts");

const TRANSCRIPT = [
  "Interviewer: What did you try first?",
  "",
  "Priya Raman: We replaced the silicone gasket with a fluoropolymer seal because the silicone cracked at minus 30 degrees during the cold soak test.",
  "",
  "Interviewer: Did that work?",
  "",
  "Priya Raman: The fluoropolymer seal held for 400 cycles without leaking, which nobody at the plant had managed before.",
].join("\n");
const UNCERTAIN = [
  "Speaker 1: What did you try first?",
  "",
  "Speaker 2: We replaced the silicone gasket with a fluoropolymer seal because the silicone cracked at minus 30 degrees during the cold soak test.",
].join("\n");
const DOCUMENT = "Cold soak log: fluoropolymer seal, 400 cycles at minus 30 degrees, no leak.";

const PROVIDER_BRIEF = {
  storyline: "The team replaced a cracking silicone gasket with a fluoropolymer seal that held at minus 30 degrees.",
  storylineClaims: [
    {
      text: "The silicone gasket failed in the cold soak test.",
      quote: "the silicone cracked at minus 30 degrees during the cold soak test",
    },
  ],
  claimExclusions: [],
  confidenceMap: [
    {
      text: "The fluoropolymer seal held for 400 cycles.",
      quote: "The fluoropolymer seal held for 400 cycles without leaking",
      confidence: "established",
    },
  ],
  glossaryTerms: [{ term: "fluoropolymer seal" }],
};

type Sent = { url: string; body: Record<string, unknown> };
const briefRequests: Sent[] = [];
const speakerRequests: Sent[] = [];

function stubProvider() {
  briefRequests.length = 0;
  speakerRequests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = (await request.json()) as Record<string, unknown>;
      const tools = (body.tools as Array<{ name: string }> | undefined) ?? [];
      if (tools.some((tool) => tool.name === "record_speaker_roles")) {
        speakerRequests.push({ url: request.url, body });
        return Response.json({
          id: "msg_speakers",
          type: "message",
          role: "assistant",
          model: String(body.model),
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "record_speaker_roles",
              input: {
                speakers: [
                  { label: "Speaker 1", role: "interviewer", confidence: 0.9 },
                  { label: "Speaker 2", role: "client", confidence: 0.9 },
                ],
              },
            },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 400, output_tokens: 40 },
        });
      }
      briefRequests.push({ url: request.url, body });
      return sseResponse(
        anthropicToolSse({
          model: String(body.model),
          tool: BRIEF_REQUEST.toolName,
          input: PROVIDER_BRIEF,
          usage: { input_tokens: 1200, output_tokens: 300 },
        })
      );
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-intake-key");
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  stubProvider();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof convexTest<typeof schema.tables>>;

function inAction<R>(t: T, fn: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  const run = t.action as unknown as (handler: (ctx: ActionCtx) => Promise<R>) => Promise<R>;
  return run.call(t, fn);
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "intake-writer", role: "writer", name: "Wren Writer" });
    const outsiderId = await ctx.db.insert("users", { authId: "intake-outsider", role: "manager", name: "Olly Outsider" });
    const readerId = await ctx.db.insert("users", { authId: "intake-reader", name: "Rhea Reader" });
    return { userId, outsiderId, readerId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "intake-writer" }),
    outsider: t.withIdentity({ subject: "intake-outsider" }),
    reader: t.withIdentity({ subject: "intake-reader" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Runs what is due over the next few debounces, step by step. */
async function settle(s: Setup, steps = 6) {
  for (let step = 0; step < steps; step += 1) {
    vi.advanceTimersByTime(INTAKE_DEBOUNCE_MS + 100);
    await s.t.finishInProgressScheduledFunctions();
  }
}

async function saveTranscript(
  s: Setup,
  draftId: Id<"intakeDrafts">,
  sourceKey: string,
  content = TRANSCRIPT,
  position = 0,
  label = "Interview"
) {
  await s.writer.mutation(intakeDraftRefs.saveIntakeSource, {
    draftId, sourceKey, kind: "transcript", position, label, content, sourceFormat: "txt",
  });
}

async function saveDocument(s: Setup, draftId: Id<"intakeDrafts">, sourceKey: string, fileName = "cold-soak.txt", content = DOCUMENT, position = 1000) {
  await s.writer.mutation(intakeDraftRefs.saveIntakeSource, {
    draftId, sourceKey, kind: "document", position, label: fileName, content, fileType: "txt",
    category: "background", intake: "file", extractionOutcome: "ok",
  });
}

async function setContext(s: Setup, draftId: Id<"intakeDrafts">, clientName = "Acme Seals") {
  await s.writer.mutation(intakeDraftRefs.updateIntakeContext, {
    draftId, clientName, interviewees: ["Priya Raman"],
  });
}

async function draftPreparations(s: Setup, draftId: Id<"intakeDrafts">): Promise<Doc<"briefPreparations">[]> {
  return await s.t.run(async (ctx) =>
    ctx.db.query("briefPreparations").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draftId)).collect()
  );
}

/** A draft with one transcript and one file, prepared. */
async function preparedDraft(s: Setup) {
  const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
  await saveTranscript(s, draftId, "transcript-key-1");
  await saveDocument(s, draftId, "document-key-1");
  await setContext(s, draftId);
  await settle(s);
  return draftId;
}

async function promote(s: Setup, draftId: Id<"intakeDrafts">, sourceKeys: string[], commandId = "command-1") {
  return await s.writer.mutation(intakeDraftRefs.promoteIntakeDraft, {
    draftId,
    commandId,
    sourceKeys,
    project: { title: "Cold seal", clientName: "Acme Seals", interviewees: ["Priya Raman"] },
  });
}

async function reserve(
  s: Setup,
  projectId: Id<"projects">,
  exclusions: { excludeDocumentIds?: Id<"projectDocuments">[]; excludeTranscriptIds?: Id<"transcripts">[] } = {}
) {
  const generationId = await s.writer.mutation(api.generations.requestGeneration, {
    projectId,
    candidateMode: "iterative",
    ...exclusions,
  });
  await s.t.run(async (ctx) => ctx.db.patch(generationId, { status: "running" }));
  return generationId;
}

function briefClient(ctx: ActionCtx, generation: Doc<"generations">) {
  const route = resolveGenerationStep({
    freeze: generation.modelFreeze ?? null,
    step: "brief",
    writerModel: generation.singleModelId!,
  });
  return {
    route,
    client: clientForStep(ctx, route, {
      callSite: "generation:brief",
      projectId: generation.projectId,
      attribution: { generationId: generation._id },
    }),
  };
}

async function adoptAtStart(s: Setup, generationId: Id<"generations">) {
  const generation = (await s.t.run(async (ctx) => ctx.db.get(generationId)))!;
  return await inAction(s.t, async (ctx) => {
    const { route, client } = briefClient(ctx, generation);
    return await deriveOrAdoptSeedBrief(ctx, client, { projectId: generation.projectId, generationId, model: route.model });
  });
}

describe("who may use a draft", () => {
  test("only the owner reads or changes a draft; a user without an active role cannot start one", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await expect(s.reader.mutation(intakeDraftRefs.createIntakeDraft, {})).rejects.toThrow();
    // Another internal user (a Manager) cannot read, change, promote or discard it.
    expect(await s.outsider.query(intakeDraftRefs.getIntakeDraft, { draftId })).toBeNull();
    await expect(
      s.outsider.mutation(intakeDraftRefs.saveIntakeSource, {
        draftId, sourceKey: "outsider-key-1", kind: "transcript", position: 1, label: "Mine", content: "Olly: Hello.",
      })
    ).rejects.toThrow(/no longer available/);
    await expect(
      s.outsider.mutation(intakeDraftRefs.promoteIntakeDraft, {
        draftId, commandId: "c", sourceKeys: ["transcript-key-1"], project: { title: "Stolen", clientName: "Acme" },
      })
    ).rejects.toThrow(/no longer available/);
    await expect(
      s.outsider.mutation(intakeDraftRefs.updateIntakeContext, { draftId, clientName: "Acme", interviewees: [] })
    ).rejects.toThrow(/no longer available/);
    await s.outsider.mutation(intakeDraftRefs.discardIntakeDraft, { draftId });
    await expect(s.reader.query(intakeDraftRefs.getIntakeDraft, { draftId })).resolves.toBeNull();
    // Still the owner's, untouched.
    const view = await s.writer.query(intakeDraftRefs.getIntakeDraft, { draftId });
    expect(view).toMatchObject({ status: "open", sources: [{ sourceKey: "transcript-key-1", kind: "transcript" }] });
    // Nothing project-shaped exists before promotion.
    expect(await s.t.run(async (ctx) => (await ctx.db.query("projects").collect()).length)).toBe(0);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("generations").collect()).length)).toBe(0);
  });
});

describe("preparing while the writer sets up", () => {
  test("no paid call before the client name exists; then the Brief is prepared once edits settle", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await saveDocument(s, draftId, "document-key-1");
    await settle(s);
    expect(briefRequests).toHaveLength(0);
    expect(await draftPreparations(s, draftId)).toHaveLength(0);
    // The turn and speaker build ran on the saved text.
    const source = await s.t.run(async (ctx) =>
      ctx.db.query("intakeSources").withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draftId).eq("sourceKey", "transcript-key-1")).unique()
    );
    expect(source?.parserVersion).toBe(TRANSCRIPT_PARSER_VERSION);

    await setContext(s, draftId);
    // The start waits 2 seconds after the last edit.
    vi.advanceTimersByTime(INTAKE_DEBOUNCE_MS - 500);
    await s.t.finishInProgressScheduledFunctions();
    expect(briefRequests).toHaveLength(0);
    await settle(s);
    const rows = await draftPreparations(s, draftId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ready", triggeredBy: s.userId });
    expect(rows[0].projectId).toBeUndefined();
    expect(briefRequests).toHaveLength(1);
    // Names were hidden from the call.
    const sent = JSON.stringify(briefRequests[0].body);
    expect(sent).not.toContain("Priya");
    expect(sent).not.toContain("Acme");
    // Counted once, attributed to the preparation and the owner, no project.
    const usage = await s.t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ callSite: "preparation:brief", briefPreparationId: rows[0]._id, userId: s.userId });
    expect(usage[0].projectId).toBeUndefined();
  });

  test("the speaker model call waits for the client name too, and the roles land before the Brief", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1", UNCERTAIN);
    await settle(s);
    const before = await s.t.run(async (ctx) =>
      ctx.db.query("intakeSources").withIndex("by_draftId_and_sourceKey", (q) => q.eq("draftId", draftId).eq("sourceKey", "transcript-key-1")).unique()
    );
    expect(before?.speakerModel).toBe("needed");
    expect(speakerRequests).toHaveLength(0);
    await s.writer.mutation(intakeDraftRefs.updateIntakeContext, { draftId, clientName: "Acme Seals", interviewees: [] });
    await settle(s, 8);
    expect(speakerRequests).toHaveLength(1);
    const speakers = await s.t.run(async (ctx) =>
      ctx.db.query("intakeSourceSpeakers").withIndex("by_draftId", (q) => q.eq("draftId", draftId)).collect()
    );
    expect(speakers.map((row) => [row.label, row.role, row.roleSource]).sort()).toEqual([
      ["Speaker 1", "interviewer", "model"],
      ["Speaker 2", "client", "model"],
    ]);
    expect(briefRequests).toHaveLength(1);
    expect((await draftPreparations(s, draftId))[0].status).toBe("ready");
  });

  test("switched off, a draft is saved but nothing is prepared or asked", async () => {
    const s = await setup();
    await s.t.run(async (ctx) =>
      ctx.db.insert("appSettings", { key: "briefPreparation.enabled", value: "off", updatedBy: s.userId, updatedAt: Date.now() })
    );
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1", UNCERTAIN);
    await setContext(s, draftId);
    await settle(s);
    expect(await draftPreparations(s, draftId)).toHaveLength(0);
    expect(briefRequests).toHaveLength(0);
    expect(speakerRequests).toHaveLength(0);
  });
});

describe("promotion and adoption", () => {
  test("confirming creates the project from the saved sources, and its run adopts the prepared Brief with no second call", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    const [prepared] = await draftPreparations(s, draftId);
    expect(prepared.status).toBe("ready");
    const receipt = await promote(s, draftId, ["transcript-key-1", "document-key-1"]);
    expect(receipt.complete).toBe(true);
    const byKey = new Map(receipt.sources.map((row) => [row.sourceKey, row]));
    const project = (await s.t.run(async (ctx) => ctx.db.get(receipt.projectId)))!;
    // Created exactly as createProject creates a project.
    expect(project).toMatchObject({ createdBy: s.userId, ownerId: s.userId, workflowStage: "intake", status: "draft" });
    const state = await s.t.run(async (ctx) => ({
      transcripts: await ctx.db.query("transcripts").withIndex("by_projectId", (q) => q.eq("projectId", receipt.projectId)).collect(),
      documents: await ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", receipt.projectId)).collect(),
      preparation: (await ctx.db.get(prepared._id))!,
      generations: await ctx.db.query("generations").collect(),
    }));
    expect(state.transcripts.map((row) => row._id)).toEqual([byKey.get("transcript-key-1")?.transcriptId]);
    expect(state.documents.map((row) => row._id)).toEqual([byKey.get("document-key-1")?.projectDocumentId]);
    expect(state.transcripts[0]).toMatchObject({ content: TRANSCRIPT, label: "Interview", parserVersion: TRANSCRIPT_PARSER_VERSION });
    expect(state.documents[0]).toMatchObject({ content: DOCUMENT, fileName: "cold-soak.txt", category: "background", uploaderRole: "writer" });
    expect(state.generations).toHaveLength(0);
    // The preparation moved to the project; its frozen rows name the project's rows.
    expect(state.preparation.projectId).toBe(receipt.projectId);

    const usageBefore = (await s.t.run(async (ctx) => ctx.db.query("aiUsage").collect())).length;
    const generationId = await reserve(s, receipt.projectId);
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    expect(briefRequests).toHaveLength(1);
    expect((await s.t.run(async (ctx) => ctx.db.query("aiUsage").collect())).length).toBe(usageBefore);
    const adopted = await s.t.run(async (ctx) => {
      const generation = (await ctx.db.get(generationId))!;
      const entries = await ctx.db.query("generationBriefEntries").withIndex("by_briefId", (q) => q.eq("briefId", generation.briefId!)).collect();
      const sources = await ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect();
      return { generation, entries, sources };
    });
    expect(adopted.generation.briefPreparation).toMatchObject({ preparationId: prepared._id, state: "adopted" });
    for (const entry of adopted.entries) {
      const source = adopted.sources.find((row) => row._id === entry.sourceId)!;
      expect(source.content.slice(entry.startOffset, entry.endOffset)).toBe(entry.exactExcerpt);
    }
  });

  test("identical text in two transcripts maps by source key, never by text", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-a", TRANSCRIPT, 0, "Morning call");
    await saveTranscript(s, draftId, "transcript-key-b", TRANSCRIPT, 1, "Afternoon call");
    await setContext(s, draftId);
    await settle(s);
    const [prepared] = await draftPreparations(s, draftId);
    expect(prepared.status).toBe("ready");
    const receipt = await promote(s, draftId, ["transcript-key-a", "transcript-key-b"]);
    const byKey = new Map(receipt.sources.map((row) => [row.sourceKey, row.transcriptId]));
    const frozen = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationSources").withIndex("by_preparationId", (q) => q.eq("preparationId", prepared._id)).collect()
    );
    // Each frozen row names the transcript its own source key became.
    for (const row of frozen) expect(row.transcriptId).toBe(byKey.get(row.sourceKey!));
    expect(new Set(frozen.map((row) => row.transcriptId)).size).toBe(2);
    const generationId = await reserve(s, receipt.projectId);
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    const cited = await s.t.run(async (ctx) => {
      const generation = (await ctx.db.get(generationId))!;
      const entries = await ctx.db.query("generationBriefEntries").withIndex("by_briefId", (q) => q.eq("briefId", generation.briefId!)).collect();
      const preparedEntries = await ctx.db.query("briefPreparationEntries").withIndex("by_preparationId", (q) => q.eq("preparationId", prepared._id)).collect();
      return {
        adopted: await Promise.all(entries.map(async (entry) => (await ctx.db.get(entry.sourceId))!.transcriptId)),
        prepared: preparedEntries.map((entry) => frozen.find((row) => row._id === entry.sourceId)!.transcriptId),
      };
    });
    // Same transcript, entry by entry: the label decides, the equal text never does.
    expect(cited.adopted.sort()).toEqual(cited.prepared.sort());
  });

  test("an intake edit makes a new preparation; the start dialog's leave-outs hit only a matching one", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    // A second file arrives after the first preparation: a new key.
    await saveDocument(s, draftId, "document-key-2", "later-notes.txt", "A later note about the seal supplier.", 1001);
    await settle(s);
    let rows = await draftPreparations(s, draftId);
    expect(rows.map((row) => row.status)).toEqual(["obsolete", "ready"]);
    // The dialog leaves the later file out: a matching preparation starts
    // while it is open.
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, { draftId, excludedSourceKeys: ["document-key-2"] });
    await settle(s);
    rows = await draftPreparations(s, draftId);
    expect(rows.map((row) => row.status)).toEqual(["obsolete", "obsolete", "ready"]);
    expect(briefRequests).toHaveLength(3);
    const receipt = await promote(s, draftId, ["transcript-key-1", "document-key-1", "document-key-2"]);
    const later = receipt.sources.find((row) => row.sourceKey === "document-key-2")!.projectDocumentId!;
    // A run with the same leave-out adopts.
    const hit = await reserve(s, receipt.projectId, { excludeDocumentIds: [later] });
    expect((await adoptAtStart(s, hit)).kind).toBe("adopted");
    expect(briefRequests).toHaveLength(3);
    // A run without it misses and derives its own.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(hit, { status: "failed" });
      await ctx.db.patch(receipt.projectId, { activeGenerationId: undefined });
    });
    const miss = await reserve(s, receipt.projectId);
    expect((await adoptAtStart(s, miss)).kind).toBe("derived");
    expect(briefRequests).toHaveLength(4);
  });

  test("a repeated confirm resumes the same project, and a large intake finishes in the background", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const long = (index: number) =>
      Array.from({ length: 8000 }, (_, line) => `${line % 2 ? "Interviewer" : "Priya Raman"}: Line ${line} of call ${index} about the cold soak rig.`).join("\n\n").slice(0, 450_000);
    const keys = ["long-key-1", "long-key-2", "long-key-3", "long-key-4"];
    for (const [index, key] of keys.entries()) await saveTranscript(s, draftId, key, long(index), index, `Call ${index + 1}`);
    const first = await promote(s, draftId, keys, "command-a");
    expect(first.complete).toBe(false);
    expect(first.sources.length).toBeGreaterThan(0);
    expect(first.sources.length).toBeLessThan(4);
    // The page retries (or a new tab confirms): the same project, finished.
    const second = await promote(s, draftId, keys, "command-b");
    expect(second.projectId).toBe(first.projectId);
    expect(second.complete).toBe(true);
    expect(second.sources.map((row) => row.sourceKey).sort()).toEqual([...keys].sort());
    const third = await promote(s, draftId, keys, "command-c");
    expect(third).toEqual(second);
    const projects = await s.t.run(async (ctx) => ctx.db.query("projects").collect());
    expect(projects).toHaveLength(1);
    const transcripts = await s.t.run(async (ctx) =>
      ctx.db.query("transcripts").withIndex("by_projectId", (q) => q.eq("projectId", first.projectId)).collect()
    );
    expect(transcripts.map((row) => row.position).sort()).toEqual([0, 1, 2, 3]);

    // A crash after the first step: the scheduled step finishes it alone.
    const other = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    for (const [index, key] of keys.entries()) await saveTranscript(s, other, key, long(index + 10), index, `Call ${index + 1}`);
    const partial = await promote(s, other, keys, "command-d");
    expect(partial.complete).toBe(false);
    await s.t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(10);
    await s.t.finishInProgressScheduledFunctions();
    const draft = await s.t.run(async (ctx) => ctx.db.get(other));
    expect(draft?.status).toBe("promoted");
    const links = await s.t.run(async (ctx) =>
      ctx.db.query("intakeSourceLinks").withIndex("by_projectId", (q) => q.eq("projectId", partial.projectId)).collect()
    );
    expect(links).toHaveLength(4);
  });

  test("a source the page no longer shows is dropped; one it lists but never saved is refused", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await saveDocument(s, draftId, "document-key-1");
    await expect(promote(s, draftId, ["transcript-key-1", "never-saved-key"])).rejects.toThrow(/not saved yet/);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("projects").collect()).length)).toBe(0);
    const receipt = await promote(s, draftId, ["transcript-key-1"]);
    expect(receipt.sources.map((row) => row.sourceKey)).toEqual(["transcript-key-1"]);
    const documents = await s.t.run(async (ctx) =>
      ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", receipt.projectId)).collect()
    );
    expect(documents).toHaveLength(0);
  });

  test("the draft's preparation sends the same request as the promoted project's own Brief", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    expect(briefRequests).toHaveLength(1);
    const prepared = briefRequests[0];
    const receipt = await promote(s, draftId, ["transcript-key-1", "document-key-1"]);
    const generationId = await reserve(s, receipt.projectId);
    const generation = (await s.t.run(async (ctx) => ctx.db.get(generationId)))!;
    await inAction(s.t, async (ctx) => {
      const { route, client } = briefClient(ctx, generation);
      return await deriveOrReuseBrief(ctx, client, {
        projectId: receipt.projectId, generationId, model: route.model, seedStartup: true,
      });
    });
    expect(briefRequests).toHaveLength(2);
    expect(briefRequests[1].url).toBe(prepared.url);
    expect(briefRequests[1].body).toEqual(prepared.body);
    expect(prepared.body.stream).toBe(true);
  });
});

describe("originals", () => {
  async function upload(s: Setup, text: string) {
    return await s.t.run(async (ctx) => ctx.storage.store(new Blob([text], { type: "text/plain" })));
  }

  test("an original saved during intake moves to the project; one landing after confirming goes to its row", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await saveDocument(s, draftId, "document-key-1");
    const transcriptFile = await upload(s, "transcript bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "transcript-key-1", storageId: transcriptFile, mimeType: "text/plain",
      })
    ).toBe(true);
    // Another user cannot attach a file to it.
    const stranger = await upload(s, "someone else");
    await expect(
      s.outsider.mutation(intakeDraftRefs.attachIntakeOriginal, { draftId, sourceKey: "document-key-1", storageId: stranger })
    ).rejects.toThrow(/no longer available/);
    const receipt = await promote(s, draftId, ["transcript-key-1", "document-key-1"]);
    const documentFile = await upload(s, "document bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "document-key-1", storageId: documentFile, mimeType: "text/plain",
      })
    ).toBe(true);
    // The purge of the promoted draft keeps the files the project holds.
    await s.t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(10);
    await s.t.finishInProgressScheduledFunctions();
    const state = await s.t.run(async (ctx) => {
      const byKey = new Map(receipt.sources.map((row) => [row.sourceKey, row]));
      return {
        transcript: await ctx.db.get(byKey.get("transcript-key-1")!.transcriptId!),
        document: await ctx.db.get(byKey.get("document-key-1")!.projectDocumentId!),
        files: await ctx.db.system.query("_storage").collect(),
        sources: await ctx.db.query("intakeSources").collect(),
        draft: await ctx.db.get(draftId),
      };
    });
    expect(state.transcript?.originalStorageId).toBe(transcriptFile);
    expect(state.document?.storageId).toBe(documentFile);
    expect(state.files.map((file) => file._id)).toEqual(expect.arrayContaining([transcriptFile, documentFile]));
    expect(state.sources).toHaveLength(0);
    expect(state.draft).toMatchObject({ status: "promoted" });
    expect(state.draft?.contentPurgedAt).toBeDefined();
    expect(state.draft?.clientName).toBeUndefined();
  });
});

describe("retention", () => {
  async function contentLeft(s: Setup, draftId: Id<"intakeDrafts">) {
    return await s.t.run(async (ctx) => {
      const preparations = await ctx.db.query("briefPreparations").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draftId)).collect();
      return {
        sources: (await ctx.db.query("intakeSources").collect()).filter((row) => row.draftId === draftId).length,
        speakers: (await ctx.db.query("intakeSourceSpeakers").withIndex("by_draftId", (q) => q.eq("draftId", draftId)).collect()).length,
        frozen: (await ctx.db.query("briefPreparationSources").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draftId)).collect()).length,
        entries: (await ctx.db.query("briefPreparationEntries").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draftId)).collect()).length,
        facts: (await ctx.db.query("briefPreparationFacts").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draftId)).collect()).length,
        files: (await ctx.db.system.query("_storage").collect()).length,
        preparations,
        draft: (await ctx.db.get(draftId))!,
      };
    });
  }

  test("Discard fences the preparation and purges text, originals, names, facts and the Brief", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    const file = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["bytes"])));
    await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, { draftId, sourceKey: "document-key-1", storageId: file });
    const before = await contentLeft(s, draftId);
    expect(before.frozen).toBeGreaterThan(0);
    expect(before.facts).toBeGreaterThan(0);
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId });
    await settle(s, 3);
    const after = await contentLeft(s, draftId);
    expect(after).toMatchObject({ sources: 0, speakers: 0, frozen: 0, entries: 0, facts: 0, files: 0 });
    expect(after.draft).toMatchObject({ status: "discarded" });
    expect(after.draft.contentPurgedAt).toBeDefined();
    expect(after.draft.clientName).toBeUndefined();
    expect(after.draft.interviewees).toBeUndefined();
    expect(after.preparations.every((row) => row.status !== "ready" && row.storylineText === undefined && row.placeholders === undefined)).toBe(true);
    // The rows stay, content-free, for the limits; nothing more is written.
    await expect(saveTranscript(s, draftId, "transcript-key-9")).rejects.toThrow(/no longer available/);
  });

  test("a draft expires 24 hours after its last edit, and its content is gone within the hour", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    vi.advanceTimersByTime(INTAKE_IDLE_MS - 60_000);
    await s.t.mutation(intakeDraftRefs.sweepIntakeDrafts, {});
    expect((await contentLeft(s, draftId)).draft.status).toBe("open");
    vi.advanceTimersByTime(2 * 60_000);
    await s.t.mutation(intakeDraftRefs.sweepIntakeDrafts, {});
    await settle(s, 3);
    const after = await contentLeft(s, draftId);
    expect(after.draft.status).toBe("expired");
    expect(after).toMatchObject({ sources: 0, speakers: 0, frozen: 0, entries: 0, facts: 0 });
    expect(after.draft.contentPurgedAt).toBeDefined();
    // An expired draft cannot be promoted.
    await expect(promote(s, draftId, ["transcript-key-1"])).rejects.toThrow(/no longer available/);
  });

  test("edits keep a draft open for at most 7 days", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const created = Date.now();
    for (let day = 0; day < 10; day += 1) {
      vi.setSystemTime(created + day * 20 * 60 * 60 * 1000);
      try {
        await saveTranscript(s, draftId, "transcript-key-1", `${TRANSCRIPT}\n\nInterviewer: Day ${day}.`);
      } catch {
        break;
      }
    }
    const draft = (await s.t.run(async (ctx) => ctx.db.get(draftId)))!;
    expect(draft.expiresAt).toBe(created + INTAKE_LIFETIME_MS);
    vi.setSystemTime(created + INTAKE_LIFETIME_MS + 1);
    await s.t.mutation(intakeDraftRefs.sweepIntakeDrafts, {});
    expect((await s.t.run(async (ctx) => ctx.db.get(draftId)))?.status).toBe("expired");
  });
});

describe("Duplicate copy receipt", () => {
  test("copying returns each copied file's exact destination, even for files with the same name and category", async () => {
    const s = await setup();
    const { fromId, toId, firstId, secondId } = await s.t.run(async (ctx) => {
      const now = Date.now();
      const project = (title: string) =>
        ctx.db.insert("projects", {
          title, clientName: "Acme Seals", status: "draft", projectType: "writing", ownerId: s.userId,
          createdBy: s.userId, shareToken: `dup-${title}`, createdAt: now, updatedAt: now,
        });
      const fromId = await project("Original");
      const toId = await project("Copy");
      const doc = (content: string) =>
        ctx.db.insert("projectDocuments", {
          projectId: fromId, fileName: "notes.txt", fileType: "txt", content, category: "background",
          source: "context_input", uploadedBy: s.userId, uploaderRole: "writer", createdAt: now,
        });
      const firstId = await doc("First set of notes.");
      const secondId = await doc("Second set of notes.");
      return { fromId, toId, firstId, secondId };
    });
    const result = await s.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: fromId,
      toProjectId: toId,
      includeReport: false,
      includeReviews: false,
    });
    expect(result.documents.map((row) => row.sourceId).sort()).toEqual([firstId, secondId].sort());
    const copies = await s.t.run(async (ctx) =>
      Promise.all(result.documents.map(async (row) => ({ row, copy: (await ctx.db.get(row.documentId))! })))
    );
    const source = await s.t.run(async (ctx) => ({ first: (await ctx.db.get(firstId))!, second: (await ctx.db.get(secondId))! }));
    for (const { row, copy } of copies) {
      expect(copy.projectId).toBe(toId);
      expect(copy.content).toBe(row.sourceId === firstId ? source.first.content : source.second.content);
    }
  });
});
