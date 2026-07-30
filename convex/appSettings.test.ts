/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const adminId = await t.run((ctx) => ctx.db.insert("users", { authId: "settings-admin", role: "admin", firstName: "Admin" }));
  return { t, adminId, admin: t.withIdentity({ subject: "settings-admin" }) };
}

function runRecord(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    runKey: `run-${crypto.randomUUID()}`,
    status: "completed" as const,
    phase: "verifyWorkItems" as const,
    dryRun: false,
    scanned: 10,
    patched: 0,
    verificationMismatches: 0,
    startedAt: now - 1_000,
    updatedAt: now,
    verifiedAt: now,
    completedAt: now,
    ...overrides,
  };
}

describe("My work rollout readiness", () => {
  it("requires a verified live backfill and no incomplete reconciliation", async () => {
    const f = await setup();
    await expect(f.admin.mutation(api.appSettings.setMyWorkRollout, { killSwitch: false, defaultView: "my_work", ready: true })).rejects.toThrow(/verify|backfill/i);
    await f.t.run((ctx) => ctx.db.insert("myWorkBackfillRuns", runRecord()));
    await expect(f.admin.mutation(api.appSettings.setMyWorkRollout, { killSwitch: false, defaultView: "my_work", ready: true })).resolves.toBeNull();

    await f.t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", { title: "Blocked", clientName: "Client", status: "draft", createdBy: f.adminId, shareToken: "settings-project", createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("oversightRebuilds", { projectId, reason: "repair", toOwnerId: f.adminId, affectedViewerIds: [f.adminId], status: "failed", attempts: 5, startedAt: Date.now(), updatedAt: Date.now() });
    });
    await expect(f.admin.mutation(api.appSettings.setMyWorkRollout, { killSwitch: false, defaultView: "my_work", ready: true })).rejects.toThrow(/reconciliation/i);
    await expect(f.admin.mutation(api.appSettings.setMyWorkRollout, { killSwitch: true, defaultView: "all_projects", ready: false })).resolves.toBeNull();
  });
});
