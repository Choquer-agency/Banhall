/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { getTeamRosterMemberOrNull } from "./lib/teamRoster";
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

// `getTeamRosterMemberOrNull` decides whether a users row may be selected as a
// project owner or assignee: convex/projects.ts:687, projectWorkflow.ts:279,
// ownerBackfill.ts:384 and lib/eligibleOwner.ts:9. `api.users.listTeam` is the
// read that populates those pickers.
describe("team roster eligibility", () => {
  it("selects by users-table id, and refuses anonymous or missing rows", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      // Two distinct accounts sharing one display name: only the id can tell
      // them apart, so a name-based lookup would resolve the wrong person.
      const first = await ctx.db.insert("users", {
        authId: "roster-sam-one",
        role: "writer",
        name: "Sam Lee",
      });
      const second = await ctx.db.insert("users", {
        authId: "roster-sam-two",
        role: "writer",
        name: "Sam Lee",
      });
      const anonymous = await ctx.db.insert("users", {
        authId: "roster-sam-anon",
        role: "writer",
        name: "Sam Lee",
        isAnonymous: true,
      });
      const deleted = await ctx.db.insert("users", {
        authId: "roster-sam-deleted",
        role: "writer",
        name: "Sam Lee",
      });
      await ctx.db.delete(deleted);
      return { first, second, anonymous, deleted };
    });

    const resolve = (userId: (typeof ids)["first"]) =>
      t.run((ctx) => getTeamRosterMemberOrNull(ctx, userId));

    expect((await resolve(ids.first))?._id).toBe(ids.first);
    expect((await resolve(ids.second))?._id).toBe(ids.second);
    // The anonymous row is present and readable: it is refused on its
    // `isAnonymous` flag, not because the lookup found nothing.
    expect(await t.run((ctx) => ctx.db.get(ids.anonymous))).not.toBeNull();
    expect(await resolve(ids.anonymous)).toBeNull();
    expect(await resolve(ids.deleted)).toBeNull();
  });

  it("keeps anonymous records out of the selectable roster", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId: "roster-member",
        role: "writer",
        firstName: "Team",
        lastName: "Member",
        email: "member@example.com",
      });
      await ctx.db.insert("users", {
        authId: "roster-guest",
        role: "writer",
        name: "Guest",
        isAnonymous: true,
      });
    });

    const roster = await t
      .withIdentity({ subject: "roster-member" })
      .query(api.users.listTeam, {});
    expect(roster).toEqual([
      expect.objectContaining({ name: "Team Member", role: "writer" }),
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
