/// <reference types="vite/client" />
/**
 * 2026-09-27 (fourth): head start gaps closed.
 *
 * Reload: the owner's open draft reads back its saved sources (metadata,
 * then each source's text on its own), names and leave-out list; nobody
 * else's, and nothing once it ended; reading it moves no expiry.
 *
 * Project page start dialog: its leave-out list asks for a project
 * preparation of exactly the ticked files (2 quiet seconds, as a draft),
 * which a run with the same list adopts; opening with every file ticked
 * asks nothing; a later evidence change keeps a fresh list.
 *
 * Last-second changes: a change sent at Start dispatches the queued
 * preparation at once, the promotion carries it to the project (waiting,
 * bounded, while its slot frees), and the run attaches instead of reading
 * again; the same on a project page. Every limit still applies.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { anthropicToolSse, sseResponse } from "./anthropicSse.fixture";
import { sha256 } from "./lib/contracts";
import { firmDayNumber } from "../shared/firmTime";
import { BRIEF_REQUEST } from "./lib/briefRequest";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";
import { INTAKE_DEBOUNCE_MS } from "./lib/intakeDrafts";
import { PREPARATION_USER_DAILY_STARTS } from "./lib/briefPreparationBudget";
import { requestBriefPreparation } from "./lib/briefPreparationTrigger";
import { deriveOrAdoptSeedBrief } from "./ai/brief";
import { clientForStep, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { resolveGenerationStep } from "./lib/generationSteps";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { PROMOTION_CONFIRMED_WAIT_MS } from "./intakeDrafts";
import { QUEUED_WAITER_DEADLINE_MS } from "./briefPreparations";

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
const DOCUMENT = "Cold soak log: fluoropolymer seal, 400 cycles at minus 30 degrees, no leak.";
const LATER = "A later note about the seal supplier and its lead times.";

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

const briefRequests: Array<Record<string, unknown>> = [];

function stubProvider() {
  briefRequests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = (await request.json()) as Record<string, unknown>;
      briefRequests.push(body);
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
  vi.setSystemTime(new Date("2026-09-27T15:00:00Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-gaps-key");
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
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "gaps-writer", role: "writer", name: "Wren Writer" });
    const outsiderId = await ctx.db.insert("users", { authId: "gaps-outsider", role: "writer", name: "Olly Outsider" });
    return { userId, outsiderId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "gaps-writer" }),
    outsider: t.withIdentity({ subject: "gaps-outsider" }),
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

/** Runs only what is already due now, without moving the clock. */
async function runDue(s: Setup) {
  vi.advanceTimersByTime(1);
  await s.t.finishInProgressScheduledFunctions();
}

async function row(s: Setup, id: Id<"briefPreparations">) {
  return (await s.t.run(async (ctx) => ctx.db.get(id)))!;
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

// ─── Draft helpers ──────────────────────────────────────────────────────────

async function saveTranscript(s: Setup, draftId: Id<"intakeDrafts">, sourceKey: string) {
  await s.writer.mutation(intakeDraftRefs.saveIntakeSource, {
    draftId, sourceKey, kind: "transcript", position: 0, label: "Interview", content: TRANSCRIPT, sourceFormat: "txt",
  });
}

async function saveDocument(
  s: Setup,
  draftId: Id<"intakeDrafts">,
  sourceKey: string,
  fileName: string,
  content: string,
  position: number
) {
  await s.writer.mutation(intakeDraftRefs.saveIntakeSource, {
    draftId, sourceKey, kind: "document", position, label: fileName, content, fileType: "txt",
    category: "background", intake: "file", extractionOutcome: "ok",
  });
}

/** A draft with one transcript and two files, prepared with every file. */
async function preparedDraft(s: Setup) {
  const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
  await saveTranscript(s, draftId, "transcript-key-1");
  await saveDocument(s, draftId, "document-key-1", "cold-soak.txt", DOCUMENT, 1000);
  await saveDocument(s, draftId, "document-key-2", "later-notes.txt", LATER, 1001);
  await s.writer.mutation(intakeDraftRefs.updateIntakeContext, { draftId, clientName: "Acme Seals", interviewees: ["Priya Raman"] });
  await settle(s);
  return draftId;
}

const ALL_KEYS = ["transcript-key-1", "document-key-1", "document-key-2"];

async function draftPreparations(s: Setup, draftId: Id<"intakeDrafts">): Promise<Doc<"briefPreparations">[]> {
  return await s.t.run(async (ctx) =>
    ctx.db.query("briefPreparations").withIndex("by_intakeDraftId", (q) => q.eq("intakeDraftId", draftId)).collect()
  );
}

async function promote(s: Setup, draftId: Id<"intakeDrafts">, commandId = "command-1") {
  const receipt = await s.writer.mutation(intakeDraftRefs.promoteIntakeDraft, {
    draftId,
    commandId,
    sourceKeys: ALL_KEYS,
    project: { title: "Cold seal", clientName: "Acme Seals", interviewees: ["Priya Raman"] },
  });
  if ("ended" in receipt) throw new Error("The draft ended");
  return receipt;
}

// ─── Project helpers ────────────────────────────────────────────────────────

async function projectSetup() {
  const s = await setup();
  const ids = await s.t.run(async (ctx) => {
    const now = Date.now() - 10 * 60 * 1000;
    const projectId = await ctx.db.insert("projects", {
      title: "Cold seal",
      clientName: "Acme Seals",
      status: "draft",
      projectType: "writing",
      ownerId: s.userId,
      createdBy: s.userId,
      shareToken: "gaps-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: TRANSCRIPT,
      contentHash: await sha256(TRANSCRIPT),
      label: "Interview",
      position: 0,
      parserVersion: TRANSCRIPT_PARSER_VERSION,
      createdAt: now,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Interviewer", role: "interviewer", roleSource: "consultant", confidence: 1, turnCount: 2,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Priya Raman", role: "client", roleSource: "heuristic", confidence: 0.95, turnCount: 2,
    });
    const document = (fileName: string, content: string) =>
      ctx.db.insert("projectDocuments", {
        projectId, fileName, fileType: "txt", content, category: "background", source: "context_input",
        uploadedBy: s.userId, uploaderRole: "writer", createdAt: now,
      });
    const coldSoakId = await document("cold-soak.txt", DOCUMENT);
    const laterId = await document("later-notes.txt", LATER);
    return { projectId, transcriptId, coldSoakId, laterId };
  });
  return { ...s, ...ids };
}

type ProjectSetup = Awaited<ReturnType<typeof projectSetup>>;

async function projectPreparations(s: ProjectSetup): Promise<Doc<"briefPreparations">[]> {
  return await s.t.run(async (ctx) =>
    ctx.db.query("briefPreparations").withIndex("by_projectId", (q) => q.eq("projectId", s.projectId)).collect()
  );
}

/** The project prepared with every file, as an evidence change would. */
async function preparedProject(s: ProjectSetup) {
  await s.t.run(async (ctx) => requestBriefPreparation(ctx, s.projectId, { userId: s.userId, reason: "document_added" }));
  await settle(s, 4);
  const [ready] = await projectPreparations(s);
  expect(ready.status).toBe("ready");
  return ready;
}

async function select(s: ProjectSetup, excludedDocumentIds: Id<"projectDocuments">[], confirm?: boolean) {
  await s.writer.mutation(api.briefPreparations.setProjectStartSelection, {
    projectId: s.projectId,
    excludedTranscriptIds: [],
    excludedDocumentIds,
    ...(confirm ? { confirm: true } : {}),
  });
}

describe("reload restores the draft", () => {
  test("the owner reads back the saved sources, names and leave-out list, then each text; nobody else does", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, { draftId, excludedSourceKeys: ["document-key-2"] });
    const before = (await s.t.run(async (ctx) => ctx.db.get(draftId)))!;

    const restored = await s.writer.query(intakeDraftRefs.restoreIntakeDraft, { draftId });
    expect(restored).toMatchObject({
      clientName: "Acme Seals",
      interviewerUserId: null,
      interviewees: ["Priya Raman"],
      excludedSourceKeys: ["document-key-2"],
      pendingReads: 0,
    });
    expect(restored!.sources.map((source) => [source.sourceKey, source.kind, source.position, source.label])).toEqual([
      ["transcript-key-1", "transcript", 0, "Interview"],
      ["document-key-1", "document", 1000, "cold-soak.txt"],
      ["document-key-2", "document", 1001, "later-notes.txt"],
    ]);
    expect(restored!.sources[1]).toMatchObject({
      contentLength: DOCUMENT.length, fileType: "txt", category: "background", intake: "file", extractionOutcome: "ok", hasOriginal: false,
    });
    expect(restored!.sources[0]).toMatchObject({ sourceFormat: "txt", contentLength: TRANSCRIPT.length });
    // No text in the listing; each source's text on its own read.
    expect(JSON.stringify(restored)).not.toContain("fluoropolymer");
    expect(await s.writer.query(intakeDraftRefs.getIntakeSourceText, { draftId, sourceKey: "transcript-key-1" })).toEqual({
      content: TRANSCRIPT,
    });
    expect(await s.writer.query(intakeDraftRefs.getIntakeSourceText, { draftId, sourceKey: "document-key-2" })).toEqual({
      content: LATER,
    });
    expect(await s.writer.query(intakeDraftRefs.getIntakeSourceText, { draftId, sourceKey: "missing-key-9" })).toBeNull();

    // Another internal user reads nothing.
    expect(await s.outsider.query(intakeDraftRefs.restoreIntakeDraft, { draftId })).toBeNull();
    expect(await s.outsider.query(intakeDraftRefs.getIntakeSourceText, { draftId, sourceKey: "transcript-key-1" })).toBeNull();
    // Reading is not an edit: the expiry and the preparation are untouched.
    const after = (await s.t.run(async (ctx) => ctx.db.get(draftId)))!;
    expect(after.expiresAt).toBe(before.expiresAt);
    expect(after.lastEditedAt).toBe(before.lastEditedAt);

    // Start over (Discard): the draft reads back nothing.
    await s.writer.mutation(intakeDraftRefs.discardIntakeDraft, { draftId });
    expect(await s.writer.query(intakeDraftRefs.restoreIntakeDraft, { draftId })).toBeNull();
    expect(await s.writer.query(intakeDraftRefs.getIntakeSourceText, { draftId, sourceKey: "transcript-key-1" })).toBeNull();
    expect((await draftPreparations(s, draftId)).every((prep) => prep.status !== "queued" && prep.status !== "running")).toBe(true);
  });

  test("an expired or promoted draft is not restored", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    await promote(s, draftId);
    expect(await s.writer.query(intakeDraftRefs.restoreIntakeDraft, { draftId })).toBeNull();
    const other = await preparedDraft(s);
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(await s.writer.query(intakeDraftRefs.restoreIntakeDraft, { draftId: other })).toBeNull();
  });
});

describe("last-second changes on New project", () => {
  test("a change sent with Start dispatches at once, rides the promotion and the run adopts it instead of reading again", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    expect(briefRequests).toHaveLength(1);
    // The writer unticks a file and presses Start within the 2 seconds.
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, {
      draftId, excludedSourceKeys: ["document-key-2"], confirm: true,
    });
    const rows = await draftPreparations(s, draftId);
    const confirmed = rows.find((prep) => prep.confirmedAt !== undefined)!;
    // Sent now: claimed in the confirm itself, with no quiet period.
    expect(confirmed).toMatchObject({ status: "running", triggerReason: "selection_changed" });
    expect(confirmed.dispatchedAt).toBe(Date.now());
    expect(rows.filter((prep) => prep._id !== confirmed._id).map((prep) => prep.status)).toEqual(["obsolete"]);

    const receipt = await promote(s, draftId);
    expect(receipt.complete).toBe(true);
    // Carried to the project, still running: the run waits on it.
    expect(await row(s, confirmed._id)).toMatchObject({ status: "running", projectId: receipt.projectId });
    const later = receipt.sources.find((source) => source.sourceKey === "document-key-2")!.projectDocumentId!;
    const generationId = await reserve(s, receipt.projectId, { excludeDocumentIds: [later] });
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    await settle(s, 3);
    expect((await row(s, confirmed._id)).status).toBe("ready");
    // One call for the head start, none for the run.
    expect(briefRequests).toHaveLength(2);
    const generation = (await s.t.run(async (ctx) => ctx.db.get(generationId)))!;
    expect(generation.briefPreparation?.preparationId).toBe(confirmed._id);
  });

  test("without Start's change the old behaviour holds: a queued preparation ends at promotion and the run reads from scratch", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, { draftId, excludedSourceKeys: ["document-key-2"] });
    const receipt = await promote(s, draftId);
    const queued = (await draftPreparations(s, draftId)).find((prep) => prep.triggerReason === "selection_changed")!;
    expect(queued).toMatchObject({ status: "cancelled", endedReason: "promoted" });
    const later = receipt.sources.find((source) => source.sourceKey === "document-key-2")!.projectDocumentId!;
    const generationId = await reserve(s, receipt.projectId, { excludeDocumentIds: [later] });
    expect((await adoptAtStart(s, generationId)).kind).toBe("derived");
    expect(briefRequests).toHaveLength(2);
  });

  test("with the slot still held by the reading it replaced, the promotion waits for it to dispatch, one call at a time", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await saveDocument(s, draftId, "document-key-1", "cold-soak.txt", DOCUMENT, 1000);
    await saveDocument(s, draftId, "document-key-2", "later-notes.txt", LATER, 1001);
    await s.writer.mutation(intakeDraftRefs.updateIntakeContext, { draftId, clientName: "Acme Seals", interviewees: ["Priya Raman"] });
    // Claimed, but its call has not run yet: it holds the slot.
    for (let step = 0; step < 6; step += 1) {
      const [prep] = await draftPreparations(s, draftId);
      if (prep?.status === "running") break;
      vi.advanceTimersByTime(INTAKE_DEBOUNCE_MS + 100);
      const queued = (await draftPreparations(s, draftId)).find((row) => row.status === "queued");
      if (queued) {
        await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
      }
    }
    const [first] = await draftPreparations(s, draftId);
    expect(first.status).toBe("running");
    expect(briefRequests).toHaveLength(0);

    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, {
      draftId, excludedSourceKeys: ["document-key-2"], confirm: true,
    });
    const confirmed = (await draftPreparations(s, draftId)).find((prep) => prep.confirmedAt !== undefined)!;
    // One call in flight per draft and per user: it waits for the slot.
    expect(confirmed).toMatchObject({ status: "queued", waitingFor: "slot" });
    expect((await row(s, first._id)).status).toBe("obsolete");

    const pending = await promote(s, draftId);
    expect(pending.complete).toBe(false);
    // The replaced call ends (its action finds the attempt out of date), the
    // slot frees, and the confirmed start dispatches while promoting.
    await runDue(s);
    await runDue(s);
    expect((await row(s, confirmed._id)).status).not.toBe("queued");
    const done = await promote(s, draftId, "command-2");
    expect(done.complete).toBe(true);
    expect(await row(s, confirmed._id)).toMatchObject({ projectId: done.projectId });
    const later = done.sources.find((source) => source.sourceKey === "document-key-2")!.projectDocumentId!;
    const generationId = await reserve(s, done.projectId, { excludeDocumentIds: [later] });
    expect(["attached", "adopted"]).toContain((await adoptAtStart(s, generationId)).kind);
    await settle(s, 3);
    // The replaced attempt never called; the confirmed one called once.
    expect(briefRequests).toHaveLength(1);
    expect((await row(s, confirmed._id)).status).toBe("ready");
  });

  test("a confirmed start held by another draft's call is not waited for: it ends and the promotion completes at once (review P2-2)", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    // A call of the same user's other draft holds the user's slot.
    await s.t.run(async (ctx) => {
      const other = await ctx.db.insert("intakeDrafts", {
        ownerId: s.userId, status: "open", createdAt: Date.now(), lastEditedAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000, transcriptCount: 0,
      });
      await ctx.db.insert("briefPreparations", {
        intakeDraftId: other, status: "running", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "x",
        createdAt: Date.now(), updatedAt: Date.now(), attemptId: "held", dispatchedAt: Date.now(),
        leaseExpiresAt: Date.now() + 11 * 60 * 1000, firmDay: firmDayNumber(Date.now()), reservedUsd: 0.01,
      });
    });
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, {
      draftId, excludedSourceKeys: ["document-key-2"], confirm: true,
    });
    const confirmed = (await draftPreparations(s, draftId)).find((prep) => prep.confirmedAt !== undefined)!;
    expect(confirmed).toMatchObject({ status: "queued", waitingFor: "slot" });
    const done = await promote(s, draftId);
    expect(done.complete).toBe(true);
    expect(await row(s, confirmed._id)).toMatchObject({ status: "cancelled", endedReason: "promoted" });
    expect(briefRequests).toHaveLength(1);
  });

  test("the promotion waits at most 45 seconds even for its own replaced reading, then ends the confirmed start", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await saveTranscript(s, draftId, "transcript-key-1");
    await saveDocument(s, draftId, "document-key-1", "cold-soak.txt", DOCUMENT, 1000);
    await saveDocument(s, draftId, "document-key-2", "later-notes.txt", LATER, 1001);
    await s.writer.mutation(intakeDraftRefs.updateIntakeContext, { draftId, clientName: "Acme Seals", interviewees: ["Priya Raman"] });
    // Claimed; its call never ends within the test (its action is never run).
    vi.advanceTimersByTime(6_000);
    for (let step = 0; step < 4; step += 1) {
      const queued = (await draftPreparations(s, draftId)).find((prep) => prep.status === "queued");
      if (!queued) break;
      await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: queued._id, revision: queued.revision });
    }
    expect((await draftPreparations(s, draftId))[0].status).toBe("running");
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, {
      draftId, excludedSourceKeys: ["document-key-2"], confirm: true,
    });
    const confirmed = (await draftPreparations(s, draftId)).find((prep) => prep.confirmedAt !== undefined)!;
    expect(confirmed).toMatchObject({ status: "queued", waitingFor: "slot" });
    expect((await promote(s, draftId)).complete).toBe(false);
    vi.advanceTimersByTime(PROMOTION_CONFIRMED_WAIT_MS + 1_000);
    const done = await promote(s, draftId, "command-2");
    expect(done.complete).toBe(true);
    expect(await row(s, confirmed._id)).toMatchObject({ status: "cancelled", endedReason: "promoted" });
    expect(briefRequests).toHaveLength(0);
  });

  test("a confirmed start keeps every limit: past the day's starts it is refused and nothing is dispatched", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    await s.t.run(async (ctx) => {
      for (let index = 0; index < PREPARATION_USER_DAILY_STARTS; index += 1) {
        await ctx.db.insert("briefPreparations", {
          intakeDraftId: draftId, status: "cancelled", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "x",
          createdAt: 0, updatedAt: 0, dispatchedAt: 1, attemptEndedAt: 2, firmDay: firmDayNumber(Date.now()), reservedUsd: 0,
        });
      }
    });
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, {
      draftId, excludedSourceKeys: ["document-key-2"], confirm: true,
    });
    const confirmed = (await draftPreparations(s, draftId)).find((prep) => prep.confirmedAt !== undefined)!;
    expect(confirmed).toMatchObject({ status: "cancelled", endedReason: "daily_starts" });
    expect(confirmed.dispatchedAt).toBeUndefined();
    expect(briefRequests).toHaveLength(1);
  });

  test("a confirm with no change and nothing queued sends nothing", async () => {
    const s = await setup();
    const draftId = await preparedDraft(s);
    await s.writer.mutation(intakeDraftRefs.setIntakeSelection, { draftId, excludedSourceKeys: [], confirm: true });
    const rows = await draftPreparations(s, draftId);
    expect(rows.map((prep) => prep.status)).toEqual(["ready"]);
    expect(briefRequests).toHaveLength(1);
  });
});

describe("the project page start dialog", () => {
  test("opening with every file ticked asks nothing; unticking prepares exactly the ticked files, which the matching run adopts", async () => {
    const s = await projectSetup();
    await select(s, []);
    expect(await projectPreparations(s)).toHaveLength(0);

    await select(s, [s.laterId]);
    let rows = await projectPreparations(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "queued", triggerReason: "selection_changed", excludedDocumentIds: [s.laterId] });
    // After 2 quiet seconds, as on New project.
    expect(rows[0].runAt - Date.now()).toBe(INTAKE_DEBOUNCE_MS);
    await settle(s, 3);
    rows = await projectPreparations(s);
    expect(rows[0].status).toBe("ready");
    expect(briefRequests).toHaveLength(1);
    // The run with the same leave-out list matches the preparation's key.
    const hit = await reserve(s, s.projectId, { excludeDocumentIds: [s.laterId] });
    expect((await adoptAtStart(s, hit)).kind).toBe("adopted");
    expect(briefRequests).toHaveLength(1);
    // A run without it misses.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(hit, { status: "failed" });
      await ctx.db.patch(s.projectId, { activeGenerationId: undefined });
    });
    const miss = await reserve(s, s.projectId);
    expect((await adoptAtStart(s, miss)).kind).toBe("derived");
    expect(briefRequests).toHaveLength(2);
  });

  test("the same list again asks nothing; a file added while it is fresh is prepared with the list", async () => {
    const s = await projectSetup();
    await select(s, [s.laterId]);
    await settle(s, 3);
    await select(s, [s.laterId]);
    expect((await projectPreparations(s)).map((prep) => prep.status)).toEqual(["ready"]);
    await s.writer.mutation(api.documents.uploadDocument, {
      projectId: s.projectId, fileName: "rig.txt", fileType: "txt", content: "Rig notes: the chamber held minus 30.",
      source: "context_input", category: "background",
    });
    const queued = (await projectPreparations(s)).find((prep) => prep.status === "queued")!;
    expect(queued.excludedDocumentIds).toEqual([s.laterId]);
  });

  test("only someone who may start a run sets the list, and never with another project's files", async () => {
    const s = await projectSetup();
    await expect(
      s.outsider.mutation(api.briefPreparations.setProjectStartSelection, {
        projectId: s.projectId, excludedTranscriptIds: [], excludedDocumentIds: [s.laterId],
      })
    ).rejects.toThrow();
    const foreign = await s.t.run(async (ctx) => {
      const other = await ctx.db.insert("projects", {
        title: "Other", clientName: "Other Co", status: "draft", projectType: "writing", ownerId: s.userId,
        createdBy: s.userId, shareToken: "other-token", createdAt: 0, updatedAt: 0,
      });
      return await ctx.db.insert("projectDocuments", {
        projectId: other, fileName: "x.txt", fileType: "txt", content: "x", source: "context_input", uploadedBy: s.userId, createdAt: 0,
      });
    });
    await expect(select(s, [foreign])).rejects.toThrow(/another project/);
    expect(await projectPreparations(s)).toHaveLength(0);
  });

  test("a change sent with Start dispatches at once and the run attaches instead of reading again", async () => {
    const s = await projectSetup();
    await preparedProject(s);
    expect(briefRequests).toHaveLength(1);
    // Unticked and started within the 2 seconds.
    await select(s, [s.laterId], true);
    const confirmed = (await projectPreparations(s)).find((prep) => prep.confirmedAt !== undefined)!;
    expect(confirmed).toMatchObject({ status: "running", excludedDocumentIds: [s.laterId] });
    const generationId = await reserve(s, s.projectId, { excludeDocumentIds: [s.laterId] });
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    await settle(s, 3);
    expect((await row(s, confirmed._id)).status).toBe("ready");
    expect(briefRequests).toHaveLength(2);
  });

  test("a run waits on a confirmed start still queued for its slot, which then dispatches, and adopts it (lead decision)", async () => {
    const s = await projectSetup();
    // The project's earlier reading is claimed and its call is in flight.
    await s.t.run(async (ctx) => requestBriefPreparation(ctx, s.projectId, { userId: s.userId, reason: "document_added" }));
    vi.advanceTimersByTime(6_000);
    const first = (await projectPreparations(s))[0];
    await s.t.mutation(internal.briefPreparations.startBriefPreparation, { preparationId: first._id, revision: first.revision });
    expect((await row(s, first._id)).status).toBe("running");
    // Unticked and started: the old reading is superseded, the new one waits for the slot.
    await select(s, [s.laterId], true);
    const confirmed = (await projectPreparations(s)).find((prep) => prep.confirmedAt !== undefined)!;
    expect(confirmed).toMatchObject({ status: "queued", waitingFor: "slot" });
    const generationId = await reserve(s, s.projectId, { excludeDocumentIds: [s.laterId] });
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    const waiter = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationWaiters").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).unique()
    );
    expect(waiter).toMatchObject({ preparationId: confirmed._id, attemptId: "queued", status: "waiting" });
    // The old call ends, the slot frees and the confirmed start dispatches,
    // though the run is going: the run waits on it.
    await runDue(s);
    await runDue(s);
    const dispatched = await row(s, confirmed._id);
    expect(dispatched.status).not.toBe("queued");
    const bound = await s.t.run(async (ctx) => ({
      waiter: await ctx.db.get(waiter!._id),
      generation: await ctx.db.get(generationId),
    }));
    expect(bound.waiter?.attemptId).toBe(dispatched.attemptId);
    expect(bound.generation?.briefPreparation?.attemptId).toBe(dispatched.attemptId);
    await settle(s, 3);
    expect((await row(s, confirmed._id)).status).toBe("ready");
    // One call in all: the old one never called, the run paid for none.
    expect(briefRequests).toHaveLength(1);
    expect((await s.t.run(async (ctx) => ctx.db.get(generationId)))?.briefPreparation?.state).toBe("adopted");
  });

  test("a queued confirmed start that has not dispatched within 30 seconds lets the run go, which derives its own", async () => {
    const s = await projectSetup();
    // The user's slot is held by a call on another project that never ends here.
    await s.t.run(async (ctx) => {
      const other = await ctx.db.insert("projects", {
        title: "Other", clientName: "Other Co", status: "draft", projectType: "writing", ownerId: s.userId,
        createdBy: s.userId, shareToken: "other-token-2", createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("briefPreparations", {
        projectId: other, status: "running", revision: 1, runAt: 0, triggeredBy: s.userId, triggerReason: "x",
        createdAt: Date.now(), updatedAt: Date.now(), attemptId: "held", dispatchedAt: Date.now(),
        leaseExpiresAt: Date.now() + 11 * 60 * 1000, firmDay: firmDayNumber(Date.now()), reservedUsd: 0.01,
      });
    });
    await select(s, [s.laterId], true);
    const confirmed = (await projectPreparations(s)).find((prep) => prep.confirmedAt !== undefined)!;
    expect(confirmed).toMatchObject({ status: "queued", waitingFor: "slot" });
    const generationId = await reserve(s, s.projectId, { excludeDocumentIds: [s.laterId] });
    expect((await adoptAtStart(s, generationId)).kind).toBe("attached");
    vi.advanceTimersByTime(QUEUED_WAITER_DEADLINE_MS + 1_000);
    await s.t.finishInProgressScheduledFunctions();
    const released = await s.t.run(async (ctx) =>
      ctx.db.query("briefPreparationWaiters").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).unique()
    );
    expect(released?.status).toBe("released");
    expect((await s.t.run(async (ctx) => ctx.db.get(generationId)))?.briefPreparation?.state).toBe("released");
    // Its next look finds the run going with nobody waiting: it ends, unsent.
    vi.advanceTimersByTime(31_000);
    await s.t.finishInProgressScheduledFunctions();
    expect(await row(s, confirmed._id)).toMatchObject({ status: "cancelled", endedReason: "generation_active" });
    expect((await row(s, confirmed._id)).dispatchedAt).toBeUndefined();
    // Only the run's own Brief was paid for.
    expect(briefRequests).toHaveLength(1);
  });

  test("Cancel spends nothing: the queued start for the unticked files ends, and a later change reads every file (review P3-5)", async () => {
    const s = await projectSetup();
    await select(s, [s.laterId]);
    const queued = (await projectPreparations(s))[0];
    expect(queued.status).toBe("queued");
    await s.writer.mutation(api.briefPreparations.setProjectStartSelection, {
      projectId: s.projectId, excludedTranscriptIds: [], excludedDocumentIds: [], cancel: true,
    });
    expect(await row(s, queued._id)).toMatchObject({ status: "cancelled", endedReason: "dialog_cancelled" });
    await settle(s, 3);
    expect(briefRequests).toHaveLength(0);
    // The list no longer applies to the next evidence change.
    await s.writer.mutation(api.documents.uploadDocument, {
      projectId: s.projectId, fileName: "rig.txt", fileType: "txt", content: "Rig notes: the chamber held minus 30.",
      source: "context_input", category: "background",
    });
    const next = (await projectPreparations(s)).find((prep) => prep.status === "queued")!;
    expect(next.excludedDocumentIds).toBeUndefined();
    // The uploaded file's words are stored with it.
    const rig = await s.t.run(async (ctx) =>
      (await ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", s.projectId)).collect()).find(
        (document) => document.fileName === "rig.txt"
      )
    );
    expect(rig?.wordCount).toBe(7);
  });
});

describe("reload details (review P2-1, P3-1)", () => {
  test("the count of files still being read comes back while it is fresh, and a report's fiscal year is kept", async () => {
    const s = await setup();
    const draftId = await s.writer.mutation(intakeDraftRefs.createIntakeDraft, {});
    await s.writer.mutation(intakeDraftRefs.saveIntakeSource, {
      draftId, sourceKey: "report-key-1", kind: "document", position: 1000, label: "FY2023 PD.docx", content: "",
      fileType: "docx", category: "previous_pd", intake: "file", extractionOutcome: "ok", fiscalYear: 2023,
    });
    await s.writer.mutation(intakeDraftRefs.reportIntakePendingReads, { draftId, count: 2 });
    const fresh = await s.writer.query(intakeDraftRefs.restoreIntakeDraft, { draftId });
    expect(fresh?.pendingReads).toBe(2);
    expect(fresh?.sources[0]).toMatchObject({ sourceKey: "report-key-1", fiscalYear: 2023, contentLength: 0 });
    await expect(
      s.writer.mutation(intakeDraftRefs.saveIntakeSource, {
        draftId, sourceKey: "report-key-2", kind: "document", position: 1001, label: "x.docx", content: "",
        fileType: "docx", category: "previous_pd", intake: "file", extractionOutcome: "ok", fiscalYear: 20.5,
      })
    ).rejects.toThrow(/fiscal year/);
    // A count not refreshed for 90 seconds (the old page is gone) is not reported.
    vi.advanceTimersByTime(91_000);
    expect((await s.writer.query(intakeDraftRefs.restoreIntakeDraft, { draftId }))?.pendingReads).toBe(0);
  });
});
