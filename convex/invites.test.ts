/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { INVITE_TTL_MS } from "./invites";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    adminId: await ctx.db.insert("users", {
      authId: "inv-admin",
      email: "admin@banhall.com",
      firstName: "Priya",
      lastName: "Shah",
      role: "admin",
    }),
    managerId: await ctx.db.insert("users", {
      authId: "inv-manager",
      email: "manager@banhall.com",
      firstName: "Mo",
      lastName: "Manager",
      role: "manager",
    }),
    writerId: await ctx.db.insert("users", {
      authId: "inv-writer",
      email: "writer@banhall.com",
      role: "writer",
    }),
    rolelessId: await ctx.db.insert("users", {
      authId: "inv-roleless",
      email: "roleless@banhall.com",
    }),
  }));
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "inv-admin" }),
    manager: t.withIdentity({ subject: "inv-manager" }),
    writer: t.withIdentity({ subject: "inv-writer" }),
    roleless: t.withIdentity({ subject: "inv-roleless" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function insertInvite(
  s: Setup,
  overrides: Partial<{
    email: string;
    role: "writer" | "manager" | "admin";
    token: string;
    invitedBy: Id<"users">;
    createdAt: number;
    expiresAt: number;
    status: "pending" | "accepted" | "revoked";
    firstName: string;
    lastName: string;
  }> = {},
) {
  const now = Date.now();
  return await s.t.run(async (ctx) =>
    ctx.db.insert("invites", {
      email: "new@banhall.com",
      role: "writer",
      token: `token-${Math.random().toString(36).slice(2)}`,
      invitedBy: s.adminId,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
      status: "pending",
      ...overrides,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T18:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createInvites", () => {
  test("creates one link per new address and reports every address", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId: "inv-existing",
        email: "member@banhall.com",
        role: "writer",
      });
    });
    await insertInvite(s, { email: "waiting@banhall.com" });

    const results = await s.admin.mutation(api.invites.createInvites, {
      emails: [
        " New@Banhall.com ",
        "new@banhall.com",
        "not-an-email",
        "member@banhall.com",
        "waiting@banhall.com",
        "second@banhall.com",
      ],
      role: "writer",
    });

    expect(results.map((r) => [r.email, r.status])).toEqual([
      ["new@banhall.com", "created"],
      ["not-an-email", "invalid"],
      ["member@banhall.com", "already_member"],
      ["waiting@banhall.com", "already_invited"],
      ["second@banhall.com", "created"],
    ]);
    const created = results.filter((r) => r.status === "created");
    for (const result of created) {
      if (result.status !== "created") continue;
      const invite = await s.t.run(async (ctx) => ctx.db.get(result.inviteId));
      expect(invite).toMatchObject({
        email: result.email,
        role: "writer",
        token: result.token,
        invitedBy: s.adminId,
        sentAt: Date.now(),
        expiresAt: Date.now() + INVITE_TTL_MS,
        status: "pending",
      });
      expect(invite?.firstName).toBeUndefined();
      expect(invite?.lastName).toBeUndefined();
    }
  });

  test("an expired pending invite does not block a new one", async () => {
    const s = await setup();
    await insertInvite(s, { email: "late@banhall.com", expiresAt: Date.now() - 1 });
    const [result] = await s.admin.mutation(api.invites.createInvites, {
      emails: ["late@banhall.com"],
      role: "writer",
    });
    expect(result?.status).toBe("created");
  });

  test("caps a request at 20 addresses and refuses an empty list", async () => {
    const s = await setup();
    const emails = Array.from({ length: 21 }, (_, i) => `p${i}@banhall.com`);
    await expect(
      s.admin.mutation(api.invites.createInvites, { emails, role: "writer" }),
    ).rejects.toThrow(/at most 20/);
    await expect(
      s.admin.mutation(api.invites.createInvites, { emails: [], role: "writer" }),
    ).rejects.toThrow(/at least one/);
    const ok = await s.admin.mutation(api.invites.createInvites, {
      emails: emails.slice(0, 20),
      role: "writer",
    });
    expect(ok).toHaveLength(20);
  });

  test("Managers invite Consultants and Managers but not Admins", async () => {
    const s = await setup();
    for (const role of ["writer", "manager"] as const) {
      const [result] = await s.manager.mutation(api.invites.createInvites, {
        emails: [`${role}-new@banhall.com`],
        role,
      });
      expect(result?.status).toBe("created");
    }
    await expect(
      s.manager.mutation(api.invites.createInvites, {
        emails: ["boss@banhall.com"],
        role: "admin",
      }),
    ).rejects.toThrow(/NOT_AUTHORIZED|Only an Admin/);
    const [admin] = await s.admin.mutation(api.invites.createInvites, {
      emails: ["boss@banhall.com"],
      role: "admin",
    });
    expect(admin?.status).toBe("created");
  });

  test("Consultants, roleless and signed-out callers cannot invite", async () => {
    const s = await setup();
    for (const caller of [s.writer, s.roleless, s.t]) {
      await expect(
        caller.mutation(api.invites.createInvites, {
          emails: ["x@banhall.com"],
          role: "writer",
        }),
      ).rejects.toThrow(/NOT_AUTHORIZED|NOT_AUTHENTICATED|Authentication|role/);
    }
    const invites = await s.t.run(async (ctx) => ctx.db.query("invites").take(5));
    expect(invites).toEqual([]);
  });
});

describe("listTeamInvites", () => {
  test("shows pending invites newest first with tokens only where manageable", async () => {
    const s = await setup();
    const now = Date.now();
    await insertInvite(s, { email: "old@banhall.com", createdAt: now - 3 * DAY, expiresAt: now + 4 * DAY });
    await insertInvite(s, {
      email: "expired@banhall.com",
      createdAt: now - 9 * DAY,
      expiresAt: now - 2 * DAY,
    });
    await insertInvite(s, { email: "boss@banhall.com", role: "admin", createdAt: now - DAY });
    await insertInvite(s, { email: "gone@banhall.com", status: "revoked" });
    await insertInvite(s, { email: "in@banhall.com", status: "accepted" });

    const asAdmin = await s.admin.query(api.invites.listTeamInvites, {});
    expect(asAdmin.map((row) => row.email)).toEqual([
      "boss@banhall.com",
      "old@banhall.com",
      "expired@banhall.com",
    ]);
    expect(asAdmin.every((row) => row.canManage && typeof row.token === "string")).toBe(true);
    expect(asAdmin.find((row) => row.email === "expired@banhall.com")?.expired).toBe(true);
    expect(asAdmin[0]?.invitedByName).toBe("Priya Shah");

    const asManager = await s.manager.query(api.invites.listTeamInvites, {});
    const boss = asManager.find((row) => row.email === "boss@banhall.com");
    expect(boss).toMatchObject({ canManage: false });
    expect(boss && "token" in boss).toBe(false);
    expect(asManager.find((row) => row.email === "old@banhall.com")?.canManage).toBe(true);
  });

  test("returns nothing to Consultants, roleless and signed-out callers", async () => {
    const s = await setup();
    await insertInvite(s);
    for (const caller of [s.writer, s.roleless, s.t]) {
      expect(await caller.query(api.invites.listTeamInvites, {})).toEqual([]);
    }
  });
});

describe("resendInvite", () => {
  test("replaces the token, restarts the 7 days and retires the old link", async () => {
    const s = await setup();
    const oldToken = "old-token";
    const inviteId = await insertInvite(s, {
      token: oldToken,
      createdAt: Date.now() - 9 * DAY,
      expiresAt: Date.now() - 2 * DAY,
    });
    const { token } = await s.manager.mutation(api.invites.resendInvite, { inviteId });
    expect(token).not.toBe(oldToken);
    const invite = await s.t.run(async (ctx) => ctx.db.get(inviteId));
    expect(invite).toMatchObject({
      token,
      sentAt: Date.now(),
      expiresAt: Date.now() + INVITE_TTL_MS,
      resendCount: 1,
      status: "pending",
    });
    expect(await s.t.query(api.invites.getInviteByToken, { token: oldToken })).toEqual({
      state: "unavailable",
    });
    expect((await s.t.query(api.invites.getInviteByToken, { token }))?.state).toBe("pending");
    await s.manager.mutation(api.invites.resendInvite, { inviteId });
    expect((await s.t.run(async (ctx) => ctx.db.get(inviteId)))?.resendCount).toBe(2);
  });

  test("follows the invite authorization matrix", async () => {
    const s = await setup();
    const adminInvite = await insertInvite(s, { role: "admin" });
    await expect(
      s.manager.mutation(api.invites.resendInvite, { inviteId: adminInvite }),
    ).rejects.toThrow(/NOT_AUTHORIZED|cannot resend/);
    await expect(
      s.writer.mutation(api.invites.resendInvite, { inviteId: adminInvite }),
    ).rejects.toThrow(/NOT_AUTHORIZED|cannot resend/);
    await s.admin.mutation(api.invites.resendInvite, { inviteId: adminInvite });
    const accepted = await insertInvite(s, { status: "accepted" });
    await expect(
      s.admin.mutation(api.invites.resendInvite, { inviteId: accepted }),
    ).rejects.toThrow(/pending/);
  });
});

describe("changeInviteRole", () => {
  test("Managers switch between Consultant and Manager but never to or from Admin", async () => {
    const s = await setup();
    const inviteId = await insertInvite(s, { role: "writer" });
    await s.manager.mutation(api.invites.changeInviteRole, { inviteId, role: "manager" });
    expect((await s.t.run(async (ctx) => ctx.db.get(inviteId)))?.role).toBe("manager");
    await expect(
      s.manager.mutation(api.invites.changeInviteRole, { inviteId, role: "admin" }),
    ).rejects.toThrow(/NOT_AUTHORIZED|cannot change/);
    const adminInvite = await insertInvite(s, { role: "admin" });
    await expect(
      s.manager.mutation(api.invites.changeInviteRole, { inviteId: adminInvite, role: "writer" }),
    ).rejects.toThrow(/NOT_AUTHORIZED|cannot change/);
    await s.admin.mutation(api.invites.changeInviteRole, { inviteId, role: "admin" });
    expect((await s.t.run(async (ctx) => ctx.db.get(inviteId)))?.role).toBe("admin");
    await expect(
      s.writer.mutation(api.invites.changeInviteRole, { inviteId, role: "writer" }),
    ).rejects.toThrow(/NOT_AUTHORIZED|cannot change/);
  });
});

describe("revokeInvite", () => {
  test("records who revoked and when, and the link then reads unavailable", async () => {
    const s = await setup();
    const inviteId = await insertInvite(s, { token: "revoke-me" });
    await s.manager.mutation(api.invites.revokeInvite, { inviteId });
    const invite = await s.t.run(async (ctx) => ctx.db.get(inviteId));
    expect(invite).toMatchObject({
      status: "revoked",
      revokedAt: Date.now(),
      revokedBy: s.managerId,
    });
    expect(await s.t.query(api.invites.getInviteByToken, { token: "revoke-me" })).toEqual({
      state: "unavailable",
    });
    await expect(s.admin.mutation(api.invites.revokeInvite, { inviteId })).rejects.toThrow(
      /pending/,
    );
  });

  test("Managers cannot revoke Admin invites and Consultants cannot revoke any", async () => {
    const s = await setup();
    const adminInvite = await insertInvite(s, { role: "admin" });
    const writerInvite = await insertInvite(s, { role: "writer" });
    await expect(
      s.manager.mutation(api.invites.revokeInvite, { inviteId: adminInvite }),
    ).rejects.toThrow(/NOT_AUTHORIZED|cannot revoke/);
    await expect(
      s.writer.mutation(api.invites.revokeInvite, { inviteId: writerInvite }),
    ).rejects.toThrow(/NOT_AUTHORIZED|cannot revoke/);
    await s.admin.mutation(api.invites.revokeInvite, { inviteId: adminInvite });
  });
});

describe("getInviteByToken", () => {
  test("pending shape carries names, inviter initials and dates", async () => {
    const s = await setup();
    const sentAt = Date.now() - DAY;
    await insertInvite(s, {
      token: "pending-token",
      role: "manager",
      firstName: "Dana",
      lastName: "Lee",
      createdAt: sentAt,
      expiresAt: sentAt + INVITE_TTL_MS,
    });
    expect(await s.t.query(api.invites.getInviteByToken, { token: "pending-token" })).toEqual({
      state: "pending",
      email: "new@banhall.com",
      firstName: "Dana",
      lastName: "Lee",
      role: "manager",
      inviter: { name: "Priya Shah", initials: "PS" },
      sentAt,
      expiresAt: sentAt + INVITE_TTL_MS,
    });
  });

  test("pending without names returns nulls", async () => {
    const s = await setup();
    await insertInvite(s, { token: "no-names" });
    const result = await s.t.query(api.invites.getInviteByToken, { token: "no-names" });
    expect(result).toMatchObject({ state: "pending", firstName: null, lastName: null });
  });

  test("expired shape tells the holder only the inviter name and email", async () => {
    const s = await setup();
    const sentAt = Date.now() - 9 * DAY;
    await insertInvite(s, {
      token: "expired-token",
      createdAt: sentAt,
      expiresAt: sentAt + INVITE_TTL_MS,
      firstName: "Dana",
    });
    expect(await s.t.query(api.invites.getInviteByToken, { token: "expired-token" })).toEqual({
      state: "expired",
      role: "writer",
      inviter: { name: "Priya Shah", firstName: "Priya", email: "admin@banhall.com" },
      sentAt,
      expiresAt: sentAt + INVITE_TTL_MS,
    });
  });

  test("accepted, revoked and unknown tokens read unavailable; an empty token is null", async () => {
    const s = await setup();
    await insertInvite(s, { token: "accepted", status: "accepted" });
    await insertInvite(s, { token: "revoked", status: "revoked" });
    for (const token of ["accepted", "revoked", "unknown"]) {
      expect(await s.t.query(api.invites.getInviteByToken, { token })).toEqual({
        state: "unavailable",
      });
    }
    expect(await s.t.query(api.invites.getInviteByToken, { token: "" })).toBeNull();
  });
});

describe("confirmInviteNames", () => {
  test("stores trimmed names on a live invite", async () => {
    const s = await setup();
    const inviteId = await insertInvite(s, { token: "confirm" });
    await s.t.mutation(api.invites.confirmInviteNames, {
      token: "confirm",
      firstName: "  Dana ",
      lastName: " Lee  ",
    });
    expect(await s.t.run(async (ctx) => ctx.db.get(inviteId))).toMatchObject({
      firstName: "Dana",
      lastName: "Lee",
    });
  });

  test("refuses blank or long names and expired, revoked or unknown invites", async () => {
    const s = await setup();
    await insertInvite(s, { token: "live" });
    await insertInvite(s, { token: "old", expiresAt: Date.now() - 1 });
    await insertInvite(s, { token: "revoked", status: "revoked" });
    const call = (token: string, firstName = "Dana", lastName = "Lee") =>
      s.t.mutation(api.invites.confirmInviteNames, { token, firstName, lastName });
    await expect(call("live", "  ", "Lee")).rejects.toThrow(/required/);
    await expect(call("live", "Dana", "")).rejects.toThrow(/required/);
    await expect(call("live", "x".repeat(101))).rejects.toThrow(/at most 100/);
    await expect(call("old")).rejects.toThrow(/expired/);
    await expect(call("revoked")).rejects.toThrow(/isn't valid/);
    await expect(call("unknown")).rejects.toThrow(/isn't valid/);
  });
});

describe("auth onCreate trigger", () => {
  test("uses the invite's names and accepts the invite", async () => {
    const s = await setup();
    const inviteId = await insertInvite(s, {
      email: "dana@banhall.com",
      token: "join",
      role: "manager",
    });
    await s.t.mutation(api.invites.confirmInviteNames, {
      token: "join",
      firstName: "Dana",
      lastName: "Lee",
    });
    await s.t.mutation(internal.auth.onCreate, {
      model: "user",
      doc: { _id: "auth-dana", email: "Dana@Banhall.com", name: "Dana Lee" },
    });
    const { user, invite } = await s.t.run(async (ctx) => ({
      user: await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", "auth-dana"))
        .unique(),
      invite: await ctx.db.get(inviteId),
    }));
    expect(user).toMatchObject({
      email: "dana@banhall.com",
      firstName: "Dana",
      lastName: "Lee",
      role: "manager",
    });
    expect(invite).toMatchObject({ status: "accepted", acceptedUserId: user?._id });
    // Round 2 (I3): the inviter hears about it, once.
    const notifications = await s.t.run(async (ctx) =>
      ctx.db.query("notifications").take(10),
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      userId: s.adminId,
      kind: "invite_accepted",
      title: "Dana Lee joined Banhall",
      body: "They accepted your invite as Manager.",
      href: "/team",
      dedupeKey: `invite_accepted:${inviteId}`,
    });
  });

  test("skips the inviter's notification when they switched it off", async () => {
    const s = await setup();
    await s.t.run(async (ctx) =>
      ctx.db.insert("notificationSettings", { userId: s.adminId, inviteAccepted: false }),
    );
    await insertInvite(s, { email: "quiet@banhall.com", token: "quiet" });
    await s.t.mutation(api.invites.confirmInviteNames, {
      token: "quiet",
      firstName: "Quinn",
      lastName: "Ito",
    });
    await s.t.mutation(internal.auth.onCreate, {
      model: "user",
      doc: { _id: "auth-quinn", email: "quiet@banhall.com", name: "Quinn Ito" },
    });
    expect(await s.t.run(async (ctx) => ctx.db.query("notifications").take(10))).toHaveLength(0);
  });

  test("refuses an invite whose names were never confirmed", async () => {
    const s = await setup();
    const inviteId = await insertInvite(s, { email: "anon@banhall.com", token: "no-names" });
    await expect(
      s.t.mutation(internal.auth.onCreate, {
        model: "user",
        doc: { _id: "auth-anon", email: "anon@banhall.com", name: "Anon" },
      }),
    ).rejects.toThrow(/First and last name are required/);
    expect((await s.t.run(async (ctx) => ctx.db.get(inviteId)))?.status).toBe("pending");
  });
});

describe("signupAllowed", () => {
  test("compares canonical input against legacy mixed-case rows", async () => {
    const s = await setup();
    const token = "legacy-email-token";
    await insertInvite(s, { email: " Legacy@Banhall.com ", token });
    await expect(
      s.t.query(internal.invites.signupAllowed, { email: "legacy@banhall.com", token }),
    ).resolves.toBe(true);
    await expect(
      s.t.query(internal.invites.signupAllowed, {
        email: "legacy@banhall.com",
        token: "wrong-token",
      }),
    ).resolves.toBe(false);
  });
});
