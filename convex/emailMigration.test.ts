/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      email: "admin@banhall.com",
      role: "admin",
    });
    const mixedUserId = await ctx.db.insert("users", {
      email: " Mixed@Banhall.com ",
      role: "writer",
    });
    const collisionAId = await ctx.db.insert("users", {
      email: "COLLISION@BANHALL.COM",
      role: "writer",
    });
    const collisionBId = await ctx.db.insert("users", {
      email: "collision@banhall.com",
      role: "manager",
    });
    await ctx.db.insert("users", { role: "writer" });
    const mixedInviteId = await ctx.db.insert("invites", {
      email: " Invite@Banhall.com ",
      firstName: "Invite",
      lastName: "Mixed",
      role: "writer",
      token: "mixed-invite",
      invitedBy: adminId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      status: "pending",
    });
    await ctx.db.insert("invites", {
      email: "INVITE@BANHALL.COM",
      firstName: "Duplicate",
      lastName: "Pending",
      role: "writer",
      token: "duplicate-invite",
      invitedBy: adminId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      status: "pending",
    });
    return { mixedUserId, collisionAId, collisionBId, mixedInviteId };
  });
  return { t, ...ids };
}

async function runUserMigration(t: Awaited<ReturnType<typeof setup>>["t"], dryRun = false) {
  let cursor: string | null = null;
  let patched = 0;
  do {
    const result: {
      patched: number;
      isDone: boolean;
      continueCursor: string;
    } = await t.mutation(internal.emailMigration.normalizeUserEmails, {
      paginationOpts: { numItems: 2, cursor },
      dryRun,
    });
    patched += result.patched;
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return patched;
}

async function runInviteMigration(t: Awaited<ReturnType<typeof setup>>["t"], dryRun = false) {
  let cursor: string | null = null;
  let patched = 0;
  do {
    const result: {
      patched: number;
      isDone: boolean;
      continueCursor: string;
    } = await t.mutation(internal.emailMigration.normalizeInviteEmails, {
      paginationOpts: { numItems: 1, cursor },
      dryRun,
    });
    patched += result.patched;
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return patched;
}

describe("email normalization migration", () => {
  test("reports legacy values and collisions without mutating", async () => {
    const { t, mixedUserId, collisionAId } = await setup();
    const report = await t.query(internal.emailMigration.report, {});
    expect(report.nonNormalizedUsers.map((row) => row.id)).toEqual(
      expect.arrayContaining([mixedUserId, collisionAId]),
    );
    expect(report.nonNormalizedInvites).toHaveLength(2);
    expect(report.userCollisions).toEqual([
      expect.objectContaining({ normalized: "collision@banhall.com" }),
    ]);
    expect(report.duplicatePendingInvites).toEqual([
      expect.objectContaining({ normalized: "invite@banhall.com" }),
    ]);
    expect(report.missingOrInvalidUserEmails).toBe(1);
  });

  test("dry-run writes nothing", async () => {
    const { t, mixedUserId, mixedInviteId } = await setup();
    expect(await runUserMigration(t, true)).toBe(1);
    expect(await runInviteMigration(t, true)).toBe(2);
    const values = await t.run(async (ctx) => ({
      user: await ctx.db.get(mixedUserId),
      invite: await ctx.db.get(mixedInviteId),
    }));
    expect(values.user?.email).toBe(" Mixed@Banhall.com ");
    expect(values.invite?.email).toBe(" Invite@Banhall.com ");
  });

  test("normalizes unique users and all invites while leaving collisions untouched", async () => {
    const { t, mixedUserId, collisionAId, collisionBId } = await setup();
    expect(await runUserMigration(t)).toBe(1);
    expect(await runInviteMigration(t)).toBe(2);
    const values = await t.run(async (ctx) => ({
      mixed: await ctx.db.get(mixedUserId),
      collisionA: await ctx.db.get(collisionAId),
      collisionB: await ctx.db.get(collisionBId),
      invites: await ctx.db.query("invites").take(10),
    }));
    expect(values.mixed?.email).toBe("mixed@banhall.com");
    expect(values.collisionA?.email).toBe("COLLISION@BANHALL.COM");
    expect(values.collisionB?.email).toBe("collision@banhall.com");
    expect(values.invites.every((invite) => invite.email === "invite@banhall.com")).toBe(true);

    expect(await runUserMigration(t)).toBe(0);
    expect(await runInviteMigration(t)).toBe(0);
  });

  test("normalizes internal setRole lookups", async () => {
    const { t } = await setup();
    const userId = await t.run(async (ctx) =>
      await ctx.db.insert("users", {
        email: "role@banhall.com",
        role: "writer",
      }),
    );
    await t.mutation(internal.users.setRole, {
      email: " ROLE@BANHALL.COM ",
      role: "manager",
    });
    const user = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(user?.role).toBe("manager");
  });
});
