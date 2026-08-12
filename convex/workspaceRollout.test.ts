/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const MASTER_KEY = "workspace.dashboard.v1.enabled";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", { authId: "ws-admin", role: "admin", firstName: "Admin" });
    const writerId = await ctx.db.insert("users", { authId: "ws-writer", role: "writer", firstName: "Writer" });
    const managerId = await ctx.db.insert("users", { authId: "ws-manager", role: "manager", firstName: "Manager" });
    const rolelessId = await ctx.db.insert("users", { authId: "ws-roleless", firstName: "NoRole" });
    const anonymousId = await ctx.db.insert("users", { authId: "ws-anon", role: "writer", isAnonymous: true });
    const anonymousAdminId = await ctx.db.insert("users", { authId: "ws-anon-admin", role: "admin", isAnonymous: true });
    // Role-bearing but never linked to a sign-in (no authId).
    const unlinkedId = await ctx.db.insert("users", { role: "writer", firstName: "Unlinked" });
    const unlinkedAdminId = await ctx.db.insert("users", { role: "admin", firstName: "UnlinkedAdmin" });
    return { adminId, writerId, managerId, rolelessId, anonymousId, anonymousAdminId, unlinkedId, unlinkedAdminId };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "ws-admin" }),
    writer: t.withIdentity({ subject: "ws-writer" }),
    manager: t.withIdentity({ subject: "ws-manager" }),
    roleless: t.withIdentity({ subject: "ws-roleless" }),
    anonymous: t.withIdentity({ subject: "ws-anon" }),
    anonymousAdmin: t.withIdentity({ subject: "ws-anon-admin" }),
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/** Version-aware helpers: read the current version, then mutate publicly. */
async function setMaster(f: Fixture, enabled: boolean) {
  const state = await f.admin.query(api.workspaceRollout.getAdminState, {});
  await f.admin.mutation(api.workspaceRollout.setMasterSwitch, {
    enabled,
    expectedVersion: state.master.version,
  });
}

async function setAccess(f: Fixture, userId: Fixture["writerId"], enabled: boolean) {
  const state = await f.admin.query(api.workspaceRollout.getAdminState, { userId });
  await f.admin.mutation(api.workspaceRollout.setUserAccess, {
    userId,
    enabled,
    expectedVersion: state.userAccess?.version ?? 0,
  });
}

async function accessRowsFor(f: Fixture, userId: Fixture["writerId"]) {
  return await f.t.run(async (ctx) =>
    ctx.db.query("workspaceDashboardAccess").withIndex("by_userId", (q) => q.eq("userId", userId)).take(10)
  );
}

async function allEvents(f: Fixture) {
  return await f.t.run(async (ctx) =>
    ctx.db.query("workspaceDashboardRolloutEvents").withIndex("by_occurredAt").take(50)
  );
}

describe("workspace dashboard rollout", () => {
  it("defaults to unavailable when the master setting is missing or malformed", async () => {
    const f = await setup();
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });

    // An enabled per-user row alone cannot enable the preview.
    await setAccess(f, f.writerId, true);
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });

    // A malformed master value also fails closed.
    await f.t.run(async (ctx) => {
      await ctx.db.insert("appSettings", {
        key: MASTER_KEY,
        value: "definitely-on",
        updatedBy: f.adminId,
        updatedAt: Date.now(),
      });
    });
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
  });

  it("requires both the master switch and the caller's enabled row", async () => {
    const f = await setup();
    await setMaster(f, true);

    // Master on without a row stays off.
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });

    // Master on + enabled row enables exactly that caller.
    await setAccess(f, f.writerId, true);
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: true });
    expect(await f.manager.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });

    // Disabling the row rolls the caller back.
    await setAccess(f, f.writerId, false);
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });

    // Global off always wins over an enabled row.
    await setAccess(f, f.writerId, true);
    await setMaster(f, false);
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
  });

  it("only lets active admins manage the master switch and per-user access", async () => {
    const f = await setup();
    const args = { enabled: true, expectedVersion: 0 };
    await expect(f.writer.mutation(api.workspaceRollout.setMasterSwitch, args)).rejects.toThrow(/elevated role/i);
    await expect(f.manager.mutation(api.workspaceRollout.setMasterSwitch, args)).rejects.toThrow(/elevated role/i);
    await expect(f.writer.mutation(api.workspaceRollout.setUserAccess, { userId: f.writerId, ...args })).rejects.toThrow(/elevated role/i);
    await expect(f.manager.mutation(api.workspaceRollout.setUserAccess, { userId: f.writerId, ...args })).rejects.toThrow(/elevated role/i);
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
  });

  it("rejects anonymous users on admin surfaces even when they carry an admin role", async () => {
    const f = await setup();
    await expect(
      f.anonymousAdmin.mutation(api.workspaceRollout.setMasterSwitch, { enabled: true, expectedVersion: 0 })
    ).rejects.toThrow(/active elevated role/i);
    await expect(
      f.anonymousAdmin.mutation(api.workspaceRollout.setUserAccess, { userId: f.writerId, enabled: true, expectedVersion: 0 })
    ).rejects.toThrow(/active elevated role/i);
    await expect(f.anonymousAdmin.query(api.workspaceRollout.getAdminState, {})).rejects.toThrow(/active elevated role/i);
    await expect(
      f.t.mutation(internal.workspaceRollout.setMasterSwitchInternal, { enabled: true, adminId: f.anonymousAdminId })
    ).rejects.toThrow(/administrator/i);
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
  });

  it("rejects invalid admins and ineligible enable targets on the internal mutations", async () => {
    const f = await setup();
    await expect(
      f.t.mutation(internal.workspaceRollout.setMasterSwitchInternal, { enabled: true, adminId: f.writerId })
    ).rejects.toThrow(/administrator/i);
    await expect(
      f.t.mutation(internal.workspaceRollout.setUserAccessInternal, { userId: f.writerId, enabled: true, adminId: f.rolelessId })
    ).rejects.toThrow(/administrator/i);
    await expect(
      f.t.mutation(internal.workspaceRollout.setMasterSwitchInternal, { enabled: false, adminId: f.unlinkedAdminId })
    ).rejects.toThrow(/linked sign-in/i);
    await expect(
      f.t.mutation(internal.workspaceRollout.setUserAccessInternal, { userId: f.rolelessId, enabled: true, adminId: f.adminId })
    ).rejects.toThrow(/cleanup-only/i);
    await expect(
      f.t.mutation(internal.workspaceRollout.setUserAccessInternal, { userId: f.anonymousId, enabled: true, adminId: f.adminId })
    ).rejects.toThrow(/cleanup-only/i);
    await expect(
      f.admin.mutation(api.workspaceRollout.setUserAccess, { userId: f.rolelessId, enabled: true, expectedVersion: 0 })
    ).rejects.toThrow(/active internal user/i);
  });

  it("refuses to enable an auth-unlinked target but allows disabling stale targets", async () => {
    const f = await setup();
    // No linked sign-in → cannot be granted the preview.
    await expect(
      f.admin.mutation(api.workspaceRollout.setUserAccess, { userId: f.unlinkedId, enabled: true, expectedVersion: 0 })
    ).rejects.toThrow(/linked sign-in/i);
    await expect(
      f.t.mutation(internal.workspaceRollout.setUserAccessInternal, { userId: f.unlinkedId, enabled: true, adminId: f.adminId })
    ).rejects.toThrow(/cleanup-only/i);

    // A previously-valid target that went stale (role removed, auth unlinked,
    // anonymized) can still be disabled — cleanup never blocks.
    await setMaster(f, true);
    await setAccess(f, f.writerId, true);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.writerId, { role: undefined, authId: undefined, isAnonymous: true });
    });
    await setAccess(f, f.writerId, false);
    const rows = await accessRowsFor(f, f.writerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);

    // Reactivating the account later does NOT silently inherit access.
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.writerId, { role: "writer", authId: "ws-writer", isAnonymous: false });
    });
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
  });

  it("fails closed on duplicate rows and repairs them only through rollback or cleanup", async () => {
    const f = await setup();
    await setMaster(f, true);
    await setAccess(f, f.writerId, true);
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: true });

    // Duplicate master rows (races/manual writes): reads fail closed…
    await f.t.run(async (ctx) => {
      await ctx.db.insert("appSettings", { key: MASTER_KEY, value: "on", updatedBy: f.adminId, updatedAt: Date.now() });
    });
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
    const adminState = await f.admin.query(api.workspaceRollout.getAdminState, {});
    expect(adminState.master.duplicates).toBe(true);
    await expect(
      f.admin.mutation(api.workspaceRollout.setMasterSwitch, {
        enabled: true,
        expectedVersion: adminState.master.version,
      })
    ).rejects.toThrow(/duplicate rows/i);

    // …and the emergency internal master-off still works, repairing to one row.
    await f.t.mutation(internal.workspaceRollout.setMasterSwitchInternal, { enabled: false, adminId: f.adminId });
    const masterRows = await f.t.run(async (ctx) =>
      ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", MASTER_KEY)).take(10)
    );
    expect(masterRows).toHaveLength(1);
    expect(masterRows[0]?.value).toBe("off");

    // Duplicate access rows: reads fail closed and public activation rejects
    // the ambiguous state. The internal cleanup-only path converges to off.
    await setMaster(f, true);
    await f.t.run(async (ctx) => {
      await ctx.db.insert("workspaceDashboardAccess", { userId: f.writerId, enabled: true, updatedBy: f.adminId, updatedAt: Date.now() });
    });
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
    await expect(setAccess(f, f.writerId, true)).rejects.toThrow(/duplicate rollout access rows/i);
    await f.t.mutation(internal.workspaceRollout.setUserAccessInternal, {
      userId: f.writerId,
      enabled: false,
      adminId: f.adminId,
    });
    const rows = await accessRowsFor(f, f.writerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
  });

  it("never duplicates a target's access row across repeated updates", async () => {
    const f = await setup();
    await setAccess(f, f.writerId, true);
    await setAccess(f, f.writerId, false);
    await setAccess(f, f.writerId, true);
    const rows = await accessRowsFor(f, f.writerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
  });

  it("appends an immutable audit event for every successful config change", async () => {
    const f = await setup();
    await setMaster(f, true);
    await setAccess(f, f.writerId, true);
    await f.t.mutation(internal.workspaceRollout.setUserAccessInternal, { userId: f.writerId, enabled: false, adminId: f.adminId });
    await f.t.mutation(internal.workspaceRollout.setMasterSwitchInternal, { enabled: false, adminId: f.adminId });

    const events = await allEvents(f);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ actorId: f.adminId, scope: "master", enabled: true, via: "public" });
    expect(events[0]?.previousEnabled).toBeUndefined();
    expect(events[1]).toMatchObject({
      actorId: f.adminId,
      scope: "user_access",
      targetUserId: f.writerId,
      enabled: true,
      via: "public",
    });
    expect(events[2]).toMatchObject({
      scope: "user_access",
      targetUserId: f.writerId,
      enabled: false,
      previousEnabled: true,
      via: "internal",
    });
    expect(events[3]).toMatchObject({ scope: "master", enabled: false, previousEnabled: true, via: "internal" });

    // A failed change appends nothing.
    await expect(
      f.admin.mutation(api.workspaceRollout.setUserAccess, { userId: f.rolelessId, enabled: true, expectedVersion: 0 })
    ).rejects.toThrow();
    expect(await allEvents(f)).toHaveLength(4);
  });

  it("rejects stale expectedVersion on public mutations while internal mutations override", async () => {
    const f = await setup();
    await setMaster(f, true); // version 0 → 1
    await expect(
      f.admin.mutation(api.workspaceRollout.setMasterSwitch, { enabled: false, expectedVersion: 0 })
    ).rejects.toThrow(/changed since it was read/i);
    await expect(
      f.admin.mutation(api.workspaceRollout.setMasterSwitch, { enabled: false, expectedVersion: -1 })
    ).rejects.toThrow(/non-negative integer/i);

    await setAccess(f, f.writerId, true); // version 0 → 1
    await expect(
      f.admin.mutation(api.workspaceRollout.setUserAccess, { userId: f.writerId, enabled: false, expectedVersion: 0 })
    ).rejects.toThrow(/changed since it was read/i);

    // Emergency internal off ignores versions entirely, but internal enable
    // is intentionally rejected so non-versioned operations cannot activate.
    await expect(
      f.t.mutation(internal.workspaceRollout.setMasterSwitchInternal, { enabled: true, adminId: f.adminId })
    ).rejects.toThrow(/rollback-only/i);
    await expect(
      f.t.mutation(internal.workspaceRollout.setUserAccessInternal, { userId: f.writerId, enabled: true, adminId: f.adminId })
    ).rejects.toThrow(/cleanup-only/i);
    await f.t.mutation(internal.workspaceRollout.setMasterSwitchInternal, { enabled: false, adminId: f.adminId });
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });

    // Fresh reads give the versions that then succeed.
    const state = await f.admin.query(api.workspaceRollout.getAdminState, { userId: f.writerId });
    await f.admin.mutation(api.workspaceRollout.setMasterSwitch, { enabled: true, expectedVersion: state.master.version });
    await f.admin.mutation(api.workspaceRollout.setUserAccess, {
      userId: f.writerId,
      enabled: true,
      expectedVersion: state.userAccess?.version ?? 0,
    });
    expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: true });
  });

  it("denies unauthenticated, anonymous, and roleless callers", async () => {
    const f = await setup();
    await expect(f.t.query(api.workspaceRollout.getAccess, {})).rejects.toThrow(/authentication/i);
    await expect(f.anonymous.query(api.workspaceRollout.getAccess, {})).rejects.toThrow(/authentication/i);
    await expect(f.roleless.query(api.workspaceRollout.getAccess, {})).rejects.toThrow(/internal role/i);
  });

  describe("admin read models (listEnabledAccess / listRolloutEvents)", () => {
    it("rejects everyone but active admins", async () => {
      const f = await setup();
      await expect(f.t.query(api.workspaceRollout.listEnabledAccess, {})).rejects.toThrow(/authentication/i);
      await expect(f.writer.query(api.workspaceRollout.listEnabledAccess, {})).rejects.toThrow(/elevated role/i);
      await expect(f.manager.query(api.workspaceRollout.listEnabledAccess, {})).rejects.toThrow(/elevated role/i);
      await expect(f.roleless.query(api.workspaceRollout.listEnabledAccess, {})).rejects.toThrow(/elevated role/i);
      await expect(f.anonymousAdmin.query(api.workspaceRollout.listEnabledAccess, {})).rejects.toThrow(/active elevated role/i);

      await expect(f.t.query(api.workspaceRollout.listRolloutEvents, {})).rejects.toThrow(/authentication/i);
      await expect(f.writer.query(api.workspaceRollout.listRolloutEvents, {})).rejects.toThrow(/elevated role/i);
      await expect(f.manager.query(api.workspaceRollout.listRolloutEvents, {})).rejects.toThrow(/elevated role/i);
      await expect(f.anonymousAdmin.query(api.workspaceRollout.listRolloutEvents, {})).rejects.toThrow(/active elevated role/i);
    });

    it("lists only users with an enabled row, with OCC versions and labels", async () => {
      const f = await setup();
      expect(await f.admin.query(api.workspaceRollout.listEnabledAccess, {})).toEqual({
        entries: [],
        truncated: false,
      });

      await setAccess(f, f.writerId, true);
      await setAccess(f, f.managerId, true);
      await setAccess(f, f.managerId, false); // disabled rows drop off the list

      const result = await f.admin.query(api.workspaceRollout.listEnabledAccess, {});
      expect(result.truncated).toBe(false);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        userId: f.writerId,
        displayName: "Writer",
        duplicates: false,
      });
      // The version echoes back into setUserAccess as expectedVersion.
      await f.admin.mutation(api.workspaceRollout.setUserAccess, {
        userId: f.writerId,
        enabled: false,
        expectedVersion: result.entries[0]!.version,
      });
      expect(await f.admin.query(api.workspaceRollout.listEnabledAccess, {})).toEqual({
        entries: [],
        truncated: false,
      });
    });

    it("surfaces duplicate access rows instead of hiding them", async () => {
      const f = await setup();
      await setAccess(f, f.writerId, true);
      await f.t.run(async (ctx) => {
        await ctx.db.insert("workspaceDashboardAccess", {
          userId: f.writerId,
          enabled: true,
          updatedBy: f.adminId,
          updatedAt: Date.now(),
        });
      });
      const result = await f.admin.query(api.workspaceRollout.listEnabledAccess, {});
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({ userId: f.writerId, duplicates: true });
      // The duplicate still fails closed for the user themselves.
      expect(await f.writer.query(api.workspaceRollout.getAccess, {})).toEqual({ available: false });
    });

    it("returns recent audit events newest-first with resolved labels, bounded", async () => {
      const f = await setup();
      await setMaster(f, true);
      await setAccess(f, f.writerId, true);
      await f.t.mutation(internal.workspaceRollout.setUserAccessInternal, {
        userId: f.writerId,
        enabled: false,
        adminId: f.adminId,
      });

      const events = await f.admin.query(api.workspaceRollout.listRolloutEvents, {});
      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({
        scope: "user_access",
        enabled: false,
        previousEnabled: true,
        via: "internal",
        actorName: "Admin",
        targetName: "Writer",
        targetUserId: f.writerId,
      });
      expect(events[2]).toMatchObject({ scope: "master", enabled: true, via: "public" });
      expect(events.map((event) => event.occurredAt)).toEqual(
        [...events.map((event) => event.occurredAt)].sort((a, b) => b - a)
      );

      // Bounds are clamped, never trusted from the client.
      expect(await f.admin.query(api.workspaceRollout.listRolloutEvents, { limit: 2 })).toHaveLength(2);
      expect(await f.admin.query(api.workspaceRollout.listRolloutEvents, { limit: 0 })).toHaveLength(1);
      expect(await f.admin.query(api.workspaceRollout.listRolloutEvents, { limit: -5 })).toHaveLength(1);
      expect(
        (await f.admin.query(api.workspaceRollout.listRolloutEvents, { limit: 10_000 })).length
      ).toBeLessThanOrEqual(50);
    });
  });
});
