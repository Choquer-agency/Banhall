/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAX_INSTRUCTIONS_CHARS } from "../shared/writerProfileLimits";
import { NO_STYLE_OVERRIDES } from "../shared/styleOverrides";
import { runDeterministicSelfCheck } from "./lib/selfCheckRules";
import type { OrderedProfileContext } from "./lib/orderedChain";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: "auth-writer-profile",
      role: "writer",
    });
    const adminId = await ctx.db.insert("users", {
      authId: "auth-admin-profile",
      role: "admin",
    });
    return { writerId, adminId };
  });
  return {
    t,
    ids,
    writer: t.withIdentity({ subject: "auth-writer-profile" }),
    admin: t.withIdentity({ subject: "auth-admin-profile" }),
  };
}

describe("writer profile instruction limits", () => {
  test("accepts and returns exactly MAX_INSTRUCTIONS_CHARS enabled characters", async () => {
    const { writer } = await setup();
    const text = "x".repeat(MAX_INSTRUCTIONS_CHARS);
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: text,
      enabled: true,
    });
    await expect(writer.query(api.writerProfiles.getMyProfile, {})).resolves.toMatchObject({
      customInstructions: text,
      enabled: true,
    });
  });

  test("rejects MAX_INSTRUCTIONS_CHARS + 1 non-whitespace characters", async () => {
    const { writer } = await setup();
    await expect(
      writer.mutation(api.writerProfiles.saveMyProfile, {
        customInstructions: "x".repeat(MAX_INSTRUCTIONS_CHARS + 1),
        enabled: true,
      })
    ).rejects.toThrow(String(MAX_INSTRUCTIONS_CHARS));
  });

  test("trims before measuring and persisting", async () => {
    const { writer } = await setup();
    const text = `  ${"x".repeat(MAX_INSTRUCTIONS_CHARS)}  `;
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: text,
      enabled: true,
    });
    const profile = await writer.query(api.writerProfiles.getMyProfile, {});
    expect(profile?.customInstructions).toHaveLength(MAX_INSTRUCTIONS_CHARS);
  });

  test("admin saves use the same limit", async () => {
    const { admin, ids } = await setup();
    await expect(
      admin.mutation(api.writerProfiles.saveProfileForUser, {
        userId: ids.writerId,
        customInstructions: "x".repeat(MAX_INSTRUCTIONS_CHARS + 1),
        enabled: true,
      })
    ).rejects.toThrow(String(MAX_INSTRUCTIONS_CHARS));
  });
});

// ─── PSOS-49: per-writer house-style overrides ──────────────────────────────

describe("writer profile style overrides", () => {
  test("writer save persists normalized toggles, readable by writer and admin", async () => {
    const { writer, admin } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Prefer short sentences.",
      enabled: true,
      styleOverrides: { bannedWords: true, openingClauses: true },
    });
    const profile = await writer.query(api.writerProfiles.getMyProfile, {});
    expect(profile?.styleOverrides).toEqual({
      ...NO_STYLE_OVERRIDES,
      bannedWords: true,
      openingClauses: true,
    });
    const rows = await admin.query(api.writerProfiles.listProfiles, {});
    expect(rows[0]?.styleOverrides).toEqual({
      ...NO_STYLE_OVERRIDES,
      bannedWords: true,
      openingClauses: true,
    });
  });

  test("a save that omits styleOverrides preserves stored waivers (stale clients)", async () => {
    const { writer } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Original.",
      enabled: true,
      styleOverrides: { bannedWords: true },
    });
    // Pre-PSOS-49 client shape: no styleOverrides field at all.
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Edited text only.",
      enabled: true,
    });
    const profile = await writer.query(api.writerProfiles.getMyProfile, {});
    expect(profile?.customInstructions).toBe("Edited text only.");
    expect(profile?.styleOverrides?.bannedWords).toBe(true);
  });

  test("admin can set toggles on a writer's behalf", async () => {
    const { admin, writer, ids } = await setup();
    await admin.mutation(api.writerProfiles.saveProfileForUser, {
      userId: ids.writerId,
      customInstructions: "",
      enabled: true,
      styleOverrides: { paragraphDensity: true },
    });
    const profile = await writer.query(api.writerProfiles.getMyProfile, {});
    expect(profile?.styleOverrides?.paragraphDensity).toBe(true);
  });

  test("legacy rows without the field read back and normalize to all-false", async () => {
    const { t, writer, ids } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("writerProfiles", {
        userId: ids.writerId,
        customInstructions: "Legacy instructions.",
        enabled: true,
        updatedBy: ids.writerId,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const profile = await writer.query(api.writerProfiles.getMyProfile, {});
    expect(profile?.styleOverrides).toBeUndefined();
    const forGeneration = await t.query(
      internal.writerProfiles.getProfileForGeneration,
      { userId: ids.writerId }
    );
    expect(forGeneration).toEqual({
      customInstructions: "Legacy instructions.",
      styleOverrides: NO_STYLE_OVERRIDES,
    });
  });

  test("getProfileForGeneration honors toggles-only profiles (empty instructions)", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "",
      enabled: true,
      styleOverrides: { repetitionCaps: true },
    });
    const result = await t.query(
      internal.writerProfiles.getProfileForGeneration,
      { userId: ids.writerId }
    );
    expect(result).toEqual({
      customInstructions: null,
      styleOverrides: { ...NO_STYLE_OVERRIDES, repetitionCaps: true },
    });
  });

  test("global 'off' mode waives for a user with NO profile row (and with none given)", async () => {
    const { t, admin, ids } = await setup();
    await admin.mutation(api.houseStyle.setModes, {
      modes: {
        bannedWords: "off",
        paragraphDensity: "writer_choice",
        sentenceConstruction: "writer_choice",
        repetitionCaps: "writer_choice",
        openingClauses: "writer_choice",
        reportSkeleton: "writer_choice",
      },
    });
    const withUser = await t.query(
      internal.writerProfiles.getProfileForGeneration,
      { userId: ids.writerId }
    );
    expect(withUser?.styleOverrides.bannedWords).toBe(true);
    expect(withUser?.customInstructions).toBeNull();
    // Legacy paths with no recorded requester still get the org-wide waiver.
    const withoutUser = await t.query(
      internal.writerProfiles.getProfileForGeneration,
      {}
    );
    expect(withoutUser?.styleOverrides.bannedWords).toBe(true);
  });

  test("global 'enforced' mode beats the writer's own waiver", async () => {
    const { t, admin, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "My rules.",
      enabled: true,
      styleOverrides: { bannedWords: true, repetitionCaps: true },
    });
    await admin.mutation(api.houseStyle.setModes, {
      modes: {
        bannedWords: "enforced",
        paragraphDensity: "writer_choice",
        sentenceConstruction: "writer_choice",
        repetitionCaps: "writer_choice",
        openingClauses: "writer_choice",
        reportSkeleton: "writer_choice",
      },
    });
    const result = await t.query(
      internal.writerProfiles.getProfileForGeneration,
      { userId: ids.writerId }
    );
    expect(result?.styleOverrides.bannedWords).toBe(false);
    expect(result?.styleOverrides.repetitionCaps).toBe(true);
    expect(result?.customInstructions).toBe("My rules.");
  });

  test("getProfileForGeneration returns null when disabled or empty with no toggles", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Some instructions.",
      enabled: false,
      styleOverrides: { bannedWords: true },
    });
    await expect(
      t.query(internal.writerProfiles.getProfileForGeneration, {
        userId: ids.writerId,
      })
    ).resolves.toBeNull();

    // Explicitly clearing the toggles (empty object → all-false) with
    // whitespace-only instructions leaves nothing to apply.
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "   ",
      enabled: true,
      styleOverrides: {},
    });
    await expect(
      t.query(internal.writerProfiles.getProfileForGeneration, {
        userId: ids.writerId,
      })
    ).resolves.toBeNull();
  });
});

// ─── Story 2 (CAP-5/6/9, AD-26): ordered-generation profile context ─────────

const ALL_WRITER_CHOICE = {
  bannedWords: "writer_choice",
  paragraphDensity: "writer_choice",
  sentenceConstruction: "writer_choice",
  repetitionCaps: "writer_choice",
  openingClauses: "writer_choice",
  reportSkeleton: "writer_choice",
} as const;

describe("ordered generation profile context", () => {
  test("a custom Build Order is stored as sent (trimmed) and returned", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Findings first.",
      enabled: true,
      buildOrder: [" 246", "242 ", "244"],
    });
    expect((await writer.query(api.writerProfiles.getMyProfile, {}))?.buildOrder).toEqual([
      "246",
      "242",
      "244",
    ]);
    const context = await t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: ids.writerId,
    });
    expect(context.profileState).toBe("applied");
    expect(context.buildOrder).toEqual(["246", "242", "244"]);
    expect(context.buildOrderFallbackReason).toBeUndefined();
  });

  test.each([
    [["242", "245", "246"], /^invalid section in Build Order: 245; House Rules default 242 → 244 → 246 used$/],
    [["242", "242", "246"], /^Build Order repeats section 242; /],
    [["246", "242"], /^Build Order is missing section 244; /],
  ])("Build Order %j falls back to 242 → 244 → 246 with a reason and never throws", async (order, reason) => {
    const { t, writer, ids } = await setup();
    await expect(
      writer.mutation(api.writerProfiles.saveMyProfile, {
        customInstructions: "",
        enabled: true,
        buildOrder: order,
      })
    ).resolves.toBeNull();
    // Stored as sent: validity is decided on read so the reason survives.
    expect((await writer.query(api.writerProfiles.getMyProfile, {}))?.buildOrder).toEqual(order);
    const context = await t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: ids.writerId,
    });
    expect(context.buildOrder).toEqual(["242", "244", "246"]);
    expect(context.buildOrderFallbackReason).toMatch(reason);
  });

  test("disabled and missing profiles report profileState and still yield the default order", async () => {
    const { t, writer, ids } = await setup();
    const missing = await t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: ids.writerId,
    });
    expect(missing).toMatchObject({
      profileState: "missing",
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    });
    expect(missing.buildOrderFallbackReason).toBeUndefined();
    expect(
      (await t.query(internal.writerProfiles.getGenerationProfileContext, {})).profileState
    ).toBe("missing");

    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Ignored while disabled.",
      enabled: false,
      buildOrder: ["246", "242", "244"],
      selfCheckRules: [{ instruction: "Lead with the uncertainty.", maxWords: 120 }],
    });
    const disabled = await t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: ids.writerId,
    });
    expect(disabled).toMatchObject({
      profileState: "disabled",
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    });
    expect(disabled.buildOrderFallbackReason).toBeUndefined();
  });

  test("category tier is org_enforced for enforced and off modes, none otherwise", async () => {
    const { t, admin, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "My rules.",
      enabled: true,
      styleOverrides: { bannedWords: true, repetitionCaps: true },
    });
    await admin.mutation(api.houseStyle.setModes, {
      modes: { ...ALL_WRITER_CHOICE, bannedWords: "enforced", paragraphDensity: "off" },
    });
    const context = await t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: ids.writerId,
    });
    const byCategory = Object.fromEntries(
      context.categoryOutcomes.map((outcome) => [outcome.category, outcome])
    );
    expect(context.categoryOutcomes).toHaveLength(6);
    expect(byCategory.bannedWords).toEqual({
      category: "bannedWords",
      mode: "enforced",
      effective: false,
      tier: "org_enforced",
    });
    expect(byCategory.paragraphDensity).toEqual({
      category: "paragraphDensity",
      mode: "off",
      effective: true,
      tier: "org_enforced",
    });
    expect(byCategory.repetitionCaps).toEqual({
      category: "repetitionCaps",
      mode: "writer_choice",
      effective: true,
      tier: "none",
    });
    expect(byCategory.openingClauses).toMatchObject({ effective: false, tier: "none" });
  });

  test("category tier is copied verbatim into Compliance Note rows, never recomputed", async () => {
    const { t, admin, ids } = await setup();
    await admin.mutation(api.houseStyle.setModes, {
      modes: { ...ALL_WRITER_CHOICE, bannedWords: "enforced" },
    });
    const context = await t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: ids.writerId,
    });
    const categoryRows = (profile: OrderedProfileContext) =>
      runDeterministicSelfCheck({
        section: "242",
        text: "The team could not predict the response under load.",
        brief: null,
        profile,
        isFirstInOrder: true,
      }).entries.filter((entry) => entry.key.startsWith("category:"));

    const rows = categoryRows(context);
    expect(rows).toHaveLength(6);
    for (const outcome of context.categoryOutcomes) {
      const row = rows.find((entry) => entry.key === `category:${outcome.category}`);
      expect(row?.row.tier, outcome.category).toBe(outcome.tier);
    }
    // A tier that contradicts its own mode still lands verbatim: the rows
    // copy getEffectiveWriterStyle's outcome and never re-derive it.
    const flipped: OrderedProfileContext = {
      ...context,
      categoryOutcomes: context.categoryOutcomes.map((outcome) => ({
        ...outcome,
        tier: outcome.tier === "none" ? ("org_enforced" as const) : ("none" as const),
      })),
    };
    for (const outcome of flipped.categoryOutcomes) {
      const row = categoryRows(flipped).find(
        (entry) => entry.key === `category:${outcome.category}`
      );
      expect(row?.row.tier, outcome.category).toBe(outcome.tier);
    }
  });

  test("getProfileForGeneration keeps its pre-story shape and null contract", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Short sentences.",
      enabled: true,
      buildOrder: ["246", "242", "244"],
      selfCheckRules: [{ instruction: "Lead with the uncertainty." }],
    });
    const applied = await t.query(internal.writerProfiles.getProfileForGeneration, {
      userId: ids.writerId,
    });
    expect(applied).toEqual({
      customInstructions: "Short sentences.",
      styleOverrides: NO_STYLE_OVERRIDES,
    });
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Short sentences.",
      enabled: false,
    });
    await expect(
      t.query(internal.writerProfiles.getProfileForGeneration, { userId: ids.writerId })
    ).resolves.toBeNull();
  });

  test("Self-check rules are validated on save and returned for an applied profile", async () => {
    const { t, writer, ids } = await setup();
    const save = (selfCheckRules: Array<Record<string, unknown>>) =>
      writer.mutation(api.writerProfiles.saveMyProfile, {
        customInstructions: "",
        enabled: true,
        selfCheckRules: selfCheckRules as never,
      });
    await expect(
      save(Array.from({ length: 21 }, (_, index) => ({ instruction: `Rule ${index}` })))
    ).rejects.toThrow(/at most 20/);
    await expect(save([{ instruction: "x".repeat(501) }])).rejects.toThrow(/500/);
    await expect(save([{ instruction: "   " }])).rejects.toThrow(/needs an instruction/);
    await expect(save([{ instruction: "Cap it.", maxWords: 0 }])).rejects.toThrow(/positive whole number/);
    await expect(save([{ instruction: "Cap it.", maxLines: 2.5 }])).rejects.toThrow(/positive whole number/);
    await expect(save([{ instruction: "Cap it.", paragraphIndex: -1 }])).rejects.toThrow(/non-negative/);

    await save([
      { section: "242", paragraphIndex: 0, instruction: "  Lead with the uncertainty.  ", maxWords: 500 },
    ]);
    const context = await t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: ids.writerId,
    });
    expect(context.selfCheckRules).toEqual([
      { section: "242", paragraphIndex: 0, instruction: "Lead with the uncertainty.", maxWords: 500 },
    ]);
  });
});
