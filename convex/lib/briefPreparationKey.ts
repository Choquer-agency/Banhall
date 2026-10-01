/**
 * The Brief preparation key (2026-09-26, decision 65): a versioned SHA-256
 * over a canonical manifest of everything that decides a Brief's request
 * and how its entries are cited. A prepared Brief is adopted by a run only
 * when the run's key, computed on the server from the run's own frozen
 * sources and policy, is the same string. The legacy `briefInputsHash` is
 * not used for adoption: it leaves out labels, order, speakers, placeholders
 * and the model.
 *
 * The manifest may include a dependency that sometimes causes a needless
 * miss; it must never leave out one that can change the request or a
 * citation's validity. Rules the request bytes do not show are hashed in
 * from convex/lib/briefDerivationPolicy.ts.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256 } from "./contracts";
import { BRIEF_DERIVATION_CONSTANTS } from "./briefDerivationPolicy";
import { stableSerialize, type JsonValue } from "./seedRevisions";
import {
  BRIEF_INPUT_BUDGET,
  BRIEF_REQUEST,
  BRIEF_SCHEMA,
  BRIEF_SYSTEM_PROMPT,
  buildBriefUserMessage,
} from "./briefRequest";
import { TRANSCRIPT_PARSER_VERSION } from "../../shared/transcriptParse";
import { speakerRoleMap } from "./transcriptStructure";
import {
  MAX_RELOCATIONS,
  MAX_SPAN_TURNS,
  MIN_RELOCATION_CHARS,
  MIN_RELOCATION_WORDS,
  RELOCATION_TURNS,
} from "./citationSpeakers";
import { resolveGenerationStep } from "./generationSteps";
import type { ModelFreeze } from "./modelCatalogValidators";
import type { PlaceholderMap } from "./deidentify";
import { MODEL } from "../../shared/generationModels";
import { intakeSpeakerView } from "./intakeDrafts";

type Ctx = QueryCtx | MutationCtx;

/**
 * The manifest's own shape. 2: the scope and each row's identity read a
 * promoted intake draft's source-key links (decision 65, stage 2).
 */
export const BRIEF_PREPARATION_KEY_VERSION = 2;
export { BRIEF_DERIVATION_VERSION } from "./briefDerivationPolicy";

/** The fields of one frozen row the key reads, from either table. */
export type BriefKeySource = Pick<
  Doc<"generationSources">,
  | "kind"
  | "label"
  | "content"
  | "contentHash"
  | "truncated"
  | "originalLength"
  | "transcriptId"
  | "projectDocumentId"
  | "digestId"
  | "uploaderRole"
  | "factsVersion"
  | "factSpans"
> & {
  /** A private intake draft's row (decision 65, stage 2). */
  intakeSourceId?: Id<"intakeSources">;
  sourceKey?: string;
};

/** Whose evidence a key describes: a project, or a private intake draft. */
export type BriefKeyScope = { projectId: Id<"projects"> } | { intakeDraftId: Id<"intakeDrafts"> };

/** Source-key links one key read may take (every transcript and file of a promoted draft). */
const MAX_KEY_LINKS = 300;

/**
 * How the key names the scope and each row. A project promoted from an
 * intake draft is named by its draft, and each transcript or file the
 * promotion installed by its source key (`intakeSourceLinks`), so the
 * draft's preparation and the project's run name the same evidence the
 * same way; anything added later keeps its own id. Only the exact link
 * maps a row: equal text never does.
 */
async function keyNames(ctx: Ctx, scope: BriefKeyScope) {
  const byTranscript = new Map<string, string>();
  const byDocument = new Map<string, string>();
  if (!("projectId" in scope)) {
    return { scope: { intakeDraftId: scope.intakeDraftId } as Record<string, string>, byTranscript, byDocument };
  }
  const links = await ctx.db
    .query("intakeSourceLinks")
    .withIndex("by_projectId", (q) => q.eq("projectId", scope.projectId))
    .take(MAX_KEY_LINKS);
  // Links in the order promotion wrote them: a file merged into an earlier
  // one (same name and text) keeps the earlier source's key.
  for (const link of links) {
    if (link.transcriptId && !byTranscript.has(link.transcriptId)) byTranscript.set(link.transcriptId, link.sourceKey);
    if (link.projectDocumentId && !byDocument.has(link.projectDocumentId)) {
      byDocument.set(link.projectDocumentId, link.sourceKey);
    }
  }
  return {
    scope: (links.length > 0 ? { intakeDraftId: links[0].draftId } : { projectId: scope.projectId }) as Record<
      string,
      string
    >,
    byTranscript,
    byDocument,
  };
}

function rowIdentity(
  source: Pick<BriefKeySource, "sourceKey" | "transcriptId" | "projectDocumentId">,
  names: { byTranscript: Map<string, string>; byDocument: Map<string, string> }
): string | null {
  if (source.sourceKey) return `intake:${source.sourceKey}`;
  if (source.transcriptId) {
    const key = names.byTranscript.get(source.transcriptId);
    return key ? `intake:${key}` : `transcript:${source.transcriptId}`;
  }
  if (source.projectDocumentId) {
    const key = names.byDocument.get(source.projectDocumentId);
    return key ? `intake:${key}` : `document:${source.projectDocumentId}`;
  }
  return null;
}

/**
 * The speaker evidence a transcript row is checked against (owner decision
 * 25): whether the stored structure describes the frozen text (the same
 * test `citationSpeakers.ts` applies) and, when it does, every label's
 * evidence role.
 */
export type SpeakerEvidenceView = {
  transcriptId: string;
  contentHash: string;
  ready: boolean;
  parserVersion: string | null;
  roles: Array<[string, string]>;
};

export async function speakerEvidenceView(
  ctx: Ctx,
  source: Pick<BriefKeySource, "transcriptId" | "content" | "contentHash">
): Promise<SpeakerEvidenceView | null> {
  if (!source.transcriptId) return null;
  const transcript = await ctx.db.get(source.transcriptId);
  const ready =
    transcript !== null &&
    transcript.parserVersion === TRANSCRIPT_PARSER_VERSION &&
    transcript.structureBuildId === undefined &&
    ((transcript.contentHash !== undefined && transcript.contentHash === source.contentHash) ||
      transcript.content.startsWith(source.content));
  const roles = ready ? [...(await speakerRoleMap(ctx, source.transcriptId))] : [];
  roles.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    transcriptId: source.transcriptId,
    contentHash: source.contentHash,
    ready,
    parserVersion: transcript?.parserVersion ?? null,
    roles: roles.map(([label, role]) => [label, role]),
  };
}

export type BriefKeyInput = {
  scope: BriefKeyScope;
  /** Every frozen row the Brief reads, in frozen order. */
  sources: readonly BriefKeySource[];
  placeholders: PlaceholderMap;
  inputMode: "full" | "digest" | null;
  transcriptFacts: boolean;
  /** The frozen models; the planning route is resolved from it. */
  freeze: ModelFreeze | null;
  /** Only a freeze from before step routing reads it. */
  writerModel: string;
};

/**
 * The canonical manifest, as a JSON value. Content itself is covered by the
 * content hashes and by the hash of the exact user message the request
 * sends; no client text is stored in it.
 */
export async function briefKeyManifest(ctx: Ctx, input: BriefKeyInput) {
  const route = resolveGenerationStep({
    freeze: input.freeze,
    step: "brief",
    writerModel: input.writerModel || MODEL,
  });
  const entry = input.freeze?.entries.find((item) => item.id === route.model) ?? null;
  const names = await keyNames(ctx, input.scope);
  const speakers: Array<Omit<SpeakerEvidenceView, "transcriptId"> & { source: string | null }> = [];
  for (const source of input.sources) {
    if (source.kind !== "transcript") continue;
    const identity = rowIdentity(source, names);
    if (!source.transcriptId && source.intakeSourceId) {
      const view = await intakeSpeakerView(ctx, { ...source, intakeSourceId: source.intakeSourceId });
      speakers.push({ source: identity, contentHash: source.contentHash, ...view });
      continue;
    }
    const view = await speakerEvidenceView(ctx, source);
    if (!view) continue;
    const { transcriptId, ...rest } = view;
    void transcriptId;
    speakers.push({ source: identity, ...rest });
  }
  return {
    keyVersion: BRIEF_PREPARATION_KEY_VERSION,
    derivation: await sha256(stableSerialize(BRIEF_DERIVATION_CONSTANTS as unknown as JsonValue)),
    scope: names.scope,
    sources: await Promise.all(
      input.sources.map(async (source) => ({
        kind: source.kind,
        source: rowIdentity(source, names),
        digestId: source.digestId ?? null,
        label: source.label,
        contentHash: source.contentHash,
        truncated: source.truncated,
        originalLength: source.originalLength,
        uploaderRole: source.uploaderRole ?? null,
        factsVersion: source.factsVersion ?? null,
        factSpans: source.factSpans ? await sha256(stableSerialize(source.factSpans as unknown as JsonValue)) : null,
      }))
    ),
    representation: { inputMode: input.inputMode, transcriptFacts: input.transcriptFacts },
    parserVersion: TRANSCRIPT_PARSER_VERSION,
    speakerPolicy: {
      maxSpanTurns: MAX_SPAN_TURNS,
      maxRelocations: MAX_RELOCATIONS,
      minRelocationChars: MIN_RELOCATION_CHARS,
      minRelocationWords: MIN_RELOCATION_WORDS,
      relocationTurns: RELOCATION_TURNS,
    },
    speakers,
    placeholders: await sha256(stableSerialize(input.placeholders.map((item) => ({ ...item })) as JsonValue)),
    request: {
      system: await sha256(BRIEF_SYSTEM_PROMPT),
      toolName: BRIEF_REQUEST.toolName,
      toolDescription: BRIEF_REQUEST.toolDescription,
      schema: await sha256(stableSerialize(BRIEF_SCHEMA as unknown as JsonValue)),
      maxTokens: BRIEF_REQUEST.maxTokens,
      budget: { ...BRIEF_INPUT_BUDGET },
      user: await sha256(buildBriefUserMessage([...input.sources])),
    },
    model: {
      model: route.model,
      source: route.source,
      policyVersion: route.policyVersion,
      request: route.request.thinking ? { thinking: route.request.thinking.type } : {},
      entry: entry ? { ...entry } : null,
    },
  };
}

/** The key: SHA-256 of the canonical manifest, prefixed with its version. */
export async function briefPreparationKey(ctx: Ctx, input: BriefKeyInput): Promise<string> {
  const manifest = await briefKeyManifest(ctx, input);
  return `v${BRIEF_PREPARATION_KEY_VERSION}:${await sha256(stableSerialize(manifest as unknown as JsonValue))}`;
}

/** A generation's key, from its frozen rows and its own frozen policy. */
export async function generationBriefKey(
  ctx: Ctx,
  generation: Doc<"generations">,
  sources: readonly BriefKeySource[]
): Promise<string> {
  return await briefPreparationKey(ctx, {
    scope: { projectId: generation.projectId },
    sources,
    placeholders: generation.placeholders ?? [],
    inputMode: generation.inputMode ?? null,
    transcriptFacts: generation.transcriptFacts === true,
    freeze: generation.modelFreeze ?? null,
    writerModel: generation.singleModelId ?? MODEL,
  });
}
