/// <reference types="vite/client" />
/**
 * Phase E, E1a (part 5 of the first 2026-10-26 entry): a writer's saved
 * preferences, private to that writer, suggested by the AI from their own
 * signals and kept only when they approve.
 */
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
  await s.t.mutation(internal.writerMemory.saveSuggestions, {
    userId: s.writerId,
    suggestions: texts.map((text) => ({ text, support: 2, checkedTextKey: preferenceTextKey(text) })),
    request: request.map((entry) => ({ ...entry, projectId: s.projectId })),
  });
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
    expect(row).toMatchObject({ text: "", state: "dismissed", textKey: preferenceTextKey("Avoids the passive voice.") });
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
    // The request the model read was masked: the record's company name is gone.
    const suggestRequest = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [unknown, { body: string }])[1].body));
    expect(JSON.stringify(suggestRequest)).not.toContain("Acme Pumps");

    // A sign-off run within a day of the last run does nothing.
    expect(await s.t.action(internal.ai.writerMemory.suggestForWriter, { userId: s.writerId, reason: "sign_off" })).toBe(0);
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
    });
  });
});

