import {
  matchesClaimExclusion,
  normalizeExclusionMatch,
} from "./claimExclusionMatcher";
import { LINE_LIMITS, WORD_CAPS, sectionMetrics } from "./lineLimits";
import { sectionParagraphs } from "./tiptapReport";
import { matchGlossaryTerms } from "./glossaryMatcher";
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
};

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

  // Profile Self-check rules: capped rules are measured here, clipped to the
  // Locked caps; uncapped rules go to the model, quoted verbatim.
  const modelRules: DeterministicSelfCheck["modelRules"] = [];
  profile.selfCheckRules.forEach((rule, index) => {
    if (rule.section !== undefined && rule.section !== section) return;
    const paragraphScoped = rule.paragraphIndex !== undefined;
    if (paragraphScoped && (rule.paragraphIndex ?? 0) >= paragraphs.length) {
      add(`rule:${index}`, {
        instruction: rule.instruction,
        paragraphIndex: rule.paragraphIndex,
        outcome: "not_applied",
        tier: "none",
        reason: `paragraph ${(rule.paragraphIndex ?? 0) + 1} is not present in Line ${section}`,
      });
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
    let over = false;
    let clipped = false;
    const measure = (
      asked: number | undefined,
      lockedLimit: number,
      actual: number,
      unit: string
    ) => {
      if (asked === undefined) return;
      const effective = Math.min(asked, lockedLimit);
      limits.push(`${effective} ${unit}`);
      if (actual > effective) over = true;
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
  });

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
    if (found < 0) {
      add(`exclusion:${index}`, {
        instruction,
        outcome: "applied",
        tier: "none",
        reason: `excluded claim absent (${label})`,
      });
      return;
    }
    const confirmedPlanConflict = (input.confirmedPlanConflicts ?? []).some(
      (wording) =>
        matchesClaimExclusion(wording, exclusion.text, exclusion.exactExcerpt)
    );
    add(
      `exclusion:${index}`,
      {
        instruction,
        paragraphIndex: found,
        outcome: "not_applied",
        tier: confirmedPlanConflict ? "conflict" : "none",
        reason: confirmedPlanConflict
          ? `writer-confirmed signed-plan conflict appears in paragraph ${found + 1} (${label}); retained and not repaired`
          : `excluded claim appears in paragraph ${found + 1} (${label})`,
      },
      !confirmedPlanConflict,
      confirmedPlanConflict
        ? undefined
        : `Paragraph ${found + 1}: remove the excluded claim "${exclusion.text}"; it is outside the eligible work (${label}) and must not be claimed.`
    );
  });

  // Glossary Terms: a verbatim (or inflected) use is applied here; a term
  // with no occurrence is a candidate the model classifies (synonym or
  // absent concept).
  const glossaryCandidates: string[] = [];
  for (const term of uniqueTerms(brief?.glossaryTerms ?? [])) {
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

  return { entries, glossaryCandidates, modelRules, paragraphs };
}

/** Every issue a repair must fix: deterministic guidance plus model verdicts. */
export function repairIssues(
  before: DeterministicSelfCheck,
  verdicts: ModelVerdict[]
): string[] {
  const issues = before.entries
    .filter((entry) => entry.repairable && entry.row.outcome === "not_applied")
    .map((entry) => entry.guidance ?? entry.row.reason);
  for (const verdict of verdicts) {
    if (verdict.outcome !== "not_applied") continue;
    const fix = verdict.repairText ?? (verdict.repairGuidance?.trim() || verdict.reason);
    const where =
      verdict.paragraphIndex === undefined
        ? "Whole section"
        : `Paragraph ${verdict.paragraphIndex + 1}`;
    issues.push(`${where}: ${fix}`);
  }
  return issues;
}

/** The Glossary Term a glossary verdict names (the candidate it mentions). */
function glossaryTermOf(verdict: ModelVerdict, candidates: string[]): string {
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
  repair: { attempted: boolean; succeeded: boolean; failureReason?: string };
  finalText: string;
}): { rows: ComplianceNoteDraft[]; summary: SelfCheckSummary } {
  const { section, before, verdicts, repair } = input;
  const failedBefore = new Set(
    before.entries
      .filter((entry) => entry.repairable && entry.row.outcome === "not_applied")
      .map((entry) => entry.key)
  );
  const finalEntries = (input.after ?? before).entries;
  const repairFailure = repair.failureReason ? `: ${repair.failureReason}` : "";

  const rows: ComplianceNoteDraft[] = finalEntries.map((entry) => {
    if (!repair.attempted || !failedBefore.has(entry.key)) return entry.row;
    if (!repair.succeeded) {
      return { ...entry.row, reason: `${entry.row.reason}; repair call failed${repairFailure}` };
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
  let remainingFailures = finalEntries.filter(
    (entry) => entry.repairable && entry.row.outcome === "not_applied"
  ).length;

  for (const verdict of verdicts) {
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
    if (verdict.outcome === "applied") {
      rows.push(noteDraft({ ...base, outcome: "applied", reason: verdict.reason || "applied" }));
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
        reason = `${reason}; repaired (deterministic re-check only; not re-verified by the model)`;
      }
    } else if (repair.attempted) {
      reason = `${reason}; repair call failed${repairFailure}`;
    }
    rows.push(noteDraft({ ...base, outcome, reason, repaired }));
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
        reason: `Storyline question withheld (${input.storylineQuestionWithheld}): shortened text must not replace the Storyline, so the Brief does not offer it (not repaired)`,
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
    | { ok: true; findings: number }
    | { ok: false; reason: string }
    | { ok: false; reportChanged: true }
): ComplianceNoteDraft {
  return noteDraft({
    section,
    source: "deterministic",
    instruction: "Consistency pass",
    outcome: outcome.ok ? "applied" : "not_applied",
    tier: "none",
    reason: outcome.ok
      ? `consistency pass ran over the assembled draft: ${outcome.findings} finding(s)`
      : "reportChanged" in outcome
        ? "consistency pass skipped: the report changed while it ran, so no findings were stored"
        : `consistency pass call failed (${outcome.reason})`,
  });
}
