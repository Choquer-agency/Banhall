/**
 * Database side of the model catalog for queries and mutations: which model
 * a role resolves to, which models a writer may pick, what a generation
 * freezes at reservation, and the track and switch writes. Actions reach
 * these through convex/modelCatalog.ts.
 *
 * 2026-10-22 decision (models follow the newest version of their tier): a
 * role follows a track (shared/modelTracks.ts) and runs that track's current
 * model; the picker lists exactly the seven tracks' current models.
 *
 * Every read here goes to the catalog table and falls back to the static seed
 * (`CANDIDATE_MODELS`) for ids the table does not hold yet, so the app keeps
 * working on a deployment whose catalog was never refreshed.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  LEGACY_MODEL,
  LEGACY_RETRIEVAL_BRIEF_MODEL,
  seedModelById,
  type ModelEntry,
  type ModelGateway,
} from "../../shared/generationModels";
import {
  MODEL_TRACKS,
  MODEL_TRACK_IDS,
  TRACK_SEED_MODEL_IDS,
  trackLabelFor,
  trackOf,
  type ModelTrackId,
} from "../../shared/modelTracks";
import {
  MODEL_ROLES,
  ROLE_POLICIES,
  ROLE_PREDECESSORS,
  SEED_CANONICAL_SLUGS,
  entryFromCatalog,
  maxPriceFor,
  parseCostCap,
  type CostCap,
  type MaxPrice,
  type ModelRole,
} from "../../shared/modelCatalog";
import { pricingFor } from "../../shared/modelPricing";
import type { FrozenModelEntry, ModelFreeze } from "./modelCatalogValidators";
import { domainError } from "./contracts";
import { GENERATION_STEP_POLICY_VERSION } from "./generationSteps";

type ReadCtx = QueryCtx | MutationCtx;

export const AUTO_SWITCH_KEY = "models.autoSwitch";
export const EVAL_BUDGET_KEY = "models.evalBudgetUsdMonthly";
export const costCapKey = (role: ModelRole) => `models.costCap.${role}`;

async function setting(ctx: ReadCtx, key: string): Promise<string | undefined> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row?.value;
}

export async function catalogRow(
  ctx: ReadCtx,
  modelId: string
): Promise<Doc<"modelCatalog"> | null> {
  return await ctx.db
    .query("modelCatalog")
    .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
    .first();
}

/** The runtime entry for `modelId`: catalog row, else seed, else undefined. */
export async function catalogEntry(
  ctx: ReadCtx,
  modelId: string
): Promise<ModelEntry | undefined> {
  const row = await catalogRow(ctx, modelId);
  return row ? entryFromCatalog(row) : seedModelById(modelId);
}

// ─── Tracks (2026-10-22 decision) ───────────────────────────────────────────

export async function trackRow(
  ctx: ReadCtx,
  track: ModelTrackId
): Promise<Doc<"modelTracks"> | null> {
  return await ctx.db
    .query("modelTracks")
    .withIndex("by_track", (q) => q.eq("track", track))
    .unique();
}

/**
 * The model a track runs now: its row, else (a deployment whose track table
 * was never written) the track's 2026-10-22 model.
 */
export async function trackModelId(ctx: ReadCtx, track: ModelTrackId): Promise<string> {
  return (await trackRow(ctx, track))?.modelId ?? TRACK_SEED_MODEL_IDS[track];
}

/** The track row, written from the seed the first time anything changes it. */
export async function ensureTrackRow(
  ctx: MutationCtx,
  track: ModelTrackId
): Promise<Doc<"modelTracks">> {
  const existing = await trackRow(ctx, track);
  if (existing) return existing;
  const id = await ctx.db.insert("modelTracks", {
    track,
    modelId: TRACK_SEED_MODEL_IDS[track],
    rolledBackFrom: [],
  });
  const inserted = await ctx.db.get(id);
  if (!inserted) throw new Error(`Track ${track} could not be written`);
  return inserted;
}

/** Every track's current model, in picker order. */
export async function trackModelIds(ctx: ReadCtx): Promise<Array<{ track: ModelTrackId; modelId: string }>> {
  const result: Array<{ track: ModelTrackId; modelId: string }> = [];
  for (const track of MODEL_TRACK_IDS) result.push({ track, modelId: await trackModelId(ctx, track) });
  return result;
}

/**
 * The model a writer may pick for `modelId`: the id itself when it is a
 * track's current model, else that id's track's current model (a stale
 * client sending a superseded id, such as claude-sonnet-5 after the Sonnet
 * track moved on), else null.
 */
export async function selectableModelIdFor(ctx: ReadCtx, modelId: string): Promise<string | null> {
  const track = trackOf(modelId);
  if (!track) return null;
  return await trackModelId(ctx, track);
}

/** A writer may pick exactly the seven tracks' current models. */
export async function isSelectableModel(ctx: ReadCtx, modelId: string): Promise<boolean> {
  return (await selectableModelIdFor(ctx, modelId)) === modelId;
}

export type SelectableModel = ModelEntry & { description?: string };

/** One track's current model as a picker entry, labelled from its track. */
async function trackEntry(ctx: ReadCtx, track: ModelTrackId): Promise<SelectableModel> {
  const modelId = await trackModelId(ctx, track);
  const definition = MODEL_TRACKS[track];
  const entry = await catalogEntry(ctx, modelId);
  const base: ModelEntry = entry ?? {
    id: modelId,
    label: modelId,
    provider: definition.provider,
    gateway: definition.gateway,
    reasoning: definition.gateway === "openrouter",
  };
  return {
    ...base,
    id: modelId,
    label: trackLabelFor(modelId) ?? base.label,
    provider: definition.provider,
    description: definition.description,
  };
}

/**
 * Every model a writer may pick: exactly one per track, the track's current
 * model, in track order. Superseded seeds stay runnable for frozen
 * generations and history but are never listed.
 */
export async function listSelectableModels(ctx: ReadCtx): Promise<SelectableModel[]> {
  const models: SelectableModel[] = [];
  for (const track of MODEL_TRACK_IDS) models.push(await trackEntry(ctx, track));
  return models;
}

export async function roleAssignment(
  ctx: ReadCtx,
  role: ModelRole
): Promise<Doc<"modelRoleAssignments"> | null> {
  return await ctx.db
    .query("modelRoleAssignments")
    .withIndex("by_role", (q) => q.eq("role", role))
    .unique();
}

async function usableForRole(ctx: ReadCtx, role: ModelRole, modelId: string) {
  const row = await catalogRow(ctx, modelId);
  const entry = row ? entryFromCatalog(row) : seedModelById(modelId);
  if (!entry || row?.status === "retired") return false;
  return ROLE_POLICIES[role].gateways.includes(entry.gateway);
}

/** Whether `role` may follow `track`: chat runs direct Anthropic models only. */
export function roleCanFollowTrack(role: ModelRole, track: ModelTrackId): boolean {
  return ROLE_POLICIES[role].gateways.includes(MODEL_TRACKS[track].gateway);
}

/**
 * The track a role follows: the track an admin pointed it at, else its
 * policy track. An assignment written before the tracks (no `track` field,
 * which includes every evaluation switch) no longer applies, so a role an
 * evaluation moved to another vendor is back on its Claude track before the
 * one-off migration (convex/modelCatalog.ts pointRolesAtTracks) even runs.
 */
export async function roleTrack(ctx: ReadCtx, role: ModelRole): Promise<ModelTrackId> {
  const assigned = (await roleAssignment(ctx, role))?.track;
  return assigned && roleCanFollowTrack(role, assigned) ? assigned : ROLE_POLICIES[role].track;
}

/**
 * The model a role runs today: its track's current model. A stale value (a
 * retired model, or one the role's gateway cannot serve) falls back to the
 * role's 2026-10-22 default rather than breaking a call.
 */
export async function roleModelId(ctx: ReadCtx, role: ModelRole): Promise<string> {
  const modelId = await trackModelId(ctx, await roleTrack(ctx, role));
  if (await usableForRole(ctx, role, modelId)) return modelId;
  return ROLE_POLICIES[role].defaultModelId;
}

type InheritedHistory = NonNullable<Doc<"modelRoleAssignments">["inheritedHistory"]>;

/**
 * A row materialized before `inheritedHistory` existed, still marked
 * "role_split": its own assignment time is then still the carried switch
 * time (or the moment it was materialized), so it is the cutoff.
 */
function legacyInheritedHistory(
  assignment: Doc<"modelRoleAssignments">,
  predecessor: ModelRole
): InheritedHistory {
  return { role: predecessor, until: assignment.assignedAt };
}

/** The predecessor history a split role inherits, if any. */
function inheritedHistoryOf(assignment: Doc<"modelRoleAssignments"> | null): InheritedHistory | null {
  if (!assignment) return null;
  if (assignment.inheritedHistory) return assignment.inheritedHistory;
  const predecessor = ROLE_PREDECESSORS[assignment.role];
  return assignment.origin === "role_split" && predecessor
    ? legacyInheritedHistory(assignment, predecessor)
    : null;
}

/** Every gateway; the Record keeps the list complete if one is added. */
const GATEWAYS = Object.keys({ anthropic: true, openrouter: true } satisfies Record<ModelGateway, true>) as ModelGateway[];

/**
 * The catalog ids that stand for the same model as `modelId`: the id itself
 * and every row with its canonical slug, on any gateway. A direct Anthropic
 * model and its OpenRouter listing share OpenRouter's canonical slug (the
 * refresh matches seed rows by it), so they are one model here (round 7).
 * Bounded: a slug has a row or two per gateway.
 */
async function sameModelIds(ctx: ReadCtx, modelId: string): Promise<string[]> {
  const ids = new Set([modelId]);
  const slug = (await catalogRow(ctx, modelId))?.canonicalSlug ?? SEED_CANONICAL_SLUGS[modelId];
  if (slug) {
    for (const gateway of GATEWAYS) {
      const rows = await ctx.db
        .query("modelCatalog")
        .withIndex("by_gateway_and_canonicalSlug", (q) => q.eq("gateway", gateway).eq("canonicalSlug", slug))
        .take(10);
      for (const row of rows) ids.add(row.modelId);
    }
  }
  return [...ids];
}

/**
 * Whether `role` was ever rolled back from `modelId`, under any of its
 * catalog ids: by a rollback of its own, or, for a split role, by its
 * predecessor's before the split. Such a model is never evaluated for the
 * role again, however many switches come after (round 6), never promoted
 * by an evaluation that was already under way (round 7), and never the
 * role's OpenRouter fallback. One indexed row per id and role, whatever
 * the history length.
 */
export async function rolledBackFrom(
  ctx: ReadCtx,
  role: ModelRole,
  modelId: string
): Promise<boolean> {
  const inherited = inheritedHistoryOf(await roleAssignment(ctx, role));
  for (const id of await sameModelIds(ctx, modelId)) {
    const own = await ctx.db
      .query("modelSwitchEvents")
      .withIndex("by_role_and_kind_and_fromModelId_and_at", (q) =>
        q.eq("role", role).eq("kind", "rollback").eq("fromModelId", id)
      )
      .first();
    if (own) return true;
    if (!inherited) continue;
    const before = await ctx.db
      .query("modelSwitchEvents")
      .withIndex("by_role_and_kind_and_fromModelId_and_at", (q) =>
        q
          .eq("role", inherited.role)
          .eq("kind", "rollback")
          .eq("fromModelId", id)
          .lte("at", inherited.until)
      )
      .first();
    if (before) return true;
  }
  return false;
}

export async function roleCostCap(ctx: ReadCtx, role: ModelRole): Promise<CostCap> {
  return parseCostCap(await setting(ctx, costCapKey(role)), ROLE_POLICIES[role].defaultCostCap);
}

/** The kill switch. On unless an admin turned it off (owner decision 21). */
export async function autoSwitchEnabled(ctx: ReadCtx): Promise<boolean> {
  return (await setting(ctx, AUTO_SWITCH_KEY)) !== "off";
}
function frozenEntry(
  entry: ModelEntry,
  prices: { inputUsdPerMTok?: number; outputUsdPerMTok?: number },
  maxPrice: MaxPrice | undefined
): FrozenModelEntry {
  return {
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    gateway: entry.gateway,
    reasoning: entry.reasoning === true,
    ...(entry.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: entry.maxCompletionTokens }
      : {}),
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.gateway === "openrouter" && maxPrice ? { maxPrice } : {}),
    ...(entry.forcedToolChoice === false ? { forcedToolChoice: false } : {}),
  };
}

/** Frozen generation roles: the ones a generation's own calls resolve. */
export const FROZEN_GENERATION_ROLES = MODEL_ROLES.filter(
  (role) => ROLE_POLICIES[role].frozenPerGeneration
) as ReadonlyArray<"writing" | "planning" | "checking" | "condense" | "retrieval_brief" | "analysis">;

/**
 * Everything a generation will call, frozen at reservation: the candidate
 * models the writer chose (or the default resolved for them) and the model of
 * each role the generation's own helper calls use. A running generation
 * never reads a role or the catalog again, so an automatic switch reaches
 * only the next reservation. The step routing it runs under is frozen too
 * (`stepPolicyVersion`, owner decision 43): the planning and checking roles
 * serve its helper steps and the writer's model writes the report.
 */
export async function freezeModelsForGeneration(
  ctx: ReadCtx,
  candidateModelIds: readonly string[],
  now: number
): Promise<ModelFreeze> {
  const roles = {
    writing: await roleModelId(ctx, "writing"),
    condense: await roleModelId(ctx, "condense"),
    retrieval_brief: await roleModelId(ctx, "retrieval_brief"),
    analysis: await roleModelId(ctx, "analysis"),
    // Owner decision 43: the helper steps' roles (lib/generationSteps.ts).
    planning: await roleModelId(ctx, "planning"),
    checking: await roleModelId(ctx, "checking"),
  };
  const capsById = new Map<string, CostCap>();
  const noteCap = (id: string, cap: CostCap) => {
    const existing = capsById.get(id);
    capsById.set(
      id,
      existing
        ? {
            maxInputUsdPerMTok: Math.max(existing.maxInputUsdPerMTok, cap.maxInputUsdPerMTok),
            maxOutputUsdPerMTok: Math.max(existing.maxOutputUsdPerMTok, cap.maxOutputUsdPerMTok),
            maxCostRatio: Math.max(existing.maxCostRatio, cap.maxCostRatio),
          }
        : cap
    );
  };
  const writingCap = await roleCostCap(ctx, "writing");
  for (const id of candidateModelIds) noteCap(id, writingCap);
  for (const role of FROZEN_GENERATION_ROLES) noteCap(roles[role], await roleCostCap(ctx, role));
  const entries: FrozenModelEntry[] = [];
  for (const [id, cap] of capsById) {
    const entry = await frozenEntryForModel(ctx, id, cap);
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries, roles, frozenAt: now, stepPolicyVersion: GENERATION_STEP_POLICY_VERSION };
}

/**
 * One model as a frozen entry carrying `cap` as its OpenRouter price
 * ceiling, or null when neither the catalog nor the seed knows it.
 */
export async function frozenEntryForModel(
  ctx: ReadCtx,
  modelId: string,
  cap: CostCap
): Promise<FrozenModelEntry | null> {
  const row = await catalogRow(ctx, modelId);
  const entry = row ? entryFromCatalog(row) : seedModelById(modelId);
  if (!entry) return null;
  const pricing = pricingFor(modelId);
  const prices = row
    ? { inputUsdPerMTok: row.inputUsdPerMTok, outputUsdPerMTok: row.outputUsdPerMTok }
    : { inputUsdPerMTok: pricing?.input, outputUsdPerMTok: pricing?.output };
  return frozenEntry(entry, prices, maxPriceFor(cap, prices));
}

/** The runtime entry a frozen generation entry stands for. */
export function entryFromFrozen(entry: FrozenModelEntry): ModelEntry {
  return {
    ...(entry.maxPrice ? { maxPrice: entry.maxPrice } : {}),
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    gateway: entry.gateway,
    reasoning: entry.reasoning,
    ...(entry.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: entry.maxCompletionTokens }
      : {}),
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.forcedToolChoice === false ? { forcedToolChoice: false } : {}),
  };
}

/**
 * Models of a generation as frozen at reservation. A legacy row (reserved
 * before models were frozen) ran every helper on the pre-catalog constants,
 * Sonnet 5 and Haiku 4.5, and keeps them whatever the defaults are today, so
 * its prompt version never changes. `defaults` replaces those two for a
 * freeze built on today's defaults (promptProgram.ts currentPromptVersion).
 */
export function generationModelFreeze(
  generation: Pick<Doc<"generations">, "modelFreeze" | "singleModelId" | "compareModelIds">,
  defaults: { model: string; retrievalBriefModel: string } = {
    model: LEGACY_MODEL,
    retrievalBriefModel: LEGACY_RETRIEVAL_BRIEF_MODEL,
  }
): ModelFreeze {
  if (generation.modelFreeze) return generation.modelFreeze;
  const MODEL = defaults.model;
  const ids = [
    ...new Set([
      ...(generation.singleModelId ? [generation.singleModelId] : []),
      ...(generation.compareModelIds ?? []),
      MODEL,
      defaults.retrievalBriefModel,
    ]),
  ];
  const entries: FrozenModelEntry[] = ids.flatMap((id) => {
    const seed = seedModelById(id);
    return seed
      ? [
          {
            id: seed.id,
            label: seed.label,
            provider: seed.provider,
            gateway: seed.gateway,
            reasoning: seed.reasoning === true,
            ...(seed.maxCompletionTokens !== undefined
              ? { maxCompletionTokens: seed.maxCompletionTokens }
              : {}),
            ...(seed.forcedToolChoice === false ? { forcedToolChoice: false } : {}),
          },
        ]
      : [];
  });
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Legacy rows ran every helper on the pre-catalog constants.
  return {
    entries,
    roles: {
      writing: MODEL,
      condense: MODEL,
      retrieval_brief: defaults.retrievalBriefModel,
      analysis: MODEL,
    },
    frozenAt: 0,
  };
}

// ─── Switch writes ──────────────────────────────────────────────────────────

/**
 * Point a role at a track by hand (2026-10-22): the role then follows that
 * track's newest version. Chat follows Claude tracks only. Logged as a
 * manual switch.
 */
export async function assignRoleTrackByHand(
  ctx: MutationCtx,
  role: ModelRole,
  track: ModelTrackId,
  userId: Id<"users">
): Promise<void> {
  if (!roleCanFollowTrack(role, track)) domainError("INVALID_INPUT", "This role cannot run that model");
  const assignment = await roleAssignment(ctx, role);
  if (assignment?.track === track) return;
  const now = Date.now();
  const fromModelId = await roleModelId(ctx, role);
  const toModelId = await trackModelId(ctx, track);
  const next = {
    modelId: toModelId,
    previousModelId: fromModelId,
    track,
    assignedAt: now,
    assignedBy: "user" as const,
    assignedByUserId: userId,
  };
  if (assignment) {
    await ctx.db.patch(assignment._id, { ...next, origin: undefined, errorNoticeAt: undefined });
  } else {
    await ctx.db.insert("modelRoleAssignments", { role, ...next });
  }
  await ctx.db.insert("modelSwitchEvents", {
    role,
    track,
    fromModelId,
    toModelId,
    kind: "manual",
    reason: "admin_choice",
    actor: "user",
    actorUserId: userId,
    at: now,
  });
}

/**
 * Point a role at the track of `modelId` (any form of a tracked id), for
 * callers that still send a model id: the admin "Default model" select.
 */
export async function assignRoleModelByHand(
  ctx: MutationCtx,
  role: ModelRole,
  modelId: string,
  userId: Id<"users">
): Promise<void> {
  const track = trackOf(modelId);
  if (!track) domainError("INVALID_INPUT", "Unknown model id");
  await assignRoleTrackByHand(ctx, role, track, userId);
}

export type TrackMoveInput = {
  track: ModelTrackId;
  toModelId: string;
  kind: "upgrade" | "rollback";
  reason: string;
  actor: "system" | "user";
  actorUserId?: Id<"users">;
  errorRate?: Doc<"modelSwitchEvents">["errorRate"];
};

/**
 * Move a track to `toModelId` and log it. An upgrade keeps the replaced
 * model as the track's previous model (the "Move back" target). A rollback
 * records the model it left in `rolledBackFrom`, so the daily job never
 * moves the track to it again, and clears the previous model: there is
 * nothing left to move back to.
 */
export async function moveTrack(
  ctx: MutationCtx,
  input: TrackMoveInput
): Promise<Id<"modelSwitchEvents">> {
  const row = await ensureTrackRow(ctx, input.track);
  const now = Date.now();
  const fromModelId = row.modelId;
  const [fromRow, toRow] = await Promise.all([catalogRow(ctx, fromModelId), catalogRow(ctx, input.toModelId)]);
  const fromPricing = pricingFor(fromModelId);
  const toPricing = pricingFor(input.toModelId);
  await ctx.db.patch(row._id, {
    modelId: input.toModelId,
    previousModelId: input.kind === "upgrade" ? fromModelId : undefined,
    switchedAt: now,
    errorNoticeAt: undefined,
    ...(input.kind === "rollback" && !row.rolledBackFrom.includes(fromModelId)
      ? { rolledBackFrom: [...row.rolledBackFrom, fromModelId] }
      : {}),
  });
  if (toRow && toRow.status !== "enabled") {
    await ctx.db.patch(toRow._id, { status: "enabled", updatedAt: now });
  }
  return await ctx.db.insert("modelSwitchEvents", {
    track: input.track,
    fromModelId,
    toModelId: input.toModelId,
    kind: input.kind,
    reason: input.reason,
    costComparison: {
      fromInputUsdPerMTok: fromRow?.inputUsdPerMTok ?? fromPricing?.input,
      fromOutputUsdPerMTok: fromRow?.outputUsdPerMTok ?? fromPricing?.output,
      toInputUsdPerMTok: toRow?.inputUsdPerMTok ?? toPricing?.input,
      toOutputUsdPerMTok: toRow?.outputUsdPerMTok ?? toPricing?.output,
    },
    ...(input.errorRate ? { errorRate: input.errorRate } : {}),
    actor: input.actor,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    at: now,
  });
}

/**
 * An admin-only line in the model log on /admin/models (2026-10-22
 * decision). Nothing model related goes to the alerts board (errorReports):
 * writers saw these notices there as bugs.
 */
export async function raiseAdminNotice(
  ctx: MutationCtx,
  message: string,
  about: { track?: ModelTrackId; modelId?: string } = {}
): Promise<void> {
  await ctx.db.insert("modelAdminNotices", {
    message,
    ...(about.track ? { track: about.track } : {}),
    ...(about.modelId ? { modelId: about.modelId } : {}),
    at: Date.now(),
  });
}
