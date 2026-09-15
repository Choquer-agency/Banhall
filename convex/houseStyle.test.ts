/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import {
  DEFAULT_HOUSE_RULE_MODES,
  NO_STYLE_OVERRIDES,
  normalizeStyleOverrides,
  resolveEffectiveOverrides,
} from "../shared/styleOverrides";
import { HOUSE_STYLE_MODES_KEY, getHouseRuleModes } from "./houseStyle";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: "auth-writer-hs",
      role: "writer",
    });
    const adminId = await ctx.db.insert("users", {
      authId: "auth-admin-hs",
      role: "admin",
    });
    return { writerId, adminId };
  });
  return {
    t,
    ids,
    writer: t.withIdentity({ subject: "auth-writer-hs" }),
    admin: t.withIdentity({ subject: "auth-admin-hs" }),
  };
}

describe("house style governance modes", () => {
  test("defaults to writer_choice everywhere except openingClauses (off) when no config row exists", async () => {
    const { admin, writer } = await setup();
    const config = await admin.query(api.houseStyle.getConfig, {});
    expect(config.modes).toEqual(DEFAULT_HOUSE_RULE_MODES);
    expect(config.modes.openingClauses).toBe("off");
    expect(config.modes.bannedWords).toBe("writer_choice");
    expect(config.updatedAt).toBeNull();
    await expect(writer.query(api.houseStyle.getModesForMe, {})).resolves.toEqual(
      DEFAULT_HOUSE_RULE_MODES
    );
  });

  test("with no config row, the effective overrides waive openers for a writer with no profile", async () => {
    const { t, ids } = await setup();
    const modes = await t.run(async (ctx) => getHouseRuleModes(ctx));
    const effective = resolveEffectiveOverrides(modes, NO_STYLE_OVERRIDES);
    expect(effective).toEqual({ ...NO_STYLE_OVERRIDES, openingClauses: true });
    expect(ids.writerId).toBeTruthy();
  });

  test("an admin can set openingClauses back to writer_choice or enforced and it sticks", async () => {
    const { t, admin, writer } = await setup();
    for (const mode of ["writer_choice", "enforced"] as const) {
      await admin.mutation(api.houseStyle.setModes, {
        modes: { ...DEFAULT_HOUSE_RULE_MODES, openingClauses: mode },
      });
      await expect(writer.query(api.houseStyle.getModesForMe, {})).resolves.toMatchObject({
        openingClauses: mode,
      });
      const stored = await t.run(async (ctx) => getHouseRuleModes(ctx));
      expect(stored.openingClauses).toBe(mode);
      // Enforced: openers apply even to a writer who waived them; writer_choice: the writer decides.
      const waivingWriter = normalizeStyleOverrides({ openingClauses: true });
      expect(resolveEffectiveOverrides(stored, waivingWriter).openingClauses).toBe(
        mode === "writer_choice"
      );
      expect(resolveEffectiveOverrides(stored, NO_STYLE_OVERRIDES).openingClauses).toBe(false);
    }
  });

  test("admin can set modes; writers read them; audit fields recorded", async () => {
    const { admin, writer, ids } = await setup();
    const modes = {
      ...DEFAULT_HOUSE_RULE_MODES,
      bannedWords: "off" as const,
      openingClauses: "enforced" as const,
    };
    await admin.mutation(api.houseStyle.setModes, { modes });
    const config = await admin.query(api.houseStyle.getConfig, {});
    expect(config.modes).toEqual(modes);
    expect(config.updatedBy).toBe(ids.adminId);
    expect(config.updatedAt).not.toBeNull();
    await expect(writer.query(api.houseStyle.getModesForMe, {})).resolves.toEqual(
      modes
    );
  });

  test("non-admins cannot read the config or set modes", async () => {
    const { writer } = await setup();
    await expect(writer.query(api.houseStyle.getConfig, {})).rejects.toThrow();
    await expect(
      writer.mutation(api.houseStyle.setModes, {
        modes: DEFAULT_HOUSE_RULE_MODES,
      })
    ).rejects.toThrow();
  });

  test("a malformed stored row degrades to the defaults", async () => {
    const { t, admin, ids } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("appSettings", {
        key: HOUSE_STYLE_MODES_KEY,
        value: "{corrupted",
        updatedBy: ids.adminId,
        updatedAt: 1,
      });
    });
    const config = await admin.query(api.houseStyle.getConfig, {});
    expect(config.modes).toEqual(DEFAULT_HOUSE_RULE_MODES);
  });
});
