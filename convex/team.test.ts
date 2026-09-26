/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { teamApi } from "../src/lib/team/api";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    adminId: await ctx.db.insert("users", {
      authId: "team-admin",
      email: "ada@banhall.com",
      firstName: "Ada",
      lastName: "Admin",
      role: "admin",
      isOwner: true,
    }),
    managerId: await ctx.db.insert("users", {
      authId: "team-manager",
      email: "mo@banhall.com",
      firstName: "Mo",
      lastName: "Manager",
      role: "manager",
    }),
    writerId: await ctx.db.insert("users", {
      authId: "team-writer",
      email: "cy@banhall.com",
      name: "Cy Consultant",
      role: "writer",
      isDeveloper: true,
    }),
    rolelessId: await ctx.db.insert("users", {
      authId: "team-roleless",
      email: "nobody@banhall.com",
    }),
    anonymousId: await ctx.db.insert("users", {
      authId: "team-anon",
      role: "writer",
      isAnonymous: true,
    }),
  }));
  return { t, ...ids };
}

const as = (t: Awaited<ReturnType<typeof setup>>["t"], who: string) =>
  t.withIdentity({ subject: `team-${who}` });

describe("team.listMembers", () => {
  test("Managers and Admins read every member with a role, sorted by name", async () => {
    const { t, managerId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("userActivity", { userId: managerId, lastActiveAt: 1234 });
    });
    for (const who of ["admin", "manager"]) {
      const rows = await as(t, who).query(teamApi.listMembers, {});
      expect(rows.map((row) => row.name)).toEqual([
        "Ada Admin",
        "Cy Consultant",
        "Mo Manager",
      ]);
      const ada = rows.find((row) => row.name === "Ada Admin")!;
      expect(ada).toMatchObject({
        email: "ada@banhall.com",
        firstName: "Ada",
        lastName: "Admin",
        role: "admin",
        isOwner: true,
        isDeveloper: false,
        lastActiveAt: null,
      });
      expect(rows.find((row) => row.name === "Mo Manager")?.lastActiveAt).toBe(1234);
      expect(rows.find((row) => row.name === "Cy Consultant")).toMatchObject({
        firstName: null,
        isDeveloper: true,
      });
      expect(rows.filter((row) => row.isSelf)).toHaveLength(1);
    }
  });

  test("Consultants, roleless and signed-out callers get an empty list", async () => {
    const { t } = await setup();
    expect(await as(t, "writer").query(teamApi.listMembers, {})).toEqual([]);
    expect(await as(t, "roleless").query(teamApi.listMembers, {})).toEqual([]);
    expect(await as(t, "anon").query(teamApi.listMembers, {})).toEqual([]);
    expect(await t.query(teamApi.listMembers, {})).toEqual([]);
  });
});

describe("team.markActive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("writes the first heartbeat and then at most once per 5 minutes", async () => {
    const { t, writerId } = await setup();
    const readRows = () =>
      t.run(async (ctx) =>
        ctx.db
          .query("userActivity")
          .withIndex("by_userId", (q) => q.eq("userId", writerId))
          .take(5),
      );
    const start = Date.now();

    await as(t, "writer").mutation(teamApi.markActive, {});
    expect((await readRows()).map((row) => row.lastActiveAt)).toEqual([start]);

    vi.setSystemTime(start + 4 * 60 * 1000);
    await as(t, "writer").mutation(teamApi.markActive, {});
    expect((await readRows()).map((row) => row.lastActiveAt)).toEqual([start]);

    vi.setSystemTime(start + 5 * 60 * 1000);
    await as(t, "writer").mutation(teamApi.markActive, {});
    expect((await readRows()).map((row) => row.lastActiveAt)).toEqual([
      start + 5 * 60 * 1000,
    ]);
  });

  test("refuses signed-out, anonymous and roleless callers", async () => {
    const { t } = await setup();
    await expect(t.mutation(teamApi.markActive, {})).rejects.toThrow(
      /NOT_AUTHENTICATED|Authentication required/,
    );
    await expect(as(t, "anon").mutation(teamApi.markActive, {})).rejects.toThrow(
      /NOT_AUTHENTICATED|Authentication required/,
    );
    await expect(as(t, "roleless").mutation(teamApi.markActive, {})).rejects.toThrow(
      /NOT_AUTHORIZED|role is required/,
    );
    const rows = await t.run(async (ctx) => ctx.db.query("userActivity").take(5));
    expect(rows).toEqual([]);
  });
});
