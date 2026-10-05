import {
  matchesClaimExclusion,
  normalizeExclusionMatch,
} from "./claimExclusionMatcher";
import { LINE_LIMITS, WORD_CAPS, sectionMetrics } from "./lineLimits";
import { STORYLINE_QUESTION_WITHHELD_REASON } from "./storylineQuestionNote";
import { sectionParagraphs } from "./tiptapReport";
import { matchGlossaryTerms } from "./glossaryMatcher";
import { isNearCopy } from "./droppedUncertainties";
import { contentWords } from "./seedQuoteSupport";
import {
  noteDraft,
  type ComplianceNoteDraft,
  type SelfCheckSummary,
} from "./complianceNote";
import {
  sectionKeyOf,
  type CategoryOutcome,
  type ComplianceTier,
  type OrderedProfileContext,
  type SectionNumber,
} from "./orderedChain";
import {
  GOVERNED_IN_IDEA_CLAUSE,
  governedTermFollowed,
  governedTermNotFollowed,
  governedTermReason,
  governingFeedbackPhrase,
  type FeedbackGovernedTerm,
  type GovernedTermState,
} from "./writerPrecedence";
import { findSourceTalk, SOURCE_TALK } from "../../shared/humanProse";
import { capWithinLocked, ruleBearsOnLine } from "./writerLineCap";

/**
 * Story 2 (CAP-9, AD-25): the deterministic half of a section's Self-check.
 * Pure and framework-free: no database, no model. It produces the
 * deterministic Compliance Note rows (Writer Profile state, Build Order, the
 * six House Rule categories, Locked caps, profile Self-check rule caps, Claim
 * Exclusions, Glossary Terms found verbatim) and hands the model call exactly
 * what the rules cannot decide (glossary candidates, free-text rules).
 *
 * Paragraph indices are 0-based and come from `sectionParagraphs`, the same
 * split the editor document (and so src/lib/reportSections.ts) uses.
 */

export type ModelCheckKind = "storyline" | "confidence" | "glossary" | "instruction";

/** One paragraph-scoped verdict from the structured Self-check call. */
export type ModelVerdict = {
  /** undefined = the verdict is about the whole section, not one paragraph. */
  paragraphIndex?: number;
  check: ModelCheckKind;
  instruction: string;
  outcome: "applied" | "not_applied";
  reason: string;
  repairGuidance?: string;
  /**
   * Summary only, in memory only: the unclipped guidance or reason the one
   * repair call uses when clipping shortened the stored text. Never stored.
   */
  repairText?: string;
  /**
   * Summary only (2026-09-28): the Self-check gave no verdict for this label,
   * even after its one follow-up. Recorded as not_applied, never repaired.
   */
  notChecked?: true;
  /**
   * Summary only, in memory only (PR #22 lead decision): the Glossary Term a
   * "feedback:F<n>" label checks, which the writer's Feedback governs in the
   * Line. Its row is written in fixed words; the verdict decides the outcome.
   */
  feedbackTerm?: string;
};

/** One finding from the assembled-draft consistency pass. */
export type ConsistencyFinding = {
  section: SectionNumber;
  paragraphIndex: number;
  sections: SectionNumber[];
  kind: "contradiction" | "excluded_claim" | "terminology";
  issue: string;
};

/** The Brief as the Self-check reads it (a rendered read of stored rows). */
export type BriefCheckContext = {
  storylineText: string;
  claimExclusions: Array<{ text: string; exactExcerpt?: string; reason?: string }>;
  confidenceMap: Array<{ text: string; confidence?: string }>;
  glossaryTerms: string[];
};

export type CheckEntry = {
  /** Stable across the pre- and post-repair runs of the same section. */
  key: string;
  row: ComplianceNoteDraft;
  /** A repair of the prose can fix this failure. */
  repairable: boolean;
  guidance?: string;
  /**
   * 2026-10-04 (first): a cap code measured (the Locked cap, or a word or
   * line cap of the writer's rules), so the rows the model writes can never
   * vouch for it. In memory only.
   */
  measuredCap?: MeasuredCap;
  /**
   * 2026-10-04 (first): why a measured rule of the Writer Profile was not
   * met, in a few words, for the Writer Profile row. In memory only.
   */
  profileRuleFailure?: string;
};

/** 2026-10-04 (first): one cap code measured on a Line. */
export type MeasuredCap = {
  kind: "locked" | "writer";
  /** "Line 244", or "paragraph 2 of Line 244" for a paragraph's cap. */
  scope: string;
  /** A whole-Line cap: the shortening passes aim under the tightest one. */
  wholeLine: boolean;
  /** Each measure over its cap, such as "602/520 words"; empty when within. */
  over: string[];
  /** The cap itself, such as "520 words" or "350 words and 50 form lines". */
  limits: string;
  /** The writer's rule, word for word (writer caps only). */
  instruction?: string;
};

/** "Line 244 is over the writer's cap at 602/520 words". */
export function measuredCapPhrase(cap: MeasuredCap): string {
  return `${cap.scope} is over ${cap.kind === "locked" ? "the Locked cap" : "the writer's cap"} at ${cap.over.join(" and ")}`;
}

export type DeterministicSelfCheck = {
  entries: CheckEntry[];
  /** Glossary Terms with no verbatim occurrence: the model classifies these. */
  glossaryCandidates: string[];
  /** Profile Self-check rules without caps: the model judges these. */
  modelRules: Array<{ instruction: string; paragraphIndex?: number }>;
  paragraphs: string[];
};

const CATEGORY_LABELS: Record<CategoryOutcome["category"], string> = {
  bannedWords: "banned words",
  paragraphDensity: "paragraph density",
  sentenceConstruction: "sentence construction",
  repetitionCaps: "repetition caps",
  openingClauses: "opening clauses",
  reportSkeleton: "report skeleton",
};

const EXCLUSION_REASON_LABELS: Record<string, string> = {
  business_risk: "business risk",
  routine_engineering: "routine engineering",
  outside_claim_period: "outside the claim period",
  not_technological: "not technological",
};

function exclusionReasonLabel(reason: string | undefined): string {
  return EXCLUSION_REASON_LABELS[reason ?? ""] ?? reason ?? "excluded";
}

/** Lowercase words joined by single spaces, padded for boundary matching. */
function normalizeForMatch(text: string): string {
  return normalizeExclusionMatch(text);
}

function isBlankNeedle(text: string): boolean {
  return normalizeForMatch(text).trim() === "";
}

function paragraphContaining(paragraphs: string[], needle: string): number {
  const normalized = normalizeForMatch(needle);
  return paragraphs.findIndex((paragraph) =>
    normalizeForMatch(paragraph).includes(normalized)
  );
}

/**
 * 2026-09-30 (second): the first paragraph holding a close form of a Claim
 * Exclusion's words: one of its sentences holds at least NEAR_COPY_SHARE of
 * the exclusion's content words, case, punctuation, stop words and light
 * plurals aside (the near-copy guard of convex/lib/droppedUncertainties.ts).
 * Release suite run 11 (exclusion-conflict, Line 244 paragraph 3) wrote
 * "this work also covered migration of the customer billing portal to a new
 * cloud host, which was routine IT work following a vendor migration guide",
 * which the exact match misses. Only the suspended row's wording reads it.
 */
export function paragraphWithCloseForm(paragraphs: readonly string[], needle: string): number {
  if (contentWords(needle).length === 0) return -1;
  return paragraphs.findIndex((paragraph) =>
    paragraph
      .split(/(?<=[.!?])\s+/)
      .some((sentence) => isNearCopy([needle], [sentence]))
  );
}

/** Rule-based verbatim/inflected Glossary Term match (glossaryMatcher.ts). */
export function glossaryTermPresent(term: string, text: string): boolean {
  const canonical = term.trim();
  if (!canonical) return false;
  return (
    matchGlossaryTerms(
      [{ term: canonical, inflections: [`${canonical}s`, `${canonical}es`] }],
      text
    ).length > 0
  );
}

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function categoryReason(
  outcome: CategoryOutcome,
  waiverAnalysisFailed: boolean
): string {
  if (outcome.mode === "enforced") {
    return "House Rule applied: org-enforced (writer waivers are ignored)";
  }
  if (outcome.mode === "off") {
    return "House Rule waived for everyone (org mode off)";
  }
  if (outcome.effective) {
    return "instruction waived via override: the Writer Profile waives this House Rule";
  }
  return waiverAnalysisFailed
    ? "House Rule applied: the settings document could not be analysed for waivers"
    : "House Rule applied (no Writer Profile waiver)";
}

/** Story 3 (AD-26): the reason on a waiver row an org-enforced mode ignored. */
export const ORG_ENFORCED_WAIVER_REASON =
  "org-enforced: this House Rule applies regardless of the Writer Profile";

export function runDeterministicSelfCheck(input: {
  section: SectionNumber;
  text: string;
  brief: BriefCheckContext | null;
  profile: OrderedProfileContext;
  /** The first section in production order carries the Build Order row. */
  isFirstInOrder: boolean;
  /** Signed plan items whose matching Brief exclusions were human-confirmed. */
  confirmedPlanConflicts?: readonly (readonly string[])[];
  /**
   * 2026-09-29 (second): Glossary Terms a signed-off edit took out of this
   * Line (writerPrecedence.ts). They are neither required nor used to
   * replace wording; each gets a conflict row saying why.
   */
  glossarySetAside?: readonly { term: string; reason: string }[];
  /**
   * PR #22 lead decision: Glossary Terms the writer's Feedback governs in
   * this Line. They are not checked here and are never Glossary candidates:
   * their own Self-check label checks them, and their row comes from its
   * verdict (assembleSectionNotes).
   */
  feedbackTerms?: readonly string[];
  /**
   * 2026-09-30 (third): signed-off plan runs only. Report text that names
   * where a fact came from (an interviewee, the test memo, the Brief) is
   * found here and sent to the repair. `subjectText` is the plan's wording
   * and the Glossary Terms: their words are the project's own subject and
   * are never reported. Absent: no such check and no row, so Single draft
   * and Compare keep their rows and requests.
   */
  sourceTalk?: { subjectText: readonly string[] };
}): DeterministicSelfCheck {
  const { section, text, brief, profile, isFirstInOrder } = input;
  const key = sectionKeyOf(section);
  const paragraphs = sectionParagraphs(text);
  const entries: CheckEntry[] = [];
  const add = (
    entryKey: string,
    fields: {
      instruction: string;
      outcome: "applied" | "not_applied";
      tier: ComplianceTier;
      reason: string;
      paragraphIndex?: number;
    },
    repairable = false,
    guidance?: string
  ) => {
    entries.push({
      key: entryKey,
      row: noteDraft({ section, source: "deterministic", ...fields }),
      repairable,
      ...(guidance ? { guidance } : {}),
    });
  };

  // The Writer Profile is never silent (AD-26): every section says whether
  // it applied.
  add(
    "profile",
    profile.profileState === "applied"
      ? {
          instruction: "Writer Profile",
          outcome: "applied",
          tier: "none",
          reason: profile.profileReason ?? "Writer Profile applied",
        }
      : {
          instruction: "Writer Profile",
          outcome: "not_applied",
          tier: "none",
          reason: `no Writer Profile applied (${profile.profileState})`,
        }
  );

  // Build Order: on the first section in production order, and on every
  // section when the profile's order fell back, so the reason is never lost.
  if (isFirstInOrder || profile.buildOrderFallbackReason) {
    const order = profile.buildOrder.join(" → ");
    add(
      "buildOrder",
      profile.buildOrderFallbackReason
        ? { instruction: "Build Order", outcome: "not_applied", tier: "none", reason: profile.buildOrderFallbackReason }
        : profile.profileState !== "applied"
          ? {
              instruction: "Build Order",
              outcome: "not_applied",
              tier: "none",
              reason: `no Writer Profile applied (${profile.profileState}); House Rules default ${order} used`,
            }
          : { instruction: "Build Order", outcome: "applied", tier: "none", reason: `Build Order ${order}` }
    );
  }

  // Six House Rule categories: tier copied verbatim from the per-category
  // outcome getEffectiveWriterStyle computed (AD-26), never recomputed here.
  // Story 3: a requested waiver the org ignored gets its own row, so no
  // tier applies silently.
  for (const outcome of profile.categoryOutcomes) {
    add(`category:${outcome.category}`, {
      instruction: `House Rule category: ${CATEGORY_LABELS[outcome.category]}`,
      outcome: outcome.effective ? "not_applied" : "applied",
      tier: outcome.tier,
      reason: categoryReason(outcome, profile.waiverAnalysisFailed === true),
    });
    if (outcome.requested === true && !outcome.effective) {
      add(`waiver:${outcome.category}`, {
        instruction: `Writer Profile waiver: ${CATEGORY_LABELS[outcome.category]}`,
        outcome: "not_applied",
        tier: outcome.tier,
        reason: ORG_ENFORCED_WAIVER_REASON,
      });
    }
  }

  // Locked caps (never overridable).
  const metrics = sectionMetrics(text, key);
  const lockedCap = `${metrics.wordCap} words and ${metrics.limit} form lines`;
  add(
    "locked",
    {
      instruction: `Locked Rule: Line ${section} holds at most ${lockedCap}`,
      outcome: metrics.overLimit ? "not_applied" : "applied",
      tier: "locked",
      reason: metrics.overLimit
        ? `cap breach at ${metrics.words}/${metrics.wordCap} words, ${metrics.lines}/${metrics.limit} lines`
        : `within cap at ${metrics.words}/${metrics.wordCap} words, ${metrics.lines}/${metrics.limit} lines`,
    },
    metrics.overLimit,
    `Shorten Line ${section} to at most ${lockedCap} (now ${metrics.words} words, ${metrics.lines} lines).`
  );
  entries[entries.length - 1]!.measuredCap = {
    kind: "locked",
    scope: `Line ${section}`,
    wholeLine: true,
    over: [
      ...(metrics.words > metrics.wordCap ? [`${metrics.words}/${metrics.wordCap} words`] : []),
      ...(metrics.lines > metrics.limit ? [`${metrics.lines}/${metrics.limit} lines`] : []),
    ],
    limits: lockedCap,
  };

  // Profile Self-check rules: capped rules are measured here, clipped to the
  // Locked caps; uncapped rules go to the model, quoted verbatim.
  const modelRules: DeterministicSelfCheck["modelRules"] = [];
  profile.selfCheckRules.forEach((rule, index) => {
    // 2026-10-04 (first): the same rule selection and Locked clipping as the
    // writer's cap drafting and shortening aim under (writerLineCap.ts).
    if (!ruleBearsOnLine(rule, section)) return;
    const paragraphScoped = rule.paragraphIndex !== undefined;
    if (paragraphScoped && (rule.paragraphIndex ?? 0) >= paragraphs.length) {
      const missing = `paragraph ${(rule.paragraphIndex ?? 0) + 1} is not present in Line ${section}`;
      add(`rule:${index}`, {
        instruction: rule.instruction,
        paragraphIndex: rule.paragraphIndex,
        outcome: "not_applied",
        tier: "none",
        reason: missing,
      });
      entries[entries.length - 1]!.profileRuleFailure = missing;
      return;
    }
    if (rule.maxWords === undefined && rule.maxLines === undefined) {
      modelRules.push({
        instruction: rule.instruction,
        ...(paragraphScoped ? { paragraphIndex: rule.paragraphIndex } : {}),
      });
      return;
    }
    const scope = paragraphScoped ? paragraphs[rule.paragraphIndex ?? 0] : text;
    const measured = sectionMetrics(scope, key);
    const parts: string[] = [];
    const limits: string[] = [];
    const overParts: string[] = [];
    let over = false;
    let clipped = false;
    const measure = (
      asked: number | undefined,
      lockedLimit: number,
      actual: number,
      unit: string
    ) => {
      if (asked === undefined) return;
      const effective = capWithinLocked(asked, lockedLimit);
      limits.push(`${effective} ${unit}`);
      if (actual > effective) {
        over = true;
        overParts.push(`${actual}/${effective} ${unit}`);
      }
      if (asked > lockedLimit) {
        clipped = true;
        parts.push(
          actual > lockedLimit
            ? `over the Locked cap at ${actual}/${lockedLimit} ${unit} (rule asked ${asked})`
            : `cap met at ${actual}/${lockedLimit} ${unit} (rule asked ${asked}; the Locked cap applies)`
        );
      } else {
        parts.push(`${actual}/${asked} ${unit}`);
      }
    };
    measure(rule.maxWords, WORD_CAPS[key], measured.words, "words");
    measure(rule.maxLines, LINE_LIMITS[key], measured.lines, "lines");
    const scopeLabel = paragraphScoped
      ? `paragraph ${(rule.paragraphIndex ?? 0) + 1} of Line ${section}`
      : `Line ${section}`;
    add(
      `rule:${index}`,
      {
        instruction: rule.instruction,
        ...(paragraphScoped ? { paragraphIndex: rule.paragraphIndex } : {}),
        outcome: over ? "not_applied" : "applied",
        tier: clipped ? "conflict" : "none",
        reason: `${over ? "exceeds: " : ""}${parts.join("; ")}`,
      },
      over,
      `Shorten ${scopeLabel} to at most ${limits.join(" and ")} (writer rule: "${rule.instruction}").`
    );
    const cap: MeasuredCap = {
      kind: "writer",
      scope: scopeLabel,
      wholeLine: !paragraphScoped,
      over: overParts,
      limits: limits.join(" and "),
      instruction: rule.instruction,
    };
    entries[entries.length - 1]!.measuredCap = cap;
    if (over) entries[entries.length - 1]!.profileRuleFailure = measuredCapPhrase(cap);
  });

  // 2026-10-04 (first): the Writer Profile row says the profile was used to
  // draft the Line; when a rule of it that code measures was not met, its
  // reason says so, so it never reads as "every rule followed".
  const profileFailures = entries.flatMap((entry) =>
    entry.profileRuleFailure && entry.row.outcome === "not_applied" ? [entry.profileRuleFailure] : []
  );
  if (profile.profileState === "applied" && profileFailures.length > 0) {
    const profileEntry = entries.find((entry) => entry.key === "profile");
    if (profileEntry) {
      profileEntry.row = noteDraft({
        section,
        source: "deterministic",
        instruction: profileEntry.row.instruction,
        outcome: profileEntry.row.outcome,
        tier: profileEntry.row.tier,
        reason: `${profileEntry.row.reason}. It was used to draft this Line, but not every rule it sets was met: ${joinedList(profileFailures)} (see ${profileFailures.length === 1 ? "that row" : "those rows"}).`,
      });
    }
  }

  // Claim Exclusions: normalized substring of the entry text or its cited
  // excerpt; an empty exclusion is skipped, never matched against everything.
  (brief?.claimExclusions ?? []).forEach((exclusion, index) => {
    const needles = [exclusion.text, exclusion.exactExcerpt ?? ""].filter(
      (needle) => !isBlankNeedle(needle)
    );
    if (needles.length === 0) return;
    let found = -1;
    for (const needle of needles) {
      found = paragraphContaining(paragraphs, needle);
      if (found >= 0) break;
    }
    const label = exclusionReasonLabel(exclusion.reason);
    const instruction = `Claim Exclusion: ${exclusion.text}`;
    // CAP-13 rule 4 (2026-09-29, second): in the Line whose signed-off plan
    // holds an idea the writer kept despite this exclusion, the exclusion is
    // meant to be suspended for that idea's content only. This check matches
    // words and cannot tell the kept idea from other content with the same
    // words, so it suspends the exclusion for the whole Line (review P3-1)
    // and says so; it never asks for a removal there. The consistency pass
    // is told to report any other content that claims the excluded work, and
    // the idea's own plan row says whether it was drafted. Every other Line,
    // and every other exclusion, is checked as before.
    const confirmedPlanConflict = (input.confirmedPlanConflicts ?? []).some(
      (wording) =>
        matchesClaimExclusion(wording, exclusion.text, exclusion.exactExcerpt)
    );
    if (confirmedPlanConflict) {
      // 2026-09-30 (second): with its words not in the Line as written, a
      // close form of them is named where one appears (release suite run 11).
      let close = -1;
      if (found < 0) {
        for (const needle of needles) {
          close = paragraphWithCloseForm(paragraphs, needle);
          if (close >= 0) break;
        }
      }
      add(`exclusion:${index}`, {
        instruction,
        ...(found >= 0 ? { paragraphIndex: found } : close >= 0 ? { paragraphIndex: close } : {}),
        outcome: "not_applied",
        tier: "conflict",
        reason: found >= 0
          ? `suspended in this Line for the idea the writer kept despite this Claim Exclusion: its words appear in paragraph ${found + 1} (${label}) and are not repaired away; this word check cannot tell that idea from other content with the same words`
          : close >= 0
            ? `suspended in this Line for the idea the writer kept despite this Claim Exclusion (${label}): its exact words are not in this Line, but a close form of its words is in paragraph ${close + 1} and is not repaired away; the idea's own row says whether it was drafted`
            : `suspended in this Line for the idea the writer kept despite this Claim Exclusion (${label}); its words are not in this Line as written, and the idea's own row says whether it was drafted`,
      });
      return;
    }
    if (found < 0) {
      add(`exclusion:${index}`, {
        instruction,
        outcome: "applied",
        tier: "none",
        reason: `excluded claim absent (${label})`,
      });
      return;
    }
    add(
      `exclusion:${index}`,
      {
        instruction,
        paragraphIndex: found,
        outcome: "not_applied",
        tier: "none",
        reason: `excluded claim appears in paragraph ${found + 1} (${label})`,
      },
      true,
      `Paragraph ${found + 1}: remove the excluded claim "${exclusion.text}"; it is outside the eligible work (${label}) and must not be claimed.`
    );
  });

  // Glossary Terms: a verbatim (or inflected) use is applied here; a term
  // with no occurrence is a candidate the model classifies (synonym or
  // absent concept).
  const glossaryCandidates: string[] = [];
  const setAside = input.glossarySetAside ?? [];
  const governed = new Set((input.feedbackTerms ?? []).map((term) => term.trim().toLowerCase()));
  for (const term of uniqueTerms(brief?.glossaryTerms ?? [])) {
    // CAP-13 rule 5: the writer's Feedback governs a term it names in this
    // Line; its own Self-check label checks it (PR #22 lead decision).
    if (governed.has(term.toLowerCase())) continue;
    // CAP-13 rule 5 (2026-09-29, second): the writer's wording outranks a
    // Glossary Term. A term a signed-off edit sets aside is not checked.
    const aside = setAside.find((entry) => entry.term.trim().toLowerCase() === term.toLowerCase());
    if (aside) {
      add(`glossary:${term.toLowerCase()}`, {
        instruction: `Glossary Term: ${term}`,
        outcome: "not_applied",
        tier: "conflict",
        reason: `Not enforced in this Line: ${aside.reason}. The writer's wording outranks the Brief.`,
      });
      continue;
    }
    const index = paragraphs.findIndex((paragraph) =>
      glossaryTermPresent(term, paragraph)
    );
    if (index < 0) {
      glossaryCandidates.push(term);
      continue;
    }
    add(`glossary:${term.toLowerCase()}`, {
      instruction: `Glossary Term: ${term}`,
      paragraphIndex: index,
      outcome: "applied",
      tier: "none",
      reason: `Glossary Term used (paragraph ${index + 1})`,
    });
  }

  // 2026-09-30 (third): no talk about sources in report text. One row per
  // Line; a hit goes to the repair with a fixed fix that names its words.
  if (input.sourceTalk) {
    const subjectText = input.sourceTalk.subjectText;
    const found = paragraphs.flatMap((paragraph, index) =>
      findSourceTalk(paragraph, { subjectText }).map((hit) => ({ index, phrase: hit.phrase })));
    if (found.length === 0) {
      add(SOURCE_TALK_KEY, {
        instruction: SOURCE_TALK.instruction,
        outcome: "applied",
        tier: "none",
        reason: SOURCE_TALK.applied,
      });
    } else {
      add(
        SOURCE_TALK_KEY,
        {
          instruction: SOURCE_TALK.instruction,
          paragraphIndex: found[0]!.index,
          outcome: "not_applied",
          tier: "none",
          reason: `names a source in ${sourceTalkPlaces(found)}`,
        },
        true,
        sourceTalkRepairIssue(found)
      );
    }
  }

  return { entries, glossaryCandidates, modelRules, paragraphs };
}

/**
 * 2026-10-04 (first, review P2-2 and re-check P3-5): what a Self-check
 * reason says about the Line's length: a word or line cap, limit or count;
 * a length cap or limit; being within, under or over the cap, or a word,
 * line or length limit; "N words"; "N form lines" or "N lines long"; and a
 * count with its unit, such as "602/520 words". Narrow on purpose: "the
 * detection limit", "below the limit" (a temperature), "end caps", "a 50/50
 * resin blend" and "ran on 2 lines" are not length.
 */
const LENGTH_TALK = new RegExp(
  [
    String.raw`\b(?:word|line)s?[\s-]+(?:caps?|limits?|counts?|budget)\b`,
    String.raw`\blength[\s-]+(?:caps?|limits?)\b`,
    String.raw`\b(?:within|under|over|exceeds?|meets?|met)\s+(?:the\s+|its\s+|this\s+|a\s+)?(?:\d[\d,]*[\s-]*(?:words?|lines?)[\s-]+|(?:words?|lines?|length)[\s-]+)?caps?\b`,
    String.raw`\b(?:within|under|over|exceeds?|meets?|met)\s+(?:the\s+|its\s+|this\s+|a\s+)?(?:\d[\d,]*[\s-]*(?:words?|lines?)|words?|lines?|length)[\s-]+limits?\b`,
    String.raw`\b\d[\d,]*[\s-]*words?\b`,
    String.raw`\b\d[\d,]*\s+form\s+lines?\b`,
    String.raw`\b\d[\d,]*[\s-]*lines?\s+long\b`,
    String.raw`\b\d[\d,]*\s*\/\s*\d[\d,]*\s*(?:words?|lines?)\b`,
  ].join("|"),
  "i"
);

/** 2026-10-04 (first): whether a reason talks about the Line's length. */
export function talksAboutLength(text: string): boolean {
  return LENGTH_TALK.test(text);
}

/**
 * 2026-10-04 (first, review P2-2): `text` without its clauses about length.
 * Clauses end at a semicolon, or at a full stop or comma before a space or
 * the end, so "1,200" and "2.5" stay whole. The clauses kept keep their own
 * words and punctuation, without a dangling semicolon or comma at the end;
 * "" when every clause was about length.
 */
export function withoutLengthClauses(text: string): string {
  const parts = text.split(/(;\s*|[.,](?=\s|$)\s*)/);
  let out = "";
  for (let index = 0; index < parts.length; index += 2) {
    const clause = parts[index] ?? "";
    const end = parts[index + 1] ?? "";
    if (!clause.trim() || talksAboutLength(clause)) continue;
    out += `${clause}${end}`;
  }
  return out.trim().replace(/[;,]$/, "").replace(/^(?:and|but|or)\s+/i, "");
}

/**
 * 2026-10-04 (first, review P3-2): whether a model verdict's instruction is
 * the Writer Profile itself. The Summary Self-check labels it with the
 * whole text; in Single draft and Compare the model quotes it, often cut
 * short, so its title line when that is a "#" heading, or an opening of six
 * words or more that the profile starts with and that runs past its first
 * line, counts too.
 */
function quotesWriterProfile(instruction: string, profile: string | undefined): boolean {
  const text = normalizeForMatch(profile ?? "");
  if (text.trim() === "") return false;
  const quoted = normalizeForMatch(instruction);
  if (quoted === text) return true;
  // Review re-check P3-1: the first line names the profile only when it is
  // a heading; a first line that is a rule ("Write in the third person.")
  // is that rule, and an opening counts only when it runs past it.
  const firstLine = profile?.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const first = normalizeForMatch(firstLine);
  if (/^\s*#/.test(firstLine) && first.trim().split(" ").length >= 3 && quoted.includes(first)) return true;
  return (
    quoted.trim().split(" ").length >= 6 &&
    quoted.trim().length > first.trim().length &&
    text.startsWith(quoted.trimEnd())
  );
}

/**
 * 2026-10-04 (first, release suite alert 7): the guard on a model row for a
 * writer instruction on a Line where code measured a cap as not met. The
 * Self-check judged a whole settings document as one instruction and wrote
 * "word cap ok" beside a measured cap row that was not met. Null leaves the
 * row as it is.
 *
 * - The row for the Writer Profile itself (quotesWriterProfile), or for an
 *   instruction that holds a writer's cap rule word for word, carries that
 *   cap, so it is never applied. Its reason names the measured cap in
 *   fixed words, then the model's reason without its clauses about length
 *   (withoutLengthClauses): "Otherwise followed: " for an applied verdict,
 *   "Also: " for one not applied.
 * - Any other instruction row whose reason talks about length keeps its
 *   outcome; its clauses about length give way to fixed words that name
 *   the measured cap, and every other clause stays.
 */
export function writerRowGuard(input: {
  verdict: Pick<ModelVerdict, "instruction" | "outcome" | "reason">;
  row: ComplianceNoteDraft;
  failedCaps: readonly MeasuredCap[];
  writerInstructions?: string;
}): ComplianceNoteDraft | null {
  const { verdict, row, failedCaps } = input;
  if (failedCaps.length === 0) return null;
  const instruction = normalizeForMatch(verdict.instruction);
  const isProfile = quotesWriterProfile(verdict.instruction, input.writerInstructions);
  const carried = failedCaps.filter((cap) => {
    if (cap.kind !== "writer") return false;
    if (isProfile) return true;
    const rule = normalizeForMatch(cap.instruction ?? "");
    return rule.trim() !== "" && instruction.includes(rule);
  });
  const talks = talksAboutLength(verdict.reason);
  if (carried.length === 0 && !talks) return null;
  // The model's words, without its clauses about length, then the notes
  // this app added after them (a repair's outcome), as written.
  const appNotes = row.reason.startsWith(verdict.reason) ? row.reason.slice(verdict.reason.length) : "";
  const modelWords = withoutLengthClauses(verdict.reason);
  const kept = modelWords
    ? `${modelWords}${appNotes}`
    : appNotes.replace(/^[;,.]\s*/, "");
  const rebuilt = (outcome: "applied" | "not_applied", reason: string) =>
    noteDraft({
      section: row.section,
      ...(row.paragraphIndex !== undefined ? { paragraphIndex: row.paragraphIndex } : {}),
      source: row.source,
      instruction: row.instruction,
      outcome,
      tier: row.tier,
      reason,
      repaired: row.repaired,
    });
  // Review re-check P3-4: the model's words end on a full stop before more follows.
  const ended = (text: string) => (/[.!?)"']$/.test(text) ? text : `${text}.`);
  if (carried.length > 0) {
    const measured = `${joinedList(carried.map(measuredCapPhrase))} (measured by code; see the cap row)`;
    const applied = verdict.outcome === "applied";
    const rest = kept
      ? applied ? ` Otherwise followed: ${ended(kept)}` : ` Also: ${ended(kept)}`
      : applied ? " The Self-check found the other rules followed." : "";
    return rebuilt("not_applied", `${applied ? "Not followed in full" : "Not followed"}: ${measured}.${rest}`);
  }
  const lead = kept ? ended(kept) : `${row.outcome === "applied" ? "Followed" : "Not followed"}, as the Self-check found.`;
  return rebuilt(
    row.outcome,
    `${lead} Length is measured by code: ${joinedList(failedCaps.map(measuredCapPhrase))} (see the cap row).`
  );
}

/** The deterministic entry key of the source-talk check (2026-09-30, third). */
export const SOURCE_TALK_KEY = "sourceTalk";

/** At most this many source-talk phrases are named in a row or a fix. */
const SOURCE_TALK_NAMED = 4;

function joinedList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** 'paragraph 1 ("interviewees") and paragraph 3 ("recorded elsewhere", "Storyline")'. */
function sourceTalkPlaces(found: ReadonlyArray<{ index: number; phrase: string }>): string {
  const named = found.slice(0, SOURCE_TALK_NAMED);
  const paragraphs = [...new Set(named.map((hit) => hit.index))].map((index) =>
    `paragraph ${index + 1} (${named.filter((hit) => hit.index === index).map((hit) => `"${hit.phrase}"`).join(", ")})`);
  const more = found.length - named.length;
  return joinedList(more > 0 ? [...paragraphs, `${more} more`] : paragraphs);
}

/**
 * The repair fix for source talk: the paragraphs, the phrases as written
 * and the rule, in fixed words (SOURCE_TALK in shared/humanProse.ts).
 */
export function sourceTalkRepairIssue(found: ReadonlyArray<{ index: number; phrase: string }>): string {
  const paragraphs = [...new Set(found.map((hit) => hit.index + 1))];
  const where = paragraphs.length === 1
    ? `Paragraph ${paragraphs[0]}`
    : `Paragraphs ${joinedList(paragraphs.map(String))}`;
  const phrases = [...new Set(found.map((hit) => `"${hit.phrase}"`))].slice(0, SOURCE_TALK_NAMED);
  return `${where}: ${SOURCE_TALK.fix} (${phrases.join(", ")}). ${SOURCE_TALK.rule}`;
}

/**
 * Every issue a repair must fix: deterministic guidance plus model verdicts.
 * A Glossary Term the writer's Feedback governs is repaired toward that
 * Feedback, quoted, with the check's guidance after it (PR #22 lead
 * decision).
 */
export function repairIssues(
  before: DeterministicSelfCheck,
  verdicts: ModelVerdict[],
  governed: readonly FeedbackGovernedTerm[] = [],
  options: {
    /**
     * 2026-09-30 (third): signed-off plan runs only. A fixed start for a
     * verdict's fix (how to hedge a Confidence Map or Storyline issue, how
     * to use a Glossary Term), put before the check's own guidance. Absent,
     * or "", leaves the issue as before.
     */
    verdictPrefix?: (verdict: ModelVerdict) => string;
  } = {}
): string[] {
  const issues = before.entries
    .filter((entry) => entry.repairable && entry.row.outcome === "not_applied")
    .map((entry) => entry.guidance ?? entry.row.reason);
  for (const verdict of verdicts) {
    if (verdict.outcome !== "not_applied" || verdict.notChecked) continue;
    const fix = verdict.repairText ?? (verdict.repairGuidance?.trim() || verdict.reason);
    const where =
      verdict.paragraphIndex === undefined
        ? "Whole section"
        : `Paragraph ${verdict.paragraphIndex + 1}`;
    const term = verdict.feedbackTerm === undefined
      ? undefined
      : governed.find((entry) => entry.term === verdict.feedbackTerm);
    if (term) {
      // 2026-09-30 (second): a term an unedited signed-off idea uses is
      // renamed there too; renaming is wording, not meaning.
      issues.push(
        `${where}: for the term "${term.term}", follow the writer's Feedback ${governingFeedbackPhrase(term.feedback)}${
          term.inSignedOffIdea ? GOVERNED_IN_IDEA_CLAUSE : ""
        }.${fix.trim() ? ` ${fix.trim()}` : ""}`
      );
      continue;
    }
    issues.push(`${where}: ${options.verdictPrefix?.(verdict) ?? ""}${fix}`);
  }
  return issues;
}

/** The Glossary Term a glossary verdict names (the candidate it mentions). */
export function glossaryTermOf(verdict: ModelVerdict, candidates: string[]): string {
  const normalized = normalizeForMatch(verdict.instruction);
  return (
    candidates.find((term) => normalized.includes(normalizeForMatch(term))) ??
    verdict.instruction
  );
}

/**
 * Final Compliance Note rows and Self-check summary for one section. The
 * deterministic rows come from the post-repair re-check when a repair ran;
 * `repaired` marks rows whose failure a repair addressed. Model verdicts are
 * not re-verified by a second model call (the budget allows one Self-check),
 * except glossary verdicts, which the rule-based matcher re-checks.
 */
export function assembleSectionNotes(input: {
  section: SectionNumber;
  before: DeterministicSelfCheck;
  after: DeterministicSelfCheck | null;
  verdicts: ModelVerdict[];
  modelCheck: { ok: true } | { ok: false; reason: string; detail?: string };
  /** `recorded`: a storylineQuestion entry is inserted on the Brief. */
  storylineQuestion: { question: string; recorded: boolean } | null;
  /**
   * Summary only: why the model's Storyline question was withheld (field
   * names and byte counts, never model text). Absent everywhere else.
   */
  storylineQuestionWithheld?: string;
  /**
   * `notUsedReason`: the repair came back but was not used (2026-09-28,
   * second: it went further over a Locked limit than the checked draft).
   */
  repair: {
    attempted: boolean;
    succeeded: boolean;
    failureReason?: string;
    notUsedReason?: string;
    /** The accepted repair was then shortened by compression (review P2-1). */
    shortened?: boolean;
  };
  finalText: string;
  /**
   * The compression passes sent on the text that was kept (the checked
   * draft, or the repair when it was used), and the failure that stopped
   * them, if any (review P2-2, P3-6).
   */
  /**
   * `heldBack` (2026-10-04, first, review re-check P2-a): shortening passes
   * not kept because they dropped a signed-off item, which would have left
   * the Line over the writer's cap anyway.
   */
  compression?: { passes: number; failure?: string; heldBack?: number };
  /**
   * 2026-10-04 (first, owner decision: signed-off items outrank the
   * writer's cap): the Line was kept over the writer's cap to keep a
   * signed-off item: a shortening pass that met the cap but dropped one was
   * not kept ("pass"), or a repair that met the cap but dropped one was not
   * used ("repair").
   */
  heldForPlan?: "pass" | "repair";
  /**
   * PR #22 lead decision: the Glossary Terms the writer's Feedback governs
   * in this Line. Each gets one row in fixed words that quote the Feedback,
   * decided by its label's verdict, or not checked when there is none.
   */
  governed?: readonly FeedbackGovernedTerm[];
  /**
   * Greptile round 4, P2: the governed terms' label verdicts from the check
   * of the final text, present only when a used repair changed the checked
   * text. They decide the rows then, never the repair's own success.
   */
  governedFinal?: { ok: true; verdicts: readonly ModelVerdict[] } | { ok: false };
  /**
   * 2026-10-04 (first): the Writer Profile text the Self-check read (the
   * saved profile, or the settings document applied as the profile). A
   * model row for it can never read as followed while a cap of the profile
   * that code measures is not met.
   */
  writerInstructions?: string;
}): { rows: ComplianceNoteDraft[]; summary: SelfCheckSummary } {
  const { section, before, verdicts, repair } = input;
  const failedBefore = new Set(
    before.entries
      .filter((entry) => entry.repairable && entry.row.outcome === "not_applied")
      .map((entry) => entry.key)
  );
  const finalEntries = (input.after ?? before).entries;
  const repairFailure = repair.failureReason ? `: ${repair.failureReason}` : "";
  const repairNotDone = repair.notUsedReason
    ? `repair not used (${repair.notUsedReason})`
    : `repair call failed${repairFailure}`;

  const rows: ComplianceNoteDraft[] = finalEntries.map((entry) => {
    if (!repair.attempted || !failedBefore.has(entry.key)) return entry.row;
    if (!repair.succeeded) {
      return { ...entry.row, reason: `${entry.row.reason}; ${repairNotDone}` };
    }
    return {
      ...entry.row,
      repaired: true,
      reason:
        entry.row.outcome === "applied"
          ? `${entry.row.reason}; repaired`
          : `${entry.row.reason}; repair failed`,
    };
  });
  // 2026-09-28 (second): a Section still over a Locked limit is kept whole,
  // never cut to fit; its row says so and what the writer must do.
  const lockedIndex = finalEntries.findIndex(
    (entry) => entry.key === "locked" && entry.row.outcome === "not_applied"
  );
  if (lockedIndex >= 0) {
    const metrics = sectionMetrics(input.finalText, sectionKeyOf(section));
    const passes = input.compression?.passes ?? 0;
    const failure = input.compression?.failure
      ? ` (a shortening pass failed: ${input.compression.failure})`
      : "";
    rows[lockedIndex] = {
      ...rows[lockedIndex],
      reason: `${rows[lockedIndex].reason}; still over after ${passes} shortening ${
        passes === 1 ? "pass" : "passes"
      }${failure}. The text was not cut to fit: shorten Line ${section} to ${metrics.wordCap} words and ${metrics.limit} lines before filing`,
    };
  }
  // 2026-10-04 (first): a writer's whole-Line cap still not met after the
  // shortening passes aimed at it is kept whole too, never cut to fit.
  finalEntries.forEach((entry, index) => {
    const cap = entry.measuredCap;
    if (cap?.kind !== "writer" || !cap.wholeLine || entry.row.outcome !== "not_applied") return;
    const passes = input.compression?.passes ?? 0;
    const failure = input.compression?.failure
      ? ` (a shortening pass failed: ${input.compression.failure})`
      : "";
    // Owner decision (2026-10-04): signed-off items outrank the writer's
    // cap. When a shortening pass was not kept because it took words of
    // one, the row says the Line stays over the cap to keep them.
    const held = input.heldForPlan === "pass"
      ? "a shortening pass that met the cap but dropped one was not kept"
      : "the repair that met the cap but dropped one was not used";
    rows[index] = {
      ...rows[index],
      reason: input.heldForPlan
        ? `${rows[index].reason}; over the writer's cap at ${cap.over.join(" and ")} to keep every signed-off item (${held})${
            input.compression?.failure ? `; a shortening pass failed: ${input.compression.failure}` : ""
          }; cut by hand if needed`
        : `${rows[index].reason}; still over after ${passes} shortening ${
            passes === 1 ? "pass" : "passes"
          }${failure}${
            (input.compression?.heldBack ?? 0) > 0
              ? " (a pass that dropped a signed-off item was not kept, and it was over the cap too)"
              : ""
          }. The text was not cut to fit: shorten Line ${section} to ${cap.limits} to meet the writer's settings`,
    };
  });
  let remainingFailures = finalEntries.filter(
    (entry) => entry.repairable && entry.row.outcome === "not_applied"
  ).length;
  // 2026-10-04 (first): the caps code measured and found not met on the
  // final text. No model row may vouch for one of them (writerRowGuard).
  const failedCaps = finalEntries.flatMap((entry) =>
    entry.measuredCap && entry.row.outcome === "not_applied" ? [entry.measuredCap] : []
  );

  const governed = input.governed ?? [];
  // The first verdict for each governed term's label; its row is written
  // below, from the final text's verdict when there is one.
  const firstGoverned = new Map<string, ModelVerdict>();
  for (const verdict of verdicts) {
    const term = verdict.feedbackTerm === undefined
      ? undefined
      : governed.find((entry) => entry.term === verdict.feedbackTerm);
    if (term) {
      if (!firstGoverned.has(term.term)) firstGoverned.set(term.term, verdict);
      continue;
    }
    const tier: ComplianceTier =
      verdict.check === "confidence" && verdict.outcome === "not_applied"
        ? "missing_fact"
        : "none";
    const base = {
      section,
      paragraphIndex: verdict.paragraphIndex,
      source: "model" as const,
      instruction: verdict.instruction,
      tier,
    };
    // 2026-10-04 (first): an instruction row never vouches for a cap code
    // measured as not met (writerRowGuard); every other row is as before.
    const pushModelRow = (draft: ComplianceNoteDraft) => {
      rows.push(
        verdict.check === "instruction" && failedCaps.length > 0
          ? writerRowGuard({
              verdict,
              row: draft,
              failedCaps,
              writerInstructions: input.writerInstructions,
            }) ?? draft
          : draft
      );
    };
    if (verdict.outcome === "applied") {
      pushModelRow(noteDraft({ ...base, outcome: "applied", reason: verdict.reason || "applied" }));
      continue;
    }
    if (verdict.notChecked) {
      // No verdict means no failure to repair: recorded as it is.
      rows.push(noteDraft({ ...base, tier: "none", outcome: "not_applied", reason: verdict.reason }));
      continue;
    }
    let outcome: "applied" | "not_applied" = "not_applied";
    let reason = verdict.reason || "not applied";
    let repaired = false;
    if (repair.attempted && repair.succeeded) {
      repaired = true;
      if (verdict.check === "glossary") {
        const term = glossaryTermOf(verdict, before.glossaryCandidates);
        if (glossaryTermPresent(term, input.finalText)) {
          outcome = "applied";
          reason = `${reason}; repaired to the Glossary Term`;
        } else {
          reason = `${reason}; repair failed`;
          remainingFailures += 1;
        }
      } else if (repair.shortened) {
        // Review P2-1: compression changed the repair after the fix.
        repaired = false;
        reason = `${reason}; repaired, then shortened to fit the Line limit, so not re-verified`;
      } else {
        reason = `${reason}; repaired (deterministic re-check only; not re-verified by the model)`;
      }
    } else if (repair.attempted) {
      reason = `${reason}; ${repairNotDone}`;
    }
    pushModelRow(noteDraft({ ...base, outcome, reason, repaired }));
  }

  // One row per governed term, in fixed words that quote the Feedback,
  // never the model's text (PR #22 lead decision). The final text decides
  // (Greptile round 4, P2): when a used repair changed the checked text, the
  // check of the final text judged its label again, and that verdict, or its
  // absence, decides the row; otherwise the first verdict describes the
  // final text. The repair's own success never marks the term followed.
  for (const term of governed) {
    const first = firstGoverned.get(term.term);
    const firstFailed = first !== undefined && first.outcome === "not_applied" && !first.notChecked;
    const firstFollowed = first !== undefined && first.outcome === "applied";
    let state: GovernedTermState;
    let detail: string | undefined;
    const final = input.governedFinal;
    if (final) {
      const verdict = final.ok
        ? final.verdicts.find((candidate) => candidate.feedbackTerm === term.term)
        : undefined;
      if (!final.ok) state = "final_check_failed";
      else if (!verdict || verdict.notChecked) state = "final_not_checked";
      else if (verdict.outcome === "applied") state = firstFailed ? "repaired" : "followed_final";
      else state = firstFailed ? "still_not_followed" : firstFollowed ? "broken_by_repair" : "final_not_followed";
    } else if (!first) {
      state = input.modelCheck.ok ? "not_checked" : "check_failed";
    } else if (first.notChecked) {
      state = "not_checked";
    } else if (first.outcome === "applied") {
      state = "followed";
    } else {
      state = "not_followed";
      // The checked text is the final text: the repair was not used, failed
      // or left the text as it was.
      detail = !repair.attempted
        ? undefined
        : !repair.succeeded
          ? repairNotDone
          : "the repair left the text unchanged";
    }
    const verdict = input.governedFinal?.ok
      ? input.governedFinal.verdicts.find((candidate) => candidate.feedbackTerm === term.term)
      : input.governedFinal ? undefined : first;
    if (governedTermNotFollowed(state) && repair.attempted) remainingFailures += 1;
    rows.push(noteDraft({
      section,
      ...(verdict && !verdict.notChecked && verdict.paragraphIndex !== undefined
        ? { paragraphIndex: verdict.paragraphIndex }
        : {}),
      source: "model",
      instruction: `Glossary Term: ${term.term}`,
      outcome: governedTermFollowed(state) ? "applied" : "not_applied",
      tier: "conflict",
      reason: governedTermReason(term.feedback, state, detail, term.inSignedOffIdea === true),
      repaired: state === "repaired",
    }));
  }

  if (input.storylineQuestion) {
    rows.push(
      noteDraft({
        section,
        paragraphIndex: 0,
        source: "model",
        instruction: "Storyline",
        outcome: "not_applied",
        tier: "none",
        reason: input.storylineQuestion.recorded
          ? `Storyline question raised in the Brief: ${input.storylineQuestion.question} (the section's evidence is stronger than the Storyline's basis; not repaired)`
          : `Storyline question not recorded in the Brief (no Confidence Map entry cited as evidence): ${input.storylineQuestion.question} (not repaired)`,
      })
    );
  }
  if (input.storylineQuestionWithheld) {
    rows.push(
      noteDraft({
        section,
        paragraphIndex: 0,
        source: "model",
        instruction: "Storyline",
        outcome: "not_applied",
        tier: "none",
        // Plain words only: the byte detail stays in the summary and the log.
        reason: STORYLINE_QUESTION_WITHHELD_REASON,
      })
    );
  }
  if (!input.modelCheck.ok) {
    rows.push(
      noteDraft({
        section,
        source: "deterministic",
        instruction: "Model Self-check",
        outcome: "not_applied",
        tier: "none",
        reason: `Self-check call failed (${input.modelCheck.reason}${
          input.modelCheck.detail ? `: ${input.modelCheck.detail}` : ""
        }); deterministic checks only`,
      })
    );
  }

  const failedChecks =
    failedBefore.size +
    verdicts.filter((verdict) => verdict.outcome === "not_applied").length;
  const status: SelfCheckSummary["status"] = !repair.attempted
    ? "pass"
    : !repair.succeeded || remainingFailures > 0
      ? "repair_failed"
      : "repair_attempted";
  return {
    rows,
    summary: {
      status,
      repairAttempted: repair.attempted,
      failedChecks,
      remainingFailures,
      modelCheck: input.modelCheck.ok ? "ok" : "failed",
      ...(!input.modelCheck.ok && input.modelCheck.detail
        ? { modelCheckDetail: input.modelCheck.detail }
        : {}),
      ...(input.storylineQuestionWithheld
        ? { storylineQuestionWithheld: input.storylineQuestionWithheld }
        : {}),
    },
  };
}

const CONSISTENCY_KIND_LABELS: Record<ConsistencyFinding["kind"], string> = {
  contradiction: "section contradiction detected",
  excluded_claim: "excluded claim presented as claimed work",
  terminology: "one concept named two ways",
};

/** Consistency-pass findings as model rows naming sections and paragraphs. */
export function consistencyNoteDrafts(
  findings: ConsistencyFinding[]
): ComplianceNoteDraft[] {
  return findings.map((finding) =>
    noteDraft({
      section: finding.section,
      paragraphIndex: finding.paragraphIndex,
      source: "model",
      instruction: `Consistency pass (${finding.kind})`,
      outcome: "not_applied",
      tier: "none",
      reason: `${CONSISTENCY_KIND_LABELS[finding.kind]} at Line ${finding.section} paragraph ${finding.paragraphIndex + 1} (sections ${finding.sections.join(", ")}): ${finding.issue}`,
    })
  );
}

/** The pass-level row recorded on the last section in production order.
 * `reportChanged`: the report kept changing while the pass ran, so its
 * findings described text that was gone and none were stored. */
export function consistencySummaryNote(
  section: SectionNumber,
  outcome:
    | { ok: true; findings: number; unreadable?: number }
    | { ok: false; reason: string }
    | { ok: false; reportChanged: true }
): ComplianceNoteDraft {
  // 2026-09-29 (second): findings left out as unreadable are counted, so a
  // pass that could read only part of its answer says so.
  const unreadable = outcome.ok && (outcome.unreadable ?? 0) > 0
    ? `; ${outcome.unreadable} more ${outcome.unreadable === 1 ? "finding" : "findings"} could not be read and ${outcome.unreadable === 1 ? "was" : "were"} left out`
    : "";
  return noteDraft({
    section,
    source: "deterministic",
    instruction: "Consistency pass",
    outcome: outcome.ok ? "applied" : "not_applied",
    tier: "none",
    reason: outcome.ok
      ? `consistency pass ran over the assembled draft: ${outcome.findings} finding(s)${unreadable}`
      : "reportChanged" in outcome
        ? "consistency pass skipped: the report changed while it ran, so no findings were stored"
        : `consistency pass call failed (${outcome.reason})`,
  });
}
