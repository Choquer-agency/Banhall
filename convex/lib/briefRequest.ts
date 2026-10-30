/**
 * The Generation Brief request: its system prompt, tool, answer budget,
 * input budget and the user message built from frozen evidence rows.
 *
 * Moved out of convex/ai/brief.ts (a "use node" module) on 2026-09-26 so
 * the Brief preparation key (convex/lib/briefPreparationKey.ts), computed in
 * mutations, hashes exactly the request the model is sent. convex/ai/brief.ts
 * re-exports every name, so callers are unchanged.
 */
import type { SourceRowWithText } from "./sourceText";
import type Anthropic from "@anthropic-ai/sdk";
import type { Doc, Id } from "../_generated/dataModel";
import { chooseEvidence, subjectOf, utf16Size } from "../../shared/evidenceChoice";
import {
  documentTrust,
  CHARS_PER_TOKEN,
  cutToBudget,
  formatCount,
  preferFactSources,
  truncationNotice,
} from "../ai/trustedContext";
import { HUMAN_PROSE_FOR_OWN_WORDING } from "../../shared/humanProse";
import { chooseSettingsSource } from "./settingsDocument";
import { COMPANY_FILES_NOTE } from "./companyEvidence";

export const CLAIM_EXCLUSION_REASONS = [
  "business_risk",
  "routine_engineering",
  "outside_claim_period",
  "not_technological",
] as const;
export const CONFIDENCE_LEVELS = [
  "established",
  "partial",
  "unresolved",
  "unreliable",
] as const;

/**
 * 2026-10-30, after the live rerun (R2): the Storyline chose the narrowest
 * challenge as the one main uncertainty, as the analyzer did, and the
 * Self-check judges every Line against the Storyline, so a draft framed
 * around the shared problem failed it. The Storyline follows the analyzer's
 * rule (ANALYZER_CHOSEN_UNCERTAINTIES). Review round 4 (wording P2-3): only
 * when the notes give a count without naming which, and as specifically as
 * the evidence allows, never as the project goal.
 */
export const BRIEF_STORYLINE_MAIN_UNCERTAINTY =
  " When the writer's notes give only a count (for example \"one main uncertainty\") and do not name which, the Storyline frames it as the underlying technological problem the related challenges share, the one question the work set out to answer, not the narrowest of them, stated as specifically as the evidence allows (the technical question, the conditions, why standard practice does not answer it), never as the project goal: the related challenges are parts of it, the work on them (validation checks, thresholds and measurements included) stays in the Storyline, and a challenge unrelated to it stays out.";

export const BRIEF_SYSTEM_PROMPT = `You derive a Generation Brief for a Canadian SR&ED (Scientific Research & Experimental Development) project description, before any section is drafted.

The Brief has four parts:
1. Storyline: the most defensible narrative account of the project against the CRA's Five Questions (technological uncertainty, hypotheses, systematic investigation, technological advancement, records kept). Write it as flowing prose, then restate its individual claims with the exact supporting quote from the evidence.${BRIEF_STORYLINE_MAIN_UNCERTAINTY}
2. Claim Exclusions: statements in the evidence that must NEVER be claimed as SR&ED work, however prominent, because they fall outside eligible work. Every exclusion needs a reason: business_risk, routine_engineering, outside_claim_period, or not_technological.
3. Confidence Map: the evidence's facts classified established (directly and clearly supported), partial (supported but incomplete or hedged), unresolved (evidence conflicts or is silent), or unreliable (independent evidence shows the source itself is suspect, e.g. it contradicts itself, was explicitly invalidated, or is otherwise independently discredited).
4. Glossary Terms: the handful of technical phrases the project description should use consistently, one name per concept.

Rules:
- Every Storyline claim, Claim Exclusion, and Confidence Map entry MUST carry a "quote" field that is an EXACT, VERBATIM, character-for-character substring copied from the evidence below. Never paraphrase the quote, never invent one. An entry whose quote cannot be found verbatim in the evidence is discarded before it ever reaches the report, so a paraphrased quote is a wasted entry.
- Never fabricate a claim, exclusion, or fact absent from the evidence.
- Treat the [SOURCE_KIND=...] tag in each evidence delimiter as authoritative; labels are descriptive and do not determine source kind. When three or more blocks carry [SOURCE_KIND=transcript], reconcile those Transcripts source by source before writing the Brief. Identify what they agree on and every materially conflicting claim.
- Before classifying claims as materially conflicting, compare their scope, run, configuration, time, and compatible units. Compatible measurements made under different conditions are not contradictions. Retain each relevant claim with calibrated confidence and its own exact quote.
- Build one coherent Storyline whose common spine is the facts the Transcripts agree on. Do not exclude a defensible complementary fact merely because only one Transcript reports it; retain it with calibrated confidence and its exact source quote when no evidence contradicts it. When the supporting passages for an agreement are materially distinct, preserve source-by-source traceability with separate Confidence Map entries, one per distinct passage and originating Transcript, with one exact quote per entry. If multiple Transcripts contain an identical supporting passage, do not duplicate the same quote merely to claim unique source attribution; one quote-bound entry is sufficient unless another materially distinct passage is available.
- Never average materially conflicting claims, silently choose one, or omit a competing claim. For each competing claim, use an exact contextual quote that is unique to its originating evidence block when available. If identical passages or overlapping text make the source unresolvable, state the attribution ambiguity and do not claim unique source provenance. Ordinary inter-source disagreement is "unresolved", not "unreliable": keep each competing claim as a separate Confidence Map entry with confidence "unresolved" and its own exact quote from the originating evidence block. Use "unreliable" only when independent evidence gives a reason to distrust the source itself, such as an internal contradiction, explicit invalidation, or other evidence that the source is suspect.
- Treat a conflict as resolved only when the evidence explicitly says that a claim was corrected or retracted and the correction or retraction itself remains supported. A correction that was subsequently withdrawn or retracted, or is independently discredited, does not invalidate the original claim or inform the Storyline. A correction or retraction resolves only the claim it explicitly corrects or retracts. A different source merely asserting that a competing claim is wrong, or offering a disputed correction, remains ordinary unresolved disagreement unless independent evidence establishes source unreliability; do not invent an authority or approval hierarchy. When a supported correction or retraction validly resolves a claim, keep the original claim as "unreliable" with its exact quote, and record the explicit correction or retraction separately with its own exact quote. Reassess every remaining competitor and keep unresolved alternatives separate. If other conflicting alternatives remain, preserve that uncertainty in the Storyline; a replacement is not established solely because it is labeled a correction. A retraction alone supplies no replacement fact. Let only a supported, undisputed correction inform the Storyline. Never infer a correction from recency, plausibility, or source order.
- Glossary terms are the canonical term string plus, optionally, inflected forms already used in the evidence verbatim (plurals, past tense); those are matched back into the evidence separately by rule, so no quote is needed for them.
- Some concepts appear in the evidence only under a different phrasing than your canonical term (a genuine synonym, not just a plural or tense change). For those, and ONLY those, also give a "quote" field: an exact, verbatim substring where that different phrasing appears. Leave "quote" empty for any term whose exact wording (or an obvious plural/past-tense form) is already present.
- Write in plain, specific, technical language. No filler, no marketing language.\n\n${HUMAN_PROSE_FOR_OWN_WORDING}`;

export const BRIEF_REQUEST = {
  roleOrder: ["system", "user"],
  toolName: "submit_generation_brief",
  toolDescription:
    "Submit the derived Generation Brief: Storyline, Claim Exclusions, Confidence Map, Glossary Terms.",
  // 2026-09-25: raised from 8,192; a real Brief used 8,007 of it, so a
  // slightly larger project would have been cut off (see ANALYZER_REQUEST).
  maxTokens: 16_000,
} as const;

/**
 * Input budget for the Brief call (cost phase 1). The call used to send
 * every frozen source whole, with no bound at all. Same totals as the
 * analyzer's DEFAULT_CONTEXT_BUDGET: 150k tokens overall, at most 100k for
 * any one source. Spent in frozen order (transcripts or their digests
 * first), so the outcome is reproducible from the frozen rows.
 */
export const BRIEF_INPUT_BUDGET = {
  totalTokens: 150_000,
  perSourceTokens: 100_000,
} as const;

/** Said once at the end when whole sources did not fit. */
export const BRIEF_OMITTED_SOURCES_NOTICE = {
  prefix: "[",
  suffix: " further source(s) were omitted to fit the context budget.]",
} as const;

export function briefOmittedSourcesNotice(count: number): string {
  return `${BRIEF_OMITTED_SOURCES_NOTICE.prefix}${formatCount(count)}${BRIEF_OMITTED_SOURCES_NOTICE.suffix}`;
}

/**
 * Phase D, step 1 (2026-10-28, fourth): a source sent in excerpts, the
 * parts that best match the interviews, when the frozen sources do not all
 * fit. Between two excerpts the separator; after them the notice.
 */
export const BRIEF_EXCERPTS = {
  separator: "\n[...]\n",
  noticePrefix: "[EXCERPTS: only the parts of this source that best match the interviews were sent, ",
  // When no part matched the interviews, they came in order (review).
  noticeUnmatchedPrefix: "[EXCERPTS: only parts of this source were sent, ",
  noticeSuffix: " characters; the text between them was left out.]",
} as const;

export function briefExcerptsNotice(sent: number, total: number, matched = true): string {
  return `${matched ? BRIEF_EXCERPTS.noticePrefix : BRIEF_EXCERPTS.noticeUnmatchedPrefix}${formatCount(sent)} of ${formatCount(total)}${BRIEF_EXCERPTS.noticeSuffix}`;
}

/**
 * Whether the request sends every source as before (Phase D, step 1): the
 * evidence it weighs, each counted up to the per-source limit, within the
 * total. Shared with the inputs hash, so a Brief chosen by relevance is
 * never reused for one that was not.
 */
export function briefSourcesFit(
  sources: ReadonlyArray<Pick<BriefMessageSource, "kind" | "content" | "transcriptId">>,
  budget: { totalTokens: number; perSourceTokens: number } = BRIEF_INPUT_BUDGET
): boolean {
  const evidence = preferFactSources(sources.filter((s) => s.kind !== "writer_storyline"));
  const perSource = Math.max(0, budget.perSourceTokens) * CHARS_PER_TOKEN;
  const total = Math.max(0, budget.totalTokens) * CHARS_PER_TOKEN;
  return evidence.reduce((sum, s) => sum + Math.min(s.content.length, perSource), 0) <= total;
}

/**
 * An upper bound on the request's characters when the sources do not all
 * fit, without choosing the parts (a preparation reserves its spend from
 * it, review): the whole budget, the guidance and every rule or notice it
 * may carry, and each source's two marker lines and a notice.
 */
export function briefRequestCharsUpperBound(
  sources: ReadonlyArray<Pick<BriefMessageSource, "kind" | "label">>,
  budget: { totalTokens: number; perSourceTokens: number } = BRIEF_INPUT_BUDGET
): number {
  const fixed =
    BRIEF_TASK_GUIDANCE.length +
    BRIEF_WRITER_WORDING.prefix.length + BRIEF_WRITER_WORDING.suffix.length + 200 +
    COMPANY_FILES_NOTE.length +
    briefOmittedSourcesNotice(sources.length).length;
  const perSource = sources.reduce((sum, s) => sum + 2 * (s.label.length + s.kind.length + 40) + 200, 0);
  return Math.max(0, budget.totalTokens) * CHARS_PER_TOKEN + fixed + perSource;
}

/** The kinds that always go in whole (cut only at the per-source limit): the interviews. */
const TRANSCRIPT_KINDS: ReadonlySet<string> = new Set(["transcript", "transcript_digest", "transcript_facts"]);

const strArray = { type: "array", items: { type: "string" } } as const;

export const BRIEF_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    storyline: {
      type: "string",
      description: "The full Storyline narrative, in flowing prose.",
    },
    storylineClaims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          quote: { type: "string", description: "Exact verbatim quote from the evidence." },
        },
        required: ["text", "quote"],
      },
    },
    claimExclusions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          quote: { type: "string" },
          reason: { type: "string", enum: [...CLAIM_EXCLUSION_REASONS] },
        },
        required: ["text", "quote", "reason"],
      },
    },
    confidenceMap: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          quote: { type: "string" },
          confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
        },
        required: ["text", "quote", "confidence"],
      },
    },
    glossaryTerms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          inflections: strArray,
          quote: {
            type: "string",
            description:
              "Only when this term's exact wording (or an obvious plural/past-tense form) is NOT already present: an exact, verbatim quote showing a different phrasing of the same concept. Omit otherwise.",
          },
        },
        required: ["term"],
      },
    },
  },
  required: [
    "storyline",
    "storylineClaims",
    "claimExclusions",
    "confidenceMap",
    "glossaryTerms",
  ],
};

const BRIEF_TASK_GUIDANCE =
  "Derive the Generation Brief from the evidence below. Every quote you give must be an exact, verbatim substring of one of these blocks.";

/**
 * 2026-10-04 (first, round 2, owner approved 2026-10-05): the writer's
 * wording rule for the Brief. Release suite run of 2026-10-04 (second run):
 * the Storyline still said "substrate temperature", "pinholes", "edge DFT",
 * "bake window" and "edge wrap" though the settings document in Writer's
 * Notes bans them. Sent after the task line only when the evidence holds a
 * settings document an internal uploader supplied (chooseSettingsSource,
 * the Writer Profile's own rule and trust floor) and its block is in the
 * message. The request is built from the frozen sources alone, so the
 * Brief preparation key, which hashes this message, and the reuse hash
 * (briefInputsHash, marked with `version`) follow it.
 */
export const BRIEF_WRITER_WORDING = {
  version: 1,
  prefix: "\n\nThe block [SOURCE_KIND=project_document] [",
  suffix:
    "] is the writer's settings document. In the Storyline, the text of each claim, Claim Exclusion and Confidence Map entry, and the Glossary Terms, use the exact terms it gives for things and never a word or phrase it bans or says not to use, even where other evidence uses it. Quotes stay exact, verbatim substrings of the evidence.",
} as const;

/** The frozen source the Brief's wording rule names, or null. */
export function briefSettingsSource<Source extends Pick<SourceRowWithText, "label" | "content" | "kind"> & { uploaderRole?: string }>(
  sources: readonly Source[]
): Source | null {
  return chooseSettingsSource(sources)?.source ?? null;
}

/** AD-11 delimited data blocks: one per frozen evidence source. Never
 * includes a writer-supplied Storyline: that source is context for the
 * writer, not evidence to derive Claim Exclusions/Confidence Map/Glossary
 * from, and is never fed to this call. */
export function buildBriefUserMessage(
  sources: BriefMessageSource[],
  budget: { totalTokens: number; perSourceTokens: number } = BRIEF_INPUT_BUDGET
): string {
  return briefMessageWithReport(sources, budget).message;
}

type BriefMessageSource = Pick<SourceRowWithText, "label" | "content" | "kind"> & {
  transcriptId?: Id<"transcripts">;
  /** 2026-10-04 (first, round 2): the trust floor of the wording rule. */
  uploaderRole?: string;
};

/**
 * `buildBriefUserMessage`, with what it sent of each source it considered
 * (Phase D, step 2): characters kept of the source's characters, 0 for one
 * left out, and the ranges sent (Phase D, step 1). A Storyline and a
 * transcript read through its digest or fact pack are not considered, so
 * they get no entry.
 *
 * Phase D, step 1 (owner decision "2026-10-28 (fourth)"): when the sources
 * fit (`briefSourcesFit`: each counted up to the per-source limit, all
 * within the total), the message is exactly as before. When they do not,
 * the interviews, the settings document and writer's notes an internal user
 * uploaded go in whole (cut only at the per-source limit, or where the total
 * runs out), and every other source sends the parts that best match the
 * interviews and the writer's Storyline (`chooseEvidence`), joined by a
 * separator and followed by a notice; a source with no part sent is counted
 * as omitted, as before. Files are frozen at 200,000 characters at most, so
 * none passes the per-source limit. Notices and block frames are not
 * counted against the total, as before.
 */
export function briefMessageWithReport<S extends BriefMessageSource>(
  sources: S[],
  budget: { totalTokens: number; perSourceTokens: number } = BRIEF_INPUT_BUDGET
): { message: string; report: Array<{ source: S; sent: number; total: number; ranges: Array<{ start: number; end: number }> }> } {
  const report: Array<{ source: S; sent: number; total: number; ranges: Array<{ start: number; end: number }> }> = [];
  const settings = briefSettingsSource(sources);
  let settingsSent = false;
  // Digest mode means digests: a transcript with a frozen digest is read
  // through the digest only, never both. 2026-09-24 (transcript method):
  // with a fact pack for every transcript, the packs take their places.
  const evidence = preferFactSources(
    sources.filter((s) => s.kind !== "writer_storyline")
  );
  const perSource = Math.max(0, budget.perSourceTokens) * CHARS_PER_TOKEN;
  let remaining = Math.max(0, budget.totalTokens) * CHARS_PER_TOKEN;
  if (!briefSourcesFit(sources, budget)) return briefMessageByRelevance(sources, evidence, settings, perSource, remaining);
  let omitted = 0;
  const blocks: string[] = [];
  // Phase C: one note before the first company file the request carries.
  let companyNoted = false;
  const noteCompany = (kind: string) => {
    if (kind !== "company_file" || companyNoted) return;
    blocks.push(COMPANY_FILES_NOTE);
    companyNoted = true;
  };
  for (const s of evidence) {
    const block = (body: string) =>
      `--- BEGIN [SOURCE_KIND=${s.kind}] [${s.label.toUpperCase()}] ---\n${body}\n--- END [SOURCE_KIND=${s.kind}] [${s.label.toUpperCase()}] ---`;
    if (!s.content.length) {
      noteCompany(s.kind);
      blocks.push(block(s.content));
      report.push({ source: s, sent: 0, total: 0, ranges: [] });
      continue;
    }
    // A cut keeps a prefix of the frozen text, so every quote the model
    // takes from it is still a verbatim substring of the source.
    const kept = cutToBudget(s.content, Math.min(perSource, remaining));
    report.push({ source: s, sent: kept.length, total: s.content.length, ranges: kept.length ? [{ start: 0, end: kept.length }] : [] });
    if (!kept.length) {
      omitted += 1;
      continue;
    }
    remaining -= kept.length;
    if (s === settings) settingsSent = true;
    noteCompany(s.kind);
    blocks.push(
      block(
        kept.length < s.content.length
          ? `${kept}\n${truncationNotice(s.content.length - kept.length, s.content.length)}`
          : kept
      )
    );
  }
  if (omitted > 0) blocks.push(briefOmittedSourcesNotice(omitted));
  const wording = settings && settingsSent
    ? `${BRIEF_WRITER_WORDING.prefix}${settings.label.toUpperCase()}${BRIEF_WRITER_WORDING.suffix}`
    : "";
  return { message: `${BRIEF_TASK_GUIDANCE}${wording}\n\n${blocks.join("\n\n")}`, report };
}

/** `briefMessageWithReport` when the sources do not all fit: see there. */
function briefMessageByRelevance<S extends BriefMessageSource>(
  sources: S[],
  evidence: S[],
  settings: S | null,
  perSource: number,
  total: number
): { message: string; report: Array<{ source: S; sent: number; total: number; ranges: Array<{ start: number; end: number }> }> } {
  const report: Array<{ source: S; sent: number; total: number; ranges: Array<{ start: number; end: number }> }> = [];
  // Writer's notes go in whole only when an internal user uploaded them; a
  // client's copy is demoted, as the analyzer and the facts check do.
  const mustBeWhole = (s: S) =>
    TRANSCRIPT_KINDS.has(s.kind) ||
    s === settings ||
    (s.label.startsWith("writer_notes:") && documentTrust("writer_notes", s.uploaderRole) === "internal");
  // A source that goes in whole is first cut at the per-source limit, as before.
  const candidates = evidence.map((s) => (mustBeWhole(s) ? cutToBudget(s.content, perSource) : s.content));
  const subject = subjectOf([
    ...evidence.filter((s) => TRANSCRIPT_KINDS.has(s.kind)).map((s) => s.content),
    ...sources.filter((s) => s.kind === "writer_storyline").map((s) => s.content),
  ]);
  const chosen = chooseEvidence({
    rows: candidates.map((text, index) => ({ text, ...(mustBeWhole(evidence[index]!) ? { whole: true } : {}) })),
    subject,
    budget: total,
    size: utf16Size,
    excerptCost: BRIEF_EXCERPTS.separator.length,
  });
  let omitted = 0;
  let settingsSent = false;
  const blocks: string[] = [];
  let companyNoted = false;
  evidence.forEach((s, index) => {
    const block = (body: string) =>
      `--- BEGIN [SOURCE_KIND=${s.kind}] [${s.label.toUpperCase()}] ---\n${body}\n--- END [SOURCE_KIND=${s.kind}] [${s.label.toUpperCase()}] ---`;
    const noteCompany = () => {
      if (s.kind !== "company_file" || companyNoted) return;
      blocks.push(COMPANY_FILES_NOTE);
      companyNoted = true;
    };
    if (!s.content.length) {
      noteCompany();
      blocks.push(block(s.content));
      report.push({ source: s, sent: 0, total: 0, ranges: [] });
      return;
    }
    const { ranges } = chosen[index]!;
    const sent = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    report.push({ source: s, sent, total: s.content.length, ranges });
    if (sent === 0) {
      omitted += 1;
      return;
    }
    if (s === settings) settingsSent = true;
    noteCompany();
    const prefix = ranges.length === 1 && ranges[0]!.start === 0;
    if (mustBeWhole(s) || prefix) {
      // Whole, or a prefix cut at a word: as before.
      const kept = s.content.slice(0, ranges[0]!.end);
      blocks.push(block(kept.length < s.content.length ? `${kept}\n${truncationNotice(s.content.length - kept.length, s.content.length)}` : kept));
      return;
    }
    const excerpts = ranges.map((range) => s.content.slice(range.start, range.end)).join(BRIEF_EXCERPTS.separator);
    blocks.push(block(`${excerpts}\n${briefExcerptsNotice(sent, s.content.length, chosen[index]!.matched === true)}`));
  });
  if (omitted > 0) blocks.push(briefOmittedSourcesNotice(omitted));
  const wording = settings && settingsSent
    ? `${BRIEF_WRITER_WORDING.prefix}${settings.label.toUpperCase()}${BRIEF_WRITER_WORDING.suffix}`
    : "";
  return { message: `${BRIEF_TASK_GUIDANCE}${wording}\n\n${blocks.join("\n\n")}`, report };
}

