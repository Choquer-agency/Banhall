/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAX_INSTRUCTIONS_CHARS } from "../shared/writerProfileLimits";
import {
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  type StyleOverrideKey,
} from "../shared/styleOverrides";
import { runDeterministicSelfCheck } from "./lib/selfCheckRules";
import { pickOrderedProfileContext, type OrderedProfileContext } from "./lib/orderedChain";
import { LINE_LIMITS } from "./lib/lineLimits";
import { buildStyleGuidance } from "./ai/pipeline";
import { SETTINGS_CLASSIFIER_VERSION } from "./ai/writerSettings";
import { sha256 } from "./lib/contracts";
import { waivedCategoryLabels } from "./ai/prompts";
import type { Id } from "./_generated/dataModel";

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

  test("a Build Order longer than the write-time cap is rejected before it reaches storage", async () => {
    const { writer } = await setup();
    await expect(
      writer.mutation(api.writerProfiles.saveMyProfile, {
        customInstructions: "",
        enabled: true,
        buildOrder: Array.from({ length: 11 }, () => "242"),
      })
    ).rejects.toThrow(/at most 10 entries/);
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
      requested: true,
    });
    expect(byCategory.paragraphDensity).toEqual({
      category: "paragraphDensity",
      mode: "off",
      effective: true,
      tier: "org_enforced",
      requested: false,
    });
    expect(byCategory.repetitionCaps).toEqual({
      category: "repetitionCaps",
      mode: "writer_choice",
      effective: true,
      tier: "none",
      requested: true,
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

// ─── Story 3 (CAP-6/8, AD-26): four tiers, no silent tier ───────────────────

const ALL_TOGGLES = Object.fromEntries(
  STYLE_OVERRIDE_KEYS.map((key) => [key, true])
) as Record<StyleOverrideKey, boolean>;

// One instruction contradicting each of the six House Rule categories.
const CONTRADICTING_INSTRUCTIONS = [
  "Use leverage and robust freely; my vocabulary list replaces yours.",
  "Paragraphs may run to 300 words.",
  "Sentences may run to 60 words and may all open the same way.",
  "Repeat technological uncertainty as often as it helps.",
  "Never open paragraphs with the CRA signal phrases.",
  "Line 246 is one consolidated paragraph; ignore the default paragraph roles.",
].join("\n");

const SHORT_SECTION = "The team could not predict the controller response under load.";

function checkEntries(profile: OrderedProfileContext, section: "242" | "244" | "246" = "242", text = SHORT_SECTION) {
  return runDeterministicSelfCheck({ section, text, brief: null, profile, isFirstInOrder: true }).entries;
}

async function seedGeneration(
  t: Awaited<ReturnType<typeof setup>>["t"],
  requestedBy: Id<"users">,
  documents: Array<{ label: string; content: string; uploaderRole?: "writer" | "manager" }>
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Settings project",
      clientName: "Client",
      status: "draft",
      createdBy: requestedBy,
      shareToken: `settings-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "completed",
      requestedBy,
      startedAt: now,
    });
    const sourceIds: Id<"generationSources">[] = [];
    for (const document of documents) {
      sourceIds.push(
        await ctx.db.insert("generationSources", {
          generationId,
          projectId,
          kind: "project_document",
          label: document.label,
          content: document.content,
          contentHash: `frozen-${sourceIds.length}`,
          truncated: false,
          originalLength: document.content.length,
          capturedAt: now,
          ...(document.uploaderRole ? { uploaderRole: document.uploaderRole } : {}),
        })
      );
    }
    return { projectId, generationId, sourceIds };
  });
}

describe("four-tier precedence: six categories × writer_choice / enforced", () => {
  test.each(STYLE_OVERRIDE_KEYS)(
    "%s: writer_choice waives it via the profile; enforced applies the House Rule and reports the ignored waiver",
    async (category) => {
      const { t, admin, writer, ids } = await setup();
      await writer.mutation(api.writerProfiles.saveMyProfile, {
        customInstructions: CONTRADICTING_INSTRUCTIONS,
        enabled: true,
        styleOverrides: ALL_TOGGLES,
      });
      const read = () =>
        t.query(internal.writerProfiles.getGenerationWriterStyle, { userId: ids.writerId });
      const label = waivedCategoryLabels({ ...NO_STYLE_OVERRIDES, [category]: true })[0];
      expect(label).toBeTruthy();

      // Every category writer_choice (the default): every waiver applies.
      let style = await read();
      expect(style.categoryOutcomes).toHaveLength(6);
      expect(
        style.categoryOutcomes.every(
          (outcome) => outcome.effective && outcome.tier === "none" && outcome.requested
        )
      ).toBe(true);
      let entries = checkEntries(pickOrderedProfileContext(style));
      const waived = entries.find((entry) => entry.key === `category:${category}`);
      expect(waived?.row).toMatchObject({ outcome: "not_applied", tier: "none" });
      expect(waived?.row.reason).toMatch(/^instruction waived via override/);
      expect(entries.filter((entry) => entry.key.startsWith("waiver:"))).toEqual([]);
      // House Rule omitted: the waived area is handed to the writer's text.
      expect(
        buildStyleGuidance(undefined, style.customInstructions ?? undefined, style.styleOverrides)
      ).toContain(label);

      // This category enforced by the org.
      await admin.mutation(api.houseStyle.setModes, {
        modes: { ...ALL_WRITER_CHOICE, [category]: "enforced" },
      });
      style = await read();
      expect(style.categoryOutcomes.find((outcome) => outcome.category === category)).toEqual({
        category,
        mode: "enforced",
        effective: false,
        tier: "org_enforced",
        requested: true,
      });
      expect(style.styleOverrides[category]).toBe(false);
      entries = checkEntries(pickOrderedProfileContext(style));
      expect(entries.find((entry) => entry.key === `category:${category}`)?.row).toMatchObject({
        outcome: "applied",
        tier: "org_enforced",
        reason: "House Rule applied: org-enforced (writer waivers are ignored)",
      });
      const waiverRows = entries.filter((entry) => entry.key.startsWith("waiver:"));
      expect(waiverRows.map((entry) => entry.key)).toEqual([`waiver:${category}`]);
      expect(waiverRows[0].row).toMatchObject({
        outcome: "not_applied",
        tier: "org_enforced",
        reason: "org-enforced: this House Rule applies regardless of the Writer Profile",
      });
      expect(waiverRows[0].row.instruction).toMatch(/^Writer Profile waiver: /);
      // House Rule present: the enforced area is no longer handed over.
      expect(
        buildStyleGuidance(undefined, style.customInstructions ?? undefined, style.styleOverrides)
      ).not.toContain(label);
    }
  );

  test("an enforced category with no requested waiver adds no waiver row", async () => {
    const { t, admin, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "My rules.",
      enabled: true,
      styleOverrides: { repetitionCaps: true },
    });
    await admin.mutation(api.houseStyle.setModes, {
      modes: { ...ALL_WRITER_CHOICE, bannedWords: "enforced" },
    });
    const style = await t.query(internal.writerProfiles.getGenerationWriterStyle, { userId: ids.writerId });
    expect(style.categoryOutcomes.find((outcome) => outcome.category === "bannedWords")?.requested).toBe(false);
    expect(
      checkEntries(pickOrderedProfileContext(style)).filter((entry) => entry.key.startsWith("waiver:"))
    ).toEqual([]);
  });
});

describe("cap and Build Order extraction from profile text", () => {
  test("a cap above the Locked cap is extracted, clipped to it and reported as a conflict", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Line 246: no more than 80 lines.",
      enabled: true,
    });
    const context = await t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: ids.writerId,
    });
    expect(context.selfCheckRules).toEqual([
      { section: "246", instruction: "Line 246: no more than 80 lines.", maxLines: 80 },
    ]);
    const row = checkEntries(context, "246", "The work established how the controller behaves under load.").find(
      (entry) => entry.key === "rule:0"
    );
    expect(row?.row).toMatchObject({ outcome: "applied", tier: "conflict" });
    expect(row?.row.reason).toMatch(/^cap met at \d+\/50 lines \(rule asked 80; the Locked cap applies\)$/);
    // No Locked cap changes.
    expect(LINE_LIMITS.s246).toBe(50);
  });

  test("extraction fills only what the profile does not hold structurally; a stored [] stays empty", async () => {
    const { t, writer, ids } = await setup();
    const text = "Build order: 246, 242, 244.\nLine 242: at most 30 lines.";
    await writer.mutation(api.writerProfiles.saveMyProfile, { customInstructions: text, enabled: true });
    let context = await t.query(internal.writerProfiles.getGenerationProfileContext, { userId: ids.writerId });
    expect(context.buildOrder).toEqual(["246", "242", "244"]);
    expect(context.selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242: at most 30 lines.", maxLines: 30 },
    ]);

    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: text,
      enabled: true,
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    });
    context = await t.query(internal.writerProfiles.getGenerationProfileContext, { userId: ids.writerId });
    expect(context.buildOrder).toEqual(["242", "244", "246"]);
    expect(context.selfCheckRules).toEqual([]);
  });

  test("mixed stored fields: each stored field wins and extraction fills only the other", async () => {
    const text = "Build order: 246, 242, 244.\nLine 242: at most 30 lines.";

    // Only a Build Order stored: it wins, and the text's cap rule still applies.
    const onlyOrder = await setup();
    await onlyOrder.writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: text,
      enabled: true,
      buildOrder: ["244", "242", "246"],
    });
    const orderContext = await onlyOrder.t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: onlyOrder.ids.writerId,
    });
    expect(orderContext.buildOrder).toEqual(["244", "242", "246"]);
    expect(orderContext.buildOrderFallbackReason).toBeUndefined();
    expect(orderContext.selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242: at most 30 lines.", maxLines: 30 },
    ]);

    // Only Self-check rules stored: they win, and the text's Build Order still applies.
    const onlyRules = await setup();
    await onlyRules.writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: text,
      enabled: true,
      selfCheckRules: [{ section: "246", instruction: "Stored rule for 246.", maxWords: 300 }],
    });
    const rulesContext = await onlyRules.t.query(internal.writerProfiles.getGenerationProfileContext, {
      userId: onlyRules.ids.writerId,
    });
    expect(rulesContext.buildOrder).toEqual(["246", "242", "244"]);
    expect(rulesContext.selfCheckRules).toEqual([
      { section: "246", instruction: "Stored rule for 246.", maxWords: 300 },
    ]);
  });

  test("an extracted partial Build Order falls back with the resolveBuildOrder reason", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Drafting order: 246 then 242.",
      enabled: true,
    });
    const context = await t.query(internal.writerProfiles.getGenerationProfileContext, { userId: ids.writerId });
    expect(context.buildOrder).toEqual(["242", "244", "246"]);
    expect(context.buildOrderFallbackReason).toMatch(/^Build Order is missing section 244; /);

    // A one-section instruction is never dropped without a reason.
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Build order: 246 first.",
      enabled: true,
    });
    const single = await t.query(internal.writerProfiles.getGenerationProfileContext, { userId: ids.writerId });
    expect(single.buildOrder).toEqual(["242", "244", "246"]);
    expect(single.buildOrderFallbackReason).toMatch(/^Build Order is missing section 242, 244; /);
  });
});

describe("settings documents in the effective-style policy", () => {
  const document = (text: string, addressedCategories: StyleOverrideKey[] | null) => ({
    text,
    supplyPath: "writer_notes" as const,
    addressedCategories,
    fileName: "PD Writing Customized Settings.docx",
  });

  test("a document equal to the enabled profile matches it: the profile applies with its own toggles", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Short sentences.\nLine 242: at most 30 lines.",
      enabled: true,
      styleOverrides: { bannedWords: true },
    });
    const style = await t.query(internal.writerProfiles.getGenerationWriterStyle, {
      userId: ids.writerId,
      settingsDocument: document("  Short sentences.   Line 242: at most 30 lines. ", ["paragraphDensity"]),
    });
    expect(style).toMatchObject({
      matchesProfile: true,
      settingsSource: "profile",
      savedProfileSuperseded: false,
      profileState: "applied",
      customInstructions: "Short sentences.\nLine 242: at most 30 lines.",
    });
    expect(style.styleOverrides).toEqual({ ...NO_STYLE_OVERRIDES, bannedWords: true });
    expect(style.profileReason).toBeUndefined();
  });

  test("a differing document supersedes the enabled profile, and the Writer Profile row says so", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Line 242: at most 30 lines.",
      enabled: true,
      styleOverrides: { bannedWords: true },
      buildOrder: ["246", "242", "244"],
    });
    const style = await t.query(internal.writerProfiles.getGenerationWriterStyle, {
      userId: ids.writerId,
      settingsDocument: document("Findings first.", ["paragraphDensity"]),
    });
    expect(style).toMatchObject({
      matchesProfile: false,
      settingsSource: "writer_notes",
      savedProfileSuperseded: true,
      profileState: "applied",
      customInstructions: "Findings first.",
      // Replaced, not merged: nothing of the saved profile carries over.
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    });
    expect(style.styleOverrides).toEqual({ ...NO_STYLE_OVERRIDES, paragraphDensity: true });
    expect(style.profileReason).toBe(
      "Writer Profile applied from the settings document PD Writing Customized Settings.docx in Writer's Notes; the saved Writer Profile was superseded for this generation"
    );
    const profileRow = checkEntries(pickOrderedProfileContext(style)).find((entry) => entry.key === "profile");
    expect(profileRow?.row).toMatchObject({ outcome: "applied", reason: style.profileReason });
  });

  test("over a disabled profile a document applies without superseding; a failed analysis waives nothing and says why", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Short sentences.",
      enabled: false,
    });
    const style = await t.query(internal.writerProfiles.getGenerationWriterStyle, {
      userId: ids.writerId,
      settingsDocument: document("Short sentences.", null),
    });
    expect(style).toMatchObject({
      matchesProfile: false,
      settingsSource: "writer_notes",
      savedProfileSuperseded: false,
      profileState: "applied",
      waiverAnalysisFailed: true,
    });
    expect(style.profileReason).toBeUndefined();
    expect(style.styleOverrides).toEqual(NO_STYLE_OVERRIDES);
    const categoryRows = checkEntries(pickOrderedProfileContext(style)).filter((entry) =>
      entry.key.startsWith("category:")
    );
    expect(categoryRows).toHaveLength(6);
    expect(
      categoryRows.every(
        (entry) =>
          entry.row.outcome === "applied" &&
          entry.row.reason === "House Rule applied: the settings document could not be analysed for waivers"
      )
    ).toBe(true);
  });

  test("the same settings as a profile and as a document give identical ordered context, flavor and overrides", async () => {
    const { t, writer, ids } = await setup();
    const text = "Use my own vocabulary.\nLine 246: no more than 80 lines.\nBuild order: 246, 242, 244";
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: text,
      enabled: true,
      styleOverrides: { bannedWords: true, reportSkeleton: true },
    });
    const fromProfile = await t.query(internal.writerProfiles.getGenerationWriterStyle, {
      userId: ids.writerId,
    });
    // The admin has no saved profile: only the document applies.
    const fromDocument = await t.query(internal.writerProfiles.getGenerationWriterStyle, {
      userId: ids.adminId,
      settingsDocument: document(text, ["bannedWords", "reportSkeleton"]),
    });
    expect(pickOrderedProfileContext(fromDocument)).toEqual(pickOrderedProfileContext(fromProfile));
    expect(fromDocument.customInstructions).toBe(fromProfile.customInstructions);
    expect(fromDocument.styleOverrides).toEqual(fromProfile.styleOverrides);
    expect(fromProfile.buildOrder).toEqual(["246", "242", "244"]);
  });
});

describe("settings-document candidate, analysis cache and the generation record", () => {
  test("the candidate query applies the trust floor, prefers Writer's Notes and reads the per-project cache", async () => {
    const { t, ids } = await setup();
    const { projectId, generationId, sourceIds } = await seedGeneration(t, ids.writerId, [
      { label: "writer_notes:PD Writing Customized Settings.docx", content: "Client-uploaded settings." },
      { label: "other:Writing settings.docx", content: "Attachment settings.", uploaderRole: "writer" },
      {
        label: "writer_notes:Writer's notes (pasted)",
        content: "PD Writing Customized Settings\nNotes settings.",
        uploaderRole: "manager",
      },
    ]);
    const candidate = await t.query(internal.writerProfiles.getSettingsDocumentCandidate, {
      generationId,
      userId: ids.writerId,
      classifierVersion: SETTINGS_CLASSIFIER_VERSION,
    });
    expect(candidate.document).toMatchObject({
      generationSourceId: sourceIds[2],
      supplyPath: "writer_notes",
      fileName: "Writer's notes (pasted)",
      text: "PD Writing Customized Settings\nNotes settings.",
      truncated: false,
    });
    expect(candidate.matchesProfile).toBe(false);
    expect(candidate.cachedAddressed).toBeNull();

    const contentHash = candidate.document?.contentHash ?? "";
    await t.mutation(internal.writerProfiles.recordSettingsAnalysis, {
      projectId,
      contentHash,
      classifierVersion: SETTINGS_CLASSIFIER_VERSION,
      addressedCategories: ["bannedWords"],
    });
    // Idempotent per key: the first analysis wins.
    await t.mutation(internal.writerProfiles.recordSettingsAnalysis, {
      projectId,
      contentHash,
      classifierVersion: SETTINGS_CLASSIFIER_VERSION,
      addressedCategories: ["reportSkeleton"],
    });
    expect(
      (
        await t.query(internal.writerProfiles.getSettingsDocumentCandidate, {
          generationId,
          classifierVersion: SETTINGS_CLASSIFIER_VERSION,
        })
      ).cachedAddressed
    ).toEqual(["bannedWords"]);
    expect(await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect())).toHaveLength(1);

    // A client-trust settings document alone never qualifies.
    const clientOnly = await seedGeneration(t, ids.writerId, [
      { label: "writer_notes:PD Writing Customized Settings.docx", content: "Client-uploaded settings." },
    ]);
    expect(
      (
        await t.query(internal.writerProfiles.getSettingsDocumentCandidate, {
          generationId: clientOnly.generationId,
          classifierVersion: SETTINGS_CLASSIFIER_VERSION,
        })
      ).document
    ).toBeNull();
  });

  test("a cached analysis at another classifierVersion is never served", async () => {
    const { t, ids } = await setup();
    const { projectId, generationId } = await seedGeneration(t, ids.writerId, [
      { label: "other:Writing settings.docx", content: "Findings first.", uploaderRole: "writer" },
    ]);
    const read = () =>
      t.query(internal.writerProfiles.getSettingsDocumentCandidate, {
        generationId,
        classifierVersion: SETTINGS_CLASSIFIER_VERSION,
      });
    const contentHash = (await read()).document?.contentHash ?? "";
    expect(contentHash).toBe(await sha256("Findings first."));
    await t.mutation(internal.writerProfiles.recordSettingsAnalysis, {
      projectId,
      contentHash,
      classifierVersion: "style-classifier-previous",
      addressedCategories: ["bannedWords"],
    });
    expect((await read()).cachedAddressed).toBeNull();
    // The current version gets its own row; the stale one is left alone.
    await t.mutation(internal.writerProfiles.recordSettingsAnalysis, {
      projectId,
      contentHash,
      classifierVersion: SETTINGS_CLASSIFIER_VERSION,
      addressedCategories: ["reportSkeleton"],
    });
    expect((await read()).cachedAddressed).toEqual(["reportSkeleton"]);
    expect(await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect())).toHaveLength(2);
  });

  test("the candidate reports a document equal to the requester's enabled profile and skips the cache", async () => {
    const { t, writer, ids } = await setup();
    await writer.mutation(api.writerProfiles.saveMyProfile, {
      customInstructions: "Notes settings.",
      enabled: true,
    });
    const { generationId } = await seedGeneration(t, ids.writerId, [
      { label: "writer_notes:Writing settings.md", content: "  Notes   settings. ", uploaderRole: "writer" },
    ]);
    const candidate = await t.query(internal.writerProfiles.getSettingsDocumentCandidate, {
      generationId,
      userId: ids.writerId,
      classifierVersion: SETTINGS_CLASSIFIER_VERSION,
    });
    expect(candidate.matchesProfile).toBe(true);
    expect(candidate.cachedAddressed).toBeNull();
  });

  test("getGenerationWriterSettings: outsiders get null, legacy rows null, the no-profile line and the offer", async () => {
    const { t, writer, ids } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { authId: "auth-outsider" }));
    const outsider = t.withIdentity({ subject: "auth-outsider" });
    const fileName = "PD Writing Customized Settings.docx";
    const { projectId, generationId, sourceIds } = await seedGeneration(t, ids.writerId, [
      { label: `writer_notes:${fileName}`, content: "  Findings first.  ", uploaderRole: "writer" },
    ]);
    // Legacy row: no record yet.
    expect(await writer.query(api.writerProfiles.getGenerationWriterSettings, { generationId })).toBeNull();

    const record = {
      profileState: "applied" as const,
      source: "writer_notes" as const,
      generationSourceId: sourceIds[0],
      fileName,
      matchesProfile: false,
      savedProfileSuperseded: true,
      waiverAnalysis: "analyzed" as const,
      truncated: false,
    };
    await t.mutation(internal.generations.recordWriterSettings, { generationId, writerSettings: record });
    expect(await outsider.query(api.writerProfiles.getGenerationWriterSettings, { generationId })).toBeNull();
    expect(await t.query(api.writerProfiles.getGenerationWriterSettings, { generationId })).toBeNull();
    const withOffer = (offer: Record<string, unknown>) => ({
      profileState: "applied",
      source: "writer_notes",
      fileName,
      matchesProfile: false,
      savedProfileSuperseded: true,
      waiverAnalysis: "analyzed",
      noProfileLine: null,
      offer: { supplyPath: "writer_notes", fileName, text: "Findings first.", ...offer },
    });
    // No categories recorded: the offer carries none.
    expect(await writer.query(api.writerProfiles.getGenerationWriterSettings, { generationId })).toEqual(
      withOffer({ truncated: false, addressedCategories: null })
    );

    // The query never reads the analysis cache: a cached row, even at the
    // current classifier version, changes nothing.
    await t.mutation(internal.writerProfiles.recordSettingsAnalysis, {
      projectId,
      contentHash: await sha256("Findings first."),
      classifierVersion: SETTINGS_CLASSIFIER_VERSION,
      addressedCategories: ["repetitionCaps"],
    });
    expect(
      (await writer.query(api.writerProfiles.getGenerationWriterSettings, { generationId }))?.offer
        ?.addressedCategories
    ).toBeNull();

    // Truncation and categories recorded at resolution reach the offer even
    // when the cache table is empty; the record keeps one entry per category.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("settingsDocumentAnalyses").collect()) {
        await ctx.db.delete(row._id);
      }
    });
    await t.mutation(internal.generations.recordWriterSettings, {
      generationId,
      writerSettings: {
        ...record,
        truncated: true,
        addressedCategories: ["bannedWords", "paragraphDensity", "bannedWords"],
      },
    });
    expect(await t.run((ctx) => ctx.db.query("settingsDocumentAnalyses").collect())).toHaveLength(0);
    expect(await writer.query(api.writerProfiles.getGenerationWriterSettings, { generationId })).toEqual(
      withOffer({ truncated: true, addressedCategories: ["bannedWords", "paragraphDensity"] })
    );

    for (const profileState of ["missing", "disabled"] as const) {
      const { generationId: none } = await seedGeneration(t, ids.writerId, []);
      await t.mutation(internal.generations.recordWriterSettings, {
        generationId: none,
        writerSettings: {
          profileState,
          source: "none",
          matchesProfile: false,
          savedProfileSuperseded: false,
          waiverAnalysis: "none",
          truncated: false,
        },
      });
      expect(await writer.query(api.writerProfiles.getGenerationWriterSettings, { generationId: none })).toEqual({
        profileState,
        source: "none",
        matchesProfile: false,
        savedProfileSuperseded: false,
        waiverAnalysis: "none",
        noProfileLine: "No Writer Profile applied — House Rules in full.",
        offer: null,
      });
    }
  });
});
