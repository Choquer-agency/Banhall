/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const adminAuthId = "auth-admin-email-tests";

async function setup() {
  const t = convexTest(schema, modules);
  const adminId = await t.run(async (ctx) =>
    await ctx.db.insert("users", {
      authId: adminAuthId,
      email: "admin@banhall.com",
      role: "admin",
    }),
  );
  return { t, adminId, admin: t.withIdentity({ subject: adminAuthId }) };
}

describe("invite email normalization", () => {
  test("stores a canonical email and blocks case-insensitive pending duplicates", async () => {
    const { t, admin } = await setup();
    const created = await admin.mutation(api.invites.createInvite, {
      email: " User@Banhall.com ",
      firstName: "User",
      lastName: "Example",
      role: "writer",
    });
    const invite = await t.run(async (ctx) => await ctx.db.get(created.inviteId));
    expect(invite?.email).toBe("user@banhall.com");

    await expect(
      admin.mutation(api.invites.createInvite, {
        email: "USER@BANHALL.COM",
        firstName: "Second",
        lastName: "Invite",
        role: "writer",
      }),
    ).rejects.toThrow("pending invite");
  });

  test("blocks an existing normalized member and rejects non-admin creation", async () => {
    const { t, admin } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId: "auth-existing",
        email: "member@banhall.com",
        role: "writer",
      });
    });

    await expect(
      admin.mutation(api.invites.createInvite, {
        email: " MEMBER@BANHALL.COM ",
        firstName: "Existing",
        lastName: "Member",
        role: "writer",
      }),
    ).rejects.toThrow("already has an account");

    await expect(
      t.mutation(api.invites.createInvite, {
        email: "new@banhall.com",
        firstName: "New",
        lastName: "Member",
        role: "writer",
      }),
    ).rejects.toThrow();
  });

  test("signup gate compares canonical input against legacy mixed-case rows", async () => {
    const { t, adminId } = await setup();
    const token = "legacy-email-token";
    await t.run(async (ctx) => {
      await ctx.db.insert("invites", {
        email: " Legacy@Banhall.com ",
        firstName: "Legacy",
        lastName: "Invite",
        role: "writer",
        token,
        invitedBy: adminId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        status: "pending",
      });
    });

    await expect(
      t.query(internal.invites.signupAllowed, {
        email: "legacy@banhall.com",
        token,
      }),
    ).resolves.toBe(true);
    await expect(
      t.query(internal.invites.signupAllowed, {
        email: "legacy@banhall.com",
        token: "wrong-token",
      }),
    ).resolves.toBe(false);
  });
});
