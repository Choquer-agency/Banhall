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
import {
  adminStateRef,
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
  freezeModelsForGeneration,
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

  it("runs the daily job end to end: every track is checked, none moves while each is newest, nothing is evaluated", async () => {
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
    const result = await t.action(refreshCatalogRef, {});
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
    // version of a generation with no freeze (Sonnet 5, Haiku 4.5).
    expect(await hashPromptProgram()).toBe("sha256:af60a9729413c53458ae2221eae8fc43b9a382955b4f2f2f8f8388d165fd4520");
    expect(await legacyPromptVersion()).toBe("sha256:3be5d07a3053f50cfe0ec6ce18d325267017498caaf55fc2bd7ab3c69f5000a0");
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
