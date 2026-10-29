/// <reference types="vite/client" />
/**
 * The model catalog after the 2026-10-22 decision (models follow the newest
 * version of their tier): the daily refresh, the seven tracks and the
 * picker, role resolution, reservation, frozen generations, per-track
 * rollback, the admin log and the one-off migrations. The readiness check's
 * requests are tested at the HTTP boundary in ai/modelReadiness.sdk.test.ts.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import fixture from "../shared/__fixtures__/openrouter-models-2026-10-22.json";
import { MODEL_ROLES, ROLE_POLICIES, directRowFromListing, parseOpenRouterModels } from "../shared/modelCatalog";
import { MODEL_TRACK_IDS, TRACK_SEED_MODEL_IDS } from "../shared/modelTracks";
import { requestModelId, resetRegisteredModelEntries } from "../shared/generationModels";
import crons from "./crons";
import {
  adminStateRef,
  allowTrackModelAgainRef,
  applyCatalogRefreshRef,
  applyTrackUpgradeRef,
  checkProductionErrorsRef,
  generationModelRedirectsRef,
  moveTrackBackRef,
  planTrackUpgradesRef,
  pointRolesAtTracksRef,
  recordCallOutcomeRef,
  refreshCatalogRef,
  resolveModelCatalogAlertsRef,
  setAutoSwitchRef,
  setRoleTrackRef,
} from "./lib/modelCatalogRefs";
import {
  continuedModelEntry,
  freezeModelsForGeneration,
  leaveMovedBackModels,
  listSelectableModels,
  moveTrack,
  raiseAdminNotice,
  roleModelId,
} from "./lib/modelRoles";
import {
  currentPromptVersion,
  generationPromptVersion,
  hashPromptProgram,
  legacyPromptVersion,
} from "./ai/promptProgram";
import { registerGenerationModels, resetGenerationModelCache } from "./ai/providers";
import { guardProviderNetwork } from "../tests/providerNetworkGuard";

// The credit latch read (decision 64) runs before each Anthropic request;
// load its module first so a cold import cannot race the fake clock.
beforeAll(async () => {
  await import("./providerCredit");
});

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

const NOW = Date.parse("2026-10-22T12:00:00Z");
type Raw = Record<string, unknown> & { id: string; canonical_slug: string; name: string };
const rawRows = (fixture as { data: Raw[] }).data;
const parsed = parseOpenRouterModels(fixture, NOW).models;
const ADMIN = "catalog-admin";
const WRITER = "catalog-writer";

/** A listing OpenRouter does not have yet, copied from a real row. */
function futureListing(fromId: string, id: string, slug: string, name: string) {
  const base = rawRows.find((row) => row.id === fromId);
  if (!base) throw new Error(`missing ${fromId}`);
  return parseOpenRouterModels({ data: [{ ...base, id, canonical_slug: slug, name }] }, NOW).models[0];
}
const SOL_62 = futureListing("openai/gpt-6.1-sol", "openai/gpt-6.2-sol", "openai/gpt-6.2-sol-20261101", "OpenAI: GPT-6.2 Sol");

guardProviderNetwork();
// Every timer is fake: convex-test starts scheduled functions on
// setTimeout, and a reserved generation left to run by itself would call
// model providers. Tests that need scheduled work drive it themselves.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  resetRegisteredModelEntries();
  resetGenerationModelCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetRegisteredModelEntries();
});

async function setup(models = parsed) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", { authId: ADMIN, role: "admin" });
    const writerId = await ctx.db.insert("users", { authId: WRITER, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Catalog project",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "catalog-token",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("transcripts", { projectId, content: "Interview body", createdAt: NOW });
    return { adminId, writerId, projectId };
  });
  await t.mutation(applyCatalogRefreshRef, { models, fetchedAt: NOW, complete: true });
  return {
    t,
    admin: t.withIdentity({ subject: ADMIN }),
    writer: t.withIdentity({ subject: WRITER }),
    ...ids,
  };
}

const row = (t: TestConvex, modelId: string) =>
  t.run((ctx) => ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).first());
const trackRow = (t: TestConvex, track: string) =>
  t.run(async (ctx) => (await ctx.db.query("modelTracks").collect()).find((item) => item.track === track) ?? null);
const errorReports = (t: TestConvex) => t.run((ctx) => ctx.db.query("errorReports").collect());
const adminNotices = (t: TestConvex) =>
  t.run((ctx) => ctx.db.query("modelAdminNotices").collect()).then((rows) => rows.map((item) => item.message));

/** The roles the evaluation switches left on the deployment on 2026-10-22. */
async function evaluationSwitchedRoles(t: TestConvex) {
  await t.run(async (ctx) => {
    for (const [role, modelId, previousModelId] of [
      ["writing", "openai/gpt-6.1-sol", "claude-sonnet-5"],
      ["condense", "openai/gpt-6.1-sol", "claude-sonnet-5"],
      ["analysis", "xiaomi/mimo-v2.6-pro", "claude-sonnet-5"],
      ["pd_review", "openai/gpt-6-sol", "claude-sonnet-5"],
      ["financial_extraction", "anthropic/claude-sonnet-5.5", "claude-sonnet-5"],
      ["brain_context", "claude-haiku-4-5-20251001", undefined],
    ] as const) {
      await ctx.db.insert("modelRoleAssignments", {
        role,
        modelId,
        ...(previousModelId ? { previousModelId } : {}),
        assignedAt: NOW - 86_400_000,
        assignedBy: "system",
      });
    }
    const mimo = await ctx.db.query("modelCatalog").withIndex("by_modelId", (q) => q.eq("modelId", "xiaomi/mimo-v2.6-pro")).first();
    if (mimo) await ctx.db.patch(mimo._id, { status: "enabled" });
  });
}

const freshGeneration = async (t: TestConvex, projectId: Id<"projects">, generationId: Id<"generations">) =>
  await t.run(async (ctx) => {
    await ctx.db.patch(generationId, { status: "failed" });
    await ctx.db.patch(projectId, { activeGenerationId: undefined, status: "draft" });
  });

// ─── Catalog refresh ────────────────────────────────────────────────────────

describe("catalog refresh", () => {
  it("seeds the seven track models and the superseded ones, and adds tool-capable OpenRouter models as candidates", async () => {
    const { t } = await setup();
    for (const modelId of Object.values(TRACK_SEED_MODEL_IDS)) {
      expect(await row(t, modelId), modelId).toMatchObject({ status: "enabled", source: "seed" });
    }
    expect(await row(t, "claude-sonnet-5-5")).toMatchObject({ gateway: "anthropic", forcedToolChoice: false, inputUsdPerMTok: 2 });
    expect(await row(t, "claude-sonnet-5")).toMatchObject({ status: "enabled", gateway: "anthropic" });
    expect(await row(t, "google/gemini-4-argon")).toMatchObject({ status: "candidate", source: "openrouter" });
    const all = await t.run((ctx) => ctx.db.query("modelCatalog").collect());
    expect(all.some((item) => item.modelId.startsWith("~") || item.modelId.includes(":"))).toBe(false);
  });

  it("logs a renamed, expiring or gone in-use model for admins only, once, and never on the alerts board", async () => {
    const { t } = await setup();
    const next = parsed
      .filter((model) => model.openRouterId !== "google/gemini-3.5-flash")
      .map((model) =>
        model.openRouterId === "openai/gpt-6-luna"
          ? { ...model, openRouterId: "openai/gpt-6-luna-v2" }
          : model.openRouterId === "openai/gpt-6.1-sol"
            ? { ...model, expirationDate: "2026-11-01" }
            : model
      );
    for (let run = 0; run < 2; run += 1) {
      await t.mutation(applyCatalogRefreshRef, { models: next, fetchedAt: NOW, complete: true });
    }
    const messages = await adminNotices(t);
    expect(messages.filter((m) => m.includes("renamed"))).toHaveLength(1);
    expect(messages.filter((m) => m.includes("retired on 2026-11-01"))).toHaveLength(1);
    expect(messages.filter((m) => m.includes("no longer listed") && m.includes("google/gemini-3.5-flash"))).toHaveLength(1);
    for (const message of messages) expect(message).not.toMatch(/[\u2013\u2014]/);
    expect(await errorReports(t)).toEqual([]);
  });

  it("never marks models gone from a partial pull", async () => {
    const { t } = await setup();
    await t.mutation(applyCatalogRefreshRef, { models: [], fetchedAt: NOW, complete: false });
    const argon = await row(t, "google/gemini-4-argon");
    expect(argon?.status).toBe("candidate");
    expect(argon?.missingSince).toBeUndefined();
  });

  it("runs the Monday job end to end: every track is checked, none moves while each is newest, nothing is evaluated", async () => {
    const { t } = await setup();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/api/v1/models")) return Response.json(fixture);
      if (url.includes("/endpoints")) {
        return Response.json({
          data: { endpoints: [{ provider_name: "OpenAI", status: 0, supported_parameters: ["tools", "structured_outputs"] }] },
        });
      }
      throw new Error(`Unexpected request to ${url}`);
    }));
    const result = await t.action(refreshCatalogRef, { moveTiers: true });
    expect(result.fetched).toBe(parsed.length);
    expect(result.tracksMoved).toBe(0);
    expect(urls[0]).toBe("https://openrouter.ai/api/v1/models");
    expect(urls.some((url) => url.includes("api.anthropic.com"))).toBe(false);
    for (const track of MODEL_TRACK_IDS) {
      expect(await trackRow(t, track), track).toMatchObject({ modelId: TRACK_SEED_MODEL_IDS[track], lastCheckedAt: NOW });
    }
    await t.run(async (ctx) => {
      expect(await ctx.db.query("modelEvaluations").collect()).toEqual([]);
      expect(await ctx.db.query("modelSwitchEvents").collect()).toEqual([]);
      expect(await ctx.db.query("errorReports").collect()).toEqual([]);
    });
  });

  // 2026-10-23 (owner): tiers move weekly, not daily.
  it("refreshes every day but checks and moves tiers only on the Monday run", async () => {
    const { t } = await setup();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/api/v1/models")) return Response.json({ data: [...rawRows, { ...rawRows.find((item) => item.id === "openai/gpt-6.1-sol")!, id: "openai/gpt-6.2-sol", canonical_slug: "openai/gpt-6.2-sol-20261101", name: "OpenAI: GPT-6.2 Sol" }] });
      if (url.includes("/endpoints")) return Response.json({ data: { endpoints: [] } });
      throw new Error(`Unexpected request to ${url}`);
    }));
    const result = await t.action(refreshCatalogRef, {});
    expect(result.tracksMoved).toBe(0);
    // No track was checked and no readiness request went out.
    for (const track of MODEL_TRACK_IDS) expect((await trackRow(t, track))?.lastCheckedAt, track).toBeUndefined();
    expect(urls.every((url) => url.startsWith("https://openrouter.ai/api/v1/models"))).toBe(true);
    expect(await row(t, "openai/gpt-6.2-sol")).toMatchObject({ status: "candidate" });
  });

  it("schedules the refresh daily except Monday, the tier move on Monday, and the rollback check hourly", () => {
    const jobs = (crons as unknown as {
      crons: Record<string, { name: string; args: unknown[]; schedule: { type: string; cron?: string } }>;
    }).crons;
    const job = (identifier: string) => jobs[identifier];
    expect(job("refresh model catalog")).toMatchObject({
      name: "modelCatalog:refreshCatalog",
      args: [{}],
      schedule: { type: "cron", cron: "45 8 * * 0,2-6" },
    });
    expect(job("move model tiers to their newest version")).toMatchObject({
      name: "modelCatalog:refreshCatalog",
      args: [{ moveTiers: true }],
      schedule: { type: "cron", cron: "45 8 * * 1" },
    });
    expect(job("move a failing model tier back")).toMatchObject({
      name: "modelCatalog:checkProductionErrors",
      args: [{}],
      schedule: { type: "cron", cron: "15 * * * *" },
    });
    // No other job moves tiers.
    const movers = Object.values(jobs).filter((item) => item.name === "modelCatalog:refreshCatalog");
    expect(movers.filter((item) => (item.args[0] as { moveTiers?: boolean } | undefined)?.moveTiers === true)).toHaveLength(1);
  });
});

// ─── Tracks, roles and the picker ───────────────────────────────────────────

describe("tracks and the picker", () => {
  it("offers exactly the seven tracks' current models, in track order, with plain labels", async () => {
    const { writer } = await setup();
    const capabilities = await writer.query(api.providerReadiness.getCapabilities, {});
    expect(capabilities?.models.map((model) => [model.id, model.label])).toEqual([
      ["claude-opus-5-5", "Opus 5.5"],
      ["claude-sonnet-5-5", "Sonnet 5.5"],
      ["claude-haiku-5-5", "Haiku 5.5"],
      ["openai/gpt-6.1-sol", "GPT-6.1 Sol"],
      ["openai/gpt-6-luna", "GPT-6 Luna"],
      ["google/gemini-3.1-pro-preview", "Gemini 3.1 Pro"],
      ["google/gemini-3.8-flash", "Gemini 3.8 Flash"],
    ]);
    for (const model of capabilities?.models ?? []) {
      expect(model.description, model.id).not.toBe("");
      expect(model.description, model.id).not.toMatch(/[\u2013\u2014]/);
    }
    expect(capabilities).toMatchObject({
      defaultModel: "claude-sonnet-5-5",
      defaultModelLabel: "Sonnet 5.5",
      planningModel: "claude-sonnet-5-5",
      pdReviewModel: "claude-sonnet-5-5",
    });
  });

  it("follows a track forward: the picker and every role on it move together", async () => {
    const { t, writer } = await setup([SOL_62, ...parsed]);
    await t.run(async (ctx) => {
      await ctx.db.insert("modelTracks", { track: "claude-sonnet", modelId: "claude-sonnet-5", rolledBackFrom: [] });
    });
    const before = await writer.query(api.providerReadiness.getCapabilities, {});
    expect(before?.models).toHaveLength(7);
    expect(before?.models[1]).toMatchObject({ id: "claude-sonnet-5", label: "Sonnet 5" });
    await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5-5", kind: "upgrade", reason: "newer_version", actor: "system" });
    });
    const after = await writer.query(api.providerReadiness.getCapabilities, {});
    expect(after?.models.map((model) => model.id)).not.toContain("claude-sonnet-5");
    expect(after?.defaultModel).toBe("claude-sonnet-5-5");
    await t.run(async (ctx) => {
      for (const role of MODEL_ROLES) {
        expect(await roleModelId(ctx, role), role).toBe(
          ROLE_POLICIES[role].track === "claude-haiku" ? "claude-haiku-5-5" : "claude-sonnet-5-5"
        );
      }
    });
  });

  it("puts every role back on its Claude track before the migration runs, and the migration keeps it there", async () => {
    const { t, writer } = await setup();
    await evaluationSwitchedRoles(t);
    const expected = Object.fromEntries(
      MODEL_ROLES.map((role) => [role, ROLE_POLICIES[role].track === "claude-haiku" ? "claude-haiku-5-5" : "claude-sonnet-5-5"])
    );
    const resolved = async () =>
      await t.run(async (ctx) => Object.fromEntries(await Promise.all(MODEL_ROLES.map(async (role) => [role, await roleModelId(ctx, role)]))));
    expect(await resolved()).toEqual(expected);
    // MiMo, enabled by an evaluation switch, is not pickable.
    const capabilities = await writer.query(api.providerReadiness.getCapabilities, {});
    expect(capabilities?.models.map((model) => model.id)).not.toContain("xiaomi/mimo-v2.6-pro");
    expect(capabilities?.models).toHaveLength(7);
    expect(await t.mutation(pointRolesAtTracksRef, {})).toBe(6);
    expect(await t.mutation(pointRolesAtTracksRef, {})).toBe(0);
    expect(await resolved()).toEqual(expected);
    const rows = await t.run((ctx) => ctx.db.query("modelRoleAssignments").collect());
    expect(rows.find((item) => item.role === "analysis")).toMatchObject({
      track: "claude-sonnet",
      modelId: "claude-sonnet-5-5",
      previousModelId: "xiaomi/mimo-v2.6-pro",
    });
  });

  // 2026-10-23 (review): running the migration again never undoes an admin's choice.
  it("leaves a role an admin pointed at another tier when the migration runs again", async () => {
    const { t, admin } = await setup();
    await evaluationSwitchedRoles(t);
    await t.mutation(pointRolesAtTracksRef, {});
    await admin.mutation(setRoleTrackRef, { role: "writing", track: "claude-opus" });
    expect(await t.mutation(pointRolesAtTracksRef, {})).toBe(0);
    expect(await t.run(async (ctx) => await roleModelId(ctx, "writing"))).toBe("claude-opus-5-5");
  });

  it("lets an admin point the writing role at another track, and keeps chat on Claude", async () => {
    const { t, admin, writer } = await setup();
    await admin.mutation(api.appSettings.setDefaultModel, { modelId: "openai/gpt-6-sol" });
    expect((await writer.query(api.providerReadiness.getCapabilities, {}))?.defaultModel).toBe("openai/gpt-6.1-sol");
    await expect(admin.mutation(setRoleTrackRef, { role: "chat", track: "gpt-sol" })).rejects.toThrow(/cannot run that model/);
    await admin.mutation(setRoleTrackRef, { role: "chat", track: "claude-opus" });
    await t.run(async (ctx) => {
      expect(await roleModelId(ctx, "chat")).toBe("claude-opus-5-5");
    });
    const events = await t.run((ctx) => ctx.db.query("modelSwitchEvents").collect());
    expect(events.map((event) => [event.role, event.track, event.kind, event.actor])).toEqual([
      ["writing", "gpt-sol", "manual", "user"],
      ["chat", "claude-opus", "manual", "user"],
    ]);
    await expect(writer.mutation(setRoleTrackRef, { role: "writing", track: "claude-opus" })).rejects.toThrow();
  });
});

// ─── Reservation and frozen generations ─────────────────────────────────────

describe("reservation and frozen generations", () => {
  it("freezes each role at its track's model", async () => {
    const { t, writer, projectId } = await setup();
    const id = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const generation = await t.run((ctx) => ctx.db.get(id));
    expect(generation?.singleModelId).toBe("claude-sonnet-5-5");
    expect(generation?.modelFreeze?.roles).toEqual({
      writing: "claude-sonnet-5-5",
      condense: "claude-sonnet-5-5",
      retrieval_brief: "claude-haiku-5-5",
      analysis: "claude-sonnet-5-5",
      planning: "claude-sonnet-5-5",
      checking: "claude-sonnet-5-5",
    });
    expect(generation?.modelFreeze?.entries.find((entry) => entry.id === "claude-sonnet-5-5")).toMatchObject({
      gateway: "anthropic",
      forcedToolChoice: false,
    });
  });

  it("maps a superseded id from a stale browser to its track's current model instead of refusing it", async () => {
    const { t, writer, projectId } = await setup();
    const single = await writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "single",
      singleModelId: "claude-sonnet-5",
    });
    expect((await t.run((ctx) => ctx.db.get(single)))?.singleModelId).toBe("claude-sonnet-5-5");
    await freshGeneration(t, projectId, single);
    const sol = await writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "single",
      singleModelId: "openai/gpt-5.6-sol",
    });
    expect((await t.run((ctx) => ctx.db.get(sol)))?.singleModelId).toBe("openai/gpt-6.1-sol");
    await freshGeneration(t, projectId, sol);
    const pair = await writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "compare",
      compareModelIds: ["claude-opus-4-8", "claude-haiku-4-5-20251001"],
    });
    expect((await t.run((ctx) => ctx.db.get(pair)))?.compareModelIds).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    await freshGeneration(t, projectId, pair);
    // A model on no track, or a top tier, is still refused.
    for (const singleModelId of ["xiaomi/mimo-v2.6-pro", "claude-fable-5-1", "openai/gpt-6-astra"]) {
      await expect(
        writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single", singleModelId })
      ).rejects.toThrow(/supported generation model/);
    }
  });

  it("leaves a reserved generation, its retry and its prompt version on its frozen models when the track moves", async () => {
    const { t, writer, projectId } = await setup();
    const first = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const frozen = (await t.run((ctx) => ctx.db.get(first)))?.modelFreeze;
    const version = await t.action(async (ctx) => await generationPromptVersion(ctx, first));
    await t.run(async (ctx) => {
      // As applyTrackUpgrade writes a discovered direct Claude version.
      const listing = parsed.find((model) => model.openRouterId === "anthropic/claude-sonnet-5.5")!;
      const { openRouterId: _id, ...fields } = listing;
      await ctx.db.insert("modelCatalog", {
        ...directRowFromListing(fields, "claude-sonnet-6", "Sonnet 6", false),
        status: "enabled",
        source: "openrouter",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        updatedAt: NOW,
      });
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-6", kind: "upgrade", reason: "newer_version", actor: "system" });
    });
    expect((await t.run((ctx) => ctx.db.get(first)))?.modelFreeze).toEqual(frozen);
    expect(await t.action(async (ctx) => await generationPromptVersion(ctx, first))).toBe(version);
    await freshGeneration(t, projectId, first);
    const retry = await writer.mutation(api.generations.retryGeneration, { generationId: first });
    const retried = await t.run((ctx) => ctx.db.get(retry));
    expect(retried?.singleModelId).toBe("claude-sonnet-5-5");
    expect(retried?.modelFreeze).toEqual(frozen);
    await freshGeneration(t, projectId, retry);
    // A new reservation picks up the moved track.
    const next = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    expect((await t.run((ctx) => ctx.db.get(next)))?.singleModelId).toBe("claude-sonnet-6");
  });

  // 2026-10-23 (owner): a writer never starts over because a tier moved back.
  it("retries a failed generation on the tier's current model when its tier was moved back from the frozen one", async () => {
    const { t, writer, projectId } = await setup();
    await t.mutation(pointRolesAtTracksRef, {});
    const first = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const frozen = (await t.run((ctx) => ctx.db.get(first)))?.modelFreeze;
    expect(frozen?.entries.map((entry) => entry.id)).toContain("claude-sonnet-5-5");
    await freshGeneration(t, projectId, first);
    await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5", kind: "rollback", reason: "production_error_rate", actor: "system" });
    });
    // The failed generation itself is never rewritten.
    expect((await t.run((ctx) => ctx.db.get(first)))?.modelFreeze).toEqual(frozen);
    const retry = await writer.mutation(api.generations.retryGeneration, { generationId: first });
    const retried = await t.run((ctx) => ctx.db.get(retry));
    expect(retried?.singleModelId).toBe("claude-sonnet-5");
    expect(retried?.modelFreeze?.entries.map((entry) => entry.id)).not.toContain("claude-sonnet-5-5");
    expect(retried?.modelFreeze?.roles.writing).toBe("claude-sonnet-5");
    const progress = await t.run((ctx) =>
      ctx.db.query("generationProgress").withIndex("by_generationId_and_at", (q) => q.eq("generationId", retry)).collect()
    );
    expect(progress.map((line) => line.message)).toEqual([
      "Generation request reserved.",
      "Sonnet 5.5 is no longer used for its tier, so this attempt runs on Sonnet 5.",
    ]);
    // A second retry inherits the first retry's freeze, which holds no model
    // its tier moved back from.
    await freshGeneration(t, projectId, retry);
    const again = await writer.mutation(api.generations.retryGeneration, { generationId: retry });
    expect((await t.run((ctx) => ctx.db.get(again)))?.modelFreeze).toEqual(retried?.modelFreeze);
  });

  it("retries on fresh helper models when only a helper role's model was moved back, keeping the writer's model", async () => {
    const { t, writer, projectId } = await setup();
    await t.mutation(pointRolesAtTracksRef, {});
    const first = await writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "single",
      singleModelId: "claude-opus-5-5",
    });
    expect((await t.run((ctx) => ctx.db.get(first)))?.modelFreeze?.roles.planning).toBe("claude-sonnet-5-5");
    await freshGeneration(t, projectId, first);
    await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5", kind: "rollback", reason: "production_error_rate", actor: "system" });
    });
    const retry = await writer.mutation(api.generations.retryGeneration, { generationId: first });
    const retried = await t.run((ctx) => ctx.db.get(retry));
    expect(retried?.singleModelId).toBe("claude-opus-5-5");
    expect(retried?.modelFreeze?.roles.planning).toBe("claude-sonnet-5");
    expect(retried?.modelFreeze?.entries.map((entry) => entry.id)).not.toContain("claude-sonnet-5-5");
  });

  it("retries a failed comparison with the moved-back slot on its tier's current model", async () => {
    const { t, writer, projectId } = await setup();
    await t.mutation(pointRolesAtTracksRef, {});
    const first = await writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "compare",
      compareModelIds: ["claude-opus-5-5", "claude-sonnet-5-5"],
    });
    await freshGeneration(t, projectId, first);
    await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5", kind: "rollback", reason: "production_error_rate", actor: "system" });
    });
    const retry = await writer.mutation(api.generations.retryGeneration, { generationId: first });
    expect((await t.run((ctx) => ctx.db.get(retry)))?.compareModelIds).toEqual(["claude-opus-5-5", "claude-sonnet-5"]);
  });

  // 2026-10-23 (owner, second): a step the writer starts in a generation
  // leaves a model its tier was moved back from, in the generation's own
  // freeze, so the writer never starts over.
  it("moves an open generation's roles and writer model off a model its tier moved back from, once, keeping earlier entries", async () => {
    const { t, writer, projectId } = await setup();
    await t.mutation(pointRolesAtTracksRef, {});
    const id = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const before = await t.run((ctx) => ctx.db.get(id));
    const frozen = before!.modelFreeze!;
    // Nothing moved back: nothing is written.
    const unchanged = await t.run(async (ctx) => await leaveMovedBackModels(ctx, (await ctx.db.get(id))!));
    expect(unchanged).toEqual(before);
    await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5", kind: "rollback", reason: "production_error_rate", actor: "system" });
    });
    const left = await t.run(async (ctx) => await leaveMovedBackModels(ctx, (await ctx.db.get(id))!));
    const stored = await t.run((ctx) => ctx.db.get(id));
    expect(left).toEqual(stored);
    expect(stored?.singleModelId).toBe("claude-sonnet-5");
    expect(stored?.modelFreeze?.roles).toEqual({
      writing: "claude-sonnet-5",
      condense: "claude-sonnet-5",
      retrieval_brief: "claude-haiku-5-5",
      analysis: "claude-sonnet-5",
      planning: "claude-sonnet-5",
      checking: "claude-sonnet-5",
    });
    // The moved-back entry stays, so a step already running still resolves it.
    expect(stored?.modelFreeze?.entries.map((entry) => entry.id)).toEqual(
      [...frozen.entries.map((entry) => entry.id), "claude-sonnet-5"].sort()
    );
    expect(stored?.modelFreeze?.entries.find((entry) => entry.id === "claude-sonnet-5")).toMatchObject({
      gateway: "anthropic",
      label: "Sonnet 5",
    });
    expect(stored?.modelFreeze).toMatchObject({ frozenAt: frozen.frozenAt, stepPolicyVersion: frozen.stepPolicyVersion });
    expect(stored?.modelMoves).toEqual([
      {
        fromModelId: "claude-sonnet-5-5",
        toModelId: "claude-sonnet-5",
        at: expect.any(Number),
        roles: ["writing", "planning", "checking", "condense", "analysis"],
        writer: true,
      },
    ]);
    const progress = await t.run((ctx) =>
      ctx.db.query("generationProgress").withIndex("by_generationId_and_at", (q) => q.eq("generationId", id)).collect()
    );
    expect(progress.map((line) => line.message)).toContain(
      "Sonnet 5.5 is no longer used for its tier, so this generation continues on Sonnet 5."
    );
    // Once moved, a second step finds nothing to change.
    const again = await t.run(async (ctx) => await leaveMovedBackModels(ctx, (await ctx.db.get(id))!));
    expect(again).toEqual(stored);
    expect((await t.run((ctx) => ctx.db.get(id)))?.modelMoves).toHaveLength(1);
  });

  it("moves only the helper roles of a comparison, never its pair, and leaves a row without a freeze alone", async () => {
    const { t, writer, projectId } = await setup();
    await t.mutation(pointRolesAtTracksRef, {});
    const pair = await writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "compare",
      compareModelIds: ["claude-opus-5-5", "claude-sonnet-5-5"],
    });
    await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5", kind: "rollback", reason: "production_error_rate", actor: "system" });
    });
    const moved = await t.run(async (ctx) => await leaveMovedBackModels(ctx, (await ctx.db.get(pair))!));
    expect(moved.compareModelIds).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(moved.singleModelId).toBeUndefined();
    expect(moved.modelFreeze?.roles.checking).toBe("claude-sonnet-5");
    await freshGeneration(t, projectId, pair);
    const legacy = await t.run(async (ctx) => {
      const legacyId = await ctx.db.insert("generations", {
        projectId,
        status: "failed",
        candidateMode: "single",
        singleModelId: "claude-sonnet-5-5",
        requestedAt: NOW,
        startedAt: NOW,
      });
      return await leaveMovedBackModels(ctx, (await ctx.db.get(legacyId))!);
    });
    expect(legacy.modelFreeze).toBeUndefined();
    expect(legacy.singleModelId).toBe("claude-sonnet-5-5");
    expect(legacy.modelMoves).toBeUndefined();
  });

  it("reads a generation's freeze afresh in each new action, so a step started after the move routes on the new model", async () => {
    const { t, writer, projectId } = await setup();
    await t.mutation(pointRolesAtTracksRef, {});
    const id = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const read = () => t.action(async (ctx) => (await registerGenerationModels(ctx, id))?.roles.checking);
    expect(await read()).toBe("claude-sonnet-5-5");
    await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5", kind: "rollback", reason: "production_error_rate", actor: "system" });
      await leaveMovedBackModels(ctx, (await ctx.db.get(id))!);
    });
    // No cache reset: the next action is a new invocation.
    expect(await read()).toBe("claude-sonnet-5");
  });

  it("keeps a model the generation already had exactly as frozen, and a QA run leaves the writer model alone", async () => {
    const { t, writer, projectId } = await setup();
    await t.mutation(pointRolesAtTracksRef, {});
    const id = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    // A generation that already froze Sonnet 5 for one use (a role pinned to
    // it); the marker shows whether its entry is rebuilt.
    const marked = await t.run(async (ctx) => {
      const generation = (await ctx.db.get(id))!;
      const freeze = await freezeModelsForGeneration(ctx, ["claude-sonnet-5-5", "claude-sonnet-5"], NOW);
      const modelFreeze = {
        ...freeze,
        entries: freeze.entries.map((entry) => (entry.id === "claude-sonnet-5" ? { ...entry, maxCompletionTokens: 12_345 } : entry)),
      };
      await ctx.db.patch(generation._id, { modelFreeze });
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5", kind: "rollback", reason: "production_error_rate", actor: "system" });
      return modelFreeze;
    });
    const qa = await t.run(async (ctx) => await leaveMovedBackModels(ctx, (await ctx.db.get(id))!, { writer: false }));
    expect(qa.modelFreeze?.entries).toEqual(marked.entries);
    expect(qa.modelFreeze?.roles.checking).toBe("claude-sonnet-5");
    // The QA run moves the helper roles only: not the writer model, nor the
    // writing role that names it.
    expect(qa.singleModelId).toBe("claude-sonnet-5-5");
    expect(qa.modelFreeze?.roles.writing).toBe("claude-sonnet-5-5");
    expect(qa.modelMoves).toEqual([
      {
        fromModelId: "claude-sonnet-5-5",
        toModelId: "claude-sonnet-5",
        at: expect.any(Number),
        roles: ["planning", "checking", "condense", "analysis"],
      },
    ]);
    // A later writer-started step moves the writer model too, once.
    const next = await t.run(async (ctx) => await leaveMovedBackModels(ctx, (await ctx.db.get(id))!));
    expect(next.singleModelId).toBe("claude-sonnet-5");
    expect(next.modelFreeze?.roles.writing).toBe("claude-sonnet-5");
    expect(next.modelMoves?.[1]).toMatchObject({ fromModelId: "claude-sonnet-5-5", roles: ["writing"], writer: true });
    expect(next.modelFreeze?.entries).toEqual(marked.entries);
  });

  it("retries a generation that already left a moved-back model on its own freeze, with no move line", async () => {
    const { t, writer, projectId } = await setup();
    await t.mutation(pointRolesAtTracksRef, {});
    const first = await writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "single" });
    const left = await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "claude-sonnet", toModelId: "claude-sonnet-5", kind: "rollback", reason: "production_error_rate", actor: "system" });
      return await leaveMovedBackModels(ctx, (await ctx.db.get(first))!);
    });
    await freshGeneration(t, projectId, first);
    const retry = await writer.mutation(api.generations.retryGeneration, { generationId: first });
    const retried = await t.run((ctx) => ctx.db.get(retry));
    expect(retried?.singleModelId).toBe("claude-sonnet-5");
    expect(retried?.modelFreeze).toEqual(left.modelFreeze);
    const progress = await t.run((ctx) =>
      ctx.db.query("generationProgress").withIndex("by_generationId_and_at", (q) => q.eq("generationId", retry)).collect()
    );
    expect(progress.map((line) => line.message)).toEqual(["Generation request reserved."]);
  });

  it("follows every later move to the model a pinned row runs on now", () => {
    const entry = (id: string) => ({ id, label: id, provider: "anthropic" as const, gateway: "anthropic" as const, reasoning: true });
    const generation = {
      modelFreeze: { entries: [entry("a"), entry("b"), entry("c")], roles: { writing: "c", condense: "c", retrieval_brief: "c", analysis: "c" }, frozenAt: 1 },
      modelMoves: [
        { fromModelId: "a", toModelId: "b", at: 1, roles: [], writer: true },
        { fromModelId: "b", toModelId: "c", at: 2, roles: [], writer: true },
      ],
    };
    expect(continuedModelEntry(generation, "a")?.id).toBe("c");
    expect(continuedModelEntry(generation, "b")?.id).toBe("c");
    expect(continuedModelEntry(generation, "c")).toBeNull();
    expect(continuedModelEntry({ modelFreeze: generation.modelFreeze, modelMoves: undefined }, "a")).toBeNull();
    // Back on a model it left earlier: a row on it runs on it again.
    const returned = { ...generation, modelMoves: [generation.modelMoves[0], { fromModelId: "b", toModelId: "a", at: 2, roles: [], writer: true }] };
    expect(continuedModelEntry(returned, "a")).toBeNull();
    expect(continuedModelEntry(returned, "b")?.id).toBe("a");
    // A QA run moved helper roles only, then a later step moved the writer
    // elsewhere: a Section row follows the writer's move, not the QA one.
    const afterQa = {
      ...generation,
      modelMoves: [
        { fromModelId: "a", toModelId: "b", at: 1, roles: ["checking"] },
        { fromModelId: "a", toModelId: "c", at: 2, roles: ["writing"], writer: true },
      ],
    };
    expect(continuedModelEntry(afterQa, "a")?.id).toBe("c");
    expect(continuedModelEntry({ ...generation, modelMoves: [afterQa.modelMoves[0]] }, "a")).toBeNull();
  });

  it("still redirects a model the generation left once OpenRouter stops listing it, for work queued before the move", async () => {
    const { t, projectId, writerId } = await setup();
    const generationId = await t.run(async (ctx) => {
      const modelFreeze = await freezeModelsForGeneration(ctx, ["openai/gpt-5.6-sol", "openai/gpt-6-luna"], NOW);
      return await ctx.db.insert("generations", {
        projectId,
        status: "completed",
        candidateMode: "compare",
        compareModelIds: ["openai/gpt-5.6-sol", "openai/gpt-6-luna"],
        requestedAt: NOW,
        startedAt: NOW,
        requestedBy: writerId,
        previousProjectStatus: "draft",
        modelFreeze,
        modelMoves: [{ fromModelId: "openai/gpt-5.6-sol", toModelId: "openai/gpt-6.1-sol", at: NOW, roles: ["writing"] }],
      });
    });
    await t.mutation(applyCatalogRefreshRef, {
      models: parsed.filter((model) => model.openRouterId !== "openai/gpt-5.6-sol"),
      fetchedAt: NOW,
      complete: true,
    });
    expect((await t.query(generationModelRedirectsRef, { generationId })).map((redirect) => redirect.fromModelId)).toEqual([
      "openai/gpt-5.6-sol",
    ]);
  });

  it("runs a frozen model OpenRouter no longer lists on its track's current model, recorded once, without touching the freeze", async () => {
    const { t, projectId, writerId } = await setup();
    const generationId = await t.run(async (ctx) => {
      const modelFreeze = await freezeModelsForGeneration(ctx, ["openai/gpt-5.6-sol", "openai/gpt-6-luna"], NOW);
      return await ctx.db.insert("generations", {
        projectId,
        status: "reserved",
        candidateMode: "compare",
        compareModelIds: ["openai/gpt-5.6-sol", "openai/gpt-6-luna"],
        requestedAt: NOW,
        startedAt: NOW,
        requestedBy: writerId,
        previousProjectStatus: "draft",
        modelFreeze,
      });
    });
    const frozen = (await t.run((ctx) => ctx.db.get(generationId)))?.modelFreeze;
    const version = await t.action(async (ctx) => await generationPromptVersion(ctx, generationId));
    // Superseded but still listed: not gone, so nothing changes.
    expect(await t.query(generationModelRedirectsRef, { generationId })).toEqual([]);
    await t.mutation(applyCatalogRefreshRef, {
      models: parsed.filter((model) => model.openRouterId !== "openai/gpt-5.6-sol"),
      fetchedAt: NOW,
      complete: true,
    });
    const redirects = await t.query(generationModelRedirectsRef, { generationId });
    expect(redirects).toHaveLength(1);
    expect(redirects[0]).toMatchObject({
      fromModelId: "openai/gpt-5.6-sol",
      toModelId: "openai/gpt-6.1-sol",
      entry: { id: "openai/gpt-5.6-sol", gateway: "openrouter", requestId: "openai/gpt-6.1-sol" },
    });
    const routed = await t.action(async (ctx) => {
      await registerGenerationModels(ctx, generationId);
      return [requestModelId("openai/gpt-5.6-sol"), requestModelId("openai/gpt-6-luna")];
    });
    expect(routed).toEqual(["openai/gpt-6.1-sol", "openai/gpt-6-luna"]);
    resetGenerationModelCache();
    await t.action(async (ctx) => {
      await registerGenerationModels(ctx, generationId);
    });
    const after = await t.run((ctx) => ctx.db.get(generationId));
    expect(after?.modelFreeze).toEqual(frozen);
    expect(after?.modelRedirects).toEqual([{ fromModelId: "openai/gpt-5.6-sol", toModelId: "openai/gpt-6.1-sol", at: NOW }]);
    expect(await t.action(async (ctx) => await generationPromptVersion(ctx, generationId))).toBe(version);
    const messages = await adminNotices(t);
    expect(messages.filter((message) => message.includes("now runs on GPT-6.1 Sol"))).toHaveLength(1);
    expect(await errorReports(t)).toEqual([]);
  });
});

// ─── Daily track moves and rollback ─────────────────────────────────────────

describe("track upgrades and rollback", () => {
  const passed = { plainOk: true, forcedToolChoice: true, forcedRejected: false };

  it("plans only a newer listing, and moves the track once its readiness check passes", async () => {
    const { t } = await setup([SOL_62, ...parsed]);
    const plan = await t.mutation(planTrackUpgradesRef, {});
    expect(plan.map((candidate) => [candidate.track, candidate.fromModelId, candidate.toModelId])).toEqual([
      ["gpt-sol", "openai/gpt-6.1-sol", "openai/gpt-6.2-sol"],
    ]);
    expect(await t.mutation(applyTrackUpgradeRef, {
      candidate: plan[0],
      readiness: { plainOk: false, forcedToolChoice: false, forcedRejected: false, failure: "the plain request failed (429)" },
    })).toBe("held");
    expect(await trackRow(t, "gpt-sol")).toMatchObject({ modelId: "openai/gpt-6.1-sol" });
    expect(await t.mutation(applyTrackUpgradeRef, { candidate: plan[0], readiness: passed })).toBe("moved");
    expect(await trackRow(t, "gpt-sol")).toMatchObject({ modelId: "openai/gpt-6.2-sol", previousModelId: "openai/gpt-6.1-sol", switchedAt: NOW });
    expect(await row(t, "openai/gpt-6.2-sol")).toMatchObject({ status: "enabled" });
    expect(await t.mutation(planTrackUpgradesRef, {})).toEqual([]);
  });

  it("plans nothing while automatic updates are off", async () => {
    const { t, admin } = await setup([SOL_62, ...parsed]);
    await admin.mutation(setAutoSwitchRef, { enabled: false });
    expect(await t.mutation(planTrackUpgradesRef, {})).toEqual([]);
    expect((await trackRow(t, "gpt-sol"))?.lastCheckNote).toContain("Automatic updates are off");
  });

  it("moves a failing new model's track back, never chooses it again, and writes nothing to the alerts board", async () => {
    const { t } = await setup([SOL_62, ...parsed]);
    const [candidate] = await t.mutation(planTrackUpgradesRef, {});
    await t.mutation(applyTrackUpgradeRef, { candidate, readiness: passed });
    for (let i = 0; i < 20; i += 1) {
      await t.mutation(recordCallOutcomeRef, {
        model: "openai/gpt-6.2-sol",
        callSite: "generation:analyzer",
        outcome: i % 4 === 0 ? "failure" : "success",
        code: "malformed_output",
      });
    }
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
      { track: "gpt-sol", modelId: "openai/gpt-6.2-sol", rolledBack: true },
    ]);
    expect(await trackRow(t, "gpt-sol")).toMatchObject({ modelId: "openai/gpt-6.1-sol", rolledBackFrom: ["openai/gpt-6.2-sol"] });
    expect((await trackRow(t, "gpt-sol"))?.previousModelId).toBeUndefined();
    const events = await t.run((ctx) => ctx.db.query("modelSwitchEvents").collect());
    expect(events.map((event) => [event.track, event.kind, event.fromModelId, event.toModelId])).toEqual([
      ["gpt-sol", "upgrade", "openai/gpt-6.1-sol", "openai/gpt-6.2-sol"],
      ["gpt-sol", "rollback", "openai/gpt-6.2-sol", "openai/gpt-6.1-sol"],
    ]);
    expect(await t.mutation(planTrackUpgradesRef, {})).toEqual([]);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    // Other tracks were never touched.
    expect((await trackRow(t, "claude-sonnet"))?.modelId).toBe("claude-sonnet-5-5");
    expect(await errorReports(t)).toEqual([]);
  });

  it("with automatic updates off, logs a failing model for admins once a day instead of moving it back", async () => {
    const { t, admin } = await setup([SOL_62, ...parsed]);
    const [candidate] = await t.mutation(planTrackUpgradesRef, {});
    await t.mutation(applyTrackUpgradeRef, { candidate, readiness: passed });
    await admin.mutation(setAutoSwitchRef, { enabled: false });
    for (let i = 0; i < 20; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model: "openai/gpt-6.2-sol", callSite: "x", outcome: i < 10 ? "failure" : "success" });
    }
    for (let run = 0; run < 2; run += 1) {
      expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
        { track: "gpt-sol", modelId: "openai/gpt-6.2-sol", rolledBack: false },
      ]);
    }
    expect((await adminNotices(t)).filter((message) => message.includes("not moved back"))).toHaveLength(1);
    expect((await trackRow(t, "gpt-sol"))?.modelId).toBe("openai/gpt-6.2-sol");
    expect(await errorReports(t)).toEqual([]);
  });

  it("lets an admin move a tier back, and the daily job leaves it there", async () => {
    const { t, admin, writer } = await setup([SOL_62, ...parsed]);
    await expect(admin.mutation(moveTrackBackRef, { track: "gpt-sol" })).rejects.toThrow(/no previous model/);
    const [candidate] = await t.mutation(planTrackUpgradesRef, {});
    await t.mutation(applyTrackUpgradeRef, { candidate, readiness: passed });
    await expect(writer.mutation(moveTrackBackRef, { track: "gpt-sol" })).rejects.toThrow();
    await admin.mutation(moveTrackBackRef, { track: "gpt-sol" });
    expect(await trackRow(t, "gpt-sol")).toMatchObject({ modelId: "openai/gpt-6.1-sol", rolledBackFrom: ["openai/gpt-6.2-sol"] });
    expect(await t.mutation(planTrackUpgradesRef, {})).toEqual([]);
  });

  // Review 2026-10-22: the deploy moves Sonnet 5 to 5.5 in code, not through
  // a track upgrade; the first track rows still record what ran before.
  it("can undo the deploy-day move: the error check and Move back return a tier to its pre-deploy model", async () => {
    const { t, admin } = await setup(parsed);
    await t.mutation(pointRolesAtTracksRef, {});
    expect(await trackRow(t, "claude-sonnet")).toMatchObject({ modelId: "claude-sonnet-5-5", previousModelId: "claude-sonnet-5" });
    expect(await trackRow(t, "claude-haiku")).toMatchObject({ modelId: "claude-haiku-5-5", previousModelId: "claude-haiku-4-5-20251001" });
    expect((await trackRow(t, "claude-opus"))?.previousModelId).toBeUndefined();
    for (let i = 0; i < 20; i += 1) {
      await t.mutation(recordCallOutcomeRef, {
        model: "claude-sonnet-5-5",
        callSite: "generation:analyzer",
        outcome: i % 4 === 0 ? "failure" : "success",
        code: "malformed_output",
      });
    }
    expect(await t.mutation(checkProductionErrorsRef, {})).toContainEqual(
      { track: "claude-sonnet", modelId: "claude-sonnet-5-5", rolledBack: true },
    );
    expect(await trackRow(t, "claude-sonnet")).toMatchObject({ modelId: "claude-sonnet-5", rolledBackFrom: ["claude-sonnet-5-5"] });
    await admin.mutation(moveTrackBackRef, { track: "claude-haiku" });
    expect((await trackRow(t, "claude-haiku"))?.modelId).toBe("claude-haiku-4-5-20251001");
    expect(await errorReports(t)).toEqual([]);
  });

  // 2026-10-23 (owner and review): the hourly check watches the deploy-day
  // move from its first run, without waiting for the one-off migration.
  it("watches the deploy-day move from the first hourly check, with no migration run", async () => {
    const { t } = await setup(parsed);
    expect(await trackRow(t, "claude-sonnet")).toBeNull();
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    expect(await trackRow(t, "claude-sonnet")).toMatchObject({
      modelId: "claude-sonnet-5-5",
      previousModelId: "claude-sonnet-5",
      switchedAt: NOW,
    });
    vi.setSystemTime(NOW + 60 * 60 * 1000);
    for (let i = 0; i < 20; i += 1) {
      await t.mutation(recordCallOutcomeRef, {
        model: "claude-sonnet-5-5",
        callSite: "generation:analyzer",
        outcome: i % 4 === 0 ? "failure" : "success",
        code: "malformed_output",
      });
    }
    expect(await t.mutation(checkProductionErrorsRef, {})).toContainEqual(
      { track: "claude-sonnet", modelId: "claude-sonnet-5-5", rolledBack: true },
    );
    expect((await trackRow(t, "claude-sonnet"))?.modelId).toBe("claude-sonnet-5");
    expect(await errorReports(t)).toEqual([]);
  });

  it("counts the deploy-day model's failures from before the first hourly check", async () => {
    const { t } = await setup(parsed);
    for (let i = 0; i < 20; i += 1) {
      await t.mutation(recordCallOutcomeRef, {
        model: "claude-sonnet-5-5",
        callSite: "generation:analyzer",
        outcome: i % 4 === 0 ? "failure" : "success",
        code: "malformed_output",
      });
    }
    vi.setSystemTime(NOW + 50 * 60 * 1000);
    expect(await trackRow(t, "claude-sonnet")).toBeNull();
    expect(await t.mutation(checkProductionErrorsRef, {})).toContainEqual(
      { track: "claude-sonnet", modelId: "claude-sonnet-5-5", rolledBack: true },
    );
    expect((await trackRow(t, "claude-sonnet"))?.modelId).toBe("claude-sonnet-5");
  });

  it("keeps counting the deploy-day model's earlier failures when the migration writes the rows first, across checks", async () => {
    const { t } = await setup(parsed);
    const record = async (outcome: "failure" | "success", times: number) => {
      for (let i = 0; i < times; i += 1) {
        await t.mutation(recordCallOutcomeRef, { model: "claude-sonnet-5-5", callSite: "generation:analyzer", outcome, code: "malformed_output" });
      }
    };
    await record("failure", 19);
    vi.setSystemTime(NOW + 10 * 60 * 1000);
    await t.mutation(pointRolesAtTracksRef, {});
    expect(await trackRow(t, "claude-sonnet")).toMatchObject({ deployMove: true, switchedAt: NOW + 10 * 60 * 1000 });
    vi.setSystemTime(NOW + 20 * 60 * 1000);
    // 19 calls: under the minimum, so nothing moves yet.
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([]);
    vi.setSystemTime(NOW + 30 * 60 * 1000);
    await record("success", 1);
    vi.setSystemTime(NOW + 80 * 60 * 1000);
    expect(await t.mutation(checkProductionErrorsRef, {})).toContainEqual(
      { track: "claude-sonnet", modelId: "claude-sonnet-5-5", rolledBack: true },
    );
    // The move back clears the flag.
    expect((await trackRow(t, "claude-sonnet"))?.deployMove).toBeUndefined();
  });

  it("still moves a failing tier back on day 6, and after day 7 only tells admins", async () => {
    const day = 24 * 60 * 60 * 1000;
    const failingAt = async (at: number) => {
      vi.setSystemTime(at);
      for (let i = 0; i < 20; i += 1) {
        await t.mutation(recordCallOutcomeRef, { model: "openai/gpt-6.2-sol", callSite: "x", outcome: i < 10 ? "failure" : "success" });
      }
    };
    const { t } = await setup([SOL_62, ...parsed]);
    const [candidate] = await t.mutation(planTrackUpgradesRef, {});
    await t.mutation(applyTrackUpgradeRef, { candidate, readiness: passed });
    await failingAt(NOW + 6.9 * day);
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
      { track: "gpt-sol", modelId: "openai/gpt-6.2-sol", rolledBack: true },
    ]);
    // Later, a tier that moved more than 7 days ago only gets a notice.
    const late = await setup([SOL_62, ...parsed]);
    vi.setSystemTime(NOW);
    const [lateCandidate] = await late.t.mutation(planTrackUpgradesRef, {});
    await late.t.mutation(applyTrackUpgradeRef, { candidate: lateCandidate, readiness: passed });
    vi.setSystemTime(NOW + 8 * day);
    for (let i = 0; i < 20; i += 1) {
      await late.t.mutation(recordCallOutcomeRef, { model: "openai/gpt-6.2-sol", callSite: "x", outcome: i < 10 ? "failure" : "success" });
    }
    expect(await late.t.mutation(checkProductionErrorsRef, {})).toEqual([
      { track: "gpt-sol", modelId: "openai/gpt-6.2-sol", rolledBack: false },
    ]);
    expect((await trackRow(late.t, "gpt-sol"))?.modelId).toBe("openai/gpt-6.2-sol");
    // The next hourly check does not repeat it.
    vi.setSystemTime(NOW + 8 * day + 60 * 60 * 1000);
    await late.t.mutation(checkProductionErrorsRef, {});
    expect((await adminNotices(late.t)).filter((message) => message.includes("moved more than 7 days ago"))).toHaveLength(1);
    expect(await errorReports(late.t)).toEqual([]);
  });

  it("moves a tier back on its own only in the first 7 days after its move", async () => {
    const { t } = await setup([SOL_62, ...parsed]);
    const [candidate] = await t.mutation(planTrackUpgradesRef, {});
    await t.mutation(applyTrackUpgradeRef, { candidate, readiness: passed });
    const failing = async () => {
      for (let i = 0; i < 20; i += 1) {
        await t.mutation(recordCallOutcomeRef, { model: "openai/gpt-6.2-sol", callSite: "x", outcome: i < 10 ? "failure" : "success" });
      }
    };
    vi.setSystemTime(NOW + 8 * 24 * 60 * 60 * 1000);
    await failing();
    expect(await t.mutation(checkProductionErrorsRef, {})).toEqual([
      { track: "gpt-sol", modelId: "openai/gpt-6.2-sol", rolledBack: false },
    ]);
    expect((await trackRow(t, "gpt-sol"))?.modelId).toBe("openai/gpt-6.2-sol");
    // An admin can still move it back by hand.
    expect((await trackRow(t, "gpt-sol"))?.previousModelId).toBe("openai/gpt-6.1-sol");
  });

  it("with automatic updates off, the hourly check logs a failing model about once a day, not an hour earlier each day", async () => {
    const { t, admin } = await setup([SOL_62, ...parsed]);
    const [candidate] = await t.mutation(planTrackUpgradesRef, {});
    await t.mutation(applyTrackUpgradeRef, { candidate, readiness: passed });
    await admin.mutation(setAutoSwitchRef, { enabled: false });
    for (let i = 0; i < 20; i += 1) {
      await t.mutation(recordCallOutcomeRef, { model: "openai/gpt-6.2-sol", callSite: "x", outcome: i < 10 ? "failure" : "success" });
    }
    const notices = async () => (await adminNotices(t)).filter((message) => message.includes("not moved back")).length;
    await t.mutation(checkProductionErrorsRef, {});
    expect(await notices()).toBe(1);
    vi.setSystemTime(NOW + 23 * 60 * 60 * 1000);
    await t.mutation(checkProductionErrorsRef, {});
    expect(await notices()).toBe(1);
    vi.setSystemTime(NOW + (23 * 60 + 56) * 60 * 1000);
    await t.mutation(checkProductionErrorsRef, {});
    expect(await notices()).toBe(2);
  });

  it("lets a model its tier moved back from be chosen again at the next Monday check", async () => {
    const { t } = await setup([SOL_62, ...parsed]);
    const [candidate] = await t.mutation(planTrackUpgradesRef, {});
    await t.mutation(applyTrackUpgradeRef, { candidate, readiness: passed });
    await t.run(async (ctx) => {
      await moveTrack(ctx, { track: "gpt-sol", toModelId: "openai/gpt-6.1-sol", kind: "rollback", reason: "production_error_rate", actor: "system" });
    });
    expect(await t.mutation(planTrackUpgradesRef, {})).toEqual([]);
    expect(await t.mutation(allowTrackModelAgainRef, { track: "gpt-sol", modelId: "openai/gpt-6.2-sol" })).toBe(true);
    expect(await t.mutation(allowTrackModelAgainRef, { track: "gpt-sol", modelId: "openai/gpt-6.2-sol" })).toBe(false);
    expect((await trackRow(t, "gpt-sol"))?.rolledBackFrom).toEqual([]);
    // The track stays put until the Monday check moves it after a fresh readiness check.
    expect((await trackRow(t, "gpt-sol"))?.modelId).toBe("openai/gpt-6.1-sol");
    expect((await t.mutation(planTrackUpgradesRef, {})).map((item) => item.toModelId)).toEqual(["openai/gpt-6.2-sol"]);
    expect((await adminNotices(t)).filter((message) => message.includes("may be chosen again"))).toHaveLength(1);
    expect(await errorReports(t)).toEqual([]);
  });
});

// ─── The admin log and the alerts board ─────────────────────────────────────

describe("admin log", () => {
  it("shows the seven tiers, each role's tier and one log of moves and notices", async () => {
    const { t, admin } = await setup([SOL_62, ...parsed]);
    const [candidate] = await t.mutation(planTrackUpgradesRef, {});
    await t.mutation(applyTrackUpgradeRef, { candidate, readiness: { plainOk: true, forcedToolChoice: true, forcedRejected: false } });
    await t.run(async (ctx) => {
      await raiseAdminNotice(ctx as unknown as MutationCtx, "A sample notice.");
    });
    const state = await admin.query(adminStateRef, {});
    expect(state?.tracks.map((track) => [track.track, track.modelLabel])).toEqual([
      ["claude-opus", "Opus 5.5"],
      ["claude-sonnet", "Sonnet 5.5"],
      ["claude-haiku", "Haiku 5.5"],
      ["gpt-sol", "GPT-6.2 Sol"],
      ["gpt-luna", "GPT-6 Luna"],
      ["gemini-pro", "Gemini 3.1 Pro"],
      ["gemini-flash", "Gemini 3.8 Flash"],
    ]);
    expect(state?.tracks[3]).toMatchObject({ previousLabel: "GPT-6.1 Sol", switchedAt: NOW });
    expect(state?.roles.find((role) => role.role === "retrieval_brief")).toMatchObject({ trackName: "Claude Haiku", modelLabel: "Haiku 5.5" });
    expect(state?.log.map((line) => line.text)).toEqual(
      expect.arrayContaining(["GPT Sol moved from GPT-6.1 Sol to GPT-6.2 Sol: a newer version passed its check.", "A sample notice."])
    );
    for (const line of state?.log ?? []) expect(line.text).not.toMatch(/[\u2013\u2014]/);
    const writer = t.withIdentity({ subject: WRITER });
    expect(await writer.query(adminStateRef, {})).toBeNull();
  });

  it("resolves the open alerts-board rows the catalog wrote, and only those, in the one-off migration", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      const base = { kind: "auto" as const, reportType: "bug" as const, url: "/x", breadcrumbs: [], status: "open" as const, createdAt: NOW };
      for (let i = 0; i < 3; i += 1) await ctx.db.insert("errorReports", { ...base, message: `Model catalog: ${i}`, source: "model-catalog" });
      await ctx.db.insert("errorReports", { ...base, message: "A real bug", source: "client" });
      await ctx.db.insert("errorReports", { ...base, message: "Storage", source: "storage-sweep" });
    });
    expect(await t.mutation(resolveModelCatalogAlertsRef, {})).toBe(3);
    const rows = await errorReports(t);
    expect(rows.filter((item) => item.status === "open").map((item) => item.source).sort()).toEqual(["client", "storage-sweep"]);
  });
});

// ─── Prompt versions ────────────────────────────────────────────────────────

describe("prompt versions", () => {
  it("leave the program and every generation reserved before the change exactly as they were", async () => {
    // Read on e6e287d4, the commit before tracks: the program hash and the
    // version of a generation with no freeze (Sonnet 5, Haiku 4.5). Re-read
    // after 2026-10-22 (third), which moves the Summary Self-check program on
    // purpose (no merged-id echo, 64 ordinary checks, the answer's own
    // ceiling); at e6e287d4 they were sha256:af60a972... and
    // sha256:3be5d07a.... Re-read after 2026-10-26 (Phase A), which moves
    // the program on purpose (the judges' 16,384-token answers, the repair
    // with more room, the Summary Self-check in several requests); before
    // it they were sha256:3f2fa8ea... and sha256:1612a2fd.... Re-read after
    // 2026-10-26 (Phase C), which adds the company files note to the program
    // on purpose (prompts without a company file are unchanged); before it
    // they were sha256:9e7bbee8... and sha256:b72505c9.... Re-read after
    // 2026-10-27 (ninth), which records the Self-check's rule for an unknown
    // top-level property in the program on purpose; before it they were
    // sha256:ebd32cd8... and sha256:fd39c17f.... Re-read after 2026-10-27
    // (tenth), which moves the Hypothesis objective and the Seed version on
    // purpose (`.1`, then `.2` for its repair hint); before they were
    // sha256:6a92224a... and sha256:2a6958bb.... Re-read after 2026-10-27
    // (eleventh), which drops the bullet word limit from the Seed guidance
    // and the quote rules (`.3`), and moves the Summary plan serializer to v6
    // (reference bullets clipped at 600 characters); before it they were
    // sha256:9190ac69... and sha256:f82b7ed7.... Re-read after 2026-10-28
    // (fifth), which adds the facts check's words for a document read in
    // part on purpose; before it they were sha256:8a41a05e... and
    // sha256:8de53993....
    // Re-read after 2026-10-28 (seventh): the Seed prompt's words for a
    // source sent in parts, and its version, move on purpose; before it they
    // were sha256:a9410c25... and sha256:f8e3a157....
    // Re-read after 2026-10-28 (eighth): the analysis's words for a document
    // sent in parts move on purpose; before it they were sha256:f7709e4b...
    // and sha256:2ecfaf15....
    // Re-read after 2026-10-29 (inference marker): the shared writing rules'
    // stated, inferred or missing block and the check, compression and
    // Assistant lines on [INFERRED] notes move on purpose; before it they
    // were sha256:9bb679f8... and sha256:c93316ea.... Re-read after its
    // review round 1, which adds the pointer after each Line's instructions
    // and moves the rule's examples and two check lines on purpose; before
    // it they were sha256:f8b22f23... and sha256:2ab7a8e3.... Re-read after
    // its review round 2, which says an event is never inferred and puts the
    // gap first in the rule, the pointer and three check lines, on purpose;
    // before it they were sha256:c03ace4c... and sha256:f648e3fb.... Re-read
    // after its review round 3, which adds "first approach" to the four
    // event lists and a marked first approach as a Bad example, on
    // purpose; before it they were sha256:c1e5249c... and sha256:8daa03ec....
    // Re-read after 2026-10-29 (third, the honest drafting rules): the
    // general rule, the analyzer, Line 242's limitations, Line 244's
    // hypothesis and experiments, Line 246, QA's checks and its source
    // evidence, the goal-as-result check lines, the gaps already asked,
    // the Assistant's skeleton and three Seed objectives move on purpose;
    // before it they were sha256:06c66f89... and sha256:a18aa300....
    // Re-read after its item 7: the drafting allowance over the CRA limits,
    // the compression wording that names it and the Assistant's words on
    // the limits move on purpose; before it they were sha256:b501156e...
    // and sha256:e828e9f7.... Re-read after its review round 1: Line 246's
    // paragraph with nothing learned yet, the general-practice scope, the
    // pointer, Line 242's opening, the examples, QA's opener note and its
    // unreadable-source line, the Assistant's retry rule, the gaps heading,
    // two Seed objectives and the Seed version move on purpose; before it
    // they were sha256:0ec90d51... and sha256:ed39c6c1....
    expect(await hashPromptProgram()).toBe("sha256:316935b93f597ec3a38f9831048b628bca0457371d9efd07cbd150ff800fd0f6");
    expect(await legacyPromptVersion()).toBe("sha256:3f48ba26dfc9efb7ae52c57be0cf9ed189e11b7f529c3afc937b910d9d1675f5");
    // Today's defaults freeze other models, so a new generation's version differs.
    expect(await currentPromptVersion()).not.toBe(await legacyPromptVersion());
  });

  it("the picker list a query reads is the seven track models even before any track row exists", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("modelTracks").collect()).toEqual([]);
      expect((await listSelectableModels(ctx)).map((model) => model.id)).toEqual(Object.values(TRACK_SEED_MODEL_IDS));
    });
  });
});
