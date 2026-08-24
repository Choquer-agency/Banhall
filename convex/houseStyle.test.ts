/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { DEFAULT_HOUSE_RULE_MODES } from "../shared/styleOverrides";
import { HOUSE_STYLE_MODES_KEY } from "./houseStyle";

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
  test("defaults to writer_choice everywhere when no config row exists", async () => {
    const { admin, writer } = await setup();
    const config = await admin.query(api.houseStyle.getConfig, {});
    expect(config.modes).toEqual(DEFAULT_HOUSE_RULE_MODES);
    expect(config.updatedAt).toBeNull();
    await expect(writer.query(api.houseStyle.getModesForMe, {})).resolves.toEqual(
      DEFAULT_HOUSE_RULE_MODES
    );
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

  test("a malformed stored row degrades to writer_choice", async () => {
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
