/// <reference types="vite/client" />
/**
 * Phase E, E1a (part 5 of the first 2026-10-26 entry): a writer's saved
 * preferences, private to that writer, suggested by the AI from their own
 * signals and kept only when they approve.
 */
import { SAVED_PREFERENCE_NOTE, savedPreferencesIn, withoutSavedPreferenceText } from "./lib/savedPreferences";
import { savedPreferencesOfGeneration } from "./lib/savedPreferenceNotes";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { preferenceTextKey } from "./lib/preferenceCheck";
import { DISMISSED_TEXT_KEPT_MS, MAX_OPEN_SUGGESTIONS } from "./writerMemory";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "memory-writer", role: "writer", firstName: "Wren" });
    const otherId = await ctx.db.insert("users", { authId: "memory-other", role: "writer", firstName: "Otto" });
    const adminId = await ctx.db.insert("users", { authId: "memory-admin", role: "admin", firstName: "Ada" });
    await ctx.db.insert("clients", { name: "Acme Pumps", nameKey: "acme pumps", status: "active", createdBy: adminId, createdAt: 1, updatedAt: 1 });
    const projectId = await ctx.db.insert("projects", {
      title: "Seals", clientName: "Acme Pumps", status: "draft", createdBy: writerId, ownerId: writerId,
      shareToken: "memory-token", createdAt: 1, updatedAt: 1,
    });
    return { writerId, otherId, adminId, projectId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "memory-writer" }),
    other: t.withIdentity({ subject: "memory-other" }),
    admin: t.withIdentity({ subject: "memory-admin" }),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const REQUEST = [
  { ref: "learningSignal:a", text: "Seed rewording. AI idea: The team performed testing.\nWriter's rewording: We tested it.", company: "acme" },
  { ref: "learningSignal:b", text: "Seed rewording. AI idea: Testing was performed.\nWriter's rewording: We ran the test.", company: "acme" },
];

async function suggest(s: Setup, texts: string[], request = REQUEST) {
  // Saving needs the run's lease (re-check).
  const lease = (await s.t.mutation(internal.writerMemory.leaseRun, { userId: s.writerId, reason: "nightly" }))!;
  await s.t.mutation(internal.writerMemory.saveSuggestions, {
    userId: s.writerId,
    leaseId: lease.leaseId,
    suggestions: texts.map((text) => ({ text, support: 2, checkedTextKey: preferenceTextKey(text) })),
    request: request.map((entry) => ({ ...entry, projectId: s.projectId })),
  });
  await s.t.mutation(internal.writerMemory.finishRun, { userId: s.writerId, leaseId: lease.leaseId });
  return (await s.writer.query(api.writerMemory.listMine, {})).suggestions;
}

/** A model that answers each tool: suggestions, then the style-only check. */
function stubModel(answers: { suggestions?: unknown; verdicts?: unknown }) {
  const fetchMock = vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const tool = body.tool_choice?.name ?? body.tools?.[0]?.name;
    const input = tool === "submit_preference_suggestions" ? { suggestions: answers.suggestions ?? [] } : { verdicts: answers.verdicts ?? [] };
    return Response.json({
      id: "msg", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", id: "tool", name: tool, input }],
    });
  });
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("writer memory (Phase E, E1a)", () => {
  test("only its writer sees or changes a preference; an Admin and another writer cannot", async () => {
    const s = await setup();
    const [suggestion] = await suggest(s, ["Prefers 'we' to 'the team'."]);
    expect((await s.other.query(api.writerMemory.listMine, {})).suggestions).toEqual([]);
    expect((await s.admin.query(api.writerMemory.listMine, {})).suggestions).toEqual([]);
    await expect(s.other.mutation(api.writerMemory.approve, { memoryId: suggestion!._id })).rejects.toThrow(/Preference not found/);
    await expect(s.admin.mutation(api.writerMemory.remove, { memoryId: suggestion!._id })).rejects.toThrow(/Preference not found/);
    await s.writer.mutation(api.writerMemory.approve, { memoryId: suggestion!._id });
    expect((await s.writer.query(api.writerMemory.listMine, {})).saved.map((row) => [row.text, row.on])).toEqual([["Prefers 'we' to 'the team'.", true]]);
    // Approval drops the suggestion's request texts.
    expect(await s.t.run((ctx) => ctx.db.query("writerMemorySources").collect())).toEqual([]);
  });

  test("approval checks the request again, and a suggestion whose work was erased is withdrawn", async () => {
    const s = await setup();
    // "flotation" comes from one company's work: not a way of writing.
    const flotation = [{ ref: "learningSignal:c", text: "Writer's rewording: the flotation trials ran long.", company: "acme" }];
    const [risky] = await suggest(s, ["Calls the flotation work 'the trials'."], flotation);
    await expect(s.writer.mutation(api.writerMemory.approve, { memoryId: risky!._id })).rejects.toThrow(/term from the work/);

    const kept = (await suggest(s, ["Keeps each sentence short."])).find((row) => row.text === "Keeps each sentence short.");
    await s.t.run(async (ctx) => {
      const [source] = await ctx.db.query("writerMemorySources").withIndex("by_memoryId", (q) => q.eq("memoryId", kept!._id)).collect();
      await ctx.db.delete(source!._id);
    });
    expect((await s.writer.query(api.writerMemory.listMine, {})).suggestions.map((row) => row.text)).not.toContain("Keeps each sentence short.");
    expect(await s.writer.mutation(api.writerMemory.approve, { memoryId: kept!._id })).toBe("withdrawn");
    expect(await s.t.run((ctx) => ctx.db.get(kept!._id))).toBeNull();
  });

  test("a dismissed suggestion is not suggested again, and its text is cleared after 90 days", async () => {
    const s = await setup();
    const [suggestion] = await suggest(s, ["Avoids the passive voice."]);
    await s.writer.mutation(api.writerMemory.dismiss, { memoryId: suggestion!._id });
    expect(await suggest(s, ["Avoids the passive voice."])).toEqual([]);
    await s.t.run((ctx) => ctx.db.patch(suggestion!._id, { decidedAt: Date.now() - DISMISSED_TEXT_KEPT_MS - 1 }));
    expect(await s.t.mutation(internal.writerMemory.clearDismissedTexts, {})).toBe(1);
    const row = await s.t.run((ctx) => ctx.db.get(suggestion!._id));
    expect(row).toMatchObject({ text: "", state: "cleared", textKey: preferenceTextKey("Avoids the passive voice.") });
  });

  test("at most five open suggestions", async () => {
    const s = await setup();
    const texts = ["Keeps it short.", "Avoids jargon.", "Uses plain words.", "Starts with the result.", "Writes in the past tense.", "Avoids repeating words."];
    expect(await suggest(s, texts)).toHaveLength(MAX_OPEN_SUGGESTIONS);
  });

  test("a written preference passes both checks; a name or a fact is refused; an edited suggestion is approved", async () => {
    const s = await setup();
    stubModel({ verdicts: [{ index: 1, styleOnly: true }] });
    await s.writer.action(api.ai.writerMemory.saveText, { text: "Uses Canadian spelling." });
    await expect(s.writer.action(api.ai.writerMemory.saveText, { text: "Mentions acme pumps by name." })).rejects.toThrow(/name of a company/);
    stubModel({ verdicts: [{ index: 1, styleOnly: false }] });
    await expect(s.writer.action(api.ai.writerMemory.saveText, { text: "Always says the pilot failed." })).rejects.toThrow(/fact about the work/);

    stubModel({ verdicts: [{ index: 1, styleOnly: true }] });
    const [suggestion] = await suggest(s, ["Keeps sentences short."]);
    await s.writer.action(api.ai.writerMemory.saveText, { memoryId: suggestion!._id, text: "Keeps sentences under 20 words." });
    const mine = await s.writer.query(api.writerMemory.listMine, {});
    expect(mine.suggestions).toEqual([]);
    expect(mine.saved.map((row) => [row.text, row.origin])).toEqual([
      ["Uses Canadian spelling.", "written"],
      ["Keeps sentences under 20 words.", "suggested"],
    ]);
    // Another writer cannot edit it.
    await expect(s.other.action(api.ai.writerMemory.saveText, { memoryId: suggestion!._id, text: "Keeps it short." })).rejects.toThrow(/Preference not found/);
  });

  test("a suggestion run keeps only suggestions backed by two signals that pass both checks", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("learningSignals", {
          kind: "seed_rewording", sourceKey: `seedSelection:${index}`, projectId: s.projectId, producerId: s.writerId,
          payload: { before: "The team performed testing of the seal.", after: `We tested the seal ${index}.` }, at: 10 + index,
        });
      }
    });
    const fetchMock = stubModel({
      suggestions: [
        { text: "Prefers 'we' to 'the team'.", signals: [1, 2] },
        { text: "Prefers short sentences.", signals: [3] },
        { text: "Calls the HydroFlex unit 'the seal'.", signals: [1, 3] },
        { text: "Prefers the active voice.", signals: [2, 3] },
      ],
      verdicts: [
        { index: 1, styleOnly: true },
        { index: 2, styleOnly: false },
      ],
    });
    expect(await s.t.action(internal.ai.writerMemory.suggestForWriter, { userId: s.writerId, reason: "nightly" })).toBe(1);
    const mine = await s.writer.query(api.writerMemory.listMine, {});
    expect(mine.suggestions.map((row) => [row.text, row.support])).toEqual([["Prefers 'we' to 'the team'.", 2]]);
    // The suggestion keeps its whole request, not only the signals it cited.
    expect(await s.t.run(async (ctx) => (await ctx.db.query("writerMemorySources").collect()).length)).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A new signal arrives; a sign-off run within a day of the last one does nothing, with no call.
    await s.t.run((ctx) =>
      ctx.db.insert("learningSignals", {
        kind: "seed_rewording", sourceKey: "seedSelection:new", projectId: s.projectId, producerId: s.writerId,
        payload: { before: "Long.", after: "Short." }, at: Date.now(),
      })
    );
    expect(await s.t.action(internal.ai.writerMemory.suggestForWriter, { userId: s.writerId, reason: "sign_off" })).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a failed run leaves its signals; the next reads every stream newest first, with the project's names masked (review)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.insert("transcripts", { projectId: s.projectId, content: "Priya Raman: We tuned the seal.\nInterviewer: Why?", label: "Interview", createdAt: 1 });
      const generationId = await ctx.db.insert("generations", { projectId: s.projectId, status: "completed", requestedBy: s.writerId, startedAt: 1 });
      await ctx.db.insert("learningSignals", {
        kind: "seed_rewording", sourceKey: "seedSelection:old", projectId: s.projectId, producerId: s.writerId,
        payload: { before: "Old idea.", after: "An older rewording." }, at: 5,
      });
      await ctx.db.insert("sectionEditEvents", {
        projectId: s.projectId, generationId, section: "s242", userId: s.writerId, editRatio: 0.4, createdAt: 50,
        draftText: "Acme Pumps and Priya Raman performed testing of the seal.", approvedText: "We tested the seal.",
      });
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "no" } }), { status: 400 })));
    await expect(s.t.action(internal.ai.writerMemory.suggestForWriter, { userId: s.writerId, reason: "nightly" })).rejects.toThrow();
    const [failed] = await s.t.run((ctx) => ctx.db.query("writerMemoryRuns").collect());
    expect(failed).toMatchObject({ leaseUntil: 0 });
    expect(failed!.cursorAt).toBeUndefined();

    const fetchMock = stubModel({ suggestions: [] });
    await s.t.action(internal.ai.writerMemory.suggestForWriter, { userId: s.writerId, reason: "nightly" });
    const body = String((fetchMock.mock.calls[0] as unknown as [unknown, { body: string }])[1].body);
    // The section edit (newer) comes before the Seed rewording (older).
    expect(body.indexOf("Section edit.")).toBeGreaterThan(-1);
    expect(body.indexOf("Section edit.")).toBeLessThan(body.indexOf("Seed rewording."));
    expect(body).not.toContain("Acme Pumps");
    expect(body).not.toContain("Priya Raman");
    const [done] = await s.t.run((ctx) => ctx.db.query("writerMemoryRuns").collect());
    expect(done!.cursorAt).toBe(50);
  });

  test("names on the writer's projects are refused by their parts; a company by its first word (review)", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch(s.projectId, { interviewer: "Dana Whitlock" }));
    stubModel({ verdicts: [{ index: 1, styleOnly: true }] });
    await expect(s.writer.action(api.ai.writerMemory.saveText, { text: "Mentions dana by first name." })).rejects.toThrow(/name of a company/);
    await expect(s.writer.action(api.ai.writerMemory.saveText, { text: "Calls acme's pump the prototype." })).rejects.toThrow(/name of a company/);
  });

  test("an edit or approval of a suggestion whose project is being erased withdraws it (review)", async () => {
    const s = await setup();
    const [first, second] = await suggest(s, ["Keeps it short.", "Avoids jargon."]);
    await s.t.run((ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: 9 }));
    stubModel({ verdicts: [{ index: 1, styleOnly: true }] });
    await expect(s.writer.action(api.ai.writerMemory.saveText, { memoryId: first!._id, text: "Keeps it very short." })).rejects.toThrow(/withdrawn/);
    expect(await s.writer.mutation(api.writerMemory.approve, { memoryId: second!._id })).toBe("withdrawn");
    expect((await s.writer.query(api.writerMemory.listMine, {})).suggestions).toEqual([]);
  });

  test("the sweep withdraws suggestions of erased work, freeing their places (review)", async () => {
    const s = await setup();
    await suggest(s, ["Keeps it short.", "Avoids jargon.", "Uses plain words.", "Starts with the result.", "Writes in the past tense."]);
    await s.t.run(async (ctx) => {
      for (const row of await ctx.db.query("writerMemorySources").collect()) await ctx.db.delete(row._id);
    });
    expect(await s.t.mutation(internal.writerMemory.withdrawBrokenSuggestions, {})).toBe(5);
    expect(await s.t.run((ctx) => ctx.db.query("writerMemories").collect())).toEqual([]);
    expect(await suggest(s, ["Avoids repeating words."])).toHaveLength(1);
  });

  test("the cleanup reaches every dismissed text past its first page (review)", async () => {
    vi.useFakeTimers();
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < 250; index += 1) {
        await ctx.db.insert("writerMemories", {
          userId: s.writerId, text: `Old idea ${index}.`, textKey: `old idea ${index}`, state: "dismissed", origin: "suggested",
          createdAt: 1, decidedAt: 1, updatedAt: 1,
        });
      }
    });
    await s.t.mutation(internal.writerMemory.clearDismissedTexts, {});
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await s.t.run((ctx) => ctx.db.query("writerMemories").collect());
    expect(rows.filter((row) => row.state === "cleared" && row.text === "")).toHaveLength(250);
  });

  test("an older run never clears a newer run's lease (review)", async () => {
    const s = await setup();
    const first = await s.t.mutation(internal.writerMemory.leaseRun, { userId: s.writerId, reason: "nightly" });
    await s.t.run(async (ctx) => {
      const [run] = await ctx.db.query("writerMemoryRuns").collect();
      await ctx.db.patch(run!._id, { leaseUntil: 0 });
    });
    const second = await s.t.mutation(internal.writerMemory.leaseRun, { userId: s.writerId, reason: "nightly" });
    await s.t.mutation(internal.writerMemory.finishRun, { userId: s.writerId, leaseId: first!.leaseId, consumedAt: 99 });
    const [run] = await s.t.run((ctx) => ctx.db.query("writerMemoryRuns").collect());
    expect(run).toMatchObject({ leaseId: second!.leaseId });
    expect(run!.leaseUntil).toBeGreaterThan(0);
    expect(run!.cursorAt).toBeUndefined();
  });

  test("saving with a lease another run took over saves nothing (re-check)", async () => {
    const s = await setup();
    const stale = (await s.t.mutation(internal.writerMemory.leaseRun, { userId: s.writerId, reason: "nightly" }))!;
    await s.t.run(async (ctx) => {
      const [run] = await ctx.db.query("writerMemoryRuns").collect();
      await ctx.db.patch(run!._id, { leaseUntil: 0 });
    });
    await s.t.mutation(internal.writerMemory.leaseRun, { userId: s.writerId, reason: "nightly" });
    const saved = await s.t.mutation(internal.writerMemory.saveSuggestions, {
      userId: s.writerId,
      leaseId: stale.leaseId,
      suggestions: [{ text: "Keeps it short.", support: 2, checkedTextKey: preferenceTextKey("Keeps it short.") }],
      request: REQUEST.map((entry) => ({ ...entry, projectId: s.projectId })),
    });
    expect(saved).toBe(0);
    expect((await s.writer.query(api.writerMemory.listMine, {})).suggestions).toEqual([]);
  });

  test("dismissing a suggestion of erased work withdraws it instead of keeping its text (re-check)", async () => {
    const s = await setup();
    const [suggestion] = await suggest(s, ["Keeps it short."]);
    await s.t.run((ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: 9 }));
    await s.writer.mutation(api.writerMemory.dismiss, { memoryId: suggestion!._id });
    expect(await s.t.run((ctx) => ctx.db.query("writerMemories").collect())).toEqual([]);
  });

  test("a run needs two signals newer than its cursor, not two in its window (re-check)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < 5; index += 1) {
        await ctx.db.insert("learningSignals", {
          kind: "seed_rewording", sourceKey: `seedSelection:old-${index}`, projectId: s.projectId, producerId: s.writerId,
          payload: { before: "The team performed testing.", after: `We tested it ${index}.` }, at: 10 + index,
        });
      }
      await ctx.db.insert("writerMemoryRuns", { userId: s.writerId, leaseUntil: 0, cursorAt: 100 });
      await ctx.db.insert("learningSignals", {
        kind: "seed_rewording", sourceKey: "seedSelection:new-1", projectId: s.projectId, producerId: s.writerId,
        payload: { before: "Testing was performed.", after: "We ran the test." }, at: 200,
      });
    });
    const fetchMock = stubModel({ suggestions: [] });
    expect(await s.t.action(internal.ai.writerMemory.suggestForWriter, { userId: s.writerId, reason: "nightly" })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await s.t.run((ctx) =>
      ctx.db.insert("learningSignals", {
        kind: "seed_rewording", sourceKey: "seedSelection:new-2", projectId: s.projectId, producerId: s.writerId,
        payload: { before: "Analysis was done.", after: "We analysed it." }, at: 201,
      })
    );
    await s.t.action(internal.ai.writerMemory.suggestForWriter, { userId: s.writerId, reason: "nightly" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a run makes no model call while five suggestions are open (re-check)", async () => {
    const s = await setup();
    await suggest(s, ["Keeps it short.", "Avoids jargon.", "Uses plain words.", "Starts with the result.", "Writes in the past tense."]);
    await s.t.run(async (ctx) => {
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("learningSignals", {
          kind: "seed_rewording", sourceKey: `seedSelection:${index}`, projectId: s.projectId, producerId: s.writerId,
          payload: { before: "The team performed testing.", after: `We tested it ${index}.` }, at: Date.now() + index,
        });
      }
    });
    const fetchMock = stubModel({ suggestions: [] });
    expect(await s.t.action(internal.ai.writerMemory.suggestForWriter, { userId: s.writerId, reason: "nightly" })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("masks with a draft's frozen map only when no interview came after that draft (re-check)", async () => {
    const s = await setup();
    const typed = async (text: string, at: number) =>
      await s.t.run(async (ctx) => {
        const generationId = await ctx.db.insert("generations", { projectId: s.projectId, status: "completed", startedAt: 1 });
        await ctx.db.insert("sectionEditEvents", {
          projectId: s.projectId, generationId, section: "s242", userId: s.writerId, editRatio: 0.4, createdAt: at,
          draftText: text, approvedText: "We tested the seal.",
        });
      });
    await s.t.run(async (ctx) => {
      await ctx.db.insert("transcripts", { projectId: s.projectId, content: "Priya Raman: We tuned the seal.", label: "Interview", createdAt: 1 });
      // The frozen map also names someone no interview does, so its use shows.
      await ctx.db.insert("generations", {
        projectId: s.projectId, status: "completed", startedAt: 2,
        placeholders: [
          { token: "PERSON_1", value: "Priya Raman" },
          { token: "PERSON_2", value: "Zed Quill" },
        ],
      });
    });
    await typed("Priya Raman and Zed Quill performed testing.", 50);
    const frozen = await s.t.query(internal.writerMemory.gatherForWriter, { userId: s.writerId, since: 0 });
    if (!frozen.active) throw new Error("inactive");
    expect(frozen.signals[0]!.text).not.toContain("Zed Quill");
    expect(frozen.signals[0]!.text).not.toContain("Priya Raman");

    // A later interview names Tomas Ek: the frozen map does not know him, so
    // the run builds a fresh map that does.
    await s.t.run((ctx) =>
      ctx.db.insert("transcripts", { projectId: s.projectId, content: "Tomas Ek: The gasket split.", label: "Interview 2", createdAt: 3 })
    );
    await typed("Tomas Ek performed testing.", 60);
    const fresh = await s.t.query(internal.writerMemory.gatherForWriter, { userId: s.writerId, since: 0 });
    if (!fresh.active) throw new Error("inactive");
    expect(fresh.signals.map((signal) => signal.text).join("\n")).not.toContain("Tomas Ek");
  });

  test("cleared rows never crowd the writer's texts out of a run (re-check)", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < 520; index += 1) {
        await ctx.db.insert("writerMemories", {
          userId: s.writerId, text: "", textKey: `cleared ${index}`, state: "cleared", origin: "suggested",
          checkedTextKey: `cleared ${index}`, createdAt: index, decidedAt: index, updatedAt: index,
        });
      }
      await ctx.db.insert("writerMemories", {
        userId: s.writerId, text: "Uses Canadian spelling.", textKey: preferenceTextKey("Uses Canadian spelling."), state: "on",
        origin: "written", checkedTextKey: preferenceTextKey("Uses Canadian spelling."), createdAt: 600, decidedAt: 600, updatedAt: 600,
      });
    });
    const gathered = await s.t.query(internal.writerMemory.gatherForWriter, { userId: s.writerId, since: 0 });
    if (!gathered.active) throw new Error("inactive");
    expect(gathered.existing).toEqual([{ text: "Uses Canadian spelling.", state: "on" }]);
  });

  test("deleting all removes every preference, suggestion and dismissed one", async () => {
    const s = await setup();
    const [first, second] = await suggest(s, ["Keeps it short.", "Avoids jargon."]);
    await s.writer.mutation(api.writerMemory.approve, { memoryId: first!._id });
    await s.writer.mutation(api.writerMemory.dismiss, { memoryId: second!._id });
    expect(await s.writer.mutation(api.writerMemory.removeAll, {})).toEqual({ removed: 2, more: false });
    expect(await s.t.run((ctx) => ctx.db.query("writerMemories").collect())).toEqual([]);
  });

  test("erasing a project removes an open suggestion's texts, so it is withdrawn", async () => {
    const s = await setup();
    await suggest(s, ["Keeps it short."]);
    await s.t.run(async (ctx) => {
      for (const row of await ctx.db.query("writerMemorySources").withIndex("by_projectId", (q) => q.eq("projectId", s.projectId)).collect()) {
        await ctx.db.delete(row._id);
      }
    });
    expect((await s.writer.query(api.writerMemory.listMine, {})).suggestions).toEqual([]);
  });

  describe("use with the writer's style (E1b)", () => {
    async function savePreferences(s: Setup, texts: Array<[string, "on" | "off"]>) {
      await s.t.run(async (ctx) => {
        for (const [index, [text, state]] of texts.entries()) {
          await ctx.db.insert("writerMemories", {
            userId: s.writerId, text, textKey: preferenceTextKey(text), state, origin: "written",
            checkedTextKey: preferenceTextKey(text), createdAt: index, decidedAt: index, updatedAt: index,
          });
        }
      });
    }
    async function profile(s: Setup, customInstructions: string, enabled = true) {
      await s.t.run((ctx) =>
        ctx.db.insert("writerProfiles", { userId: s.writerId, customInstructions, enabled, updatedBy: s.writerId, createdAt: 1, updatedAt: 1 })
      );
    }
    const style = (s: Setup, settingsDocument?: { text: string }) =>
      s.t.query(internal.writerProfiles.getGenerationWriterStyle, {
        userId: s.writerId,
        ...(settingsDocument ? { settingsDocument: { ...settingsDocument, supplyPath: "attachment" as const, addressedCategories: null } } : {}),
      });

    test("join the profile text in order, only the ones that are on, with a count and fingerprint", async () => {
      const s = await setup();
      await profile(s, "Use we.");
      await savePreferences(s, [["Uses Canadian spelling.", "on"], ["Avoids jargon.", "off"], ["Keeps sentences short.", "on"]]);
      const result = await style(s);
      expect(result.customInstructions).toBe("Use we.\n\nSaved preferences:\n- Uses Canadian spelling.\n- Keeps sentences short.");
      expect(result.savedPreferences).toMatchObject({ count: 2, textHash: expect.any(String) });
    });

    test("a writer with no profile row still gets them; a profile switched off or replaced by a settings document does not", async () => {
      const s = await setup();
      await savePreferences(s, [["Uses Canadian spelling.", "on"]]);
      expect((await style(s)).customInstructions).toBe("Saved preferences:\n- Uses Canadian spelling.");
      expect(await s.t.query(internal.writerProfiles.getProfileForGeneration, { userId: s.writerId })).toMatchObject({
        customInstructions: "Saved preferences:\n- Uses Canadian spelling.",
      });
      // A settings document that replaces the profile replaces them too.
      const replaced = await style(s, { text: "Write in the passive voice." });
      expect(replaced.customInstructions).toBe("Write in the passive voice.");
      expect(replaced.savedPreferences).toBeUndefined();
      await profile(s, "Use we.", false);
      expect((await style(s)).customInstructions).toBeNull();
    });

    test("with no saved preference the writer's style is unchanged, byte for byte", async () => {
      const s = await setup();
      await profile(s, "Use we.\nKeep it short.");
      const result = await style(s);
      expect(result.customInstructions).toBe("Use we.\nKeep it short.");
      expect(result.savedPreferences).toBeUndefined();
    });

    test("the Brief says how many a draft used", async () => {
      const s = await setup();
      const generationId = await s.t.run((ctx) =>
        ctx.db.insert("generations", {
          projectId: s.projectId, status: "running", requestedBy: s.writerId, startedAt: 1,
          writerSettings: {
            profileState: "applied", source: "profile", matchesProfile: false, savedProfileSuperseded: false,
            waiverAnalysis: "profile", truncated: false, savedPreferences: { count: 3, textHash: "h" },
          },
        })
      );
      const view = await s.writer.query(api.writerProfiles.getGenerationWriterSettings, { generationId });
      expect(view?.savedPreferencesLine).toBe("3 saved preferences used.");
      // E1b review: a draft keeps its count after the writer deletes them all.
      await s.writer.mutation(api.writerMemory.removeAll, {});
      expect((await s.writer.query(api.writerProfiles.getGenerationWriterSettings, { generationId }))?.savedPreferencesLine).toBe(
        "3 saved preferences used."
      );
    });

    test("join in the order they were approved, not made, and record their ids (review)", async () => {
      const s = await setup();
      await s.t.run(async (ctx) => {
        for (const [text, createdAt, decidedAt] of [
          ["Made first, approved last.", 1, 30],
          ["Made last, approved first.", 20, 10],
        ] as const) {
          await ctx.db.insert("writerMemories", {
            userId: s.writerId, text, textKey: preferenceTextKey(text), state: "on", origin: "suggested",
            checkedTextKey: preferenceTextKey(text), createdAt, decidedAt, updatedAt: decidedAt,
          });
        }
      });
      const result = await style(s);
      expect(result.customInstructions).toBe("Saved preferences:\n- Made last, approved first.\n- Made first, approved last.");
      const rows = await s.t.run((ctx) => ctx.db.query("writerMemories").collect());
      const idOf = (text: string) => rows.find((row) => row.text === text)!._id;
      expect(result.savedPreferences?.ids).toEqual([idOf("Made last, approved first."), idOf("Made first, approved last.")]);
    });

    test("another writer's preferences never join a writer's style (review)", async () => {
      const s = await setup();
      await s.t.run((ctx) =>
        ctx.db.insert("writerMemories", {
          userId: s.otherId, text: "Uses British spelling.", textKey: "uses british spelling", state: "on", origin: "written",
          checkedTextKey: "uses british spelling", createdAt: 1, decidedAt: 1, updatedAt: 1,
        })
      );
      await savePreferences(s, [["Uses Canadian spelling.", "on"]]);
      expect((await style(s)).customInstructions).toBe("Saved preferences:\n- Uses Canadian spelling.");
      const other = await s.t.query(internal.writerProfiles.getGenerationWriterStyle, { userId: s.otherId });
      expect(other.customInstructions).toBe("Saved preferences:\n- Uses British spelling.");
    });

    test("with no profile row: chat matches only the stored profile, wording rules apply, and the Brief says both (review)", async () => {
      const s = await setup();
      await savePreferences(s, [["Uses Canadian spelling.", "on"]]);
      expect(await s.t.query(internal.writerProfiles.getProfileForGeneration, { userId: s.writerId })).toMatchObject({
        customInstructions: "Saved preferences:\n- Uses Canadian spelling.",
        profileInstructions: null,
        savedPreferences: { count: 1 },
      });
      const context = await s.t.query(internal.writerProfiles.getGenerationProfileContext, { userId: s.writerId });
      expect(context).toMatchObject({ profileState: "missing", savedPreferencesApplied: true });
      await profile(s, "Use we.");
      expect(await s.t.query(internal.writerProfiles.getProfileForGeneration, { userId: s.writerId })).toMatchObject({
        profileInstructions: "Use we.",
      });

      const generationId = await s.t.run((ctx) =>
        ctx.db.insert("generations", {
          projectId: s.projectId, status: "running", requestedBy: s.writerId, startedAt: 1,
          writerSettings: {
            profileState: "missing", source: "none", matchesProfile: false, savedProfileSuperseded: false,
            waiverAnalysis: "none", truncated: false, savedPreferences: { count: 1, textHash: "h" },
          },
        })
      );
      const view = await s.writer.query(api.writerProfiles.getGenerationWriterSettings, { generationId });
      expect(view).toMatchObject({
        noProfileLine: "No Writer Profile applied. House Rules apply in full, with the saved preferences below.",
        savedPreferencesLine: "1 saved preference used.",
      });
    });

    test("a Compliance Note row never carries a saved preference's text (review)", async () => {
      const s = await setup();
      const saved = savedPreferencesIn("Use we.\n\nSaved preferences:\n- Keeps sentences under 25 words.\n- Uses Canadian spelling.");
      expect(saved).toEqual(["Keeps sentences under 25 words.", "Uses Canadian spelling."]);
      expect(savedPreferencesIn("Use we.")).toEqual([]);
      const note = (instruction: string, reason: string) => ({ section: "242" as const, source: "model" as const, instruction, outcome: "applied" as const, tier: "none" as const, reason, repaired: false });
      expect(withoutSavedPreferenceText(note("Keeps sentences under 25 words.", "Every sentence is short."), saved)).toMatchObject(SAVED_PREFERENCE_NOTE);
      expect(withoutSavedPreferenceText(note("Keeps sentences under 25", "Quoted in part."), saved)).toMatchObject(SAVED_PREFERENCE_NOTE);
      // Third re-check: a deterministic row is never hidden for sharing
      // words; a model row needs four of a preference's words in a row,
      // not only common ones; a short preference only as the whole field.
      const houseRule = { ...note("Use the active voice.", "Every sentence names who acted."), source: "deterministic" as const };
      expect(withoutSavedPreferenceText(houseRule, ["Uses the active voice in every Line."])).toEqual(houseRule);
      const sharesThree = note("Use the active voice.", "Checked.");
      expect(withoutSavedPreferenceText(sharesThree, ["Uses the active voice in every Line."])).toEqual(sharesThree);
      // "with it and the" is all common words; nothing else is shared.
      const sharesCommon = note("Start with it and the summary.", "Checked.");
      expect(withoutSavedPreferenceText(sharesCommon, ["Leads with it and the result."])).toEqual(sharesCommon);
      expect(withoutSavedPreferenceText(note("Concise.", "Checked."), ["Concise."])).toMatchObject(SAVED_PREFERENCE_NOTE);
      const mentionsConcise = note("Keep the summary concise.", "Checked.");
      expect(withoutSavedPreferenceText(mentionsConcise, ["Concise."])).toEqual(mentionsConcise);
      // The whole preference in a deterministic row is still hidden.
      expect(
        withoutSavedPreferenceText({ ...note("Keeps sentences under 25 words.", "Measured."), source: "deterministic" as const }, saved)
      ).toMatchObject(SAVED_PREFERENCE_NOTE);
      expect(withoutSavedPreferenceText(note("Writer Profile", "The writer asked: uses Canadian spelling."), saved)).toMatchObject(SAVED_PREFERENCE_NOTE);
      const profileRow = note("Use we.", "The Line uses we.");
      expect(withoutSavedPreferenceText(profileRow, saved)).toEqual(profileRow);
      expect(withoutSavedPreferenceText(note("Keeps sentences under 25 words.", "x"), [])).toMatchObject({ instruction: "Keeps sentences under 25 words." });

      // The generation's frozen style is read only when it used some.
      const generationId = await s.t.run(async (ctx) => {
        const id = await ctx.db.insert("generations", {
          projectId: s.projectId, status: "running", requestedBy: s.writerId, startedAt: 1,
          writerSettings: {
            profileState: "applied", source: "profile", matchesProfile: false, savedProfileSuperseded: false,
            waiverAnalysis: "profile", truncated: false, savedPreferences: { count: 1, textHash: "h" },
          },
        });
        await ctx.db.insert("generationArtifacts", {
          generationId: id, kind: "writer_style",
          content: JSON.stringify({ styleGuidance: "", writerFlavor: "Use we.\n\nSaved preferences:\n- Uses Canadian spelling.", styleOverrides: {} }),
        });
        return id;
      });
      expect(await s.t.run(async (ctx) => savedPreferencesOfGeneration(ctx, (await ctx.db.get(generationId))!))).toEqual(["Uses Canadian spelling."]);
      await s.t.run((ctx) => ctx.db.patch(generationId, { writerSettings: undefined }));
      expect(await s.t.run(async (ctx) => savedPreferencesOfGeneration(ctx, (await ctx.db.get(generationId))!))).toEqual([]);
    });

    test("stored Compliance Notes never carry a saved preference, in whole or in part, in either field (re-check)", async () => {
      const s = await setup();
      expect(
        withoutSavedPreferenceText(
          { section: "242" as const, source: "model" as const, instruction: "Writer Profile", outcome: "applied" as const, tier: "none" as const, reason: 'The preference "sentences under 25 words" was followed.', repaired: false },
          ["Keeps sentences under 25 words."]
        )
      ).toMatchObject(SAVED_PREFERENCE_NOTE);
      const { generationId, candidateRunId } = await s.t.run(async (ctx) => {
        const generationId = await ctx.db.insert("generations", {
          projectId: s.projectId, status: "running", requestedBy: s.writerId, startedAt: 1,
          writerSettings: {
            profileState: "applied", source: "profile", matchesProfile: false, savedProfileSuperseded: false,
            waiverAnalysis: "profile", truncated: false, savedPreferences: { count: 1, textHash: "h" },
          },
        });
        await ctx.db.insert("generationArtifacts", {
          generationId, kind: "writer_style",
          content: JSON.stringify({ styleGuidance: "", writerFlavor: "Use we.\n\nSaved preferences:\n- Keeps sentences under 25 words.", styleOverrides: {} }),
        });
        await ctx.db.patch(s.projectId, { activeGenerationId: generationId });
        const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
          generationId, projectId: s.projectId, model: "m", label: "A", status: "running", queuedAt: 1,
        });
        return { generationId, candidateRunId };
      });
      const note = (instruction: string, reason: string) => ({
        section: "244" as const, source: "model" as const, instruction, outcome: "applied" as const, tier: "none" as const, reason, repaired: false,
      });
      await s.t.mutation(internal.generations.insertConsistencyNotes, {
        generationId,
        candidateRunId,
        notes: [
          note("Keeps sentences under 25 words.", "Every sentence is short."),
          note("Writer Profile", 'The preference "sentences under 25 words" was followed.'),
          note("Use we.", "The Line uses we."),
        ],
      });
      const stored = await s.t.run((ctx) => ctx.db.query("complianceNotes").collect());
      expect(stored.map((row) => [row.instruction, row.reason])).toEqual([
        [SAVED_PREFERENCE_NOTE.instruction, SAVED_PREFERENCE_NOTE.reason],
        [SAVED_PREFERENCE_NOTE.instruction, SAVED_PREFERENCE_NOTE.reason],
        ["Use we.", "The Line uses we."],
      ]);
      expect(JSON.stringify(stored)).not.toMatch(/under 25 words/);
    });
  });
});

