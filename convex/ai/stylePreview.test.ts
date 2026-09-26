/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { previewMyStyleRef } from "../../src/lib/settings/stylePreviewApi";
import {
  STYLE_PREVIEW_FIXTURE,
  STYLE_PREVIEW_LIMIT_MESSAGE,
  STYLE_PREVIEW_MAX_WORDS,
  buildStylePreviewPrompt,
  toPreviewParagraphs,
} from "./stylePreview";
import { NO_STYLE_OVERRIDES } from "../../shared/styleOverrides";
import { STYLE_PREVIEW_DAILY_CAP } from "../writerProfiles";
import { HOUSE_STYLE_MODES_KEY } from "../houseStyle";

// Only the model client is replaced; the action, cache, cap and writes are real.
const providerMocks = vi.hoisted(() => ({ create: vi.fn(), role: vi.fn() }));
vi.mock("./providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers")>()),
  clientForRole: async (_ctx: unknown, role: string, meta: unknown) => {
    providerMocks.role(role, meta);
    return { client: { messages: { create: providerMocks.create } }, model: "claude-sonnet-5" };
  },
}));
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ]),
);

const REPLY =
  "Cedarline did not know if FrostLine could hold temperature with the dock doors open.\n\nThe team ran three builds to find out.";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const ana = await ctx.db.insert("users", { authId: "prev-ana", role: "writer" });
    await ctx.db.insert("users", { authId: "prev-sam", role: "manager" });
    await ctx.db.insert("users", { authId: "prev-roleless" });
    await ctx.db.insert("writerProfiles", {
      userId: ana,
      customInstructions: "Short sentences. Never say leverage.",
      enabled: true,
      styleOverrides: { sentenceConstruction: true },
      updatedBy: ana,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  return {
    t,
    ana: t.withIdentity({ subject: "prev-ana" }),
    sam: t.withIdentity({ subject: "prev-sam" }),
    roleless: t.withIdentity({ subject: "prev-roleless" }),
  };
}

beforeEach(() => {
  providerMocks.role.mockReset();
  providerMocks.create.mockReset().mockResolvedValue({
    content: [{ type: "text", text: REPLY }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
});

describe("buildStylePreviewPrompt", () => {
  it("writes the house sample from the facts and house rules only", () => {
    const { system, user } = buildStylePreviewPrompt({ instructions: null, styleOverrides: NO_STYLE_OVERRIDES });
    expect(user).toContain(STYLE_PREVIEW_FIXTURE);
    expect(user).not.toContain("personal style preferences");
    expect(system).toContain(`${STYLE_PREVIEW_MAX_WORDS} words at most`);
    expect(system).toContain("SENTENCE CONSTRUCTION");
    expect(system).toContain("HUMAN PROSE");
  });

  it("adds the writer's instructions and drops the house rules they waive", () => {
    const { system, user } = buildStylePreviewPrompt({
      instructions: "Short sentences.",
      styleOverrides: { ...NO_STYLE_OVERRIDES, sentenceConstruction: true },
    });
    expect(user).toContain("Short sentences.");
    expect(user).toContain("AUTHORITATIVE");
    expect(system).not.toContain("SENTENCE CONSTRUCTION:");
    expect(system).toContain("HUMAN PROSE");
  });
});

describe("toPreviewParagraphs", () => {
  it("keeps two plain paragraphs and strips markdown", () => {
    expect(
      toPreviewParagraphs("# Line 242\n\n**Cedarline** did *not* know.\n\n- The team ran builds.\n\nA third paragraph."),
    ).toEqual(["Cedarline did not know.", "The team ran builds."]);
  });

  it("ends at the last full sentence inside the word cap", () => {
    const sentence = "One two three four five six seven eight nine ten. ";
    const out = toPreviewParagraphs(sentence.repeat(20), 35);
    expect(out).toHaveLength(1);
    expect(out[0]!.split(/\s+/)).toHaveLength(30);
    expect(out[0]!.endsWith(".")).toBe(true);
  });
});

describe("previewMyStyle", () => {
  it("runs on the planning role and returns the sample", async () => {
    const { ana } = await setup();
    const result = await ana.action(previewMyStyleRef, { variant: "preferences" });
    expect(result).toEqual({
      status: "ready",
      cached: false,
      paragraphs: [
        "Cedarline did not know if FrostLine could hold temperature with the dock doors open.",
        "The team ran three builds to find out.",
      ],
    });
    expect(providerMocks.role).toHaveBeenCalledWith(
      "planning",
      expect.objectContaining({ callSite: "settings:style_preview" }),
    );
    const request = providerMocks.create.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(request.messages[0]!.content).toContain("Short sentences. Never say leverage.");
  });

  it("serves a repeat view from the cache without a model call", async () => {
    const { ana } = await setup();
    await ana.action(previewMyStyleRef, { variant: "preferences" });
    const again = await ana.action(previewMyStyleRef, { variant: "preferences" });
    expect(again).toMatchObject({ status: "ready", cached: true });
    expect(providerMocks.create).toHaveBeenCalledTimes(1);
  });

  it("shares the house sample across writers and keeps it free of anyone's instructions", async () => {
    const { t, ana, sam } = await setup();
    await ana.action(previewMyStyleRef, { variant: "house" });
    const forSam = await sam.action(previewMyStyleRef, { variant: "house" });
    expect(forSam).toMatchObject({ status: "ready", cached: true });
    expect(providerMocks.create).toHaveBeenCalledTimes(1);
    const request = providerMocks.create.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(request.messages[0]!.content).not.toContain("Never say leverage");
    const rows = await t.run((ctx) => ctx.db.query("writerStylePreviews").take(10));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBeUndefined();
  });

  it("a change in the org modes makes a new house sample", async () => {
    const { t, ana } = await setup();
    await ana.action(previewMyStyleRef, { variant: "house" });
    await t.run(async (ctx) => {
      const admin = await ctx.db.insert("users", { authId: "prev-admin", role: "admin" });
      await ctx.db.insert("appSettings", {
        key: HOUSE_STYLE_MODES_KEY,
        value: JSON.stringify({ bannedWords: "off" }),
        updatedBy: admin,
        updatedAt: 1,
      });
    });
    expect(await ana.action(previewMyStyleRef, { variant: "house" })).toMatchObject({ cached: false });
    expect(providerMocks.create).toHaveBeenCalledTimes(2);
  });

  it(`stops generating after ${STYLE_PREVIEW_DAILY_CAP} previews a day but still serves the cache`, async () => {
    const { t, ana } = await setup();
    const anaId = await t.run(async (ctx) =>
      (await ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", "prev-ana")).unique())!._id,
    );
    await ana.action(previewMyStyleRef, { variant: "house" });
    await t.run(async (ctx) => {
      for (let i = 1; i < STYLE_PREVIEW_DAILY_CAP; i += 1) {
        await ctx.db.insert("writerStylePreviews", {
          requestedBy: anaId,
          userId: anaId,
          variant: "preferences",
          inputsHash: `old-${i}`,
          paragraphs: ["x"],
          model: "m",
          createdAt: Date.now(),
        });
      }
    });
    expect(await ana.action(previewMyStyleRef, { variant: "preferences" })).toEqual({
      status: "limit",
      message: STYLE_PREVIEW_LIMIT_MESSAGE,
    });
    expect(await ana.action(previewMyStyleRef, { variant: "house" })).toMatchObject({ cached: true });
    expect(providerMocks.create).toHaveBeenCalledTimes(1);
  });

  it("refuses signed-out and roleless callers before any model work", async () => {
    const { t, roleless } = await setup();
    await expect(t.action(previewMyStyleRef, { variant: "house" })).rejects.toThrow(/Authentication required/);
    await expect(roleless.action(previewMyStyleRef, { variant: "house" })).rejects.toThrow(
      /NOT_AUTHORIZED|role is required/,
    );
    expect(providerMocks.role).not.toHaveBeenCalled();
    expect(providerMocks.create).not.toHaveBeenCalled();
  });

  it("fails without storing when the model is cut off", async () => {
    const { t, ana } = await setup();
    providerMocks.create.mockResolvedValue({
      content: [{ type: "text", text: "Cedarline did not" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(ana.action(previewMyStyleRef, { variant: "house" })).rejects.toThrow(/could not be written/);
    expect(await t.run((ctx) => ctx.db.query("writerStylePreviews").take(1))).toEqual([]);
  });
});
