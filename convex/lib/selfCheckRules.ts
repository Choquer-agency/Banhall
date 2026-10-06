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
import {
  bannedRuleHits,
  hitsPhrase,
  holdsPhrase,
  openingAt,
  termRuleHits,
  wordingPattern,
  bannedRowInstruction,
  openingRowInstruction,
  openingStatement,
  termRowInstruction,
  type RequiredTermRule,
  type WriterWordingRules,
} from "./writerWording";

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
  /**
   * Summary only, in memory only (2026-10-04 first, Round 5 follow-up): the
   * reason as the model sent it, when clipping shortened `reason`. Only the
   * row for the writer's settings stores it (writerRowReverseGuard).
   */
  unclippedReason?: string;
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
  /**
   * 2026-10-04 (first), Round 5: a wording rule of the writer's that code
   * measured (a term, a banned word, an opening), so the model's row for
   * the settings can never contradict it. In memory only.
   */
  measuredWording?: true;
  /** Round 5 (review P3-4): the writer's line the measured rule was read from. */
  wordingSource?: string;
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

/**
 * Round 2 (2026-10-05): how a Self-check row starts when its label could not
 * be judged on the text that ships after a used repair.
 */
export const NOT_CHECKED_ON_FINAL_TEXT = "Not checked on the final text";

/**
 * Round 2 (2026-10-05, review P3-4, and the follow-up's review P2): how a
 * row a used repair was sent for ends when the repair left the checked text
 * byte for byte, so the first verdict describes the final text.
 */
export const REPAIR_LEFT_CHECKED_TEXT = "; the repair left the checked text as it was";

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
  /**
   * 2026-10-04 (first), Round 5: the writer's wording rules code measures
   * (extractWriterWordingRules), when the Writer Profile applied. Absent or
   * empty: no such rows, so a writer with no such rule keeps every row and
   * request as before.
   */
  writerWording?: WriterWordingRules;
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

  // 2026-10-04 (first), Round 5 (owner approved 2026-10-05, "Build code
  // checks"): the writer's terms, banned words and required openings are
  // measured here, on this text, as the caps are. Each rule gets its own
  // row naming the paragraph and the words, a break goes to the repair as an
  // exact issue, and the Writer Profile row's caveat below covers it.
  if (profile.profileState === "applied" && input.writerWording) {
    const wording = input.writerWording;
    const measuredEntry = (source: string, failure?: string) => {
      const entry = entries[entries.length - 1]!;
      entry.measuredWording = true;
      entry.wordingSource = source;
      if (failure) entry.profileRuleFailure = failure;
    };
    const requiredTerms = wording.terms.map((rule) => rule.term);
    wording.terms.forEach((rule, index) => {
      const hits = termRuleHits(text, rule, requiredTerms.filter((term) => term !== rule.term));
      const used = holdsPhrase(text, rule.term);
      const instruction = termRowInstruction(rule);
      if (hits.length === 0) {
        add(`wording:term:${index}`, {
          instruction,
          outcome: "applied",
          tier: "none",
          reason: used ? `"${rule.term}" used; no banned synonym` : `no banned synonym of "${rule.term}"`,
        });
        measuredEntry(rule.source);
        return;
      }
      const found = hitsPhrase(hits);
      add(
        `wording:term:${index}`,
        {
          instruction,
          paragraphIndex: hits[0]!.paragraphIndex,
          outcome: "not_applied",
          tier: "none",
          reason: `${found}; the writer's settings say "${rule.term}"${used ? "" : ", which this Line never uses"}`,
        },
        true,
        hits
          .map((hit) => `Paragraph ${hit.paragraphIndex + 1}: replace "${hit.words}" with wording that uses "${rule.term}"${
            rule.allowedWithTerm ? ` (the writer's settings never allow "${hit.banned}" on its own)` : ` (the writer's settings never allow "${hit.banned}")`
          }.`)
          .join(" ")
      );
      measuredEntry(rule.source, `${found} (the writer's term is "${rule.term}")`);
    });
    wording.banned.forEach((rule, index) => {
      const hits = bannedRuleHits(text, rule, requiredTerms);
      const instruction = bannedRowInstruction(rule);
      if (hits.length === 0) {
        add(`wording:banned:${index}`, { instruction, outcome: "applied", tier: "none", reason: `"${rule.phrase}" not used` });
        measuredEntry(rule.source);
        return;
      }
      const found = hitsPhrase(hits);
      add(
        `wording:banned:${index}`,
        {
          instruction,
          paragraphIndex: hits[0]!.paragraphIndex,
          outcome: "not_applied",
          tier: "none",
          reason: `${found}; the writer's settings ban "${rule.phrase}"`,
        },
        true,
        hits
          .map((hit) => `Paragraph ${hit.paragraphIndex + 1}: replace "${hit.words}" with other wording; the writer's settings ban "${rule.phrase}".`)
          .join(" ")
      );
      measuredEntry(rule.source, `${found} (the writer's settings ban "${rule.phrase}")`);
    });
    const openers = profile.categoryOutcomes.find((outcome) => outcome.category === "openingClauses");
    wording.openings.forEach((rule, index) => {
      if (rule.section !== section) return;
      const statement = openingStatement(rule);
      const instruction = openingRowInstruction(rule);
      // The House Rule openers outrank the writer's opening unless waived.
      if (openers && !openers.effective) {
        add(`wording:opening:${index}`, {
          instruction,
          outcome: "not_applied",
          tier: openers.tier,
          reason: `Not measured: the House Rule openers apply in this Line (${categoryReason(openers, profile.waiverAnalysisFailed === true)})`,
        });
        return;
      }
      const at = openingAt(text, rule.opening);
      if (at) {
        add(`wording:opening:${index}`, {
          instruction,
          paragraphIndex: at.paragraphIndex,
          outcome: "applied",
          tier: "none",
          reason: `P${at.paragraphIndex + 1} ${at.opensParagraph ? "opens" : "has a sentence that opens"} with "${rule.opening}" (whether that sentence is ${statement} is the Self-check's to judge)`,
        });
        measuredEntry(rule.source);
        return;
      }
      add(
        `wording:opening:${index}`,
        {
          instruction,
          outcome: "not_applied",
          tier: "none",
          reason: `No sentence of Line ${section} opens with "${rule.opening}", which the writer's settings require for ${statement}`,
        },
        true,
        rule.statement
          ? `Open the statement of the ${rule.statement === "objective" ? "objective" : "uncertainties"} with "${rule.opening}".`
          : `Open the statement the writer's settings name with "${rule.opening}".`
      );
      measuredEntry(rule.source, `no sentence of Line ${section} opens with "${rule.opening}"`);
    });
  }

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
 * a length cap or limit; being within, under, over, above or below the cap
 * (or the writer's cap), or within, under or over a word, line or length
 * limit; "N words"; "N form lines" or "N lines long"; and a
 * count with its unit, such as "602/520 words". Narrow on purpose: "the
 * detection limit", "below the limit" (a temperature), "end caps", "a 50/50
 * resin blend" and "ran on 2 lines" are not length.
 */
const LENGTH_TALK = new RegExp(
  [
    String.raw`\b(?:word|line)s?[\s-]+(?:caps?|limits?|counts?|budget)\b`,
    String.raw`\blength[\s-]+(?:caps?|limits?)\b`,
    String.raw`\b(?:within|under|over|above|below|exceeds?|meets?|met)\s+(?:the\s+writer's\s+|the\s+|its\s+|this\s+|a\s+)?(?:\d[\d,]*[\s-]*(?:words?|lines?)[\s-]+|(?:words?|lines?|length)[\s-]+)?caps?\b`,
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
 * line or stops mid-sentence within it, counts too.
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
  if (quoted.trim().split(" ").length < 6 || !text.startsWith(quoted.trimEnd())) return false;
  // An opening past the first line, or one cut off mid-sentence within it
  // (review re-check P3-6): a quote of the whole first line is that line.
  if (quoted.trim().length > first.trim().length) return true;
  const raw = instruction.trim();
  const cutOff = /(?:\.\.\.|\u2026)$/.test(raw) || !/[.!?]["')\]]*$/.test(raw);
  return cutOff && quoted.trim().length < first.trim().length;
}

/** The [C#] entry a Confidence Map verdict names, or null. */
function confidenceEntryOf(instruction: string): string | null {
  return /\bC(\d+)\b/.exec(instruction)?.[1] ?? null;
}

/**
 * Two normalized wordings name the same label when equal, or when the
 * shorter is a quote of the longer that the model cut short: it runs to six
 * words or more, the longer starts with it, and it shows the cut, with an
 * ellipsis at its end or by stopping inside a word. Greptile on PR #27: a
 * shorter text that ends at a word boundary with no ellipsis can be a rule
 * of its own ("Write in the third person throughout" beside "Write in the
 * third person throughout, naming the company"), so it is never taken for
 * the longer one; at worst the two read as two rows, never as a repair.
 */
function sameWording(a: string, b: string): boolean {
  // Lowercase words only: the cut is read from the text as the model wrote it.
  const left = normalizeForMatch(a).trim();
  const right = normalizeForMatch(b).trim();
  if (left === "" || right === "") return false;
  if (left === right) return true;
  const [shorter, longer, written] = left.length <= right.length ? [left, right, a.trim()] : [right, left, b.trim()];
  if (shorter.split(" ").length < 6 || !longer.startsWith(shorter)) return false;
  const ellipsis = /(?:\.\.\.|\u2026)$/.test(written);
  const insideWord = /[\p{L}\p{N}]$/u.test(written) && /^[\p{L}\p{N}]/u.test(longer.slice(shorter.length));
  return ellipsis || insideWord;
}

/**
 * Round 2 review re-check, P2: whether two Self-check verdicts judge the same
 * label. In Summary mode the instruction is the label the app supplied, so
 * equal words match. In Single draft and Compare the model words each
 * label itself, differently from call to call, so the Storyline matches by
 * its check alone, a Glossary verdict by the term it names, a Confidence
 * Map verdict by its [C#] entry (or its wording), and an instruction by its
 * wording, one a cut-short quote of the other (sameWording), or both quoting
 * the Writer Profile.
 */
export function sameSelfCheckLabel(
  a: Pick<ModelVerdict, "check" | "instruction">,
  b: Pick<ModelVerdict, "check" | "instruction">,
  context: { glossaryCandidates: readonly string[]; writerInstructions?: string }
): boolean {
  if (a.check !== b.check) return false;
  if (a.instruction === b.instruction) return true;
  switch (a.check) {
    case "storyline":
      return true;
    case "glossary": {
      const term = (verdict: Pick<ModelVerdict, "instruction">) =>
        normalizeForMatch(glossaryTermOf(verdict as ModelVerdict, [...context.glossaryCandidates])).trim();
      return term(a) === term(b);
    }
    case "confidence": {
      const left = confidenceEntryOf(a.instruction);
      const right = confidenceEntryOf(b.instruction);
      return left !== null && right !== null ? left === right : sameWording(a.instruction, b.instruction);
    }
    case "instruction":
      return (
        sameWording(a.instruction, b.instruction) ||
        (quotesWriterProfile(a.instruction, context.writerInstructions) &&
          quotesWriterProfile(b.instruction, context.writerInstructions))
      );
  }
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
  /**
   * 2026-10-04 (first), Round 5: the writer's wording rules code measured
   * as broken, each as a phrase ("P3 says \"pinhole\" (the writer's term
   * is \"outgassing defects\")"). The Writer Profile's own row names them.
   */
  failedWording?: ReadonlyArray<{ phrase: string; source: string }>;
  writerInstructions?: string;
}): ComplianceNoteDraft | null {
  const { verdict, row, failedCaps } = input;
  const isProfile = quotesWriterProfile(verdict.instruction, input.writerInstructions);
  // Review P3-4: the Writer Profile's own row carries every measured break;
  // another instruction row carries a break of a rule it quotes, as a cap.
  const quoted = normalizeForMatch(verdict.instruction).trim();
  const wording = (input.failedWording ?? [])
    .filter((failure) => {
      if (isProfile) return true;
      const source = normalizeForMatch(failure.source).trim();
      return source !== "" && (quoted.includes(source) || (quoted.split(" ").length >= 6 && source.includes(quoted)));
    })
    .map((failure) => failure.phrase);
  if (failedCaps.length === 0 && wording.length === 0) return null;
  const instruction = normalizeForMatch(verdict.instruction);
  const carried = failedCaps.filter((cap) => {
    if (cap.kind !== "writer") return false;
    if (isProfile) return true;
    const rule = normalizeForMatch(cap.instruction ?? "");
    return rule.trim() !== "" && instruction.includes(rule);
  });
  const talks = failedCaps.length > 0 && talksAboutLength(verdict.reason);
  if (carried.length === 0 && wording.length === 0 && !talks) return null;
  // The model's words, without its clauses about length, then the notes
  // this app added after them (a repair's outcome), as written.
  const appNotes = row.reason.startsWith(verdict.reason) ? row.reason.slice(verdict.reason.length) : "";
  // Its clauses about length give way only to a cap code measured as not met.
  const modelWords = failedCaps.length > 0 ? withoutLengthClauses(verdict.reason) : verdict.reason.trim();
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
  if (carried.length > 0 || wording.length > 0) {
    const measured = wording.length === 0
      ? `${joinedList(carried.map(measuredCapPhrase))} (measured by code; see the cap row)`
      : `${joinedList([...carried.map(measuredCapPhrase), ...wording])} (measured by code; see ${carried.length + wording.length === 1 ? "that row" : "those rows"})`;
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

/** The kinds of the writer's rules code can measure, as a remark names them. */
const MEASURED_KINDS = {
  opening: /\b(?:open(?:er|ers|ing|ings|s)?|begin(?:s|ning)?|starts?)\b/i,
  term: /\b(?:synonyms?|terms?|terminology|glossary|vocabulary)\b/i,
  banned: /\b(?:banned|bans?)\b/i,
  cap: /\b(?:caps?|word\s+counts?|length|too\s+long|\d+\s*\/\s*\d+\s+words)\b/i,
} as const;
/** What code does not measure, so a remark about it stays the model's. */
const UNMEASURED_KIND =
  /\b(?:confidence|hedg\w*|storyline|style|tone|voice|tense|person|we|our|ours|us|ourselves|exclu\w*|claim\w*|statements?|stated|states|objectives?|uncertaint\w*|mid-paragraph|order|sequence|structure|headings?|plain|jargon|figures?|numbers?|results?|targets?|sources?|facts?|passive|active|repetition|density|topics?|mention\w*|describ\w*|paragraphs?|sentences?|company|naming|name|names)\b/i;
/**
 * Re-check P1-1 (a): the words or phrases a remark names: quoted, or after
 * says, uses, writes, word, term or synonym (articles and generic words such
 * as "banned" and "word" set aside, up to four words, to the next stop).
 */
const NAMED_AFTER =
  /\b(?:says?|uses?|writes?|word|term|synonym)\s+((?:[A-Za-z][\w-]*\s*){1,7})/gi;
const NAMED_STOP = /^(?:instead|not|but|where|which|in|on|for|from|than|of|and|or|is|are|was|were|to|that|rather|with|as|by|at)$/i;
const NAMED_GENERIC = /^(?:the|a|an|banned|ban|word|words|term|terms|synonym|synonyms|phrase|phrases|wording|writer's|writers|settings?)$/i;
function namedPhrases(remark: string): string[] {
  const quoted = [...remark.matchAll(/["\u201c\u2018']([^"\u201d\u2019']{2,60})["\u201d\u2019']/g)].map((match) => match[1]!.trim());
  const after = [...remark.replace(/["\u201c][^"\u201d]*["\u201d]/g, " ").matchAll(NAMED_AFTER)].flatMap((match) => {
    const words: string[] = [];
    for (const word of match[1]!.trim().split(/\s+/)) {
      if (NAMED_STOP.test(word)) break;
      if (words.length === 0 && NAMED_GENERIC.test(word)) continue;
      words.push(word);
      if (words.length === 4) break;
    }
    return words.length > 0 ? [words.join(" ")] : [];
  });
  return [...quoted, ...after];
}
const wordCountOf = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Final re-check P2-A1: the words a settled remark may hold besides the
 * measured rules' own phrases and paragraph references: function words, the
 * kinds code measures, and plain judgement words. Any other word keeps the
 * model's verdict ("P2 contains optimizing, a banned form." names a form
 * the matcher does not know).
 */
const SETTLE_ALLOWED_WORDS = new Set(
  (
    "a an the of in on at to from for with by as and or but not no nor is are was were be been being it its this that these those there here " +
    "all any each every some one only also than then so yet does do did has have had see per its " +
    "differs differ different difference missing missed lacks lack lacking wrong wrongly incorrect incorrectly correct correctly right " +
    "properly used use uses using contains contain found present absent appears appear followed follow follows broken breaks break " +
    "kept met ok okay fine fails fail failed violates violate violated violation instead required requires require exact exactly verbatim " +
    "settings setting document writer writer's writers profile rule rules line lines says say writes write word words term terms phrase " +
    "phrases wording form forms banned ban bans synonym synonyms opener openers opening openings open opens begin begins start starts " +
    "cap caps length long glossary terminology vocabulary count counts fix fixes fixed change replace rewrite make ensure should must"
  ).split(" ")
);

/** Whether a remark holds a word outside the measured phrases, references and SETTLE_ALLOWED_WORDS. */
function namesUnmeasured(remark: string, measuredPhrases: readonly string[]): boolean {
  let rest = remark;
  for (const phrase of measuredPhrases) rest = rest.replace(wordingPattern(phrase), " ");
  rest = rest
    .replace(/\bP\d+(?:\s*[-\u2013]\s*P?\d+)?\b/gi, " ")
    .replace(/\blines?\s+(?:242|244|246)\b/gi, " ")
    .replace(/\b\d+\s*\/\s*\d+\s+words\b/gi, " ");
  const words = rest.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) ?? [];
  return words.some((word) => !SETTLE_ALLOWED_WORDS.has(word.toLowerCase().replace(/\u2019/g, "'")));
}

/** The longest remark of the model's the settings row stores. */
const MAX_SETTINGS_REMARK_CHARS = 600;

/**
 * 2026-10-04 (first), Round 5 follow-up (release suite run 6 of
 * 2026-10-05): the model's verdicts on the writer's settings, settled
 * against what code measured on the same text. Run 6's rows for the whole
 * settings document read not applied with clipped, wrong reasons ("P1
 * opener differs" though P1 opens with the exact words; "P2-4 use
 * banned..." though code found no banned word) beside true measured rows.
 *
 * A not applied verdict on the Writer Profile (its instruction quotes the
 * profile) whose reason talks only about what code measures (openings,
 * terms, banned words, caps) is read as applied when every rule code
 * measures on this Line was kept: its row says so, with the model's remark
 * kept as a note, and it asks for no repair. A remark about anything code
 * does not measure (a hedge, the Storyline, style, the first person, which
 * sentence is the named statement) keeps the verdict as the model gave it.
 * The Writer Profile verdict keeps its reason whole (the unclipped reason,
 * up to 600 characters), so a consultant can read it.
 */
export function settleWriterSettingsVerdicts(
  verdicts: readonly ModelVerdict[],
  check: DeterministicSelfCheck,
  writerInstructions: string | undefined,
  /**
   * Re-check P1-1: the measured rules, and what of the settings the
   * extractor left to the model (a word ban or an opening it did not read).
   */
  context: { rules?: WriterWordingRules; unread?: { wordBans: boolean; openings: boolean; pronouns?: readonly string[] } } = {}
): ModelVerdict[] {
  const rules = context.rules;
  const measuredPhrases = rules
    ? [
        ...rules.terms.flatMap((rule) => [rule.term, ...rule.banned]),
        ...rules.banned.flatMap((rule) => [rule.phrase, ...rule.forms]),
        ...rules.openings.map((rule) => rule.opening),
      ]
    : [];
  // Coordinator decision: a first-person-only ban counts as accounted for
  // only while the Line holds none of its pronouns (we, our, ours, us,
  // ourselves always; I, me, my, mine when the ban lists them).
  const banned = context.unread?.pronouns ?? [];
  const pronouns = banned.length > 0
    ? [...new Set(["we", "our", "ours", "us", "ourselves", ...banned.filter((pronoun) => /^(?:i|me|my|mine)$/i.test(pronoun))])]
    : [];
  const lineText = check.paragraphs.join("\n\n");
  const firstPersonUsed = pronouns.some((pronoun) => new RegExp(`(?<![\\p{L}\\p{N}'])${pronoun}(?![\\p{L}\\p{N}'])`, "iu").test(lineText));
  const isMeasuredPhrase = (phrase: string) =>
    measuredPhrases.some((own) => holdsPhrase(phrase, own) && wordCountOf(phrase) <= wordCountOf(own) + 1);
  const measured = check.entries.filter(
    (entry) => entry.measuredWording || (entry.measuredCap?.kind === "writer")
  );
  const allHeld = measured.length > 0 && measured.every((entry) => entry.row.outcome === "applied");
  // The kinds measured on this Line: a remark about another kind stays the model's.
  const present: Record<keyof typeof MEASURED_KINDS, boolean> = {
    opening: measured.some((entry) => entry.key.startsWith("wording:opening:")),
    term: measured.some((entry) => entry.key.startsWith("wording:term:")),
    banned: measured.some((entry) => entry.key.startsWith("wording:banned:")),
    cap: measured.some((entry) => entry.measuredCap?.kind === "writer"),
  };
  return verdicts.map((verdict) => {
    if (verdict.check !== "instruction" || !quotesWriterProfile(verdict.instruction, writerInstructions)) return verdict;
    const full = (verdict.unclippedReason ?? verdict.reason).slice(0, MAX_SETTINGS_REMARK_CHARS);
    const whole: ModelVerdict = full === verdict.reason ? verdict : { ...verdict, reason: full };
    if (verdict.outcome !== "not_applied" || verdict.notChecked || !allHeld) return whole;
    const said = [full, verdict.repairGuidance ?? ""].join(" ");
    const unquoted = said.replace(/["\u201c][^"\u201d]*["\u201d]/g, " ");
    const kinds = (Object.keys(MEASURED_KINDS) as Array<keyof typeof MEASURED_KINDS>).filter((kind) => MEASURED_KINDS[kind].test(unquoted));
    if (kinds.length === 0 || kinds.some((kind) => !present[kind]) || UNMEASURED_KIND.test(unquoted)) return whole;
    // (a) every word or phrase it names is a measured rule's own, and it
    // holds no other word than those, references and plain judgement words.
    if (!namedPhrases(said).every(isMeasuredPhrase) || namesUnmeasured(said, measuredPhrases)) return whole;
    // (b) no rule of the kinds it names was left to the model.
    if ((kinds.includes("banned") || kinds.includes("term")) && (context.unread?.wordBans || firstPersonUsed)) return whole;
    if (kinds.includes("opening") && context.unread?.openings) return whole;
    const { repairGuidance: _guidance, repairText: _text, unclippedReason: _unclipped, ...rest } = verdict;
    return {
      ...rest,
      outcome: "applied",
      reason: `Every rule code measures on this Line was kept (see those rows); the Self-check's own remark, which they settle: ${full}`,
    };
  });
}

/**
 * 2026-10-04 (first), Round 5 follow-up (lead decision, owner informed;
 * release suite run 6 of 2026-10-05): the writer's glossary outranks the
 * Brief's Glossary Terms. Run 6 repaired Line 246 P1 for the Glossary Term
 * "film build" by rewriting the writer's own term "edge coverage", and the
 * consistency pass then flagged the split. A Glossary verdict not applied
 * whose Brief Glossary Term is a word the writer's settings ban is read as
 * governed by the writer's settings: applied, with no repair, and its row
 * says so. A repair that would remove a term the writer's settings require
 * is stopped at the repair (draftCheckedSection), never here (re-check
 * P2-1: a remark that names a writer's term as context is no conflict).
 */
export function settleGlossaryForWriterTerms(
  verdicts: readonly ModelVerdict[],
  rules: WriterWordingRules | undefined,
  glossaryCandidates: readonly string[]
): ModelVerdict[] {
  if (!rules || rules.terms.length === 0) return [...verdicts];
  return verdicts.map((verdict) => {
    if (verdict.check !== "glossary" || verdict.outcome !== "not_applied" || verdict.notChecked) return verdict;
    const briefTerm = glossaryTermOf(verdict, [...glossaryCandidates]);
    // Re-check P2-1: only a Brief term the writer bans; a fix that would
    // remove a writer's term is stopped at the repair instead.
    let matched: { rule: RequiredTermRule; banned: string } | undefined;
    for (const rule of rules.terms) {
      const banned = rule.banned.find((item) => holdsPhrase(briefTerm, item));
      if (banned) {
        matched = { rule, banned };
        break;
      }
    }
    if (!matched) return verdict;
    const { repairGuidance: _guidance, repairText: _text, unclippedReason: _unclipped, ...rest } = verdict;
    const remark = (verdict.unclippedReason ?? verdict.reason).slice(0, MAX_SETTINGS_REMARK_CHARS);
    return {
      ...rest,
      outcome: "applied",
      reason: `The writer's settings govern this wording: "${matched.rule.term}" is the writer's term, and they never allow "${matched.banned}" (see its row), so the Brief's Glossary Term is not used; the Self-check's remark, set aside: ${remark}`,
    };
  });
}

/**
 * 2026-10-04 (first, review re-check P3-7): what else happened to the
 * shortening passes for a writer's cap, as one plain sentence ("" when
 * nothing did): a pass that failed, and the passes not kept for a
 * signed-off item that would not have met the cap either.
 */
function writerShorteningNote(failure: string | undefined, heldBack: number, heldForFigures = 0): string {
  const clauses = [
    ...(failure ? [`a shortening pass failed (${failure})`] : []),
    ...(heldBack > 0
      ? [
          `${heldBack === 1 ? "one pass was" : `${heldBack} passes were`} not kept because ${
            heldBack === 1 ? "it" : "they"
          } dropped a signed-off item, though ${heldBack === 1 ? "it" : "they"} would not have met the cap either`,
        ]
      : []),
    // Round 4 (review P2-1): figures and hedges outrank the writer's cap.
    ...(heldForFigures > 0
      ? [
          `${heldForFigures === 1 ? "one pass was" : `${heldForFigures} passes were`} not kept because ${
            heldForFigures === 1 ? "it" : "they"
          } dropped a figure or a negation the text holds, which outrank the writer's cap`,
        ]
      : []),
  ];
  if (clauses.length === 0) return "";
  const sentence = clauses.join(", and ");
  return ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
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
 * judged again on the final text after a used repair (Round 2, 2026-10-05,
 * and its follow-up): the check of the final text (`finalVerdicts`) writes
 * the label rows; glossary verdicts the rule-based matcher also re-checks.
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
  compression?: { passes: number; failure?: string; heldBack?: number; heldForFigures?: number };
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
  /**
   * Round 2 (2026-10-05, owner decision; follow-up: after every used
   * repair): the Self-check's label verdicts on the final text, which write
   * those rows in place of the first check's, or why the check of the final
   * text did not complete (its rows then read "not checked on the final
   * text"). The governed terms keep `governedFinal`.
   */
  finalVerdicts?:
    | {
        ok: true;
        verdicts: readonly ModelVerdict[];
        /**
         * Review P3-4: shortening left the repair as the checked text, so
         * these are the first check's verdicts, which describe it.
         */
        sameAsChecked?: true;
      }
    | { ok: false; reason: string };
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
    // Owner decision (2026-10-04): signed-off items outrank the writer's
    // cap. When a shortening pass was not kept because it took words of
    // one, the row says the Line stays over the cap to keep them.
    const held = input.heldForPlan === "pass"
      ? "a shortening pass that met the cap but dropped one was not kept"
      : "the repair that met the cap but dropped one was not used";
    // Round 5 (rule 5): a used repair took a Line that met the writer's cap
    // over it. It is kept for what it fixed (found wrong in the text, and
    // ranked with or above the cap), its shortening passes aimed at the cap
    // with their guards, and the row says so plainly.
    const checked = input.after && repair.succeeded
      ? before.entries.find((candidate) => candidate.key === entry.key)
      : undefined;
    const pushedOver = checked?.row.outcome === "applied"
      ? `; the repair, kept for what it fixed, took Line ${section} over the writer's cap that the checked draft met (${checked.row.reason})`
      : "";
    rows[index] = {
      ...rows[index],
      reason: input.heldForPlan
        ? `${rows[index].reason}; over the writer's cap at ${cap.over.join(" and ")} to keep every signed-off item (${held})${
            input.compression?.failure ? `; a shortening pass failed: ${input.compression.failure}` : ""
          }; cut by hand if needed`
        : `${rows[index].reason}${pushedOver}; still over after ${passes} shortening ${
            passes === 1 ? "pass" : "passes"
          }.${writerShorteningNote(input.compression?.failure, input.compression?.heldBack ?? 0, input.compression?.heldForFigures ?? 0)} The text was not cut to fit: shorten Line ${section} to ${cap.limits} to meet the writer's settings`,
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
  // Round 5: the writer's wording rules code measured as broken on the
  // final text, which the model's row for the settings never contradicts.
  const failedWording = finalEntries.flatMap((entry) =>
    entry.measuredWording && entry.row.outcome === "not_applied" && entry.profileRuleFailure && entry.wordingSource
      ? [{ phrase: entry.profileRuleFailure, source: entry.wordingSource }]
      : []
  );

  const governed = input.governed ?? [];
  // The first verdict for each governed term's label; its row is written
  // below, from the final text's verdict when there is one.
  const firstGoverned = new Map<string, ModelVerdict>();
  const governedTermOf = (verdict: ModelVerdict) =>
    verdict.feedbackTerm === undefined
      ? undefined
      : governed.find((entry) => entry.term === verdict.feedbackTerm);
  const baseOf = (verdict: ModelVerdict) => ({
    section,
    paragraphIndex: verdict.paragraphIndex,
    source: "model" as const,
    instruction: verdict.instruction,
    tier: (verdict.check === "confidence" && verdict.outcome === "not_applied"
      ? "missing_fact"
      : "none") as ComplianceTier,
  });
  // 2026-10-04 (first): an instruction row never vouches for a cap code
  // measured as not met (writerRowGuard); every other row is as before.
  const pushModelRow = (verdict: ModelVerdict, draft: ComplianceNoteDraft) => {
    rows.push(
      verdict.check === "instruction" && (failedCaps.length > 0 || failedWording.length > 0)
        ? writerRowGuard({
            verdict,
            row: draft,
            failedCaps,
            failedWording,
            writerInstructions: input.writerInstructions,
          }) ?? draft
        : draft
    );
  };
  // Round 2 (2026-10-05): when shortening changed a used repair, the check
  // of the final text decides these rows.
  const final = input.finalVerdicts;
  for (const verdict of verdicts) {
    const term = governedTermOf(verdict);
    if (term) {
      if (!firstGoverned.has(term.term)) firstGoverned.set(term.term, verdict);
      continue;
    }
    const base = baseOf(verdict);
    if (final && !final.ok) {
      // The final text was not checked: no verdict on the text before
      // shortening is recorded as if it described the text that ships.
      rows.push(noteDraft({
        ...base,
        tier: "none",
        outcome: "not_applied",
        reason: `${NOT_CHECKED_ON_FINAL_TEXT} (the check of the final text did not complete: ${final.reason})`,
      }));
      continue;
    }
    if (final) continue;
    if (verdict.outcome === "applied") {
      pushModelRow(verdict, noteDraft({ ...base, outcome: "applied", reason: verdict.reason || "applied" }));
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
      } else {
        // Round 2 follow-up (2026-10-05): every used repair is checked again
        // on the final text (finalVerdicts), so this is reached only when no
        // such check ran; the row never reports the verdict on the text
        // before the repair as if it described the final text.
        repaired = false;
        reason = `${NOT_CHECKED_ON_FINAL_TEXT} (no check of the final text ran)`;
      }
    } else if (repair.attempted) {
      reason = `${reason}; ${repairNotDone}`;
    }
    pushModelRow(verdict, noteDraft({ ...base, outcome, reason, repaired }));
  }
  if (final?.ok) {
    // Review re-check P2: in Single draft and Compare `instruction` is the
    // model's own wording, so the two checks are matched by label, not by
    // their exact words (sameSelfCheckLabel).
    const candidates = [...before.glossaryCandidates, ...(input.after?.glossaryCandidates ?? [])];
    const same_ = (a: ModelVerdict, b: ModelVerdict) =>
      sameSelfCheckLabel(a, b, { glossaryCandidates: candidates, writerInstructions: input.writerInstructions });
    const failing = (verdict: ModelVerdict | undefined) =>
      verdict !== undefined && verdict.outcome === "not_applied" && !verdict.notChecked;
    // Whether the first check failed this label (any of its verdicts for it).
    const firstFailed = (verdict: ModelVerdict) =>
      verdicts.some((first) => !governedTermOf(first) && failing(first) && same_(first, verdict));
    // Review P3-4: the final text is the checked text, so the first check
    // already judged it; its verdicts are read as the final ones.
    const same = final.sameAsChecked === true;
    /** A Glossary Term the first check failed that the final text now holds. */
    const glossaryRepaired = (first: ModelVerdict) =>
      first.check === "glossary" && glossaryTermPresent(glossaryTermOf(first, before.glossaryCandidates), input.finalText);
    const pushGlossaryRepaired = (first: ModelVerdict) =>
      pushModelRow(first, noteDraft({
        ...baseOf(first),
        outcome: "applied",
        reason: `${first.reason || "not applied"}; repaired to the Glossary Term`,
        repaired: true,
      }));
    for (const verdict of final.verdicts) {
      if (governedTermOf(verdict)) continue;
      const base = baseOf(verdict);
      const wasFailing = !same && firstFailed(verdict);
      if (verdict.notChecked) {
        // Re-check P3: a label the first check failed and the check of the
        // final text left out is a remaining failure, unless the final text
        // now holds the Glossary Term.
        const first = verdicts.find((candidate) => !governedTermOf(candidate) && failing(candidate) && same_(candidate, verdict));
        if (wasFailing && first && glossaryRepaired(first)) {
          pushGlossaryRepaired(first);
          continue;
        }
        if (wasFailing) remainingFailures += 1;
        rows.push(noteDraft({ ...base, tier: "none", outcome: "not_applied", reason: `${NOT_CHECKED_ON_FINAL_TEXT} (the Self-check gave no verdict for it)` }));
        continue;
      }
      if (verdict.outcome === "applied") {
        pushModelRow(verdict, noteDraft({
          ...base,
          outcome: "applied",
          reason: wasFailing
            ? `${verdict.reason || "applied"}; repaired, and checked again on the final text`
            : verdict.reason || "applied",
          repaired: wasFailing,
        }));
        continue;
      }
      remainingFailures += 1;
      pushModelRow(verdict, noteDraft({
        ...base,
        outcome: "not_applied",
        // Review P3-7: a label the first check did not fail was found on the
        // final text, not checked "again".
        reason: same
          ? `${verdict.reason || "not applied"}${REPAIR_LEFT_CHECKED_TEXT}`
          : `${verdict.reason || "not applied"}; ${wasFailing ? "checked again" : "found"} on the final text`,
      }));
    }
    // Review P2-1: a failure the repair was made for that the check of the
    // final text gave no verdict for still has its row, never none. A
    // Glossary Term the final text now holds keeps its repaired mark
    // (review P3-4): the rule-based matcher decides it, as before.
    if (!same) {
      const reported = new Set<ModelVerdict>();
      for (const first of verdicts) {
        if (governedTermOf(first) || !failing(first)) continue;
        if (final.verdicts.some((verdict) => !governedTermOf(verdict) && same_(first, verdict))) continue;
        // One row per label, however many first verdicts it had.
        if ([...reported].some((other) => same_(other, first))) continue;
        reported.add(first);
        if (glossaryRepaired(first)) {
          pushGlossaryRepaired(first);
          continue;
        }
        remainingFailures += 1;
        rows.push(noteDraft({
          ...baseOf(first),
          tier: "none",
          outcome: "not_applied",
          reason: `${NOT_CHECKED_ON_FINAL_TEXT} (the Self-check gave no verdict for it)`,
        }));
      }
      // Follow-up review P3-1: in Single draft and Compare the model words its
      // own labels and is not asked for one verdict per label, so the check
      // of the final text can leave out a label the first check found met.
      // It keeps its row, as not checked on the final text, and is no
      // failure. A Glossary Term the final text holds needs none: the
      // final text's deterministic row records it.
      for (const first of verdicts) {
        if (governedTermOf(first) || failing(first)) continue;
        if (final.verdicts.some((verdict) => !governedTermOf(verdict) && same_(first, verdict))) continue;
        if ([...reported].some((other) => same_(other, first))) continue;
        reported.add(first);
        if (first.check === "glossary" && glossaryTermPresent(glossaryTermOf(first, before.glossaryCandidates), input.finalText)) continue;
        rows.push(noteDraft({
          ...baseOf(first),
          tier: "none",
          outcome: "not_applied",
          reason: `${NOT_CHECKED_ON_FINAL_TEXT} (the Self-check gave no verdict for it)`,
        }));
      }
    }
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
