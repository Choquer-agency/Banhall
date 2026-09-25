import type { PdSubsectionRoleId } from "../../shared/pdSubsections";
import { isDashClean } from "../../shared/humanProse";
import { speakerOfTranscriptLine } from "../../shared/transcriptParse";

export const SEED_TAGS = [
  "conservative",
  "aggressive",
  "high_level",
  "detailed",
  "technical",
  "alternative_angle",
] as const;

export type SeedTag = (typeof SEED_TAGS)[number];
export type SeedBatchMode = "batch" | "feedback";

export const MAX_BULLET_WORDS = 25;
export const MIN_BATCH_SEEDS = 3;
export const MAX_BATCH_SEEDS = 5;
export const MIN_FEEDBACK_SEEDS = 1;
export const MAX_FEEDBACK_SEEDS = 3;

export type SeedCandidateProvenance = {
  sourceId: string;
  startOffset: number;
  endOffset: number;
  exactExcerpt: string;
};

export type SeedCandidate = {
  bullets: string[];
  tags: SeedTag[];
  provenance: SeedCandidateProvenance[];
  uncertaintySeedId?: string;
  experimentSeedIds?: string[];
};

export type ValidatedSeedProvenance = SeedCandidateProvenance & {
  sourceContentHash: string;
};

export type ValidatedSeedCandidate = Omit<SeedCandidate, "provenance"> & {
  provenance: ValidatedSeedProvenance[];
  support: "source_supported" | "writer_asserted";
  originalSupport: "source_supported" | "writer_asserted";
};

export type SeedReference = {
  seedId: string;
  generationId: string;
  roleId: PdSubsectionRoleId;
  active: boolean;
};

export type SeedReferenceContext = {
  generationId: string;
  references: readonly SeedReference[];
};

export type FrozenSeedSource = {
  sourceId: string;
  generationId?: string;
  content: string;
  contentHash: string;
};

export type SeedValidationIssueCode =
  | "INVALID_SHAPE"
  | "INVALID_BULLET_COUNT"
  | "BULLET_TOO_LONG"
  | "BULLET_NOT_ONE_SENTENCE"
  | "BULLET_TYPOGRAPHIC_DASH"
  | "INVALID_TAG_COUNT"
  | "INVALID_TAG"
  | "DUPLICATE_TAG"
  | "INVALID_ADVANCEMENT_REFERENCE"
  | "INVALID_PROVENANCE"
  | "INVALID_BATCH_SIZE"
  | "INSUFFICIENT_TAG_DIVERSITY"
  | "INSUFFICIENT_FORM_DIVERSITY";

export type SeedValidationIssue = {
  code: SeedValidationIssueCode;
  message: string;
  seedIndex?: number;
};

export type SeedValidationResult =
  | { ok: true; seed: ValidatedSeedCandidate; issues: SeedValidationIssue[] }
  | { ok: false; issues: SeedValidationIssue[] };

export type BatchValidationResult = {
  ok: boolean;
  seeds: ValidatedSeedCandidate[];
  dropped: number;
  issues: SeedValidationIssue[];
};

const TAG_SET: ReadonlySet<string> = new Set(SEED_TAGS);
const ABBREVIATIONS = [
  "e.g.",
  "i.e.",
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "inc.",
  "ltd.",
  "vs.",
  "etc.",
  "u.s.",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSeedTag(value: string): value is SeedTag {
  return TAG_SET.has(value);
}

function isIgnoredPeriod(text: string, index: number): boolean {
  const previous = text[index - 1];
  const next = text[index + 1];
  if (previous !== undefined && next !== undefined && /\d/.test(previous) && /\d/.test(next)) {
    return true;
  }
  if (index === text.length - 1) return false;
  const throughPeriod = text.slice(0, index + 1).toLowerCase();
  return ABBREVIATIONS.some((abbreviation) => throughPeriod.endsWith(abbreviation));
}

export function countSeedBulletWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

function seedSentenceTerminators(trimmed: string): number[] {
  const terminators: number[] = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character !== "." && character !== "!" && character !== "?") continue;
    const next = trimmed[index + 1];
    if (next !== undefined && !/\s/u.test(next)) continue;
    if (character === "." && isIgnoredPeriod(trimmed, index)) continue;
    terminators.push(index);
  }
  return terminators;
}

export function isOneSeedSentence(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  const terminators = seedSentenceTerminators(trimmed);
  return terminators.length === 1 && terminators[0] === trimmed.length - 1;
}

/** Hard bound on one writer-edited bullet. The 25-word and one-sentence
 * contract applies to AI-proposed Seeds only; this only stops abuse. */
export const MAX_EDITED_BULLET_CHARS = 600;

/** True when a writer's bullet runs past the AI Seed contract: more than
 * MAX_BULLET_WORDS words or more than one sentence. Drives the soft
 * "Long for a seed" note; it never blocks a save. A missing final full stop
 * alone is not "long". */
export function isLongForSeed(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (countSeedBulletWords(trimmed) > MAX_BULLET_WORDS) return true;
  return seedSentenceTerminators(trimmed).some((index) => index < trimmed.length - 1);
}

function parseProvenance(value: unknown): SeedCandidateProvenance | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.sourceId !== "string" ||
    typeof value.startOffset !== "number" ||
    typeof value.endOffset !== "number" ||
    typeof value.exactExcerpt !== "string"
  ) {
    return null;
  }
  return {
    sourceId: value.sourceId,
    startOffset: value.startOffset,
    endOffset: value.endOffset,
    exactExcerpt: value.exactExcerpt,
  };
}

function parseSeedCandidate(
  value: unknown
): { candidate: SeedCandidate; malformedProvenance: number } | null {
  if (!isRecord(value)) return null;
  if (!isStringArray(value.bullets) || !isStringArray(value.tags)) return null;
  if (!Array.isArray(value.provenance)) return null;
  const provenance: SeedCandidateProvenance[] = [];
  let malformedProvenance = 0;
  for (const raw of value.provenance) {
    const parsed = parseProvenance(raw);
    if (parsed) provenance.push(parsed);
    else malformedProvenance += 1;
  }
  if (
    value.uncertaintySeedId !== undefined &&
    typeof value.uncertaintySeedId !== "string"
  ) {
    return null;
  }
  if (
    value.experimentSeedIds !== undefined &&
    !isStringArray(value.experimentSeedIds)
  ) {
    return null;
  }
  const tags: SeedTag[] = [];
  for (const tag of value.tags) {
    if (!isSeedTag(tag)) return null;
    tags.push(tag);
  }
  return {
    candidate: {
      bullets: [...value.bullets],
      tags,
      provenance,
      ...(value.uncertaintySeedId !== undefined
        ? { uncertaintySeedId: value.uncertaintySeedId }
        : {}),
      ...(value.experimentSeedIds !== undefined
        ? { experimentSeedIds: [...value.experimentSeedIds] }
        : {}),
    },
    malformedProvenance,
  };
}

function validReference(
  seedId: string,
  roleId: PdSubsectionRoleId,
  context: SeedReferenceContext
): boolean {
  return context.references.some(
    (reference) =>
      reference.seedId === seedId &&
      reference.generationId === context.generationId &&
      reference.roleId === roleId &&
      reference.active
  );
}

function validateAdvancementReferences(args: {
  candidate: SeedCandidate;
  roleId: PdSubsectionRoleId;
  referenceContext?: SeedReferenceContext;
}): SeedValidationIssue[] {
  if (args.roleId !== "specific_advancements") return [];
  const context = args.referenceContext;
  const activeExperiments =
    context?.references.filter(
      (reference) =>
        reference.generationId === context.generationId &&
        reference.roleId === "experimentation" &&
        reference.active
    ) ?? [];
  const uncertaintyId = args.candidate.uncertaintySeedId;
  const experimentIds = args.candidate.experimentSeedIds;
  if (
    activeExperiments.length === 0 &&
    uncertaintyId === undefined &&
    experimentIds === undefined
  ) {
    return [];
  }
  if (
    !context ||
    !uncertaintyId ||
    !experimentIds ||
    experimentIds.length === 0 ||
    new Set(experimentIds).size !== experimentIds.length ||
    !validReference(uncertaintyId, "active_uncertainties", context) ||
    experimentIds.some(
      (seedId) => !validReference(seedId, "experimentation", context)
    )
  ) {
    return [
      {
        code: "INVALID_ADVANCEMENT_REFERENCE",
        message:
          "Specific advancement references must name active uncertainty and experimentation selections from this generation",
      },
    ];
  }
  return [];
}

function validatedProvenance(args: {
  candidate: SeedCandidate;
  malformedProvenance: number;
  generationId?: string;
  frozenSources?: readonly FrozenSeedSource[];
}): { provenance: ValidatedSeedProvenance[]; issues: SeedValidationIssue[] } {
  const byId = new Map(
    (args.frozenSources ?? []).map((source) => [source.sourceId, source])
  );
  const provenance: ValidatedSeedProvenance[] = [];
  let invalid = args.malformedProvenance;
  for (const citation of args.candidate.provenance) {
    const source = byId.get(citation.sourceId);
    const offsetsValid =
      Number.isInteger(citation.startOffset) &&
      Number.isInteger(citation.endOffset) &&
      citation.startOffset >= 0 &&
      citation.endOffset > citation.startOffset &&
      citation.endOffset <= (source?.content.length ?? -1);
    const generationValid =
      source !== undefined &&
      (args.generationId === undefined ||
        source.generationId === undefined ||
        source.generationId === args.generationId);
    if (
      !source ||
      !offsetsValid ||
      !generationValid ||
      source.content.slice(citation.startOffset, citation.endOffset) !==
        citation.exactExcerpt
    ) {
      invalid += 1;
      continue;
    }
    provenance.push({ ...citation, sourceContentHash: source.contentHash });
  }
  return {
    provenance,
    issues:
      invalid > 0
        ? [
            {
              code: "INVALID_PROVENANCE",
              message: `${invalid} provenance citation(s) did not match the frozen source bytes`,
            },
          ]
        : [],
  };
}

function withoutAdvancementLinks(candidate: SeedCandidate): SeedCandidate {
  const {
    uncertaintySeedId: _uncertainty,
    experimentSeedIds: _experiments,
    ...rest
  } = candidate;
  return rest;
}

export function validateSeed(args: {
  roleId: PdSubsectionRoleId;
  seed: unknown;
  referenceContext?: SeedReferenceContext;
  frozenSources?: readonly FrozenSeedSource[];
}): SeedValidationResult {
  const parsed = parseSeedCandidate(args.seed);
  if (!parsed) {
    return {
      ok: false,
      issues: [{ code: "INVALID_SHAPE", message: "Seed has an invalid shape" }],
    };
  }
  // Link fields belong to specific advancements only. The shared provider
  // schema allows them on every role, so they are dropped elsewhere rather
  // than stored on a Seed they cannot describe.
  const candidate =
    args.roleId === "specific_advancements"
      ? parsed.candidate
      : withoutAdvancementLinks(parsed.candidate);
  const issues: SeedValidationIssue[] = [];
  if (candidate.bullets.length < 1 || candidate.bullets.length > 2) {
    issues.push({
      code: "INVALID_BULLET_COUNT",
      message: "Seed must contain one or two bullets",
    });
  }
  for (const bullet of candidate.bullets) {
    if (countSeedBulletWords(bullet) > MAX_BULLET_WORDS) {
      issues.push({
        code: "BULLET_TOO_LONG",
        message: `Seed bullet exceeds ${MAX_BULLET_WORDS} words`,
      });
    }
    if (!isOneSeedSentence(bullet)) {
      issues.push({
        code: "BULLET_NOT_ONE_SENTENCE",
        message: "Seed bullet must contain exactly one terminated sentence",
      });
    }
    // dashfix (owner, 2026-09-23): the plain hyphen is the only dash in an
    // AI-written Seed. Provenance excerpts are verbatim and not checked here.
    if (!isDashClean(bullet)) {
      issues.push({
        code: "BULLET_TYPOGRAPHIC_DASH",
        message: "Seed bullet must use the plain hyphen, not an em dash, en dash or dash stand-in",
      });
    }
  }
  if (candidate.tags.length < 1 || candidate.tags.length > 2) {
    issues.push({
      code: "INVALID_TAG_COUNT",
      message: "Seed must contain one or two tags",
    });
  }
  if (new Set(candidate.tags).size !== candidate.tags.length) {
    issues.push({ code: "DUPLICATE_TAG", message: "Seed tags must be distinct" });
  }
  issues.push(
    ...validateAdvancementReferences({
      candidate,
      roleId: args.roleId,
      referenceContext: args.referenceContext,
    })
  );
  const blocking = issues.some((issue) => issue.code !== "INVALID_PROVENANCE");
  if (blocking) return { ok: false, issues };

  const citationResult = validatedProvenance({
    candidate,
    malformedProvenance: parsed.malformedProvenance,
    generationId: args.referenceContext?.generationId,
    frozenSources: args.frozenSources,
  });
  const support =
    citationResult.provenance.length > 0
      ? "source_supported"
      : "writer_asserted";
  return {
    ok: true,
    seed: {
      ...candidate,
      provenance: citationResult.provenance,
      support,
      originalSupport: support,
    },
    issues: [...issues, ...citationResult.issues],
  };
}

export function validateBatch(args: {
  roleId: PdSubsectionRoleId;
  mode: SeedBatchMode;
  seeds: readonly unknown[];
  referenceContext?: SeedReferenceContext;
  frozenSources?: readonly FrozenSeedSource[];
}): BatchValidationResult {
  const seeds: ValidatedSeedCandidate[] = [];
  const issues: SeedValidationIssue[] = [];
  args.seeds.forEach((seed, seedIndex) => {
    const result = validateSeed({
      roleId: args.roleId,
      seed,
      referenceContext: args.referenceContext,
      frozenSources: args.frozenSources,
    });
    issues.push(
      ...result.issues.map((issue) => ({ ...issue, seedIndex }))
    );
    if (result.ok) seeds.push(result.seed);
  });

  const min = args.mode === "batch" ? MIN_BATCH_SEEDS : MIN_FEEDBACK_SEEDS;
  const max = args.mode === "batch" ? MAX_BATCH_SEEDS : MAX_FEEDBACK_SEEDS;
  if (seeds.length < min || seeds.length > max) {
    issues.push({
      code: "INVALID_BATCH_SIZE",
      message: `${args.mode} output must contain ${min} to ${max} valid seeds`,
    });
  }
  if (args.mode === "batch") {
    const distinctTags = new Set(seeds.flatMap((seed) => seed.tags));
    if (distinctTags.size < 2) {
      issues.push({
        code: "INSUFFICIENT_TAG_DIVERSITY",
        message: "Seed batch must use at least two distinct tags",
      });
    }
    if (
      seeds.length >= 4 &&
      (!seeds.some((seed) => seed.bullets.length === 1) ||
        !seeds.some((seed) => seed.bullets.length === 2))
    ) {
      issues.push({
        code: "INSUFFICIENT_FORM_DIVERSITY",
        message: "A batch of four or five seeds must include one-bullet and two-bullet forms",
      });
    }
  }
  const batchIssueCodes: ReadonlySet<SeedValidationIssueCode> = new Set([
    "INVALID_BATCH_SIZE",
    "INSUFFICIENT_TAG_DIVERSITY",
    "INSUFFICIENT_FORM_DIVERSITY",
  ]);
  return {
    ok: !issues.some((issue) => batchIssueCodes.has(issue.code)),
    seeds,
    dropped: args.seeds.length - seeds.length,
    issues,
  };
}

export type SeedToolInputSchema = {
  type: "object";
  [key: string]: unknown;
};

/**
 * The forced tool schema every Seed request sends, whatever the role or
 * mode. Role and mode constraints live in application validation.
 */
export function seedToolSchema(): SeedToolInputSchema {
  // One schema for every role and both modes (cost phase 1): the tool
  // definition renders before the system prompt, so a role- or mode-specific
  // schema would split the cached prefix. Link fields are optional for every
  // role and the array spans both modes' bounds; validateBatch and
  // validateSeed enforce the role's links and the mode's count.
  const advancementProperties = {
    uncertaintySeedId: { type: "string" },
    experimentSeedIds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string" },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["seeds"],
    properties: {
      seeds: {
        type: "array",
        minItems: Math.min(MIN_BATCH_SEEDS, MIN_FEEDBACK_SEEDS),
        maxItems: Math.max(MAX_BATCH_SEEDS, MAX_FEEDBACK_SEEDS),
        items: {
          type: "object",
          additionalProperties: false,
          required: ["bullets", "tags", "provenance"],
          properties: {
            bullets: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              items: { type: "string" },
            },
            tags: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              uniqueItems: true,
              items: { type: "string", enum: [...SEED_TAGS] },
            },
            provenance: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "sourceId",
                  "startOffset",
                  "endOffset",
                  "exactExcerpt",
                ],
                properties: {
                  sourceId: { type: "string" },
                  startOffset: { type: "integer", minimum: 0 },
                  endOffset: { type: "integer", minimum: 1 },
                  exactExcerpt: { type: "string" },
                },
              },
            },
            ...advancementProperties,
          },
        },
      },
    },
  };
}

/**
 * Where a validated citation sits in its frozen transcript: the 1-based line
 * of the excerpt's first non-blank character and, when the transcript names
 * speakers, the speaker of that line or of the nearest turn above it. Stamped
 * once when a Seed is written, because readers cannot afford to reread a
 * frozen transcript (up to ~1 MiB) per citation.
 */
export type CitationLocation = { line: number; speaker?: string };

/** Moved to shared/transcriptParse.ts (phase 3); re-exported unchanged. */
export { speakerOfTranscriptLine };

/**
 * Locates each citation in one pass over `content`, reading no further than
 * the last citation. Offsets must already be validated against `content`.
 * Results come back in the order given.
 */
export function locateCitations(
  content: string,
  citations: readonly { startOffset: number; endOffset: number }[]
): CitationLocation[] {
  const targets = citations.map(({ startOffset, endOffset }, index) => {
    let offset = startOffset;
    while (offset < endOffset - 1 && /\s/.test(content[offset])) offset += 1;
    return { offset, index };
  });
  const order = [...targets].sort((a, b) => a.offset - b.offset);
  const result: CitationLocation[] = new Array(citations.length);
  let lineStart = 0;
  let lineNumber = 1;
  let speaker: string | undefined;
  for (const target of order) {
    for (;;) {
      const newline = content.indexOf("\n", lineStart);
      const lineEnd = newline === -1 ? content.length : newline;
      if (target.offset <= lineEnd || newline === -1) {
        // Evaluate this line's own label once per line (idempotent).
        const own = speakerOfTranscriptLine(content.slice(lineStart, lineEnd));
        const current = own ?? speaker;
        result[target.index] = current ? { line: lineNumber, speaker: current } : { line: lineNumber };
        break;
      }
      speaker = speakerOfTranscriptLine(content.slice(lineStart, lineEnd)) ?? speaker;
      lineStart = newline + 1;
      lineNumber += 1;
    }
  }
  return result;
}
