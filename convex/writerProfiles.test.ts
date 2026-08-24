/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAX_INSTRUCTIONS_CHARS } from "../shared/writerProfileLimits";
import { NO_STYLE_OVERRIDES } from "../shared/styleOverrides";

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
