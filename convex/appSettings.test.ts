/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { analyzerContextBudget } from "./appSettings";
import { DEFAULT_CONTEXT_BUDGET } from "./ai/trustedContext";

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


/**
 * Story 2: the analyzer context budget is admin-tunable, and a stale or
 * fat-fingered value must never break a generation — it falls back silently,
 * per field.
 */
describe("analyzer context budget settings", () => {
  async function writeSetting(
    f: Awaited<ReturnType<typeof setup>>,
    key: string,
    value: string
  ) {
    await f.t.run((ctx) =>
      ctx.db.insert("appSettings", {
        key,
        value,
        updatedBy: f.adminId,
        updatedAt: Date.now(),
      })
    );
  }

  it("falls back to the module constants when nothing is configured", async () => {
    const f = await setup();
    expect(await f.t.run((ctx) => analyzerContextBudget(ctx))).toEqual(
      DEFAULT_CONTEXT_BUDGET
    );
  });

  it("reads each configured field as a positive integer", async () => {
    const f = await setup();
    await writeSetting(f, "ai.analyzerContextBudgetTokens", "120000");
    await writeSetting(f, "ai.analyzerTranscriptBudgetTokens", " 80000 ");
    await writeSetting(f, "ai.analyzerDocumentBudgetTokens", "5000");
    await writeSetting(f, "ai.analyzerMaxContextDocuments", "6");
    expect(await f.t.run((ctx) => analyzerContextBudget(ctx))).toEqual({
      totalTokens: 120_000,
      transcriptTokens: 80_000,
      perDocumentTokens: 5_000,
      maxDocuments: 6,
    });
  });

  it("falls back per field on unparseable, zero, negative and fractional values", async () => {
    const f = await setup();
    await writeSetting(f, "ai.analyzerContextBudgetTokens", "abc");
    await writeSetting(f, "ai.analyzerTranscriptBudgetTokens", "0");
    await writeSetting(f, "ai.analyzerDocumentBudgetTokens", "-5");
    await writeSetting(f, "ai.analyzerMaxContextDocuments", "2.5");
    expect(await f.t.run((ctx) => analyzerContextBudget(ctx))).toEqual(
      DEFAULT_CONTEXT_BUDGET
    );
  });

  it("rejects notations that do not mean what an admin typed", async () => {
    const f = await setup();
    // "1e9" and "0x2710" both survive Number() as positive integers.
    await writeSetting(f, "ai.analyzerContextBudgetTokens", "1e9");
    await writeSetting(f, "ai.analyzerTranscriptBudgetTokens", "0x2710");
    await writeSetting(f, "ai.analyzerDocumentBudgetTokens", "+5000");
    await writeSetting(f, "ai.analyzerMaxContextDocuments", "6 documents");
    expect(await f.t.run((ctx) => analyzerContextBudget(ctx))).toEqual(
      DEFAULT_CONTEXT_BUDGET
    );
  });
});
