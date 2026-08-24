/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("team roster access", () => {
  it("fails closed for unauthenticated, anonymous, and roleless identities", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "roster-writer", role: "writer", firstName: "Writer", email: "writer@example.com" });
      await ctx.db.insert("users", { authId: "roster-anon", role: "writer", isAnonymous: true, firstName: "Anonymous" });
      await ctx.db.insert("users", { authId: "roster-roleless", firstName: "Roleless" });
    });
    await expect(t.query(api.users.listTeam, {})).resolves.toEqual([]);
    await expect(t.withIdentity({ subject: "roster-anon" }).query(api.users.listTeam, {})).resolves.toEqual([]);
    await expect(t.withIdentity({ subject: "roster-roleless" }).query(api.users.listTeam, {})).resolves.toEqual([]);
    await expect(t.withIdentity({ subject: "roster-writer" }).query(api.users.listTeam, {})).resolves.toEqual([
      expect.objectContaining({ name: "Writer", email: "writer@example.com", role: "writer" }),
    ]);
  });
});

describe("developer-tool exposure", () => {
  // 2026-08-19: flag management is limited to developers and workspace
  // Owners — a plain admin can neither see nor change these flags.
  it("is a flag-manager-managed profile flag, not a role or capability", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => ({
      admin: await ctx.db.insert("users", {
        authId: "developer-admin",
        role: "admin",
        firstName: "Admin",
        email: "admin@example.com",
      }),
      owner: await ctx.db.insert("users", {
        authId: "developer-owner",
        role: "admin",
        isOwner: true,
        firstName: "Owner",
        email: "owner@example.com",
      }),
      writer: await ctx.db.insert("users", {
        authId: "developer-writer",
        role: "writer",
        firstName: "Writer",
        email: "writer@example.com",
      }),
    }));
    const admin = t.withIdentity({ subject: "developer-admin" });
    const owner = t.withIdentity({ subject: "developer-owner" });
    const writer = t.withIdentity({ subject: "developer-writer" });

    await expect(
      writer.mutation(api.users.setUserDeveloper, {
        userId: ids.writer,
        isDeveloper: true,
      })
    ).rejects.toThrow(/elevated role|admin/i);

    await expect(
      admin.mutation(api.users.setUserDeveloper, {
        userId: ids.writer,
        isDeveloper: true,
      })
    ).rejects.toThrow(/developers and workspace owners/i);

    await owner.mutation(api.users.setUserDeveloper, {
      userId: ids.writer,
      isDeveloper: true,
    });
    const roster = await admin.query(api.users.listUsers, {});
    expect(roster.find((user) => user._id === ids.writer)).toMatchObject({
      role: "writer",
      isDeveloper: true,
    });

    await t.mutation(internal.users.setDeveloper, {
      email: "writer@example.com",
      isDeveloper: false,
    });
    expect(await t.run((ctx) => ctx.db.get(ids.writer))).toMatchObject({
      role: "writer",
      isDeveloper: false,
    });
  });
});
