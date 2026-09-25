/**
 * Database side of the model catalog for queries and mutations: which model
 * a role resolves to, which models a writer may pick, what a generation
 * freezes at reservation, and the switch and rollback writes. Actions reach
 * these through convex/modelCatalog.ts.
 *
 * Every read here goes to the catalog table and falls back to the static seed
 * (`CANDIDATE_MODELS`) for ids the table does not hold yet, so the app keeps
 * working on a deployment whose catalog was never refreshed.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  CANDIDATE_MODELS,
  MODEL,
  seedModelById,
  type ModelEntry,
} from "../../shared/generationModels";
import {
  AUTOMATION_THRESHOLDS,
  MODEL_ROLES,
  ROLE_POLICIES,
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

type ReadCtx = QueryCtx | MutationCtx;

export const AUTO_SWITCH_KEY = "models.autoSwitch";
export const EVAL_BUDGET_KEY = "models.evalBudgetUsdMonthly";
export const LEGACY_DEFAULT_MODEL_KEY = "defaultModel";
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

/** A writer may pick an enabled catalog model, or a seed the table lacks. */
export async function isSelectableModel(ctx: ReadCtx, modelId: string): Promise<boolean> {
  const row = await catalogRow(ctx, modelId);
  return row ? row.status === "enabled" : seedModelById(modelId) !== undefined;
}

export type SelectableModel = ModelEntry & { description?: string };

/**
 * Every model a writer may pick, seed order first, then catalog additions in
 * the order they were enabled. Bounded: the enabled set is a curated few.
 */
export async function listSelectableModels(ctx: ReadCtx): Promise<SelectableModel[]> {
  const enabled = await ctx.db
    .query("modelCatalog")
    .withIndex("by_status", (q) => q.eq("status", "enabled"))
    .take(100);
  const byId = new Map(enabled.map((row) => [row.modelId, row]));
  const models: SelectableModel[] = [];
  for (const seed of CANDIDATE_MODELS) {
    const row = byId.get(seed.id);
    if (row) {
      models.push(entryFromCatalog(row));
      byId.delete(seed.id);
    } else if (!(await catalogRow(ctx, seed.id))) {
      models.push(seed as ModelEntry);
    }
  }
  for (const row of byId.values()) models.push(entryFromCatalog(row));
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

/**
 * The model a role runs today. Order: the role's assignment, then (writing
 * only) the admin's legacy default-model setting, then the role default. A
 * stale value (a retired model, or one the role's gateway cannot serve)
 * falls through rather than breaking a call.
 */
export async function roleModelId(ctx: ReadCtx, role: ModelRole): Promise<string> {
  const assignment = await roleAssignment(ctx, role);
  if (assignment && (await usableForRole(ctx, role, assignment.modelId))) {
    return assignment.modelId;
  }
  if (role === "writing") {
    const legacy = await setting(ctx, LEGACY_DEFAULT_MODEL_KEY);
    if (legacy && (await isSelectableModel(ctx, legacy))) return legacy;
  }
  return ROLE_POLICIES[role].defaultModelId;
}

export async function roleCostCap(ctx: ReadCtx, role: ModelRole): Promise<CostCap> {
  return parseCostCap(await setting(ctx, costCapKey(role)), ROLE_POLICIES[role].defaultCostCap);
}

/** The kill switch. On unless an admin turned it off (owner decision 21). */
export async function autoSwitchEnabled(ctx: ReadCtx): Promise<boolean> {
  return (await setting(ctx, AUTO_SWITCH_KEY)) !== "off";
}

export async function monthlyEvalBudgetUsd(ctx: ReadCtx): Promise<number> {
  const raw = (await setting(ctx, EVAL_BUDGET_KEY))?.trim() ?? "";
  const parsed = /^(?:\d+\.?\d*|\.\d+)$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : AUTOMATION_THRESHOLDS.defaultMonthlyEvalBudgetUsd;
}

/** Start of the UTC calendar month containing `now`. */
export function monthStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/**
 * USD committed to evaluations this UTC month: what finished rows actually
 * spent, what running rows reserved (their maximum), and the planning
 * estimate of rows still queued. Rows count in the month their spend was
 * last accounted (planned, claimed or settled: `accountedAt`), so a row
 * queued last month and claimed this month counts this month. `excluding`
 * leaves one row out (the row being claimed, whose own reservation is
 * being decided).
 */
export async function evalSpendThisMonth(
  ctx: ReadCtx,
  now: number,
  excluding?: Id<"modelEvaluations">
): Promise<number> {
  let spent = 0;
  for await (const evaluation of ctx.db
    .query("modelEvaluations")
    .withIndex("by_accountedAt", (q) => q.gte("accountedAt", monthStart(now)))) {
    if (evaluation._id === excluding) continue;
    spent +=
      evaluation.status === "running"
        ? (evaluation.reservedCostUsd ?? evaluation.estimatedCostUsd)
        : evaluation.status === "queued"
          ? evaluation.estimatedCostUsd
          : (evaluation.evalCostUsd ?? 0);
  }
  return spent;
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
  };
}

/** Frozen generation roles: the ones a generation's own calls resolve. */
export const FROZEN_GENERATION_ROLES = MODEL_ROLES.filter(
  (role) => ROLE_POLICIES[role].frozenPerGeneration
) as ReadonlyArray<"writing" | "condense" | "retrieval_brief" | "analysis">;

/**
 * Everything a generation will call, frozen at reservation: the candidate
 * models the writer chose (or the default resolved for them) and the model of
 * each role the generation's own helper calls use. A running generation
 * never reads a role or the catalog again, so an automatic switch reaches
 * only the next reservation.
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
  return { entries, roles, frozenAt: now };
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
  };
}

/** Models of a generation as frozen at reservation (legacy rows: the seed). */
export function generationModelFreeze(
  generation: Pick<Doc<"generations">, "modelFreeze" | "singleModelId" | "compareModelIds">
): ModelFreeze {
  if (generation.modelFreeze) return generation.modelFreeze;
  const ids = [
    ...new Set([
      ...(generation.singleModelId ? [generation.singleModelId] : []),
      ...(generation.compareModelIds ?? []),
      MODEL,
      ROLE_POLICIES.retrieval_brief.defaultModelId,
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
      retrieval_brief: ROLE_POLICIES.retrieval_brief.defaultModelId,
      analysis: MODEL,
    },
    frozenAt: 0,
  };
}

// ─── Switch writes ──────────────────────────────────────────────────────────

export type SwitchInput = {
  role: ModelRole;
  toModelId: string;
  kind: "promotion" | "rollback" | "manual";
  reason: string;
  actor: "system" | "user";
  actorUserId?: Id<"users">;
  evaluationId?: Id<"modelEvaluations">;
  evalResults?: Doc<"modelSwitchEvents">["evalResults"];
  errorRate?: Doc<"modelSwitchEvents">["errorRate"];
};

/**
 * Point `role` at `toModelId`, keep the replaced model as the rollback
 * target, enable the new model in the catalog and write the audit event.
 * The caller has already decided the switch is allowed.
 */
export async function switchRoleModel(
  ctx: MutationCtx,
  input: SwitchInput
): Promise<Id<"modelSwitchEvents">> {
  const now = Date.now();
  const fromModelId = await roleModelId(ctx, input.role);
  const [fromRow, toRow] = await Promise.all([
    catalogRow(ctx, fromModelId),
    catalogRow(ctx, input.toModelId),
  ]);
  const fromPricing = pricingFor(fromModelId);
  const toPricing = pricingFor(input.toModelId);
  const evaluation = input.evaluationId ? await ctx.db.get(input.evaluationId) : null;
  const assignment = await roleAssignment(ctx, input.role);
  const next = {
    modelId: input.toModelId,
    previousModelId: fromModelId,
    assignedAt: now,
    assignedBy: input.actor,
    ...(input.actorUserId ? { assignedByUserId: input.actorUserId } : {}),
  };
  if (assignment) {
    await ctx.db.patch(assignment._id, { ...next, assignedByUserId: input.actorUserId });
  } else {
    await ctx.db.insert("modelRoleAssignments", { role: input.role, ...next });
  }
  if (toRow && toRow.status !== "enabled") {
    await ctx.db.patch(toRow._id, { status: "enabled", updatedAt: now });
  }
  return await ctx.db.insert("modelSwitchEvents", {
    role: input.role,
    fromModelId,
    toModelId: input.toModelId,
    kind: input.kind,
    reason: input.reason,
    ...(input.evaluationId ? { evaluationId: input.evaluationId } : {}),
    ...(input.evalResults ? { evalResults: input.evalResults } : {}),
    costComparison: {
      fromInputUsdPerMTok: fromRow?.inputUsdPerMTok ?? fromPricing?.input,
      fromOutputUsdPerMTok: fromRow?.outputUsdPerMTok ?? fromPricing?.output,
      toInputUsdPerMTok: toRow?.inputUsdPerMTok ?? toPricing?.input,
      toOutputUsdPerMTok: toRow?.outputUsdPerMTok ?? toPricing?.output,
      ...(evaluation?.incumbent ? { fromEvalCostUsd: evaluation.incumbent.costUsd } : {}),
      ...(evaluation?.candidate ? { toEvalCostUsd: evaluation.candidate.costUsd } : {}),
    },
    ...(input.errorRate ? { errorRate: input.errorRate } : {}),
    actor: input.actor,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    at: now,
  });
}

/** Point a role at a model by hand. Chat accepts direct Anthropic models only. */
export async function assignRoleModelByHand(
  ctx: MutationCtx,
  role: ModelRole,
  modelId: string,
  userId: Id<"users">
): Promise<void> {
  const row = await catalogRow(ctx, modelId);
  const entry = row ? entryFromCatalog(row) : seedModelById(modelId);
  if (!entry || row?.status === "retired") domainError("INVALID_INPUT", "Unknown model id");
  if (!ROLE_POLICIES[role].gateways.includes(entry.gateway)) {
    domainError("INVALID_INPUT", "This role cannot run that model");
  }
  if (role === "writing" && !row && !(await isSelectableModel(ctx, modelId))) {
    domainError("INVALID_INPUT", "Unknown model id");
  }
  if ((await roleModelId(ctx, role)) === modelId) return;
  await switchRoleModel(ctx, {
    role,
    toModelId: modelId,
    kind: "manual",
    reason: "admin_choice",
    actor: "user",
    actorUserId: userId,
  });
}

/**
 * One-call rollback: the role returns to the model it ran before its last
 * switch. Returns null when there is nothing to roll back to.
 */
export async function rollbackRoleModel(
  ctx: MutationCtx,
  input: Omit<SwitchInput, "toModelId" | "kind">
): Promise<Id<"modelSwitchEvents"> | null> {
  const assignment = await roleAssignment(ctx, input.role);
  const target = assignment?.previousModelId;
  if (!assignment || !target || target === assignment.modelId) return null;
  return await switchRoleModel(ctx, { ...input, toModelId: target, kind: "rollback" });
}

/**
 * Admin notice through the existing alerts board (/alerts reads
 * errorReports). Automatic model changes and catalog problems land there so
 * admins see them next to every other operational alert.
 */
export async function raiseAdminNotice(ctx: MutationCtx, message: string): Promise<void> {
  await ctx.db.insert("errorReports", {
    kind: "auto",
    reportType: "bug",
    message: `Model catalog: ${message}`,
    source: "model-catalog",
    url: "/admin/models",
    breadcrumbs: [],
    status: "open",
    createdAt: Date.now(),
  });
}
