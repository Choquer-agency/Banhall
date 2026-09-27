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
import { sha256 } from "./lib/contracts";
import { firmDayNumber } from "../shared/firmTime";
import { preparationDay } from "./lib/briefPreparationBudget";
import { BRIEF_REQUEST } from "./lib/briefRequest";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";
import { INTAKE_DEBOUNCE_MS, INTAKE_IDLE_MS, INTAKE_LIFETIME_MS } from "./lib/intakeDrafts";
import { deriveOrAdoptSeedBrief, deriveOrReuseBrief } from "./ai/brief";
import { clientForStep, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { resolveGenerationStep } from "./lib/generationSteps";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import LOOSE_LABELS from "../shared/__fixtures__/transcripts/loose-labels.txt?raw";

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

/** Runs everything scheduled over the next half minute, step by step. */
async function drain(s: Setup, steps = 50) {
  for (let step = 0; step < steps; step += 1) {
    vi.advanceTimersByTime(600);
    await s.t.finishInProgressScheduledFunctions();
  }
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
  const receipt = await s.writer.mutation(intakeDraftRefs.promoteIntakeDraft, {
    draftId,
    commandId,
    sourceKeys,
    project: { title: "Cold seal", clientName: "Acme Seals", interviewees: ["Priya Raman"] },
  });
  if ("ended" in receipt) throw new Error("The draft ended");
  return receipt;
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

describe("caps", () => {
  test("a draft takes a project's transcript caps, counted without reading the text again", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    for (let index = 0; index < 20; index += 1) {
      await saveTranscript(s, draftId, `transcript-key-${index}`, `Interviewer: Call ${index}.`, index, `Call ${index}`);
    }
    await expect(saveTranscript(s, draftId, "transcript-key-20", "Interviewer: One too many.", 20)).rejects.toThrow(/at most 20/);
    // Saving an existing one again (a new position) is not another transcript.
    await saveTranscript(s, draftId, "transcript-key-3", "Interviewer: Call 3.", 30, "Call 3");
    await s.writer.mutation(intakeDraftRefs.removeIntakeSource, { draftId, sourceKey: "transcript-key-0" });
    await saveTranscript(s, draftId, "transcript-key-20", "Interviewer: Now it fits.", 20);
    const draft = (await s.t.run(async (ctx) => ctx.db.get(draftId)))!;
    expect(draft.transcriptCount).toBe(20);
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

  test("a loose label and the firm's name are masked as for a project, and the run adopts after promotion", async () => {
    const s = await setup();
    await s.t.run(async (ctx) =>
      ctx.db.insert("appSettings", {
        key: "privacy.firmNames",
        value: JSON.stringify(["Northwind Consulting", "NWC"]),
        updatedBy: s.userId,
        updatedAt: Date.now(),
      })
    );
    const content = [
      LOOSE_LABELS,
      "",
      "Dana Whitfield: Northwind Consulting will write it up for NWC's files.",
    ].join("\n");
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1", content);
    await saveDocument(s, draftId, "document-key-1");
    await setContext(s, draftId);
    await settle(s, 8);
    const [prepared] = await draftPreparations(s, draftId);
    expect(prepared.status).toBe("ready");
    const map = prepared.placeholders ?? [];
    for (const label of ["thermal drift", "latency", "bottom line"]) {
      expect(map.find((entry) => entry.value === label)?.at, label).toBe("label");
    }
    expect(map.some((entry) => entry.value === "Northwind Consulting")).toBe(true);
    const sent = JSON.stringify(briefRequests[briefRequests.length - 1].body);
    expect(sent).not.toContain("thermal drift:");
    expect(sent).not.toContain("Northwind Consulting");
    expect(sent).not.toContain("Priya");

    const receipt = await promote(s, draftId, ["transcript-key-1", "document-key-1"]);
    const generationId = await reserve(s, receipt.projectId);
    // The run froze the same map from the promoted project.
    expect((await s.t.run(async (ctx) => ctx.db.get(generationId)))?.placeholders).toEqual(map);
    const calls = briefRequests.length;
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    expect(briefRequests).toHaveLength(calls);
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
    // The page retries (or a new tab confirms): the same project. It is
    // complete only once every transcript's turns are built.
    const second = await promote(s, draftId, keys, "command-b");
    expect(second.projectId).toBe(first.projectId);
    expect(second.complete).toBe(false);
    expect(second.sources.map((row) => row.sourceKey).sort()).toEqual([...keys].sort());
    await expect(reserve(s, first.projectId)).rejects.toThrow(/still being set up/);
    await drain(s);
    const third = await promote(s, draftId, keys, "command-c");
    expect(third.complete).toBe(true);
    expect(third.projectId).toBe(first.projectId);
    const projects = await s.t.run(async (ctx) => ctx.db.query("projects").collect());
    expect(projects).toHaveLength(1);
    const transcripts = await s.t.run(async (ctx) =>
      ctx.db.query("transcripts").withIndex("by_projectId", (q) => q.eq("projectId", first.projectId)).collect()
    );
    expect(transcripts.map((row) => row.position).sort()).toEqual([0, 1, 2, 3]);
    expect(transcripts.every((row) => row.parserVersion === TRANSCRIPT_PARSER_VERSION && !row.structureBuildId)).toBe(true);

    // A crash after the first step: the scheduled steps finish it alone.
    const other = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    for (const [index, key] of keys.entries()) await saveTranscript(s, other, key, long(index + 10), index, `Call ${index + 1}`);
    const partial = await promote(s, other, keys, "command-d");
    expect(partial.complete).toBe(false);
    await drain(s);
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
  /** A fresh upload, claimed by the writer as the page claims it. */
  async function upload(s: Setup, text: string, claimedBy: Id<"users"> | null = s.userId) {
    return await s.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([text], { type: "text/plain" }));
      if (claimedBy) await ctx.db.insert("uploadClaims", { storageId, userId: claimedBy, claimedAt: Date.now() });
      return storageId;
    });
  }
  const files = (s: Setup) => s.t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).map((file) => file._id));

  test("an original saved during intake moves to the project; one landing after confirming goes to its row", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await saveDocument(s, draftId, "document-key-1");
    const transcriptFile = await upload(s, "transcript bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "transcript-key-1", storageId: transcriptFile, contentHash: await sha256(TRANSCRIPT), mimeType: "text/plain",
      })
    ).toBe(true);
    // Another user cannot attach a file to it.
    const stranger = await upload(s, "someone else", s.outsiderId);
    await expect(
      s.outsider.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "document-key-1", storageId: stranger, contentHash: await sha256(DOCUMENT),
      })
    ).rejects.toThrow(/no longer available/);
    const receipt = await promote(s, draftId, ["transcript-key-1", "document-key-1"]);
    const documentFile = await upload(s, "document bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "document-key-1", storageId: documentFile, contentHash: await sha256(DOCUMENT), mimeType: "text/plain",
      })
    ).toBe(true);
    // The purge of the promoted draft keeps the files the project holds.
    await drain(s, 3);
    const state = await s.t.run(async (ctx) => {
      const byKey = new Map(receipt.sources.map((row) => [row.sourceKey, row]));
      return {
        transcript: await ctx.db.get(byKey.get("transcript-key-1")!.transcriptId!),
        document: await ctx.db.get(byKey.get("document-key-1")!.projectDocumentId!),
        sources: await ctx.db.query("intakeSources").collect(),
        texts: await ctx.db.query("intakeSourceTexts").collect(),
        draft: await ctx.db.get(draftId),
      };
    });
    expect(state.transcript?.originalStorageId).toBe(transcriptFile);
    expect(state.document?.storageId).toBe(documentFile);
    expect(await files(s)).toEqual(expect.arrayContaining([transcriptFile, documentFile]));
    expect(state.sources).toHaveLength(0);
    expect(state.texts).toHaveLength(0);
    expect(state.draft).toMatchObject({ status: "promoted" });
    expect(state.draft?.contentPurgedAt).toBeDefined();
    expect(state.draft?.clientName).toBeUndefined();
  });

  test("an original of replaced text is refused and its file deleted (Replace file)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveDocument(s, draftId, "document-key-1");
    // The writer replaced the file: the saved text changed before the
    // first file's upload finished.
    await saveDocument(s, draftId, "document-key-1", "cold-soak.txt", "Replaced cold soak log.");
    const stale = await upload(s, "old bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "document-key-1", storageId: stale, contentHash: await sha256(DOCUMENT),
      })
    ).toBe(false);
    expect(await files(s)).not.toContain(stale);
    const fresh = await upload(s, "new bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "document-key-1", storageId: fresh, contentHash: await sha256("Replaced cold soak log."),
      })
    ).toBe(true);
  });

  test("an upload that lands after Discard is deleted when the caller claimed it, and nobody else's upload is ever deleted", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveDocument(s, draftId, "document-key-1");
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId });
    const mine = await upload(s, "late bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "document-key-1", storageId: mine, contentHash: await sha256(DOCUMENT),
      })
    ).toBe(false);
    expect(await files(s)).not.toContain(mine);
    // An unclaimed file with a wrong key is left alone.
    const other = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const unclaimed = await upload(s, "someone's bytes", null);
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId: other, sourceKey: "missing-key-1", storageId: unclaimed, contentHash: "x",
      })
    ).toBe(false);
    expect(await files(s)).toContain(unclaimed);
  });

  test("while promoting, a source not yet installed takes its original; after promotion only within the hour and with edit access", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const long = Array.from({ length: 14000 }, (_, line) => `Priya Raman: Line ${line} of the rig call.`).join("\n\n").slice(0, 450_000);
    const keys = ["long-key-1", "long-key-2", "long-key-3", "long-key-4"];
    for (const [index, key] of keys.entries()) await saveTranscript(s, draftId, key, `${long.slice(0, 440_000)} ${index}`, index, `Call ${index}`);
    const first = await promote(s, draftId, keys);
    expect(first.complete).toBe(false);
    const waiting = keys.find((key) => !first.sources.some((row) => row.sourceKey === key))!;
    const text = `${long.slice(0, 440_000)} ${keys.indexOf(waiting)}`;
    const file = await upload(s, "rig bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: waiting, storageId: file, contentHash: await sha256(text),
      })
    ).toBe(true);
    await drain(s);
    const receipt = await promote(s, draftId, keys);
    const installed = receipt.sources.find((row) => row.sourceKey === waiting)!;
    expect((await s.t.run(async (ctx) => ctx.db.get(installed.transcriptId!)))?.originalStorageId).toBe(file);

    // An hour after promotion a late original no longer reaches the row.
    const late = keys.find((key) => key !== waiting)!;
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    const tooLate = await upload(s, "too late");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: late, storageId: tooLate, contentHash: await sha256(`${long.slice(0, 440_000)} ${keys.indexOf(late)}`),
      })
    ).toBe(false);
    expect(await files(s)).not.toContain(tooLate);
  });

  test("after promotion a late original needs a live project the caller may still edit", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    const receipt = await promote(s, draftId, ["transcript-key-1"]);
    // Ownership moved to someone else: the former creator may not edit.
    await s.t.run(async (ctx) => ctx.db.patch(receipt.projectId, { ownerId: s.outsiderId }));
    const file = await upload(s, "bytes");
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "transcript-key-1", storageId: file, contentHash: await sha256(TRANSCRIPT),
      })
    ).toBe(false);
    expect((await s.t.run(async (ctx) => ctx.db.get(receipt.sources[0].transcriptId!)))?.originalStorageId).toBeUndefined();
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
    expect(
      await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
        draftId, sourceKey: "document-key-1", storageId: file, contentHash: await sha256(DOCUMENT),
      })
    ).toBe(true);
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
    expect(after.preparations.map((row) => row.endedReason)).toContain("draft_closed");
    // The rows stay, content-free, for the limits; nothing more is written.
    await expect(saveTranscript(s, draftId, "transcript-key-9")).rejects.toThrow(/no longer available/);
  });

  test("Discard fences a claimed attempt: nothing is sent or kept, and the attempt ends", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await settle(s, 1);
    await setContext(s, draftId);
    // Step until the start claims the attempt; its call has not run yet.
    for (let step = 0; step < 4 && (await draftPreparations(s, draftId))[0]?.status !== "running"; step += 1) {
      vi.advanceTimersByTime(INTAKE_DEBOUNCE_MS + 100);
      await s.t.finishInProgressScheduledFunctions();
    }
    const [running] = await draftPreparations(s, draftId);
    expect(running.status).toBe("running");
    expect(briefRequests).toHaveLength(0);
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId });
    expect((await s.t.run(async (ctx) => ctx.db.get(running._id)))).toMatchObject({
      status: "obsolete",
      endedReason: "draft_closed",
    });
    await settle(s, 3);
    expect(briefRequests).toHaveLength(0);
    const after = (await s.t.run(async (ctx) => ctx.db.get(running._id)))!;
    expect(after.status).toBe("obsolete");
    expect(after.attemptEndedAt).toBeDefined();
    const entries = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationEntries").withIndex("by_preparationId", (q) => q.eq("preparationId", running._id)).collect()
    );
    expect(entries).toHaveLength(0);
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

describe("review fixes (2026-09-26, Opus 5.5 and Fable 5.1)", () => {
  const lines = (count: number, words = "about the cold soak rig and the seal") =>
    Array.from({ length: count }, (_, line) => `${line % 2 ? "Dana Whitfield" : "Priya Raman"}: Line ${line} ${words}.`).join("\n\n");

  test("a transcript over 400 turns and one over 150,000 characters: promotion waits for their turn builds, then the run adopts (O-P2-2)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const many = lines(460, "rig");
    const long = lines(2600);
    expect(long.length).toBeGreaterThan(150_000);
    await saveTranscript(s, draftId, "many-turns-key", many, 0, "Many turns");
    await saveTranscript(s, draftId, "long-text-key", long, 1, "Long call");
    await setContext(s, draftId);
    await drain(s);
    const [prepared] = await draftPreparations(s, draftId);
    expect([prepared.status, prepared.endedReason, many.length + long.length]).toEqual(["ready", undefined, many.length + long.length]);
    const first = await promote(s, draftId, ["many-turns-key", "long-text-key"]);
    expect(first.complete).toBe(false);
    await expect(reserve(s, first.projectId)).rejects.toThrow(/still being set up/);
    await drain(s);
    const done = await promote(s, draftId, ["many-turns-key", "long-text-key"]);
    expect(done.complete).toBe(true);
    const generationId = await reserve(s, done.projectId);
    const calls = briefRequests.length;
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
    expect(briefRequests).toHaveLength(calls);
  });

  test("the refusal while setting up carries its own code (O-P2-5)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "long-text-key", lines(3600), 0, "Long call");
    const first = await promote(s, draftId, ["long-text-key"]);
    expect(first.complete).toBe(false);
    const error = await reserve(s, first.projectId).catch((caught: unknown) => caught);
    expect((error as { data?: { code?: string } }).data?.code).toBe("PROJECT_SETTING_UP");
  });

  test("confirming before the draft's speakers were built asks the model on the project (O-P2-4)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1", UNCERTAIN);
    // No scheduled work has run: the draft's build never ran.
    const receipt = await promote(s, draftId, ["transcript-key-1"]);
    const jobs = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(
      jobs.filter((job) => job.name.includes("classifySpeakerRoles") && job.state.kind === "pending").map((job) => job.args[0])
    ).toEqual([{ transcriptId: receipt.sources[0].transcriptId }]);
  });

  test("a project erased part way ends the draft, purges it, and a repeat confirm builds nothing (O-P2-6, Fable P2-3)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const keys = ["long-key-1", "long-key-2", "long-key-3", "long-key-4"];
    for (const [index, key] of keys.entries()) {
      await saveTranscript(s, draftId, key, lines(12_000).slice(0, 440_000) + ` ${index}`, index, `Call ${index}`);
    }
    const file = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["bytes"])));
    await s.writer.mutation(intakeDraftRefs.attachIntakeOriginal, {
      draftId, sourceKey: "long-key-4", storageId: file, contentHash: await sha256(lines(12_000).slice(0, 440_000) + " 3"),
    });
    const first = await promote(s, draftId, keys);
    expect(first.complete).toBe(false);
    // The new project is deleted before the rest is installed.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(first.projectId, { deletionStartedAt: Date.now() });
    });
    await drain(s);
    const state = await s.t.run(async (ctx) => ({
      draft: (await ctx.db.get(draftId))!,
      sources: (await ctx.db.query("intakeSources").collect()).filter((row) => row.draftId === draftId),
      texts: (await ctx.db.query("intakeSourceTexts").withIndex("by_draftId", (q) => q.eq("draftId", draftId)).collect()),
      files: (await ctx.db.system.query("_storage").collect()).map((row) => row._id),
    }));
    expect(state.draft.status).toBe("discarded");
    expect(state.draft.contentPurgedAt).toBeDefined();
    expect(state.sources).toHaveLength(0);
    expect(state.texts).toHaveLength(0);
    expect(state.files).not.toContain(file);
    await expect(promote(s, draftId, keys)).rejects.toThrow(/no longer available/);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("projects").collect()).length)).toBe(1);
  });

  test("a promotion whose project was detached by erasure ends on a repeat confirm, and the sweep ends a stuck one (O-P2-6)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "long-text-key", lines(3600), 0, "Long call");
    const first = await promote(s, draftId, ["long-text-key"]);
    // Erasure detached the project from the draft (projectScopedTables).
    await s.t.run(async (ctx) => {
      await ctx.db.patch(draftId, { projectId: undefined });
      await ctx.db.delete(first.projectId);
    });
    const again = await s.writer.mutation(intakeDraftRefs.promoteIntakeDraft, {
      draftId, commandId: "again", sourceKeys: ["long-text-key"], project: { title: "Cold seal", clientName: "Acme Seals" },
    });
    expect(again).toEqual({ ended: true });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("projects").collect()).length)).toBe(0);

    // A stuck promotion (its chain lost) is resumed by the sweep when its project is live.
    const other = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, other, "long-text-key", lines(3600), 0, "Long call");
    const stuck = await promote(s, other, ["long-text-key"]);
    await s.t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      }
    });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect((await s.t.mutation(intakeDraftRefs.sweepIntakeDrafts, {})).stuck).toBe(1);
    await drain(s);
    await drain(s);
    expect((await s.t.run(async (ctx) => ctx.db.get(other)))?.status).toBe("promoted");
    expect((await promote(s, other, ["long-text-key"])).projectId).toBe(stuck.projectId);
  });

  test("names must settle for 5 seconds: typing Acm then Acme Robotics sends only the full masked name (Fable P2-1)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1", `${UNCERTAIN}\n\nSpeaker 2: Acme Robotics built the rig in Leduc.`);
    await drain(s, 3);
    await s.writer.mutation(intakeDraftRefs.updateIntakeContext, { draftId, clientName: "Acm", interviewees: [] });
    vi.advanceTimersByTime(1_000);
    await s.t.finishInProgressScheduledFunctions();
    await s.writer.mutation(intakeDraftRefs.updateIntakeContext, { draftId, clientName: "Acme Robotics", interviewees: [] });
    await drain(s, 20);
    expect(speakerRequests).toHaveLength(1);
    expect(briefRequests).toHaveLength(1);
    for (const request of [...speakerRequests, ...briefRequests]) {
      expect(JSON.stringify(request.body)).not.toContain("Acme Robotics");
    }
    // A later change of the names asks the speaker model again.
    await s.writer.mutation(intakeDraftRefs.updateIntakeContext, { draftId, clientName: "Acme Robotics Ltd", interviewees: [] });
    await drain(s, 20);
    expect(speakerRequests).toHaveLength(2);
  });

  test("an old speaker answer never lands on new text or other names", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1", UNCERTAIN);
    const sourceId = await s.t.run(async (ctx) => {
      const source = (await ctx.db.query("intakeSources").collect())[0];
      await ctx.db.patch(source._id, { speakerModel: "pending", speakerModelKey: "key-now" });
      return source._id;
    });
    await s.t.mutation(intakeDraftRefs.recordIntakeSpeakerRoles, {
      sourceId, key: "key-before", roles: [{ label: "Speaker 2", role: "client", confidence: 0.9 }],
    });
    await s.t.mutation(intakeDraftRefs.recordIntakeSpeakerRoles, {
      sourceId, key: "key-now", contentHash: "other-text", roles: [{ label: "Speaker 2", role: "client", confidence: 0.9 }],
    });
    expect((await s.t.run(async (ctx) => ctx.db.get(sourceId)))?.speakerModel).toBe("pending");
  });

  test("speaker model calls stop at 60 a day and the Brief still goes ahead", async () => {
    const s = await setup();
    await s.t.run(async (ctx) =>
      ctx.db.insert("intakeDailyCounts", {
        userId: s.userId, firmDay: firmDayNumber(Date.now()), drafts: 0, speakerCalls: 60,
      })
    );
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1", UNCERTAIN);
    await setContext(s, draftId);
    await drain(s, 20);
    expect(speakerRequests).toHaveLength(0);
    expect((await draftPreparations(s, draftId))[0]?.status).toBe("ready");
  });

  test("drafts: 30 a day, and past 10 open the least recently edited one is discarded (O-P1-1)", async () => {
    const s = await setup();
    const drafts: Id<"intakeDrafts">[] = [];
    for (let index = 0; index < 10; index += 1) {
      drafts.push(await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {}));
      vi.advanceTimersByTime(1_000);
    }
    // The first draft is edited: now the second is the least recently edited.
    await saveTranscript(s, drafts[0], "transcript-key-1");
    await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const statuses = await s.t.run(async (ctx) => Promise.all(drafts.map(async (id) => (await ctx.db.get(id))?.status)));
    expect(statuses[0]).toBe("open");
    expect(statuses[1]).toBe("discarded");
    await s.t.run(async (ctx) => {
      const row = await ctx.db
        .query("intakeDailyCounts")
        .withIndex("by_userId_and_firmDay", (q) => q.eq("userId", s.userId).eq("firmDay", firmDayNumber(Date.now())))
        .unique();
      await ctx.db.patch(row!._id, { drafts: 30 });
    });
    await expect(s.writer.mutation(intakeDraftRefs.createIntakeDraft, {})).rejects.toThrow(/a lot of new projects today/);
  });

  test("large documents: text is chunked, reads skip it, and all document text is capped at 3,000,000 characters (Fable P2-2)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const big = (letter: string) => `${letter} `.repeat(449_999) + "é";
    for (const [index, letter] of ["a", "b", "c"].entries()) {
      await saveDocument(s, draftId, `big-doc-key-${index}`, `big-${index}.txt`, big(letter), 1000 + index);
    }
    await expect(saveDocument(s, draftId, "big-doc-key-3", "big-3.txt", "A".repeat(400_000), 1003)).rejects.toThrow(
      /at most 3,000k characters of supporting document text/
    );
    const chunks = await s.t.run(async (ctx) => ctx.db.query("intakeSourceTexts").withIndex("by_draftId", (q) => q.eq("draftId", draftId)).collect());
    expect(chunks.length).toBe(15);
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk.text).length <= 900_000)).toBe(true);
    // The owner's view lists the files without their text.
    expect((await s.writer.query(intakeDraftRefs.getIntakeDraft, { draftId }))?.sources).toHaveLength(3);
    await saveTranscript(s, draftId, "transcript-key-1");
    const receipt = await promote(s, draftId, ["transcript-key-1", "big-doc-key-0", "big-doc-key-1", "big-doc-key-2"]);
    await drain(s, 5);
    const done = await promote(s, draftId, ["transcript-key-1", "big-doc-key-0", "big-doc-key-1", "big-doc-key-2"]);
    expect([receipt.complete || done.complete, done.sources.map((row) => row.sourceKey).sort()]).toEqual([
      true,
      ["big-doc-key-0", "big-doc-key-1", "big-doc-key-2", "transcript-key-1"],
    ]);
    const stored = await s.t.run(async (ctx) => ctx.db.get(done.sources.find((row) => row.sourceKey === "big-doc-key-1")!.projectDocumentId!));
    expect(stored?.content).toBe(big("b"));
  });

  test("a second file with the same name and text merges into the first, as uploads do", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await saveDocument(s, draftId, "document-key-1");
    await saveDocument(s, draftId, "document-key-2", "cold-soak.txt", DOCUMENT, 1001);
    await setContext(s, draftId);
    await drain(s);
    const receipt = await promote(s, draftId, ["transcript-key-1", "document-key-1", "document-key-2"]);
    const ids = receipt.sources.filter((row) => row.kind === "document").map((row) => row.projectDocumentId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
    const generationId = await reserve(s, receipt.projectId);
    expect((await adoptAtStart(s, generationId)).kind).toBe("adopted");
  });

  test("the draft purge reaches preparations past the first 50 (Fable P2-4)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 60; index += 1) {
        const preparationId = await ctx.db.insert("briefPreparations", {
          intakeDraftId: draftId, status: "obsolete", revision: 1, runAt: now, triggeredBy: s.userId,
          triggerReason: "source_saved", createdAt: now, updatedAt: now, endedAt: now, storylineText: `Storyline ${index}`,
        });
        await ctx.db.insert("briefPreparationSources", {
          preparationId, intakeDraftId: draftId, kind: "transcript", label: "l", content: "c", contentHash: "h",
          truncated: false, originalLength: 1, capturedAt: now,
        });
      }
    });
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId });
    await drain(s, 10);
    const left = await s.t.run(async (ctx) => ({
      sources: await ctx.db.query("briefPreparationSources").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draftId)).collect(),
      unpurged: (await ctx.db.query("briefPreparations").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draftId)).collect())
        .filter((row) => row.contentPurgedAt === undefined),
      draft: await ctx.db.get(draftId),
    }));
    expect(left.sources).toHaveLength(0);
    expect(left.unpurged).toHaveLength(0);
    expect(left.draft?.contentPurgedAt).toBeDefined();
  });

  test("content-free closed drafts are deleted after 30 days", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId });
    await drain(s, 3);
    expect((await s.t.run(async (ctx) => ctx.db.get(draftId)))?.contentPurgedAt).toBeDefined();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    await s.t.mutation(intakeDraftRefs.sweepIntakeDrafts, {});
    expect(await s.t.run(async (ctx) => ctx.db.get(draftId))).toBeNull();
  });

  test("a draft holds $0.50 for its whole life, and its spend that day counts toward the promoted project", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    // Earlier days' spend on this draft.
    await s.t.run(async (ctx) =>
      ctx.db.insert("briefPreparations", {
        intakeDraftId: draftId, status: "failed", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "x",
        createdAt: 0, updatedAt: 0, dispatchedAt: 1, firmDay: firmDayNumber(Date.now()) - 3, reservedUsd: 0.49,
      })
    );
    await saveTranscript(s, draftId, "transcript-key-1");
    await setContext(s, draftId);
    await drain(s);
    const rows = await draftPreparations(s, draftId);
    expect(rows.find((row) => row.triggerReason !== "x")).toMatchObject({ status: "cancelled", endedReason: "project_budget" });
    expect(briefRequests).toHaveLength(0);
    const day = await s.t.run(async (ctx) => {
      const today = firmDayNumber(Date.now());
      await ctx.db.insert("briefPreparations", {
        intakeDraftId: draftId, status: "obsolete", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "y",
        createdAt: 0, updatedAt: 0, dispatchedAt: 1, firmDay: today, reservedUsd: 0.3,
      });
      return today;
    });
    const receipt = await promote(s, draftId, ["transcript-key-1"]);
    const spent = await s.t.run(async (ctx) =>
      preparationDay(ctx, { userId: s.userId, scope: { projectId: receipt.projectId }, firmDay: day })
    );
    expect(spent.projectUsd).toBeCloseTo(0.3, 10);
  });
});

describe("re-check fixes (2026-09-26, Opus 5.5)", () => {
  test("a 400,000-character CJK document that would not fit its project row is refused at save, in plain words (P2-A)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const cjk = "冷却試験の記録".repeat(57_143).slice(0, 400_000);
    const error = await saveDocument(s, draftId, "cjk-doc-key-1", "記録.txt", cjk).catch((caught: unknown) => caught);
    expect((error as { data?: { code?: string; message?: string } }).data).toMatchObject({
      code: "INTAKE_TEXT_LIMIT",
      message: "This file holds too much text to save in a project. Split it or remove some pages.",
    });
    const transcriptError = await saveTranscript(s, draftId, "cjk-transcript-key", `話者1: ${cjk}`).catch((caught: unknown) => caught);
    expect((transcriptError as { data?: { code?: string } }).data?.code).toBe("INTAKE_TEXT_LIMIT");
    // A smaller CJK document fits.
    await saveDocument(s, draftId, "cjk-doc-key-2", "記録2.txt", cjk.slice(0, 250_000));
  });

  test("draft errors carry their own codes", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId });
    const gone = await saveTranscript(s, draftId, "transcript-key-1").catch((caught: unknown) => caught);
    expect((gone as { data?: { code?: string } }).data?.code).toBe("INTAKE_DRAFT_GONE");
  });

  test("names edited a few seconds apart, again and again, never cancel the preparation (P3-3)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await setContext(s, draftId, "Acme");
    for (let edit = 0; edit < 14; edit += 1) {
      vi.advanceTimersByTime(3_000);
      await s.t.finishInProgressScheduledFunctions();
      await s.writer.mutation(intakeDraftRefs.updateIntakeContext, {
        draftId, clientName: `Acme Seals ${edit}`, interviewees: ["Priya Raman"],
      });
    }
    await drain(s, 20);
    const rows = await draftPreparations(s, draftId);
    expect(rows.some((row) => row.endedReason === "names_unsettled")).toBe(false);
    expect(rows.at(-1)?.status).toBe("ready");
    expect(briefRequests).toHaveLength(1);
  });

  test("the wait for turn builds reads the links, which each build marks when it finishes (P3-4)", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    const long = Array.from({ length: 2600 }, (_, line) => `Priya Raman: Line ${line} about the cold soak rig and the seal.`).join("\n\n");
    await saveTranscript(s, draftId, "short-key", TRANSCRIPT, 0, "Short");
    await saveTranscript(s, draftId, "long-key", long, 1, "Long");
    const first = await promote(s, draftId, ["short-key", "long-key"]);
    expect(first.complete).toBe(false);
    const links = async () =>
      await s.t.run(async (ctx) =>
        ctx.db.query("intakeSourceLinks").withIndex("by_projectId", (q) => q.eq("projectId", first.projectId)).collect()
      );
    // The short one was built inside the step; the long one is not yet.
    expect((await links()).map((link) => [link.sourceKey, link.builtAt !== undefined]).sort()).toEqual([
      ["long-key", false],
      ["short-key", true],
    ]);
    await drain(s);
    expect((await links()).every((link) => link.builtAt !== undefined)).toBe(true);
    expect((await promote(s, draftId, ["short-key", "long-key"])).complete).toBe(true);
  });
});
