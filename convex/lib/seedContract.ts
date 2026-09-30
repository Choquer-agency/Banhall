import type { PdSubsectionRoleId } from "../../shared/pdSubsections";
import { isDashClean } from "../../shared/humanProse";
import {
  advancementLinkProblem,
  allowedAdvancementLinks,
  isResultRole,
  pickedLinkSelections,
} from "../../shared/advancementLinks";
import { speakerOfTranscriptLine, speakersAtOffsets } from "../../shared/transcriptParse";
import { quoteCheckIssues, type QuoteCheckIssue } from "./seedQuoteSupport";

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
  /**
   * 2026-09-24 (transcript method): the verified fact a transcript citation
   * was resolved from (convex/lib/seedFacts.ts). Offsets are still what
   * validation byte-checks; the id only says where they came from.
   */
  factId?: string;
};

export type SeedCandidate = {
  bullets: string[];
  tags: SeedTag[];
  provenance: SeedCandidateProvenance[];
  uncertaintySeedId?: string;
  experimentSeedIds?: string[];
  /**
   * 2026-09-30 (fourth): on an Advancement to science or goal improvements
   * Seed, the picked uncertainties whose result it states.
   */
  answeredUncertaintySeedIds?: string[];
};

export type ValidatedSeedProvenance = SeedCandidateProvenance & {
  sourceContentHash: string;
  /**
   * Owner decision 25 outside facts mode (2026-09-25): the cited words
   * include a speaker with no role yet. Citable; the quote card asks for a
   * speaker check (decision 24).
   */
  needsSpeakerCheck?: true;
  /**
   * 2026-09-27 (third): the cited words share too few meaningful words with
   * the Seed, or repeat an excerpt another Seed of the Batch owns
   * (seedQuoteSupport.ts). Still a valid citation; the quote card asks for
   * a check.
   */
  needsQuoteCheck?: true;
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
  /**
   * 2026-09-29 (first): on an experimentation reference, the uncertainty
   * selection the experiment tested, when it records one.
   */
  uncertaintySeedId?: string;
};

export type SeedReferenceContext = {
  generationId: string;
  references: readonly SeedReference[];
  /**
   * 2026-09-29 (first, review P2-2): the first Seed of each uncertainty's
   * revision chain, by uncertainty Seed id, so an uncertainty and its
   * Feedback revisions count as one. Missing ids are their own root.
   */
  uncertaintyRoots?: Readonly<Record<string, string>>;
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
  | "INVALID_EXPERIMENT_REFERENCE"
  | "INVALID_RESULT_REFERENCE"
  | "INVALID_PROVENANCE"
  | "INVALID_BATCH_SIZE"
  | "INSUFFICIENT_TAG_DIVERSITY"
  | "INSUFFICIENT_FORM_DIVERSITY";

/**
 * 2026-09-29 (first, run 7): why a Seed's links failed, so a failed Batch
 * can be recorded as counts by reason, never as model text.
 */
export type SeedLinkIssueReason =
  | "missing_link"
  | "unknown_uncertainty"
  | "uncertainty_without_tested_experiment"
  | "unknown_experiment"
  | "duplicate_experiment"
  | "experiment_tested_other"
  // 2026-09-30 (fourth, review P3-1): an Advancement to science Seed sent an
  // empty list; it must name at least one uncertainty.
  | "empty_answers";

export type SeedValidationIssue = {
  code: SeedValidationIssueCode;
  message: string;
  seedIndex?: number;
  linkReason?: SeedLinkIssueReason;
};

/** Issues that never cost a Seed its place. */
const NON_BLOCKING_ISSUES: ReadonlySet<SeedValidationIssueCode> = new Set(["INVALID_PROVENANCE"]);

export type SeedValidationResult =
  | { ok: true; seed: ValidatedSeedCandidate; issues: SeedValidationIssue[] }
  | { ok: false; issues: SeedValidationIssue[] };

export type BatchValidationResult = {
  ok: boolean;
  seeds: ValidatedSeedCandidate[];
  /** Each kept Seed's place in the model's answer, 0-based. */
  seedIndexes: number[];
  dropped: number;
  issues: SeedValidationIssue[];
  /** The fewest valid Seeds this Batch needed, recorded with a failure (run 7). */
  minimum?: number;
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
    ...(typeof value.factId === "string" ? { factId: value.factId } : {}),
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
  if (
    value.answeredUncertaintySeedIds !== undefined &&
    !isStringArray(value.answeredUncertaintySeedIds)
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
      // A repeated id is one answer (the schema asks for unique items).
      ...(value.answeredUncertaintySeedIds !== undefined
        ? { answeredUncertaintySeedIds: [...new Set(value.answeredUncertaintySeedIds)] }
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

function activeReferences(
  context: SeedReferenceContext | undefined,
  roleId: PdSubsectionRoleId
): SeedReference[] {
  return (
    context?.references.filter(
      (reference) =>
        reference.generationId === context.generationId &&
        reference.roleId === roleId &&
        reference.active
    ) ?? []
  );
}

function rootsOf(context: SeedReferenceContext | undefined) {
  const roots = context?.uncertaintyRoots;
  return (seedId: string) => roots?.[seedId] ?? seedId;
}

function pickedFromContext(context: SeedReferenceContext | undefined) {
  const uncertainties = activeReferences(context, "active_uncertainties").map((reference) => reference.seedId);
  const experiments = activeReferences(context, "experimentation").map((reference) => ({
    seedId: reference.seedId,
    uncertaintySeedId: reference.uncertaintySeedId ?? null,
  }));
  const rootOf = rootsOf(context);
  return {
    uncertainties,
    rootOf,
    allowed: allowedAdvancementLinks(uncertainties, experiments, rootOf),
    picked: pickedLinkSelections(uncertainties, experiments, rootOf),
  };
}

/**
 * 2026-09-29 (first, run 7): the links a Subsection 11 request offers, one
 * entry per picked uncertainty with the picked experiments that tested it.
 * Empty when no link can be made. Shared by the prompt and the repair note.
 */
export function offeredAdvancementLinks(context: SeedReferenceContext | undefined) {
  return pickedFromContext(context).allowed;
}

/**
 * 2026-09-29 (first): links are dropped where the request sent no list to
 * copy them from (review P3-3): an experiment with no uncertainty picked,
 * and an advancement when no link can be made (no picked uncertainty that a
 * picked experiment tested). A link copied from the decisions there could
 * only be wrong, and refusing it would fail the Batch for nothing: the Seed
 * is kept unlinked, cannot be approved, and the step says why.
 */
function withoutUnrequestedLinks(
  candidate: SeedCandidate,
  roleId: PdSubsectionRoleId,
  context: SeedReferenceContext | undefined
): SeedCandidate {
  if (roleId === "experimentation" && activeReferences(context, "active_uncertainties").length === 0) {
    return withoutAdvancementLinks(candidate);
  }
  if (roleId === "specific_advancements" && pickedFromContext(context).allowed.length === 0) {
    return withoutAdvancementLinks(candidate);
  }
  // 2026-09-30 (fourth): with no uncertainty picked, a result has nothing
  // to answer and no list was sent.
  if (isResultRole(roleId) && activeReferences(context, "active_uncertainties").length === 0) {
    return withoutAdvancementLinks(candidate);
  }
  return candidate;
}

/**
 * 2026-09-29 (first): an experiment Seed names the uncertainty it tested.
 * When the request's decisions hold uncertainty selections, every Seed of
 * Subsection 9 must set uncertaintySeedId to one of them; with none, it
 * carries no link. Experiments never link other experiments.
 */
function validateExperimentReference(args: {
  candidate: SeedCandidate;
  roleId: PdSubsectionRoleId;
  referenceContext?: SeedReferenceContext;
}): SeedValidationIssue[] {
  if (args.roleId !== "experimentation") return [];
  const context = args.referenceContext;
  const uncertainties = activeReferences(context, "active_uncertainties");
  const uncertaintyId = args.candidate.uncertaintySeedId;
  if (uncertainties.length === 0 && uncertaintyId === undefined) return [];
  if (
    !context ||
    !uncertaintyId ||
    !validReference(uncertaintyId, "active_uncertainties", context)
  ) {
    return [
      {
        code: "INVALID_EXPERIMENT_REFERENCE",
        message:
          "An experiment must name the active uncertainty selection it tested, from this generation",
        linkReason: uncertaintyId ? "unknown_uncertainty" : "missing_link",
      },
    ];
  }
  return [];
}

/**
 * 2026-09-30 (fourth): an Advancement to science or goal improvements Seed
 * records the picked uncertainties whose result it states. When the
 * request's decisions hold uncertainty selections, every such Seed must set
 * answeredUncertaintySeedIds, each id a picked uncertainty of this
 * generation; an Advancement to science Seed names at least one, and a goal
 * improvements Seed may name none when it only restates the goal. With no
 * uncertainty picked, it carries no link.
 */
function validateResultReferences(args: {
  candidate: SeedCandidate;
  roleId: PdSubsectionRoleId;
  referenceContext?: SeedReferenceContext;
}): SeedValidationIssue[] {
  if (!isResultRole(args.roleId)) return [];
  const context = args.referenceContext;
  const uncertainties = activeReferences(context, "active_uncertainties");
  const answered = args.candidate.answeredUncertaintySeedIds;
  if (uncertainties.length === 0 && answered === undefined) return [];
  const issue = (linkReason: SeedLinkIssueReason): SeedValidationIssue[] => [
    {
      code: "INVALID_RESULT_REFERENCE",
      message:
        "A result must name the active uncertainty selections it answers, from this generation",
      linkReason,
    },
  ];
  if (!context || answered === undefined) return issue("missing_link");
  if (answered.some((seedId) => !validReference(seedId, "active_uncertainties", context))) {
    return issue("unknown_uncertainty");
  }
  if (args.roleId === "overall_advancement" && answered.length === 0) return issue("empty_answers");
  return [];
}

function advancementIssue(linkReason: SeedLinkIssueReason): SeedValidationIssue[] {
  return [
    {
      code: "INVALID_ADVANCEMENT_REFERENCE",
      message:
        "A specific advancement must link one offered uncertainty and experiments that tested it, from this generation",
      linkReason,
    },
  ];
}

function validateAdvancementReferences(args: {
  candidate: SeedCandidate;
  roleId: PdSubsectionRoleId;
  referenceContext?: SeedReferenceContext;
}): SeedValidationIssue[] {
  if (args.roleId !== "specific_advancements") return [];
  const context = args.referenceContext;
  // 2026-09-29 (first): links are required whenever one can be made: a
  // picked uncertainty that a picked experiment tested (or an experiment
  // that records no uncertainty). With none, the links were already
  // dropped (withoutUnrequestedLinks) and the step says why.
  const { allowed, picked } = pickedFromContext(context);
  const uncertaintyId = args.candidate.uncertaintySeedId;
  const experimentIds = args.candidate.experimentSeedIds;
  if (
    allowed.length === 0 &&
    uncertaintyId === undefined &&
    experimentIds === undefined
  ) {
    return [];
  }
  if (!context || allowed.length === 0 || !uncertaintyId || !experimentIds || experimentIds.length === 0) {
    return advancementIssue("missing_link");
  }
  if (new Set(experimentIds).size !== experimentIds.length) return advancementIssue("duplicate_experiment");
  if (!validReference(uncertaintyId, "active_uncertainties", context)) return advancementIssue("unknown_uncertainty");
  if (experimentIds.some((seedId) => !validReference(seedId, "experimentation", context))) {
    return advancementIssue("unknown_experiment");
  }
  const root = picked.rootOf(uncertaintyId);
  if (!allowed.some((link) => picked.rootOf(link.uncertaintySeedId) === root)) {
    return advancementIssue("uncertainty_without_tested_experiment");
  }
  const problem = advancementLinkProblem(args.candidate, picked);
  if (problem === null) return [];
  return advancementIssue(problem === "experiment_tested_other" ? "experiment_tested_other" : "missing_link");
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
  for (const original of args.candidate.provenance) {
    const source = byId.get(original.sourceId);
    // 2026-09-24 (owner decision 26): the model reads placeholders, not
    // names, so offsets it counts drift from the frozen text. Offsets were
    // never trustworthy from a model; a verbatim excerpt at the wrong offsets
    // is located in its own source and still byte-checked below.
    // The occurrence nearest the model's own offset wins (review 2026-09-25):
    // an excerpt the interviewer also said earlier must not move to their
    // turn and take their speaker.
    const located =
      source &&
      source.content.slice(original.startOffset, original.endOffset) !== original.exactExcerpt &&
      original.exactExcerpt !== ""
        ? nearestOccurrence(source.content, original.exactExcerpt, original.startOffset)
        : -1;
    const citation =
      located !== -1
        ? { ...original, startOffset: located, endOffset: located + original.exactExcerpt.length }
        : original;
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

/**
 * The result of the transcript speaker check for one validated citation
 * (convex/lib/citationSpeakers.ts): kept at `startOffset`/`endOffset`, which
 * may be another place of the same words in the same row, or null when the
 * words are only the interviewer's or another speaker's.
 */
export type CheckedSeedCitation = {
  startOffset: number;
  endOffset: number;
  needsSpeakerCheck: boolean;
} | null;

/**
 * Owner decision 25 outside facts mode (2026-09-25): drops each citation
 * the speaker check rejected, moves or marks the rest, and recomputes
 * support the way validateSeed does. A Seed left with no citation is kept
 * as writer-asserted; nothing fails. `checked[i]` is the result for
 * `seed.provenance[i]`. `dropped` counts every citation not kept, a
 * duplicate of a kept place included. Pure.
 */
export function withCheckedSpeakers(
  seed: ValidatedSeedCandidate,
  checked: readonly CheckedSeedCitation[]
): { seed: ValidatedSeedCandidate; dropped: number } {
  const provenance: ValidatedSeedProvenance[] = [];
  const places = new Set<string>();
  seed.provenance.forEach((citation, index) => {
    const result = checked[index];
    if (!result) return;
    // Two citations moved to the same place are one citation.
    const place = `${citation.sourceId}|${result.startOffset}|${result.endOffset}`;
    if (places.has(place)) return;
    places.add(place);
    const { needsSpeakerCheck: _previous, ...rest } = citation;
    provenance.push({
      ...rest,
      startOffset: result.startOffset,
      endOffset: result.endOffset,
      ...(result.needsSpeakerCheck ? { needsSpeakerCheck: true as const } : {}),
    });
  });
  const support = provenance.length > 0 ? "source_supported" : "writer_asserted";
  return {
    seed: { ...seed, provenance, support, originalSupport: support },
    dropped: seed.provenance.length - provenance.length,
  };
}

/**
 * The start of the occurrence of `excerpt` in `content` nearest `near` (the
 * earlier one on a tie), or -1. A non-number `near` means the first.
 */
export function nearestOccurrence(content: string, excerpt: string, near: number): number {
  if (excerpt === "") return -1;
  const target = Number.isFinite(near) ? near : 0;
  let best = -1;
  for (let at = content.indexOf(excerpt); at !== -1; at = content.indexOf(excerpt, at + 1)) {
    if (best === -1 || Math.abs(at - target) < Math.abs(best - target)) best = at;
    if (at > target) break;
  }
  return best;
}

function withoutAdvancementLinks(candidate: SeedCandidate): SeedCandidate {
  const {
    uncertaintySeedId: _uncertainty,
    experimentSeedIds: _experiments,
    answeredUncertaintySeedIds: _answered,
    ...rest
  } = candidate;
  return rest;
}

/** 2026-09-29 (first): an experiment keeps the uncertainty it tested only. */
function withExperimentLinkOnly(candidate: SeedCandidate): SeedCandidate {
  const { experimentSeedIds: _experiments, answeredUncertaintySeedIds: _answered, ...rest } = candidate;
  return rest;
}

/** 2026-09-29 (first): an advancement keeps its uncertainty and experiments only. */
function withAdvancementLinksOnly(candidate: SeedCandidate): SeedCandidate {
  const { answeredUncertaintySeedIds: _answered, ...rest } = candidate;
  return rest;
}

/** 2026-09-30 (fourth): a result keeps the uncertainties it answers only. */
function withResultLinksOnly(candidate: SeedCandidate): SeedCandidate {
  const { uncertaintySeedId: _uncertainty, experimentSeedIds: _experiments, ...rest } = candidate;
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
  // Link fields belong to specific advancements, since 2026-09-29 (first)
  // an experiment's uncertainty to experimentation, and since 2026-09-30
  // (fourth) the answered uncertainties to Advancement to science and goal
  // improvements. The shared provider schema allows some of them on every
  // role, so they are dropped elsewhere rather than stored on a Seed they
  // cannot describe.
  const candidate = withoutUnrequestedLinks(
    args.roleId === "specific_advancements"
      ? withAdvancementLinksOnly(parsed.candidate)
      : args.roleId === "experimentation"
        ? withExperimentLinkOnly(parsed.candidate)
        : isResultRole(args.roleId)
          ? withResultLinksOnly(parsed.candidate)
          : withoutAdvancementLinks(parsed.candidate),
    args.roleId,
    args.referenceContext
  );
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
    }),
    ...validateExperimentReference({
      candidate,
      roleId: args.roleId,
      referenceContext: args.referenceContext,
    }),
    ...validateResultReferences({
      candidate,
      roleId: args.roleId,
      referenceContext: args.referenceContext,
    })
  );
  const blocking = issues.some((issue) => !NON_BLOCKING_ISSUES.has(issue.code));
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
  const inputIndexes: number[] = [];
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
    if (result.ok) {
      seeds.push(result.seed);
      inputIndexes.push(seedIndex);
    }
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
    seedIndexes: inputIndexes,
    dropped: args.seeds.length - seeds.length,
    issues,
    minimum: min,
  };
}

/**
 * 2026-09-29 (first, run 7): one rejected answer as counts, never model
 * text: the Seeds the model returned and how many were valid, the minimum,
 * and for each rule (and link reason) how many Seeds broke it. Recorded on a
 * failed Batch so a failure is never a black box.
 */
export type SeedAnswerCounts = {
  seedsReturned: number;
  seedsValid: number;
  minimum: number;
  issues: Array<{ code: SeedValidationIssueCode | "WRONG_TOOL"; reason?: SeedLinkIssueReason; seeds: number }>;
};

/**
 * PR #22 review (G13): an answer from a Seed tool other than the one the
 * request asked for, as counts. None of its Seeds is kept, whatever they
 * hold, so every Seed it returned counts against `WRONG_TOOL`.
 */
export function wrongToolAnswerCounts(returned: number, mode: SeedBatchMode): SeedAnswerCounts {
  return {
    seedsReturned: returned,
    seedsValid: 0,
    minimum: mode === "batch" ? MIN_BATCH_SEEDS : MIN_FEEDBACK_SEEDS,
    issues: [{ code: "WRONG_TOOL", seeds: returned }],
  };
}

export function seedAnswerCounts(result: BatchValidationResult, returned: number): SeedAnswerCounts {
  const counts = new Map<string, { code: SeedValidationIssueCode; reason?: SeedLinkIssueReason; seeds: Set<number> }>();
  for (const issue of result.issues) {
    const key = `${issue.code}:${issue.linkReason ?? ""}`;
    const entry = counts.get(key) ?? {
      code: issue.code,
      ...(issue.linkReason ? { reason: issue.linkReason } : {}),
      seeds: new Set<number>(),
    };
    entry.seeds.add(issue.seedIndex ?? -1);
    counts.set(key, entry);
  }
  return {
    seedsReturned: returned,
    seedsValid: result.seeds.length,
    minimum: result.minimum ?? MIN_BATCH_SEEDS,
    issues: [...counts.values()].map(({ seeds, ...rest }) => ({
      ...rest,
      seeds: [...seeds].filter((index) => index >= 0).length,
    })),
  };
}

/**
 * 2026-09-27 (third): each citation must back its own Seed
 * (seedQuoteSupport.ts). Runs after the speaker check, so a quote that check
 * drops is never judged. A citation that fails is kept and marked
 * `needsQuoteCheck`, never dropped, so no Seed or Batch is lost. Reuse is
 * looked for in a fresh Batch only. Pure.
 */
export function withQuoteChecks(
  seeds: readonly ValidatedSeedCandidate[],
  mode: SeedBatchMode
): { seeds: ValidatedSeedCandidate[]; issues: QuoteCheckIssue[] } {
  const issues = quoteCheckIssues(seeds, { reuse: mode === "batch" });
  const marked = seeds.map((seed, seedIndex) => {
    const flagged = new Set(
      issues.filter((issue) => issue.seedIndex === seedIndex).map((issue) => issue.citationIndex)
    );
    if (flagged.size === 0) return seed;
    return {
      ...seed,
      provenance: seed.provenance.map((citation, index) =>
        flagged.has(index) ? { ...citation, needsQuoteCheck: true as const } : citation
      ),
    };
  });
  return { seeds: marked, issues };
}

export type SeedToolInputSchema = {
  type: "object";
  [key: string]: unknown;
};

/**
 * 2026-09-29 (first, run 7 re-check): which Seed tool a request forces. A
 * request that sends a FROZEN EXPERIMENT LINKS block forces the experiment
 * tool, one that sends FROZEN ADVANCEMENT LINKS the advancement tool, one
 * that sends FROZEN RESULT LINKS (2026-09-30 fourth) the result tool, and
 * every other request the shared one.
 */
export type SeedToolKind = "shared" | "experiment" | "advancement" | "result";

/**
 * The linked Seed schemas, fixed for every request so the tools list is
 * byte-stable across a generation's Seed requests. The experiment schema
 * requires uncertaintySeedId and has no experiment list; the advancement
 * schema requires uncertaintySeedId and experimentSeedIds (at least one);
 * the result schema (2026-09-30 fourth) requires answeredUncertaintySeedIds,
 * a list that may be empty, and has neither of the others. Which ids are
 * allowed is never in the schema: the request's link block lists them and
 * validateSeed enforces them, with the Advancement to science minimum of one.
 */
export function linkedSeedSchemas(base: SeedToolInputSchema): {
  experiment: SeedToolInputSchema;
  advancement: SeedToolInputSchema;
  result: SeedToolInputSchema;
} {
  type Mutable = SeedToolInputSchema & {
    properties: { seeds: { items: { required: string[]; properties: Record<string, unknown> } } };
  };
  const experiment = structuredClone(base) as Mutable;
  const experimentItem = experiment.properties.seeds.items;
  delete experimentItem.properties.experimentSeedIds;
  experimentItem.required = [...experimentItem.required, "uncertaintySeedId"];
  const advancement = structuredClone(base) as Mutable;
  const advancementItem = advancement.properties.seeds.items;
  advancementItem.required = [...advancementItem.required, "uncertaintySeedId", "experimentSeedIds"];
  const result = structuredClone(base) as Mutable;
  const resultItem = result.properties.seeds.items;
  delete resultItem.properties.uncertaintySeedId;
  delete resultItem.properties.experimentSeedIds;
  resultItem.properties.answeredUncertaintySeedIds = {
    type: "array",
    uniqueItems: true,
    items: { type: "string" },
  };
  resultItem.required = [...resultItem.required, "answeredUncertaintySeedIds"];
  return { experiment, advancement, result };
}

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
  // The speaker comes from the analyzed turns (parser v8 review, P2-5), so
  // a line that only looks like a label never names the speaker.
  const speakers = speakersAtOffsets(
    content,
    order.map((target) => target.offset)
  );
  let lineStart = 0;
  let lineNumber = 1;
  order.forEach((target, rank) => {
    for (;;) {
      const newline = content.indexOf("\n", lineStart);
      const lineEnd = newline === -1 ? content.length : newline;
      if (target.offset <= lineEnd || newline === -1) {
        const current = speakers[rank];
        result[target.index] = current ? { line: lineNumber, speaker: current } : { line: lineNumber };
        return;
      }
      lineStart = newline + 1;
      lineNumber += 1;
    }
  });
  return result;
}
