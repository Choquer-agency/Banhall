/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { getTeamRosterMemberOrNull, isTeamRosterMember, listTeamRoster } from "./lib/teamRoster";

const modules = import.meta.glob("./**/*.ts");

describe("team roster access", () => {
  it("resolves duplicate names by persisted user IDs and excludes present anonymous and deleted users", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const first = await ctx.db.insert("users", { authId: "duplicate-first", role: "writer", name: "Sam Lee" });
      const second = await ctx.db.insert("users", { authId: "duplicate-second", role: "writer", name: "Sam Lee" });
      const anonymous = await ctx.db.insert("users", { authId: "duplicate-anonymous", role: "writer", name: "Sam Lee", isAnonymous: true });
      const deleted = await ctx.db.insert("users", { name: "Deleted member" });
      await ctx.db.delete(deleted);
      return { first, second, anonymous, deleted };
    });
    const persisted = await t.run(async (ctx) => ({
      first: await ctx.db.get(ids.first), second: await ctx.db.get(ids.second),
      anonymous: await ctx.db.get(ids.anonymous), deleted: await ctx.db.get(ids.deleted),
    }));
    expect(ids.first).not.toBe(ids.second);
    expect(persisted.anonymous).toMatchObject({ _id: ids.anonymous, isAnonymous: true });
    expect(persisted.deleted).toBeNull();
    expect(isTeamRosterMember(persisted.first)).toBe(true);
    expect(isTeamRosterMember(persisted.anonymous)).toBe(false);
    expect(isTeamRosterMember(persisted.deleted)).toBe(false);
    const resolved = await t.run(async (ctx) => ({
      first: await getTeamRosterMemberOrNull(ctx, ids.first),
      second: await getTeamRosterMemberOrNull(ctx, ids.second),
      anonymous: await getTeamRosterMemberOrNull(ctx, ids.anonymous),
      deleted: await getTeamRosterMemberOrNull(ctx, ids.deleted),
      roster: await listTeamRoster(ctx),
    }));
    expect(resolved.first).toEqual(persisted.first);
    expect(resolved.second).toEqual(persisted.second);
    expect(resolved.anonymous).toBeNull();
    expect(resolved.deleted).toBeNull();
    expect(resolved.roster).toHaveLength(2);
    expect(resolved.roster).toEqual(expect.arrayContaining([persisted.first, persisted.second]));
    const roster = await t.withIdentity({ subject: "duplicate-first" }).query(api.users.listTeam, {});
    expect(roster).toHaveLength(2);
    expect(roster).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.first, name: "Sam Lee", role: "writer" }),
      expect.objectContaining({ id: ids.second, name: "Sam Lee", role: "writer" }),
    ]));
    expect(roster.map((row) => row.id)).not.toContain(ids.anonymous);
    expect(roster.map((row) => row.id)).not.toContain(ids.deleted);
  });

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
