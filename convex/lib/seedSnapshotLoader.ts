import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../../shared/pdSubsections";
import { createReadBudget } from "./readBudget";
import { preferDigestSources } from "../ai/trustedContext";
import { domainError } from "./contracts";
import {
  MAX_SEED_SNAPSHOT_ROWS,
  SeedContextLimitError,
  buildDispatchSnapshot,
  contextRevision,
  type MaterializedSeedFeedback,
  type MaterializedSeedSelection,
  type SeedContextSnapshot,
} from "./seedRevisions";

type SeedReadCtx = Pick<QueryCtx | MutationCtx, "db">;

export type LoadedSeedDispatchSnapshot = {
  snapshot: SeedContextSnapshot;
  contextRevision: string;
};

/**
 * Materialize the complete decision set used by one attempt. The pure
 * canonicalizer owns ordering and limits; this loader only resolves database
 * rows to their final wording. It deliberately does not return live rows to
 * the action. Dispatch persists the returned snapshot first.
 */
export async function loadSeedDispatchSnapshot(
  ctx: SeedReadCtx,
  args: {
    generationId: Id<"generations">;
    roleId: PdSubsectionRoleId;
    feedbackRequestId?: Id<"seedFeedbackRequests">;
    budget?: ReturnType<typeof createReadBudget>;
  },
): Promise<LoadedSeedDispatchSnapshot> {
  const targetRole = PD_SUBSECTIONS.find((role) => role.roleId === args.roleId);
  if (!targetRole) domainError("INVALID_INPUT", "Unknown seed subsection role");
  const predecessorRoleIds = PD_SUBSECTIONS.filter(
    (role) => role.order < targetRole.order,
  ).map((role) => role.roleId);
  const feedbackRoleIds = [...predecessorRoleIds, args.roleId];
  const budget = args.budget ?? createReadBudget({ maxBytes: 8 * 1024 * 1024 });
  async function readOne<T extends import("convex/values").Value>(
    read: () => Promise<T>,
  ) {
    const result = await budget.one(read);
    if (result.kind === "not-loaded")
      domainError(
        "INVALID_INPUT",
        `Seed context for ${args.roleId} exceeds the read budget`,
        { reason: "SEED_PROCESSING_LIMIT" },
      );
    return result.value;
  }
  const subsectionRead = await budget.list(
    ctx.db
      .query("seedSubsections")
      .withIndex("by_generationId", (q) =>
        q.eq("generationId", args.generationId),
      ),
    14,
  );
  if (!subsectionRead.complete)
    domainError(
      "INVALID_INPUT",
      `Seed context for ${args.roleId} exceeds the read budget`,
      { reason: "SEED_PROCESSING_LIMIT" },
    );
  const subsections = subsectionRead.rows;
  const skippedRoleIds = subsections
    .filter((row) => row.state === "skipped")
    .map((row) => row.roleId);
  const skipped = new Set<PdSubsectionRoleId>(skippedRoleIds);
  const selectionRows: Doc<"seedSelections">[] = [];
  for (const roleId of predecessorRoleIds) {
    const remaining = MAX_SEED_SNAPSHOT_ROWS + 1 - selectionRows.length;
    if (remaining <= 0) break;
    if (skipped.has(roleId)) continue;
    const read = await budget.list(
      ctx.db
        .query("seedSelections")
        .withIndex("by_generationId_and_selected_and_roleId", (q) =>
          q
            .eq("generationId", args.generationId)
            .eq("selected", true)
            .eq("roleId", roleId),
        ),
      remaining,
    );
    if (!read.complete)
      domainError(
        "INVALID_INPUT",
        `Seed context for ${args.roleId} exceeds the processing budget`,
        { reason: "SEED_PROCESSING_LIMIT" },
      );
    selectionRows.push(...read.rows);
  }

  const feedbackRows: Doc<"seedFeedbackRequests">[] = [];
  for (const roleId of feedbackRoleIds) {
    const remaining = MAX_SEED_SNAPSHOT_ROWS + 1 - feedbackRows.length;
    if (remaining <= 0) break;
    const read = await budget.list(
      ctx.db
        .query("seedFeedbackRequests")
        .withIndex("by_generationId_and_status_and_roleId", (q) =>
          q
            .eq("generationId", args.generationId)
            .eq("status", "active")
            .eq("roleId", roleId),
        ),
      remaining,
    );
    if (!read.complete)
      domainError(
        "INVALID_INPUT",
        `Seed context for ${args.roleId} exceeds the processing budget`,
        { reason: "SEED_PROCESSING_LIMIT" },
      );
    feedbackRows.push(...read.rows);
  }

  if (subsections.length > 13) {
    domainError("INVALID_STATE", "Seed stage has duplicate subsection rows");
  }
  if (
    selectionRows.length > MAX_SEED_SNAPSHOT_ROWS ||
    feedbackRows.length > MAX_SEED_SNAPSHOT_ROWS
  ) {
    domainError(
      "INVALID_INPUT",
      `Seed context for ${args.roleId} is too large`,
      { reason: "SEED_PROCESSING_LIMIT" },
    );
  }

  const selections: MaterializedSeedSelection[] = [];
  for (const row of selectionRows) {
    const seed = await readOne(() => ctx.db.get(row.seedId));
    if (
      !seed ||
      seed.generationId !== args.generationId ||
      seed.projectId !== row.projectId ||
      seed.roleId !== row.roleId
    ) {
      domainError(
        "INVALID_STATE",
        "A selected seed no longer belongs to this seed stage",
      );
    }
    selections.push({
      roleId: row.roleId,
      seedId: row.seedId,
      bullets: row.editedBullets ?? seed.bullets,
      active: !skipped.has(row.roleId),
    });
  }

  const feedbackRequests: MaterializedSeedFeedback[] = feedbackRows.map(
    (row) => ({
      roleId: row.roleId,
      feedbackRequestId: row._id,
      targetSeedId: row.targetSeedId,
      instruction: row.instruction,
      status: row.status,
    }),
  );

  let target: Parameters<typeof buildDispatchSnapshot>[0]["target"];
  if (args.feedbackRequestId) {
    const requestId = args.feedbackRequestId;
    const request = await readOne(() => ctx.db.get(requestId));
    if (
      !request ||
      request.generationId !== args.generationId ||
      request.roleId !== args.roleId ||
      request.status !== "active"
    ) {
      domainError(
        "INVALID_STATE",
        "Feedback request is no longer active for this role",
      );
    }
    target = {
      roleId: request.roleId,
      feedbackRequestId: request._id,
      targetSeedId: request.targetSeedId,
      targetWording: request.targetWording,
      instruction: request.instruction,
    };
  }

  try {
    const snapshot = buildDispatchSnapshot({
      targetRoleId: args.roleId,
      selections,
      skippedRoleIds,
      feedbackRequests,
      ...(target ? { target } : {}),
    });
    return { snapshot, contextRevision: await contextRevision(snapshot) };
  } catch (error) {
    if (error instanceof SeedContextLimitError) {
      domainError(
        "INVALID_INPUT",
        `Seed context for ${args.roleId} exceeds its ${error.limit} limit`,
        { reason: "SEED_PROCESSING_LIMIT" },
      );
    }
    throw error;
  }
}

export type FrozenSeedActionInput = {
  brief: Pick<
    Doc<"generationBriefs">,
    "_id" | "inputsHash" | "origin" | "storylineText" | "version"
  >;
  briefEntries: Array<
    Pick<
      Doc<"generationBriefEntries">,
      | "_id"
      | "group"
      | "text"
      | "reason"
      | "confidence"
      | "sourceId"
      | "sourceContentHash"
      | "startOffset"
      | "endOffset"
      | "exactExcerpt"
    >
  >;
  sources: Array<
    Pick<
      Doc<"generationSources">,
      | "_id"
      | "kind"
      | "label"
      | "content"
      | "contentHash"
      | "truncated"
      | "originalLength"
    >
  >;
  writerSettings: {
    profile: Doc<"generations">["writerSettings"];
    styleGuidance: string;
    styleOverrides: Record<string, unknown>;
  };
  lengthTarget: "concise" | "standard" | "full";
};

export const MAX_SEED_BRIEF_ENTRY_ROWS = 500;
export const MAX_SEED_SOURCE_ROWS = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frozenStyleProjection(content: string): {
  styleGuidance: string;
  styleOverrides: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Frozen seed writer settings are malformed");
  }
  if (!isRecord(parsed))
    throw new Error("Frozen seed writer settings are malformed");
  const styleGuidance = parsed.styleGuidance;
  const styleOverrides = parsed.styleOverrides;
  if (typeof styleGuidance !== "string" || !isRecord(styleOverrides)) {
    throw new Error("Frozen seed writer settings are incomplete");
  }
  return { styleGuidance, styleOverrides };
}

/** Read generation-frozen model inputs. Called only after the attempt claim. */
export async function loadFrozenSeedActionInput(
  ctx: SeedReadCtx,
  args: {
    generation: Doc<"generations">;
    briefVersionId: Id<"generationBriefs">;
    budget?: ReturnType<typeof createReadBudget>;
  },
): Promise<FrozenSeedActionInput> {
  const budget = args.budget ?? createReadBudget({ maxBytes: 8 * 1024 * 1024 });
  const briefRead = await budget.one(() => ctx.db.get(args.briefVersionId));
  if (briefRead.kind === "not-loaded")
    throw new SeedContextLimitError(
      "read_bytes",
      "Frozen Brief exceeds the read budget",
    );
  const brief = briefRead.value;
  if (!brief || brief.projectId !== args.generation.projectId) {
    throw new Error(
      "Seed attempt Brief is missing or belongs to another project",
    );
  }
  const entryRead = await budget.list(
    ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id)),
    MAX_SEED_BRIEF_ENTRY_ROWS,
  );
  const sourceRead = await budget.list(
    ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) =>
        q.eq("generationId", args.generation._id),
      ),
    MAX_SEED_SOURCE_ROWS,
  );
  const settingsRead = await budget.one(() =>
    ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", args.generation._id).eq("kind", "brain_blocks"),
      )
      .unique(),
  );
  if (
    !entryRead.complete ||
    !sourceRead.complete ||
    settingsRead.kind === "not-loaded"
  )
    throw new SeedContextLimitError(
      "read_bytes",
      "Frozen seed inputs exceed the processing budget",
    );
  const briefEntries = entryRead.rows,
    sources = sourceRead.rows,
    settingsArtifact = settingsRead.value;
  if (briefEntries.length > MAX_SEED_BRIEF_ENTRY_ROWS) {
    throw new SeedContextLimitError(
      "rows",
      "Seed attempt Brief exceeds its bounded row limit",
    );
  }
  if (sources.length > MAX_SEED_SOURCE_ROWS) {
    throw new SeedContextLimitError(
      "rows",
      "Seed attempt sources exceed their bounded row limit",
    );
  }
  if (!settingsArtifact)
    throw new Error("Frozen seed writer settings are missing");
  const style = frozenStyleProjection(settingsArtifact.content);
  return {
    brief: {
      _id: brief._id,
      inputsHash: brief.inputsHash,
      origin: brief.origin,
      storylineText: brief.storylineText,
      version: brief.version,
    },
    briefEntries: briefEntries
      .filter(
        (entry) =>
          entry.change !== "removed" && entry.group !== "storylineQuestion",
      )
      .map((entry) => ({
        _id: entry._id,
        group: entry.group,
        text: entry.text,
        reason: entry.reason,
        confidence: entry.confidence,
        sourceId: entry.sourceId,
        sourceContentHash: entry.sourceContentHash,
        startOffset: entry.startOffset,
        endOffset: entry.endOffset,
        exactExcerpt: entry.exactExcerpt,
      })),
    // Digest mode means digests (cost phase 1): a transcript with a frozen
    // digest reaches the Seed prompt only as that digest, in the
    // transcript's place, so the byte limit is never spent on both.
    sources: preferDigestSources(sources).map((source) => ({
      _id: source._id,
      kind: source.kind,
      label: source.label,
      content: source.content,
      contentHash: source.contentHash,
      truncated: source.truncated,
      originalLength: source.originalLength,
    })),
    writerSettings: {
      profile: args.generation.writerSettings,
      styleGuidance: style.styleGuidance,
      styleOverrides: style.styleOverrides,
    },
    lengthTarget: args.generation.lengthTarget ?? "standard",
  };
}
