/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { getInternalProjectAccessOrNull, getProjectAccess, requireInternalProjectAccess } from "./lib/auth";

const modules = import.meta.glob("./**/*.ts");

// 2026-09-01 audit, finding S10: `getProjectAccess` used to return `internal`
// for ANY mapped `users` row. Internal access now needs the same actor
// eligibility as `getInternalProjectAccessOrNull` (not stored-anonymous, has a
// role). An ineligible signed-in caller falls through to the share-token check
// exactly like an unauthenticated client reviewer.

const SHARE_TOKEN = "pa-share-token";
const WRONG_TOKEN = "pa-wrong-token";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", {
      authId: "pa-writer",
      role: "writer",
      firstName: "Wren",
    });
    // Stored anonymous record that also carries a role: never internal.
    const storedAnonymousId = await ctx.db.insert("users", {
      authId: "pa-anonymous",
      role: "writer",
      isAnonymous: true,
      firstName: "Anon",
    });
    // Mapped and signed in, but holds no internal role.
    const rolelessId = await ctx.db.insert("users", {
      authId: "pa-roleless",
      firstName: "Rory",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Share-token project",
      clientName: "Acme",
      status: "review",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: SHARE_TOKEN,
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "Report body",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    const missingProjectId = await ctx.db.insert("projects", {
      title: "Deleted",
      clientName: "Deleted",
      status: "draft",
      createdBy: writerId,
      shareToken: "pa-deleted-token",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.delete(missingProjectId);
    return { writerId, storedAnonymousId, rolelessId, projectId, reportId, missingProjectId };
  });
  return {
    t,
    ...ids,
    noIdentity: t,
    unmapped: t.withIdentity({ subject: "pa-unmapped" }),
    writer: t.withIdentity({ subject: "pa-writer" }),
    storedAnonymous: t.withIdentity({ subject: "pa-anonymous" }),
    roleless: t.withIdentity({ subject: "pa-roleless" }),
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
type Actor = Fixture["writer"];

/** Publish the report so the share token resolves to a client_review grant. */
async function publish(f: Fixture) {
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.projectId, {
      sharedReportId: f.reportId,
      status: "client_review",
    });
  });
}

function access(actor: Actor, f: Fixture, shareToken?: string) {
  return actor.run((ctx) => getProjectAccess(ctx, f.projectId, shareToken));
}

describe("getProjectAccess internal eligibility", () => {
  it("grants internal access with the exact stored role for an owner, manager, and admin", async () => {
    const f = await setup();
    for (const role of ["writer", "manager", "admin"] as const) {
      const authId = role === "writer" ? "pa-writer" : `pa-${role}`;
      const userId = role === "writer" ? f.writerId : await f.t.run((ctx) =>
        ctx.db.insert("users", { authId, role }));
      const actor = f.t.withIdentity({ subject: authId });
      const nullable = await actor.run((ctx) => getInternalProjectAccessOrNull(ctx, f.projectId));
      const required = await actor.run((ctx) => requireInternalProjectAccess(ctx, f.projectId));
      expect(required).toMatchObject({ project: { _id: f.projectId }, user: { _id: userId, role } });
      expect(nullable).toEqual(required);
      for (const token of [undefined, SHARE_TOKEN, WRONG_TOKEN]) {
        expect(await access(actor, f, token)).toEqual({ kind: "internal", ...required });
      }
    }
  });

  it("gives an unrelated writer matching nullable, throwing, and token access", async () => {
    const f = await setup();
    const otherWriterId = await f.t.run((ctx) => ctx.db.insert("users", {
      authId: "pa-other-writer", role: "writer", firstName: "Other writer",
    }));
    const actor = f.t.withIdentity({ subject: "pa-other-writer" });
    await publish(f);
    const nullable = await actor.run((ctx) => getInternalProjectAccessOrNull(ctx, f.projectId));
    const required = await actor.run((ctx) => requireInternalProjectAccess(ctx, f.projectId));
    expect(required).toMatchObject({
      project: { _id: f.projectId, ownerId: f.writerId, createdBy: f.writerId },
      user: { _id: otherWriterId, role: "writer" },
    });
    expect(otherWriterId).not.toBe(f.writerId);
    expect(required).toEqual(nullable);
    for (const token of [undefined, SHARE_TOKEN, WRONG_TOKEN]) {
      expect(await access(actor, f, token)).toEqual({ kind: "internal", ...required });
    }
  });

  it.each([
    ["a stored-anonymous user with a role", "storedAnonymous"],
    ["a mapped user without a role", "roleless"],
  ] as const)("never treats %s as internal", async (_label, key) => {
    const f = await setup();
    const actor = f[key];

    // Same eligibility rule as the internal helper.
    expect(
      await actor.run((ctx) => getInternalProjectAccessOrNull(ctx, f.projectId))
    ).toBeNull();

    // No token: denied outright.
    expect(await access(actor, f)).toEqual({ kind: "denied" });
    // Matching token but nothing published yet: still denied.
    expect(await access(actor, f, SHARE_TOKEN)).toEqual({ kind: "denied" });

    await publish(f);
    // Matching token once a report is shared: a client-review grant, exactly
    // like an unauthenticated reviewer, and never an internal one.
    const granted = await access(actor, f, SHARE_TOKEN);
    expect(granted).toMatchObject({
      kind: "client_review",
      project: { _id: f.projectId, sharedReportId: f.reportId },
    });
    expect(granted).not.toHaveProperty("user");
    // Wrong token and no token stay denied even after publishing.
    expect(await access(actor, f, WRONG_TOKEN)).toEqual({ kind: "denied" });
    expect(await access(actor, f)).toEqual({ kind: "denied" });
  });
});

describe("getProjectAccess share-token path", () => {
  it("grants client_review to an unauthenticated caller with the matching token on a shared report", async () => {
    const f = await setup();
    await publish(f);
    const granted = await access(f.noIdentity, f, SHARE_TOKEN);
    expect(granted).toMatchObject({
      kind: "client_review",
      project: { _id: f.projectId, sharedReportId: f.reportId },
    });
    expect(granted).not.toHaveProperty("user");
  });

  it("denies the wrong token", async () => {
    const f = await setup();
    await publish(f);
    expect(await access(f.noIdentity, f, WRONG_TOKEN)).toEqual({ kind: "denied" });
    expect(await access(f.noIdentity, f)).toEqual({ kind: "denied" });
    await expect(f.noIdentity.run((ctx) => getInternalProjectAccessOrNull(ctx, f.projectId)))
      .resolves.toBeNull();
    await expect(f.noIdentity.run((ctx) => requireInternalProjectAccess(ctx, f.projectId)))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED", message: "Authentication required" } });
  });

  it("denies a matching token while no report is shared", async () => {
    const f = await setup();
    expect(await access(f.noIdentity, f, SHARE_TOKEN)).toEqual({ kind: "denied" });
  });

  it("treats an authenticated but unmapped identity like an unauthenticated caller", async () => {
    const f = await setup();
    expect(await access(f.unmapped, f, SHARE_TOKEN)).toEqual({ kind: "denied" });
    await publish(f);
    expect(await access(f.unmapped, f, SHARE_TOKEN)).toMatchObject({
      kind: "client_review",
      project: { _id: f.projectId },
    });
    expect(await access(f.unmapped, f)).toEqual({ kind: "denied" });
  });

  it("denies every caller on a missing project", async () => {
    const f = await setup();
    await expect(f.writer.run((ctx) => getInternalProjectAccessOrNull(ctx, f.missingProjectId)))
      .resolves.toBeNull();
    await expect(f.writer.run((ctx) => requireInternalProjectAccess(ctx, f.missingProjectId)))
      .rejects.toMatchObject({ data: { code: "NOT_FOUND", message: "Project not found" } });
    for (const actor of [f.writer, f.storedAnonymous, f.roleless, f.noIdentity]) {
      expect(
        await actor.run((ctx) => getProjectAccess(ctx, f.missingProjectId, SHARE_TOKEN))
      ).toEqual({ kind: "denied" });
    }
  });
});
