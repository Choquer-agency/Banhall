/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { MAX_INSTRUCTIONS_CHARS } from "../shared/writerProfileLimits";

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
  test("accepts and returns exactly 60,000 enabled characters", async () => {
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

  test("rejects 60,001 non-whitespace characters", async () => {
    const { writer } = await setup();
    await expect(
      writer.mutation(api.writerProfiles.saveMyProfile, {
        customInstructions: "x".repeat(MAX_INSTRUCTIONS_CHARS + 1),
        enabled: true,
      })
    ).rejects.toThrow("60000");
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
    ).rejects.toThrow("60000");
  });
});
