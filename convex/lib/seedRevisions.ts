import {
  PD_SUBSECTIONS,
  type PdSection,
  type PdSubsectionRoleId,
} from "../../shared/pdSubsections";
import { CHARS_PER_LINE, LINE_LIMITS } from "./lineLimits";

export const MAX_SEED_SNAPSHOT_ROWS = 128;
export const MAX_SEED_CONTEXT_ROW_UTF8_BYTES = 64_000;
export const MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES = 512_000;
export const MAX_SEED_PROMPT_UTF8_BYTES = 600_000;
export const MAX_SUMMARY_PLAN_CHECK_INPUT_UTF8_BYTES = 64_000;
/**
 * Worst-case compact-JSON bytes of one Summary Self-check response. Real
 * Briefs carry 10 to 20 ordinary checks per Section, so 4,096 bytes refused
 * every real sign-off (2026-09-25). 16,384 bytes fits 30 ordinary checks,
 * about 10 plan rows and the Storyline question. The Summary-plan Self-check
 * request sends the same number as its output token allowance
 * (SUMMARY_PLAN_SELF_CHECK_REQUEST.maxTokens), so a response within this
 * byte limit never needs more tokens than the request allows.
 */
export const MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES = 16_384;
export const MAX_SUMMARY_PLAN_VERDICTS = 256;
export const MAX_SUMMARY_ORDINARY_VERDICTS = 30;
export const MAX_SUMMARY_SELF_CHECK_LABEL_ESCAPED_UTF8_BYTES = 32;
export const MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES = 64;
export const MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES = 64;
export const MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES = 96;
export const MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES = 96;
export const MAX_SUMMARY_SELF_CHECK_PARAGRAPH = 9_999_999_999;

/**
 * 2026-09-30 (first): at most this many uncertainties the writer dropped get
 * a LEAVE OUT entry and a plan check in each Line, so sign-off admission
 * counts them exactly. Any beyond the cap is named in the Compliance Note as
 * not checked.
 */
export const MAX_DROPPED_UNCERTAINTY_CHECKS = 3;
/**
 * 2026-09-30 (first): the experiments, and separately the advancements, that
 * recorded a dropped uncertainty and go with it as reference, at most this
 * many of each.
 */
export const MAX_DROPPED_UNCERTAINTY_RELATED_PER_KIND = 3;
/**
 * 2026-09-30 (first): the dropped uncertainties frozen on a Summary at most,
 * checked or not, so the row stays small. Any beyond it is not named.
 */
export const MAX_DROPPED_UNCERTAINTIES_FROZEN = 16;
/**
 * 2026-09-30 (first): the JSON-escaped UTF-8 bytes of Line 242's text that
 * Line 246's advancement check carries: twice the characters of a Line 242 at
 * its Locked cap (50 lines of 78), so a Line at the cap fits even with
 * curly quotes and other multi-byte characters. Longer text is clipped with
 * a mark. Sign-off admission reserves exactly this many bytes.
 */
export const MAX_ANSWERS_242_REFERENCE_ESCAPED_UTF8_BYTES =
  LINE_LIMITS.s242 * CHARS_PER_LINE * 2;
/** The reference admission reserves for Line 246's advancement check. */
export const ANSWERS_242_WORST_CASE_REFERENCE = "x".repeat(
  MAX_ANSWERS_242_REFERENCE_ESCAPED_UTF8_BYTES
);
/** 2026-09-30 (first): the id of Line 246's advancement check. */
export const ADVANCEMENTS_ANSWER_242_RULE_ID = "advancements_answer_242" as const;
/**
 * 2026-09-30 (second, Rule C): the id of Line 244's check that its work is
 * for an uncertainty Line 242 states or for a signed-off item.
 */
export const WORK_ANSWERS_242_RULE_ID = "work_answers_242" as const;
export type SummaryPlanRuleId =
  | typeof ADVANCEMENTS_ANSWER_242_RULE_ID
  | typeof WORK_ANSWERS_242_RULE_ID;

/**
 * Bump these versions whenever provider-facing Summary serialization or
 * ordinary label projection changes. Dynamic data stays outside the version.
 * v2 (2026-09-30, first): LEAVE OUT entries and checks (`droppedSeedId`) and
 * Line 246's advancement check (`ruleId`).
 * v3 (2026-09-30, second): Line 244's work check (`ruleId`
 * work_answers_242), with Line 242 and Line 246's signed-off items as data.
 */
export const SUMMARY_PLAN_SERIALIZER_VERSION = "summary-plan-jsonl-v3";
export const SUMMARY_ORDINARY_LABEL_PROJECTION_VERSION =
  "summary-ordinary-labels-v2";

export type FrozenSourceIdMap = ReadonlyArray<{
  originSourceId: string;
  recoverySourceId: string;
}>;

/**
 * Resolve a citation's immutable origin id to the row owned by this attempt.
 * The map is identity-free by design: content hashes are evidence integrity
 * fields, never source identity. Both Seed and Brief citation readers use
 * this resolver on recovery generations.
 */
export function resolveFrozenSourceId(
  originSourceId: string,
  sourceIdMap?: FrozenSourceIdMap
): string {
  if (!sourceIdMap) return originSourceId;
  const matches = sourceIdMap.filter(
    (entry) => entry.originSourceId === originSourceId
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Frozen source map is missing ${originSourceId}`
        : `Frozen source map duplicates ${originSourceId}`
    );
  }
  return matches[0].recoverySourceId;
}

export function assertFrozenSourceBijection(args: {
  originSourceIds: readonly string[];
  recoverySourceIds: readonly string[];
  sourceIdMap: FrozenSourceIdMap;
}): void {
  const origins = new Set(args.originSourceIds);
  const recoveries = new Set(args.recoverySourceIds);
  if (
    origins.size !== args.originSourceIds.length ||
    recoveries.size !== args.recoverySourceIds.length ||
    args.sourceIdMap.length !== origins.size
  ) {
    throw new Error("Frozen source map is not a complete bijection");
  }
  const mappedRecoveries = new Set<string>();
  for (const originSourceId of origins) {
    const recoverySourceId = resolveFrozenSourceId(
      originSourceId,
      args.sourceIdMap
    );
    if (!recoveries.has(recoverySourceId) || mappedRecoveries.has(recoverySourceId)) {
      throw new Error("Frozen source map is not a complete bijection");
    }
    mappedRecoveries.add(recoverySourceId);
  }
  if (mappedRecoveries.size !== recoveries.size) {
    throw new Error("Frozen source map is not a complete bijection");
  }
}

export type FrozenSummaryPlanItem = {
  itemId: string;
  roleId: PdSubsectionRoleId;
  kind: "standard" | "optional" | "multiple";
  bullets: readonly string[];
  support: "source_supported" | "writer_asserted";
  uncertaintySeedId?: string;
  experimentSeedIds?: readonly string[];
  confirmedExclusion?: boolean;
};

/**
 * 2026-09-30 (first): an uncertainty the writer ticked, then unticked, frozen
 * at sign-off with the wording of the run's experiments and advancements that
 * recorded it, as reference so drafting and the Self-check recognise it.
 */
export type FrozenDroppedUncertainty<SeedId extends string = string> = {
  seedId: SeedId;
  wording: readonly string[];
  experiments: ReadonlyArray<{ seedId: SeedId; wording: readonly string[] }>;
  advancements: ReadonlyArray<{ seedId: SeedId; wording: readonly string[] }>;
};

/**
 * A plan check's instruction: cover a signed-off item, honour a Skip,
 * leave out an uncertainty the writer dropped (2026-09-30, first), on Line
 * 246 claim advancements only for uncertainties Line 242 states (Rule B) or,
 * on Line 244, describe work only for them or for a signed-off item
 * (2026-09-30 second, Rule C).
 */
export type FrozenSummaryPlanInstruction =
  | "cover"
  | "skip"
  | "leave_out"
  | "answer_242"
  | "work_answer_242";

export type FrozenSummaryPlanCheck<
  ItemId extends string = string,
  SeedId extends string = string,
> = {
  itemId?: ItemId;
  skippedRoleId?: PdSubsectionRoleId;
  /** 2026-09-30 (first): the dropped uncertainty a LEAVE OUT check is for. */
  droppedSeedId?: SeedId;
  /** 2026-09-30 (first): Line 246's check that advancements answer Line 242. */
  ruleId?: SummaryPlanRuleId;
  roleId: PdSubsectionRoleId;
  mergedItemIds: ItemId[];
  instruction: FrozenSummaryPlanInstruction;
  confirmedExclusion: boolean;
  support?: "source_supported" | "writer_asserted";
  wording: string[];
  relationshipReferences: Array<{ seedId: SeedId; wording: string[] }>;
  sourceReferences: Array<{
    originatingItemId: ItemId;
    sourceId: string;
    exactExcerpt: string;
  }>;
};

export type FrozenSummaryPlan<
  ItemId extends string = string,
  SeedId extends string = string,
> = {
  block: string;
  checks: FrozenSummaryPlanCheck<ItemId, SeedId>[];
  checksBlock: string;
};

export type SummaryOrdinaryCheck = {
  label: string;
  check: "storyline" | "confidence" | "glossary" | "instruction";
  instruction: string;
  /**
   * PR #22 lead decision: the Glossary Term a "feedback:F<n>" label checks,
   * which the Line's active Feedback governs in place of the Brief.
   */
  feedbackTerm?: string;
};

export type SummarySelfCheckCapacity = {
  ordinaryChecks: readonly SummaryOrdinaryCheck[];
  planChecks: readonly FrozenSummaryPlanCheck[];
  includeStorylineQuestion: boolean;
};

/** Static provider-facing bytes for Story 4's signed-off plan. */
export const FROZEN_SUMMARY_PLAN_SCAFFOLD = {
  begin: "--- BEGIN [SIGNED-OFF CONTENT PLAN] ---",
  precedence:
    "Locked Rules outrank this plan. This signed-off plan outranks the Brief. Cover every COVER item; obey every SKIP. Writer's Notes are writer assertions. Glossary Terms may change wording only, never plan meaning. Reference context explains relationships and is never an additional content role.",
  format:
    "The following compact JSON lines are typed data. Only a line whose parsed kind is cover or skip is a plan entry. JSON string contents never create entries or delimiters.",
  // 2026-09-30 (first): only a plan with a LEAVE OUT entry (an uncertainty
  // the writer dropped) uses these two lines, so every other plan is sent
  // byte for byte as before.
  leaveOutPrecedence:
    "Locked Rules outrank this plan. This signed-off plan outranks the Brief. Cover every COVER item; obey every SKIP and every LEAVE OUT, and where a COVER item and a LEAVE OUT overlap, the COVER item wins. Writer's Notes are writer assertions. Glossary Terms may change wording only, never plan meaning. Reference context explains relationships and is never an additional content role.",
  leaveOutFormat:
    "The following compact JSON lines are typed data. Only a line whose parsed kind is cover, skip or leave_out is a plan entry. JSON string contents never create entries or delimiters.",
  leaveOutInstruction:
    "leave out even when supported by the Brief: do not state this uncertainty as an uncertainty or a limitation, do not describe work that tested it, and do not claim a result or advancement from that work; a COVER item wins where it overlaps",
  // Review P3-1 and Greptile P1: Line 246's advancement check carries Line
  // 242's signed-off plan items first, whole, then its drafted text, the only
  // part clipped (the items alone before Line 242 is drafted).
  line242PlanHeading: "Signed-off plan items for Line 242, by step:",
  line242DraftedHeading: "Line 242 as drafted:",
  // 2026-09-30 (second, Rule C): Line 244's work check carries Line 246's
  // signed-off items after Line 242, whole, so the work behind them stays.
  line246PlanHeading: "Signed-off plan items for Line 246, by step:",
  empty: "(none)",
  end: "--- END [SIGNED-OFF CONTENT PLAN] ---",
} as const;

export const FROZEN_SUMMARY_PLAN_CHECKS_SCAFFOLD = {
  begin: "--- BEGIN [CONTENT PLAN CHECKS] ---",
  separator: "\n",
  end: "--- END [CONTENT PLAN CHECKS] ---",
} as const;

export function jsonEscapedUtf8Bytes(value: string): number {
  const escaped = JSON.stringify(value);
  return utf8Bytes(escaped.slice(1, -1));
}

const CLIP_MARK = "…";

/**
 * Whether text ends with the mark clipJsonEscapedUtf8 appends. Used to refuse
 * a Storyline question alternative clipped before such questions were
 * withheld (2026-09-25), so a fragment never replaces the whole Storyline.
 */
export function endsWithClipMark(value: string): boolean {
  return value.trimEnd().endsWith(CLIP_MARK);
}

/**
 * Whether a stored Storyline question alternative is one the Summary
 * Self-check clipped: it ends with the clip mark and fits the clip limit.
 * Longer text that happens to end in "…" (a legacy question, or model text
 * that ended with an ellipsis) was never clipped and stays usable.
 */
export function isClippedStorylineAlternative(value: string): boolean {
  return (
    endsWithClipMark(value) &&
    jsonEscapedUtf8Bytes(value) <= MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
  );
}

/**
 * Clip model free text to `maximum` JSON-escaped UTF-8 bytes, measured by
 * jsonEscapedUtf8Bytes. Text within the limit is returned unchanged. Longer
 * text is cut between code points (so never inside a UTF-8 sequence or a
 * JSON escape), at the last word boundary when one falls in the second half
 * of the kept text, and ends with a "…" mark that the limit already counts.
 * Escaping is per code point, so the kept prefix costs exactly the sum of
 * its code points.
 */
export function clipJsonEscapedUtf8(value: string, maximum: number): string {
  if (jsonEscapedUtf8Bytes(value) <= maximum) return value;
  const markBytes = jsonEscapedUtf8Bytes(CLIP_MARK);
  const withMark = maximum > markBytes;
  const budget = withMark ? maximum - markBytes : Math.max(maximum, 0);
  const codePoints = Array.from(value);
  let used = 0;
  let end = 0;
  while (end < codePoints.length) {
    const cost = jsonEscapedUtf8Bytes(codePoints[end]);
    if (used + cost > budget) break;
    used += cost;
    end += 1;
  }
  const hardCut = codePoints.slice(0, end).join("");
  if (!withMark) return hardCut;
  let kept = hardCut;
  const next = codePoints[end];
  const last = codePoints[end - 1];
  // The cut splits a word only when a word character follows it: a full
  // stop, comma or closing mark after it means the last word is whole
  // (plan-coverage review P3-2).
  if (next !== undefined && last !== undefined && !/[\s.,;:!?)\]}"”]/u.test(next) && /\S/u.test(last)) {
    const boundary = kept.search(/\s\S*$/u);
    if (boundary > 0 && boundary >= kept.length / 2) kept = kept.slice(0, boundary);
  }
  kept = kept.replace(/[\s,;:]+$/u, "");
  return `${kept || hardCut}${CLIP_MARK}`;
}

function assertEscapedStringLimit(
  value: string,
  maximum: number,
  label: string
): void {
  if (jsonEscapedUtf8Bytes(value) > maximum) {
    throw new SeedContextLimitError(
      "summary_self_check_field_utf8_bytes",
      `${label} exceeds ${maximum} JSON-escaped UTF-8 bytes`
    );
  }
}

function canonicalPlanCheck(
  check: FrozenSummaryPlanCheck
): JsonValue {
  return {
    confirmedExclusion: check.confirmedExclusion,
    ...(check.droppedSeedId ? { droppedSeedId: check.droppedSeedId } : {}),
    instruction: check.instruction,
    ...(check.itemId ? { itemId: check.itemId } : {}),
    mergedItemIds: [...check.mergedItemIds],
    relationshipReferences: check.relationshipReferences.map((reference) => ({
      seedId: reference.seedId,
      wording: [...reference.wording],
    })),
    roleId: check.roleId,
    ...(check.ruleId ? { ruleId: check.ruleId } : {}),
    ...(check.skippedRoleId ? { skippedRoleId: check.skippedRoleId } : {}),
    ...(check.support ? { support: check.support } : {}),
    sourceReferences: check.sourceReferences.map((reference) => ({
      exactExcerpt: reference.exactExcerpt,
      originatingItemId: reference.originatingItemId,
      sourceId: reference.sourceId,
    })),
    wording: [...check.wording],
  };
}

/**
 * The keys a plan check or verdict is referenced by: an item, a Skip, a
 * dropped uncertainty or a rule (2026-09-30, first). A usable reference sets
 * exactly one of them.
 */
export const SUMMARY_PLAN_REF_KEYS = ["itemId", "skippedRoleId", "droppedSeedId", "ruleId"] as const;
export type SummaryPlanRefKey = (typeof SUMMARY_PLAN_REF_KEYS)[number];
export type SummaryPlanRefFields = Partial<Record<SummaryPlanRefKey, string>>;

/** Every reference a plan check or verdict sets, in key order. */
export function summaryPlanRefsOf(
  check: SummaryPlanRefFields
): Array<{ key: SummaryPlanRefKey; id: string }> {
  return SUMMARY_PLAN_REF_KEYS.flatMap((key) => {
    const id = check[key];
    return id !== undefined ? [{ key, id }] : [];
  });
}

/** Whether a verdict and a plan check name the same one reference. */
export function sameSummaryPlanRef(
  left: SummaryPlanRefFields,
  right: SummaryPlanRefFields
): boolean {
  const [ref] = summaryPlanRefsOf(left);
  return ref !== undefined && right[ref.key] === ref.id;
}

/** Exact expanded block projection shared by admission and runtime. */
export function projectFrozenSummaryPlanChecks(
  checks: readonly FrozenSummaryPlanCheck[]
): string {
  const body = checks.map((check) => stableSerialize(canonicalPlanCheck(check))).join(
    FROZEN_SUMMARY_PLAN_CHECKS_SCAFFOLD.separator
  );
  const block = [
    FROZEN_SUMMARY_PLAN_CHECKS_SCAFFOLD.begin,
    body,
    FROZEN_SUMMARY_PLAN_CHECKS_SCAFFOLD.end,
  ].join("\n");
  return block;
}

/** Exact expanded block sent to the Summary-only Self-check. */
export function serializeFrozenSummaryPlanChecks(
  checks: readonly FrozenSummaryPlanCheck[]
): string {
  const block = projectFrozenSummaryPlanChecks(checks);
  assertSummaryPlanCheckInputWithinLimit(block);
  return block;
}

/** Exact inclusive predicate shared by primitive proof and runtime admission. */
export function assertSummaryPlanCheckInputWithinLimit(block: string): void {
  if (utf8Bytes(block) > MAX_SUMMARY_PLAN_CHECK_INPUT_UTF8_BYTES) {
    throw new SeedContextLimitError(
      "summary_plan_check_input_utf8_bytes",
      `Expanded Summary plan checks exceed ${MAX_SUMMARY_PLAN_CHECK_INPUT_UTF8_BYTES} UTF-8 bytes`
    );
  }
}

export function projectSummaryOrdinaryChecks(args: {
  storylineText: string;
  confidenceMap: readonly { text: string }[];
  glossaryTerms: readonly string[];
  writerFlavor?: string;
  rules: readonly { instruction: string }[];
  /**
   * PR #22 lead decision (v2): Glossary Terms the Line's active Feedback
   * governs, each checked by its own label in place of a Glossary label, so
   * the count never exceeds the one admitted at sign-off.
   */
  feedbackTerms?: readonly string[];
}): SummaryOrdinaryCheck[] {
  const checks: SummaryOrdinaryCheck[] = [];
  if (args.storylineText.trim()) {
    checks.push({ label: "storyline", check: "storyline", instruction: "Storyline" });
  }
  args.confidenceMap.forEach((entry, index) => {
    checks.push({
      label: `confidence:C${index + 1}`,
      check: "confidence",
      instruction: `Confidence Map: ${entry.text}`,
    });
  });
  args.glossaryTerms.forEach((term, index) => {
    checks.push({
      label: `glossary:G${index + 1}`,
      check: "glossary",
      instruction: `Glossary Term: ${term}`,
    });
  });
  if (args.writerFlavor?.trim()) {
    checks.push({
      label: "writer:profile",
      check: "instruction",
      instruction: args.writerFlavor.trim(),
    });
  }
  args.rules.forEach((rule, index) => {
    checks.push({
      label: `rule:R${index + 1}`,
      check: "instruction",
      instruction: rule.instruction,
    });
  });
  (args.feedbackTerms ?? []).forEach((term, index) => {
    checks.push({
      label: `feedback:F${index + 1}`,
      check: "instruction",
      instruction: `Glossary Term: ${term}`,
      feedbackTerm: term,
    });
  });
  return checks;
}

function repeated(maximum: number, value: string): string {
  return value.repeat(maximum);
}

/** Conservative complete response envelope used at sign-off and runtime. */
export function projectSummarySelfCheckWorstCaseResponse(
  args: SummarySelfCheckCapacity
): string {
  if (args.ordinaryChecks.length > MAX_SUMMARY_ORDINARY_VERDICTS) {
    throw new SeedContextLimitError(
      "summary_self_check_ordinary_count",
      `Summary Self-check requires more than ${MAX_SUMMARY_ORDINARY_VERDICTS} ordinary verdicts`
    );
  }
  if (args.planChecks.length > MAX_SUMMARY_PLAN_VERDICTS) {
    throw new SeedContextLimitError(
      "summary_self_check_plan_count",
      `Summary Self-check requires more than ${MAX_SUMMARY_PLAN_VERDICTS} plan verdicts`
    );
  }
  const ordinaryLabels = new Set<string>();
  for (const ordinary of args.ordinaryChecks) {
    assertEscapedStringLimit(
      ordinary.label,
      MAX_SUMMARY_SELF_CHECK_LABEL_ESCAPED_UTF8_BYTES,
      "Summary ordinary label"
    );
    if (ordinaryLabels.has(ordinary.label)) {
      throw new SeedContextLimitError(
        "summary_self_check_merge_refs",
        `Summary ordinary label is duplicated: ${ordinary.label}`
      );
    }
    ordinaryLabels.add(ordinary.label);
  }
  for (const check of args.planChecks) {
    const refs = summaryPlanRefsOf(check);
    const primary = refs.length === 1 ? refs[0]!.id : undefined;
    if (!primary) {
      throw new SeedContextLimitError(
        "summary_self_check_merge_refs",
        "Summary plan check needs exactly one item, Skip, dropped uncertainty or rule identifier"
      );
    }
    assertEscapedStringLimit(
      primary,
      MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES,
      "Summary plan identifier"
    );
    for (const mergedId of check.mergedItemIds) {
      assertEscapedStringLimit(
        mergedId,
        MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES,
        "Summary merged item identifier"
      );
    }
    if (
      check.itemId &&
      (!check.mergedItemIds.includes(check.itemId) ||
        new Set(check.mergedItemIds).size !== check.mergedItemIds.length)
    ) {
      throw new SeedContextLimitError(
        "summary_self_check_merge_refs",
        `Summary plan check has incomplete merge references for ${check.itemId}`
      );
    }
  }
  const reason = repeated(MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES, "r");
  const repairGuidance = repeated(
    MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES,
    "g"
  );
  const verdicts = args.ordinaryChecks.map((ordinary) => ({
    check: "instruction",
    instruction: ordinary.label,
    outcome: "not_applied",
    paragraph: MAX_SUMMARY_SELF_CHECK_PARAGRAPH,
    reason,
    repairGuidance,
  }));
  const planVerdicts = args.planChecks.map((check) => ({
    ...(check.droppedSeedId ? { droppedSeedId: check.droppedSeedId } : {}),
    ...(check.itemId ? { itemId: check.itemId } : {}),
    mergedItemIds: [...check.mergedItemIds],
    outcome: "not_applied",
    paragraph: MAX_SUMMARY_SELF_CHECK_PARAGRAPH,
    reason,
    repairGuidance,
    ...(check.ruleId ? { ruleId: check.ruleId } : {}),
    ...(check.skippedRoleId ? { skippedRoleId: check.skippedRoleId } : {}),
  }));
  const envelope: JsonValue = {
    planVerdicts,
    ...(args.includeStorylineQuestion
      ? {
          storylineQuestion: {
            confidenceEntry: MAX_SUMMARY_SELF_CHECK_PARAGRAPH,
            question: repeated(MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES, "q"),
            sectionClaim: repeated(MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES, "c"),
            storylineAlternative: repeated(
              MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES,
              "a"
            ),
          },
        }
      : {}),
    verdicts,
  };
  return stableSerialize(envelope);
}

export function summarySelfCheckWorstCaseResponse(args: SummarySelfCheckCapacity): string {
  const serialized = projectSummarySelfCheckWorstCaseResponse(args);
  assertSummarySelfCheckResponseWithinLimit(serialized);
  return serialized;
}

/** Exact inclusive predicate shared by primitive proof and sign-off admission. */
export function assertSummarySelfCheckResponseWithinLimit(serialized: string): void {
  if (utf8Bytes(serialized) > MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES) {
    throw new SeedContextLimitError(
      "summary_self_check_response_utf8_bytes",
      `Summary Self-check worst-case response exceeds ${MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES} UTF-8 bytes`
    );
  }
}

/**
 * The signed-off plan items of one Line's steps that are not skipped, in
 * step order and, within a step, in the order given.
 */
export function linePlanItems<Role extends { roleId: PdSubsectionRoleId; bullets: readonly string[] }>(
  section: PdSection,
  items: readonly Role[],
  skippedRoleIds: readonly PdSubsectionRoleId[]
): Array<{ roleId: PdSubsectionRoleId; wording: string[] }> {
  const skipped = new Set(skippedRoleIds);
  return PD_SUBSECTIONS
    .filter((role) => role.section === section && !skipped.has(role.roleId))
    .flatMap((role) =>
      items
        .filter((item) => item.roleId === role.roleId)
        .map((item) => ({ roleId: role.roleId, wording: [...item.bullets] })));
}

/**
 * 2026-09-30 (first): the signed-off plan items of Line 242's steps that are
 * not skipped, in step order and, within a step, in the order given.
 */
export function line242PlanItems<Role extends { roleId: PdSubsectionRoleId; bullets: readonly string[] }>(
  items: readonly Role[],
  skippedRoleIds: readonly PdSubsectionRoleId[]
): Array<{ roleId: PdSubsectionRoleId; wording: string[] }> {
  return linePlanItems("s242", items, skippedRoleIds);
}

/** 2026-09-30 (second, Rule C): the same for Line 246. */
export function line246PlanItems<Role extends { roleId: PdSubsectionRoleId; bullets: readonly string[] }>(
  items: readonly Role[],
  skippedRoleIds: readonly PdSubsectionRoleId[]
): Array<{ roleId: PdSubsectionRoleId; wording: string[] }> {
  return linePlanItems("s246", items, skippedRoleIds);
}

function planItemsByStep(
  heading: string,
  items: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }>
): string {
  const title = (roleId: PdSubsectionRoleId) =>
    PD_SUBSECTIONS.find((role) => role.roleId === roleId)?.title ?? roleId;
  return [
    heading,
    ...(items.length > 0
      ? items.map((item) => `- ${title(item.roleId)}: ${item.wording.join(" ")}`)
      : [`- ${FROZEN_SUMMARY_PLAN_SCAFFOLD.empty}`]),
  ].join("\n");
}

/**
 * 2026-09-30 (first, Greptile P1): the wording of Line 246's advancement
 * check. Line 242's signed-off plan items come first and are never clipped;
 * the drafted text follows under its own heading and is clipped alone to
 * MAX_ANSWERS_242_REFERENCE_ESCAPED_UTF8_BYTES with a mark. Without drafted
 * text, the items stand alone.
 */
export function line242Reference(args: {
  items: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }>;
  line242Text?: string;
}): string {
  const plan = planItemsByStep(FROZEN_SUMMARY_PLAN_SCAFFOLD.line242PlanHeading, args.items);
  const drafted = args.line242Text?.trim() ?? "";
  if (!drafted) return plan;
  return `${plan}\n\n${FROZEN_SUMMARY_PLAN_SCAFFOLD.line242DraftedHeading}\n${clipJsonEscapedUtf8(
    drafted,
    MAX_ANSWERS_242_REFERENCE_ESCAPED_UTF8_BYTES
  )}`;
}

/**
 * 2026-09-30 (second, Rule C): the wording of Line 244's work check. Line
 * 242 as in Rule B (its signed-off items whole, then its drafted text, the
 * only part clipped, to the same reservation), then Line 246's signed-off
 * items, whole: frozen at sign-off, so admission counts their exact bytes.
 */
export function line244Reference(args: {
  items242: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }>;
  line242Text?: string;
  items246: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }>;
}): string {
  return `${line242Reference({ items: args.items242, line242Text: args.line242Text })}\n\n${planItemsByStep(
    FROZEN_SUMMARY_PLAN_SCAFFOLD.line246PlanHeading,
    args.items246
  )}`;
}

/** Build the immutable, delimited content plan consumed by a single section. */
export function buildFrozenSummaryPlan<
  ItemId extends string = string,
  SeedId extends string = string,
>(args: {
  section: PdSection;
  items: readonly (Omit<FrozenSummaryPlanItem, "itemId" | "uncertaintySeedId" | "experimentSeedIds"> & {
    itemId: ItemId;
    uncertaintySeedId?: SeedId;
    experimentSeedIds?: readonly SeedId[];
  })[];
  skippedRoleIds: readonly PdSubsectionRoleId[];
  referencesBySeedId?: ReadonlyMap<SeedId, readonly string[]>;
  sourceRefsByItemId?: ReadonlyMap<
    ItemId,
    readonly { sourceId: string; exactExcerpt: string }[]
  >;
  /**
   * 2026-09-30 (first): the uncertainties the writer dropped, within the
   * cap, each a LEAVE OUT entry and plan check in every Line.
   */
  droppedUncertainties?: readonly FrozenDroppedUncertainty<SeedId>[];
  /**
   * 2026-09-30 (first): Line 246 only. Its advancement check carries Line
   * 242's signed-off plan items from `items`, whole, then `line242Text` (the
   * text Line 242 was drafted with, or ANSWERS_242_WORST_CASE_REFERENCE at
   * admission), clipped alone to MAX_ANSWERS_242_REFERENCE_ESCAPED_UTF8_BYTES.
   * No text: the items alone. Absent: no such check.
   */
  answers242?: { line242Text?: string };
  /**
   * 2026-09-30 (second, Rule C): Line 244 only. Its work check carries Line
   * 242 as `answers242` does, then Line 246's signed-off items from `items`,
   * whole. Absent: no such check.
   */
  workAnswers242?: { line242Text?: string };
}): FrozenSummaryPlan<ItemId, SeedId> {
  const sectionRoles = PD_SUBSECTIONS.filter((role) => role.section === args.section);
  const roleIds = new Set(sectionRoles.map((role) => role.roleId));
  const skipped = new Set(args.skippedRoleIds.filter((roleId) => roleIds.has(roleId)));
  const items = args.items.filter((item) => roleIds.has(item.roleId) && !skipped.has(item.roleId));
  type PlanItem = (typeof items)[number];
  const checks: FrozenSummaryPlanCheck<ItemId, SeedId>[] = [];
  const entries: JsonValue[] = [];

  for (const role of sectionRoles) {
    if (skipped.has(role.roleId)) {
      checks.push({
        skippedRoleId: role.roleId,
        roleId: role.roleId,
        mergedItemIds: [],
        instruction: "skip",
        confirmedExclusion: false,
        wording: [],
        relationshipReferences: [],
        sourceReferences: [],
      });
      entries.push({
        instruction: "omit even when supported by the Brief",
        kind: "skip",
        roleId: role.roleId,
      });
      continue;
    }
    const roleItems = items.filter((item) => item.roleId === role.roleId);
    if (roleItems.length === 0) continue;
    const groups: PlanItem[][] = [];
    if (role.kind !== "multiple") {
      groups.push(roleItems);
    } else if (role.roleId === "specific_advancements") {
      const byUncertainty = new Map<string, PlanItem[]>();
      for (const item of roleItems) {
        const key = item.uncertaintySeedId ?? item.itemId;
        const group = byUncertainty.get(key) ?? [];
        group.push(item);
        byUncertainty.set(key, group);
      }
      groups.push(...byUncertainty.values());
    } else {
      groups.push(...roleItems.map((item) => [item]));
    }
    for (const group of groups) {
      const ids = group.map((item) => item.itemId);
      const referenceIds = new Set<SeedId>();
      for (const item of group) {
        if (item.uncertaintySeedId) referenceIds.add(item.uncertaintySeedId);
        for (const id of item.experimentSeedIds ?? []) referenceIds.add(id);
      }
      const relationshipReferences = [...referenceIds].map((seedId) => {
        const wording = args.referencesBySeedId?.get(seedId);
        if (!wording) {
          throw new Error(
            `Signed-off content plan reference closure is incomplete for ${seedId}`
          );
        }
        return { seedId, wording: [...wording] };
      });
      const groupSourceReferences = group.flatMap((item) =>
        (args.sourceRefsByItemId?.get(item.itemId) ?? []).map((citation) => ({
          exactExcerpt: citation.exactExcerpt,
          originatingItemId: item.itemId,
          sourceId: citation.sourceId,
        }))
      );
      entries.push({
        itemIds: ids,
        items: group.map((item) => ({
          itemId: item.itemId,
          support: item.support,
          wording: [...item.bullets],
        })),
        kind: "cover",
        relationshipReferences: relationshipReferences.map((reference) => ({
          seedId: reference.seedId,
          wording: [...reference.wording],
        })),
        roleId: role.roleId,
        roleKind: role.kind,
        sourceReferences: groupSourceReferences,
      });
      for (const item of group) {
        const sourceReferences = (args.sourceRefsByItemId?.get(item.itemId) ?? [])
          .map((citation) => ({
            originatingItemId: item.itemId,
            sourceId: citation.sourceId,
            exactExcerpt: citation.exactExcerpt,
          }));
        checks.push({
          itemId: item.itemId,
          roleId: role.roleId,
          mergedItemIds: [...ids],
          instruction: "cover",
          confirmedExclusion: item.confirmedExclusion ?? false,
          support: item.support,
          wording: [...item.bullets],
          relationshipReferences,
          sourceReferences,
        });
      }
    }
  }
  // 2026-09-30 (first): what the writer dropped stays out of every Line. A
  // dropped uncertainty's experiments and advancements go with it as
  // reference, so the drafter and the checker recognise its content.
  const dropped = (args.droppedUncertainties ?? []).slice(0, MAX_DROPPED_UNCERTAINTY_CHECKS);
  for (const uncertainty of dropped) {
    const relationshipReferences = [
      ...uncertainty.experiments.slice(0, MAX_DROPPED_UNCERTAINTY_RELATED_PER_KIND),
      ...uncertainty.advancements.slice(0, MAX_DROPPED_UNCERTAINTY_RELATED_PER_KIND),
    ].map((reference) => ({ seedId: reference.seedId, wording: [...reference.wording] }));
    entries.push({
      droppedSeedId: uncertainty.seedId,
      instruction: FROZEN_SUMMARY_PLAN_SCAFFOLD.leaveOutInstruction,
      kind: "leave_out",
      relationshipReferences: relationshipReferences.map((reference) => ({
        seedId: reference.seedId,
        wording: [...reference.wording],
      })),
      wording: [...uncertainty.wording],
    });
    checks.push({
      droppedSeedId: uncertainty.seedId,
      roleId: "active_uncertainties",
      mergedItemIds: [],
      instruction: "leave_out",
      confirmedExclusion: false,
      wording: [...uncertainty.wording],
      relationshipReferences,
      sourceReferences: [],
    });
  }
  // 2026-09-30 (first): every Line 246 advancement answers an uncertainty
  // Line 242 states. The check carries Line 242 as data: its signed-off plan
  // items, whole (frozen at sign-off, so admission counts their exact bytes),
  // then its drafted text, the only part clipped (Greptile P1).
  if (args.answers242 && args.section === "s246") {
    checks.push({
      ruleId: ADVANCEMENTS_ANSWER_242_RULE_ID,
      roleId: "specific_advancements",
      mergedItemIds: [],
      instruction: "answer_242",
      confirmedExclusion: false,
      wording: [line242Reference({
        items: line242PlanItems(args.items, args.skippedRoleIds),
        line242Text: args.answers242.line242Text,
      })],
      relationshipReferences: [],
      sourceReferences: [],
    });
  }
  // 2026-09-30 (second, Rule C): Line 244 describes work only for an
  // uncertainty Line 242 states, or work a COVER item holds or needs as its
  // evidence. The check carries Line 242 as Rule B does, then Line 246's
  // signed-off items, whole.
  if (args.workAnswers242 && args.section === "s244") {
    checks.push({
      ruleId: WORK_ANSWERS_242_RULE_ID,
      roleId: "experimentation",
      mergedItemIds: [],
      instruction: "work_answer_242",
      confirmedExclusion: false,
      wording: [line244Reference({
        items242: line242PlanItems(args.items, args.skippedRoleIds),
        line242Text: args.workAnswers242.line242Text,
        items246: line246PlanItems(args.items, args.skippedRoleIds),
      })],
      relationshipReferences: [],
      sourceReferences: [],
    });
  }
  const leaveOut = dropped.length > 0;
  const block = [
    FROZEN_SUMMARY_PLAN_SCAFFOLD.begin,
    leaveOut ? FROZEN_SUMMARY_PLAN_SCAFFOLD.leaveOutPrecedence : FROZEN_SUMMARY_PLAN_SCAFFOLD.precedence,
    leaveOut ? FROZEN_SUMMARY_PLAN_SCAFFOLD.leaveOutFormat : FROZEN_SUMMARY_PLAN_SCAFFOLD.format,
    entries.map((entry) => stableSerialize(entry)).join("\n") ||
      FROZEN_SUMMARY_PLAN_SCAFFOLD.empty,
    FROZEN_SUMMARY_PLAN_SCAFFOLD.end,
  ].join("\n");
  if (utf8Bytes(block) > MAX_SEED_PROMPT_UTF8_BYTES) {
    throw new SeedContextLimitError(
      "prompt_utf8_bytes",
      "Signed-off content plan exceeds the prompt byte budget"
    );
  }
  const checksBlock = serializeFrozenSummaryPlanChecks(checks);
  return { block, checks, checksBlock };
}

export type SeedContextItemKind =
  | "selection"
  | "skip"
  | "feedback"
  | "ownFeedback"
  | "target";

type SeedContextItemBase = {
  roleId: PdSubsectionRoleId;
};

export type SeedSelectionContextItem = SeedContextItemBase & {
  kind: "selection";
  seedId: string;
  bullets: string[];
  /**
   * 2026-09-29 (first): on an experimentation selection, the uncertainty
   * selection the experiment tested, when the Seed records one. Absent on
   * every other role and on experiments written before the rule, so their
   * contribution hashes are unchanged.
   */
  uncertaintySeedId?: string;
};

export type SeedSkipContextItem = SeedContextItemBase & {
  kind: "skip";
};

export type SeedFeedbackContextItem = SeedContextItemBase & {
  kind: "feedback" | "ownFeedback";
  feedbackRequestId: string;
  seedId: string;
  text: string;
};

export type SeedTargetContextItem = SeedContextItemBase & {
  kind: "target";
  feedbackRequestId: string;
  seedId: string;
  bullets: string[];
  text: string;
};

export type SeedContextItem =
  | SeedSelectionContextItem
  | SeedSkipContextItem
  | SeedFeedbackContextItem
  | SeedTargetContextItem;

export type SeedContextSnapshot = {
  v: 1;
  items: SeedContextItem[];
};

export type SeedSelectionRevisionItem = {
  seedId: string;
  bullets: readonly string[];
};

export type MaterializedSeedSelection = {
  roleId: PdSubsectionRoleId;
  seedId: string;
  bullets: readonly string[];
  active: boolean;
  /** 2026-09-29 (first): the uncertainty an experimentation selection tested. */
  uncertaintySeedId?: string;
};

export type MaterializedSeedFeedback = {
  roleId: PdSubsectionRoleId;
  feedbackRequestId: string;
  targetSeedId: string;
  instruction: string;
  status: "active" | "suspendedBySkip" | "withdrawn";
};

export type MaterializedSeedTarget = {
  roleId: PdSubsectionRoleId;
  feedbackRequestId: string;
  targetSeedId: string;
  targetWording: readonly string[];
  instruction: string;
};

export type BuildDispatchSnapshotArgs = {
  targetRoleId: PdSubsectionRoleId;
  selections: readonly MaterializedSeedSelection[];
  skippedRoleIds: readonly PdSubsectionRoleId[];
  feedbackRequests: readonly MaterializedSeedFeedback[];
  target?: MaterializedSeedTarget;
};

export type SeedSubsectionRevisionState = {
  state: "untouched" | "generating" | "in_progress" | "approved" | "skipped" | "failed";
  currentContextRevision: string;
  selectionRevision: string;
  approvedContextRevision?: string;
  approvedSelectionRevision?: string;
};

export type ShownSetSeed = {
  _id: string;
  _creationTime: number;
  roleId: PdSubsectionRoleId;
  batchId: string;
  order: number;
  revisionOfSeedId?: string;
};

export type ShownSetBatch = {
  _id: string;
  _creationTime: number;
};

const ROLE_ORDER = new Map<PdSubsectionRoleId, number>(
  PD_SUBSECTIONS.map((subsection) => [subsection.roleId, subsection.order])
);

const KIND_ORDER: Readonly<Record<SeedContextItemKind, number>> = {
  selection: 0,
  skip: 1,
  feedback: 2,
  ownFeedback: 3,
  target: 4,
};

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON serialization with recursive lexical object-key ordering. */
export function stableSerialize(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function roleOrder(roleId: PdSubsectionRoleId): number {
  const order = ROLE_ORDER.get(roleId);
  if (order === undefined) {
    throw new Error(`Unknown seed role: ${roleId}`);
  }
  return order;
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  const normalizedLeft = left ?? "";
  const normalizedRight = right ?? "";
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function itemSeedId(item: SeedContextItem): string | undefined {
  return "seedId" in item ? item.seedId : undefined;
}

function itemFeedbackRequestId(item: SeedContextItem): string | undefined {
  return "feedbackRequestId" in item ? item.feedbackRequestId : undefined;
}

export function canonicalizeSeedSnapshot(
  snapshot: SeedContextSnapshot
): SeedContextSnapshot {
  const items = snapshot.items.map((item): SeedContextItem => {
    switch (item.kind) {
      case "selection":
        return { ...item, bullets: [...item.bullets] };
      case "target":
        return { ...item, bullets: [...item.bullets] };
      case "skip":
      case "feedback":
      case "ownFeedback":
        return { ...item };
      default: {
        const exhaustive: never = item;
        return exhaustive;
      }
    }
  });
  items.sort((left, right) => {
    return (
      roleOrder(left.roleId) - roleOrder(right.roleId) ||
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      compareOptional(itemSeedId(left), itemSeedId(right)) ||
      compareOptional(itemFeedbackRequestId(left), itemFeedbackRequestId(right))
    );
  });
  return { v: 1, items };
}

/** Resolve a Seed's current writer-visible wording without mutating either row. */
export function materializeFinalWording(
  seed: { _id: string; bullets: readonly string[] },
  selection?: { seedId: string; editedBullets?: readonly string[] }
): string[] {
  if (selection && selection.seedId !== seed._id) {
    throw new Error("Seed selection does not belong to the supplied seed");
  }
  return [...(selection?.editedBullets ?? seed.bullets)];
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export class SeedContextLimitError extends Error {
  readonly limit:
    | "rows"
    | "row_utf8_bytes"
    | "snapshot_utf8_bytes"
    | "prompt_utf8_bytes"
    | "read_bytes"
    | "summary_plan_check_input_utf8_bytes"
    | "summary_self_check_response_utf8_bytes"
    | "summary_self_check_plan_count"
    | "summary_self_check_ordinary_count"
    | "summary_self_check_field_utf8_bytes"
    | "summary_self_check_merge_refs";

  constructor(
    limit: SeedContextLimitError["limit"],
    message: string
  ) {
    super(message);
    this.name = "SeedContextLimitError";
    this.limit = limit;
  }
}

export function assertSeedSnapshotWithinLimits(snapshot: SeedContextSnapshot): void {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  if (canonical.items.length > MAX_SEED_SNAPSHOT_ROWS) {
    throw new SeedContextLimitError(
      "rows",
      `Seed snapshot has more than ${MAX_SEED_SNAPSHOT_ROWS} rows`
    );
  }
  for (const item of canonical.items) {
    if (utf8Bytes(stableSerialize(item)) > MAX_SEED_CONTEXT_ROW_UTF8_BYTES) {
      throw new SeedContextLimitError(
        "row_utf8_bytes",
        `Seed snapshot row for ${item.roleId} exceeds ${MAX_SEED_CONTEXT_ROW_UTF8_BYTES} UTF-8 bytes`
      );
    }
  }
  if (
    utf8Bytes(stableSerialize(canonical)) >
    MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES
  ) {
    throw new SeedContextLimitError(
      "snapshot_utf8_bytes",
      `Seed snapshot exceeds ${MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES} UTF-8 bytes`
    );
  }
}

export function snapshotPromptProjection(snapshot: SeedContextSnapshot): string {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  assertSeedSnapshotWithinLimits(canonical);
  const projection = stableSerialize(canonical);
  if (utf8Bytes(projection) > MAX_SEED_PROMPT_UTF8_BYTES) {
    throw new SeedContextLimitError(
      "prompt_utf8_bytes",
      `Seed prompt projection exceeds ${MAX_SEED_PROMPT_UTF8_BYTES} UTF-8 bytes`
    );
  }
  return projection;
}

export function assertSeedPromptWithinLimit(prompt: string): void {
  if (utf8Bytes(prompt) > MAX_SEED_PROMPT_UTF8_BYTES) {
    throw new SeedContextLimitError(
      "prompt_utf8_bytes",
      `Seed prompt exceeds ${MAX_SEED_PROMPT_UTF8_BYTES} UTF-8 bytes`
    );
  }
}

function buildDecisionSnapshot(args: BuildDispatchSnapshotArgs): SeedContextSnapshot {
  const targetOrder = roleOrder(args.targetRoleId);
  const skipped = new Set(args.skippedRoleIds);
  const items: SeedContextItem[] = [];

  for (const selection of args.selections) {
    if (
      selection.active &&
      !skipped.has(selection.roleId) &&
      roleOrder(selection.roleId) < targetOrder
    ) {
      items.push({
        kind: "selection",
        roleId: selection.roleId,
        seedId: selection.seedId,
        bullets: [...selection.bullets],
        ...(selection.roleId === "experimentation" && selection.uncertaintySeedId
          ? { uncertaintySeedId: selection.uncertaintySeedId }
          : {}),
      });
    }
  }
  for (const roleId of skipped) {
    if (roleOrder(roleId) < targetOrder) {
      items.push({ kind: "skip", roleId });
    }
  }
  for (const feedback of args.feedbackRequests) {
    if (feedback.status !== "active" || skipped.has(feedback.roleId)) continue;
    const order = roleOrder(feedback.roleId);
    if (order < targetOrder) {
      items.push({
        kind: "feedback",
        roleId: feedback.roleId,
        feedbackRequestId: feedback.feedbackRequestId,
        seedId: feedback.targetSeedId,
        text: feedback.instruction,
      });
    } else if (feedback.roleId === args.targetRoleId) {
      items.push({
        kind: "ownFeedback",
        roleId: feedback.roleId,
        feedbackRequestId: feedback.feedbackRequestId,
        seedId: feedback.targetSeedId,
        text: feedback.instruction,
      });
    }
  }
  if (args.target) {
    if (args.target.roleId !== args.targetRoleId) {
      throw new Error("Feedback target role does not match the dispatch role");
    }
    items.push({
      kind: "target",
      roleId: args.target.roleId,
      feedbackRequestId: args.target.feedbackRequestId,
      seedId: args.target.targetSeedId,
      bullets: [...args.target.targetWording],
      text: args.target.instruction,
    });
  }

  return canonicalizeSeedSnapshot({ v: 1, items });
}

/** Complete decision materialization. It intentionally has no prompt row ceiling. */
export function buildCompleteDecisionSnapshot(
  args: BuildDispatchSnapshotArgs
): SeedContextSnapshot {
  return buildDecisionSnapshot(args);
}

/** Model-dispatch materialization, retaining Story 2's prompt safety limits. */
export function buildDispatchSnapshot(args: BuildDispatchSnapshotArgs): SeedContextSnapshot {
  const snapshot = buildDecisionSnapshot(args);
  assertSeedSnapshotWithinLimits(snapshot);
  return snapshot;
}

export async function contributionHashes(
  snapshot: SeedContextSnapshot
): Promise<ReadonlyMap<PdSubsectionRoleId, string>> {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  const entries = await Promise.all(
    PD_SUBSECTIONS.map(async ({ roleId }) => {
      const roleSnapshot: SeedContextSnapshot = {
        v: 1,
        items: canonical.items.filter(
          (item) => item.roleId === roleId && item.kind !== "target"
        ),
      };
      return [roleId, await sha256Text(stableSerialize(roleSnapshot))] as const;
    })
  );
  return new Map(entries);
}

/** Complete per-role decision hashes, independent of model snapshot ceilings. */
export const completeContributionHashes = contributionHashes;

export async function completeContextRevision(
  snapshot: SeedContextSnapshot
): Promise<string> {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  return await sha256Text(
    stableSerialize({
      v: 1,
      items: canonical.items.filter((item) => item.kind !== "target"),
    })
  );
}

export async function contextRevision(
  snapshot: SeedContextSnapshot
): Promise<string> {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  assertSeedSnapshotWithinLimits(canonical);
  return await completeContextRevision(canonical);
}

export async function selectionRevision(
  items: readonly SeedSelectionRevisionItem[]
): Promise<string> {
  const canonical = items
    .map((item) => ({ seedId: item.seedId, bullets: [...item.bullets] }))
    .sort((left, right) => compareOptional(left.seedId, right.seedId));
  return await sha256Text(stableSerialize(canonical));
}

export const EMPTY_CONTEXT_REVISION =
  "47554e39810a156dac952dd31d88a8fcd8760cf91d73b5b844b4eccb2a9a06e4";
export const EMPTY_SELECTION_REVISION =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

export async function emptyContextRevision(): Promise<string> {
  return await contextRevision({ v: 1, items: [] });
}

export async function emptySelectionRevision(): Promise<string> {
  return await selectionRevision([]);
}

export function isSeedSubsectionStale(
  subsection: SeedSubsectionRevisionState
): boolean {
  return (
    subsection.state === "approved" &&
    (subsection.approvedContextRevision !== subsection.currentContextRevision ||
      subsection.approvedSelectionRevision !== subsection.selectionRevision)
  );
}

export type SeedContributionExplanation = {
  changedRoleIds: PdSubsectionRoleId[];
  restored: boolean;
};

/**
 * Compare immutable consumed/approved contributions with the current ones.
 * `previousCurrent` lets a caller identify the R0 -> R1 -> R0 restoration
 * without treating the restored role as changed.
 */
export function explainChange(
  snapshot: ReadonlyMap<PdSubsectionRoleId, string>,
  current: ReadonlyMap<PdSubsectionRoleId, string>,
  previousCurrent?: ReadonlyMap<PdSubsectionRoleId, string>
): SeedContributionExplanation {
  const changedRoleIds = PD_SUBSECTIONS
    .map(({ roleId }) => roleId)
    .filter(
      (roleId) =>
        (snapshot.get(roleId) ?? EMPTY_CONTEXT_REVISION) !==
        (current.get(roleId) ?? EMPTY_CONTEXT_REVISION)
    );
  const restored =
    previousCurrent !== undefined &&
    changedRoleIds.length === 0 &&
    PD_SUBSECTIONS.some(
      ({ roleId }) =>
        (previousCurrent.get(roleId) ?? EMPTY_CONTEXT_REVISION) !==
        (current.get(roleId) ?? EMPTY_CONTEXT_REVISION)
    );
  return { changedRoleIds, restored };
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Shared Shown Set/Summary ordering from AD-37 and AD-44. */
export function orderShownSet<Seed extends ShownSetSeed>(args: {
  seeds: readonly Seed[];
  batches: readonly ShownSetBatch[];
}): Seed[] {
  const byId = new Map(args.seeds.map((seed) => [seed._id, seed]));
  const batchCreatedAt = new Map(
    args.batches.map((batch) => [batch._id, batch._creationTime])
  );
  const rootBySeedId = new Map<string, string>();

  for (const seed of args.seeds) {
    const seen = new Set<string>([seed._id]);
    let current = seed;
    let rootId = seed._id;
    while (current.revisionOfSeedId) {
      rootId = current.revisionOfSeedId;
      if (seen.has(rootId)) break;
      seen.add(rootId);
      const parent = byId.get(rootId);
      if (!parent) break;
      current = parent;
    }
    rootBySeedId.set(seed._id, rootId);
  }

  function creationTime(seed: Seed): number {
    return batchCreatedAt.get(seed.batchId) ?? seed._creationTime;
  }

  const groupAnchor = new Map<string, Seed>();
  for (const seed of args.seeds) {
    const rootId = rootBySeedId.get(seed._id) ?? seed._id;
    const root = byId.get(rootId);
    const candidate = root ?? seed;
    const existing = groupAnchor.get(rootId);
    if (
      !existing ||
      creationTime(candidate) < creationTime(existing) ||
      (creationTime(candidate) === creationTime(existing) &&
        (candidate.order < existing.order ||
          (candidate.order === existing.order && candidate._id < existing._id)))
    ) {
      groupAnchor.set(rootId, candidate);
    }
  }

  return [...args.seeds].sort((left, right) => {
    const leftRoot = rootBySeedId.get(left._id) ?? left._id;
    const rightRoot = rootBySeedId.get(right._id) ?? right._id;
    const leftAnchor = groupAnchor.get(leftRoot) ?? left;
    const rightAnchor = groupAnchor.get(rightRoot) ?? right;
    const groupOrder =
      roleOrder(leftAnchor.roleId) - roleOrder(rightAnchor.roleId) ||
      creationTime(leftAnchor) - creationTime(rightAnchor) ||
      leftAnchor.order - rightAnchor.order ||
      compareText(leftRoot, rightRoot);
    if (groupOrder !== 0) return groupOrder;
    return (
      Number(left._id !== leftRoot) - Number(right._id !== rightRoot) ||
      creationTime(left) - creationTime(right) ||
      left.order - right.order ||
      compareText(left._id, right._id)
    );
  });
}

export type EncodedSeedBatchContextRow = {
  roleId: PdSubsectionRoleId;
  sourceRoleId: PdSubsectionRoleId;
  kind: SeedContextItemKind;
  seedId?: string;
  /** 2026-09-29 (first): the uncertainty an experimentation selection tested. */
  uncertaintySeedId?: string;
  feedbackRequestId?: string;
  bullets?: string[];
  text?: string;
  order: number;
  contributionHash: string;
};

export async function encodeBatchContext(
  snapshot: SeedContextSnapshot,
  args: { targetRoleId: PdSubsectionRoleId }
): Promise<EncodedSeedBatchContextRow[]> {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  assertSeedSnapshotWithinLimits(canonical);
  const hashes = await contributionHashes(canonical);
  return canonical.items.map((item, order) => {
    const base = {
      roleId: args.targetRoleId,
      sourceRoleId: item.roleId,
      kind: item.kind,
      order,
      contributionHash: hashes.get(item.roleId) ?? "",
    };
    switch (item.kind) {
      case "selection":
        return {
          ...base,
          seedId: item.seedId,
          bullets: [...item.bullets],
          ...(item.uncertaintySeedId ? { uncertaintySeedId: item.uncertaintySeedId } : {}),
        };
      case "skip":
        return base;
      case "feedback":
      case "ownFeedback":
        return {
          ...base,
          feedbackRequestId: item.feedbackRequestId,
          seedId: item.seedId,
          text: item.text,
        };
      case "target":
        return {
          ...base,
          feedbackRequestId: item.feedbackRequestId,
          seedId: item.seedId,
          bullets: [...item.bullets],
          text: item.text,
        };
      default: {
        const exhaustive: never = item;
        return exhaustive;
      }
    }
  });
}

type SeedBatchContextRowLike = EncodedSeedBatchContextRow & {
  _creationTime?: number;
};

export function decodeBatchContext(
  rows: readonly SeedBatchContextRowLike[]
): SeedContextSnapshot {
  const ordered = [...rows].sort(
    (left, right) =>
      left.order - right.order ||
      (left._creationTime ?? 0) - (right._creationTime ?? 0)
  );
  const items = ordered.map((row): SeedContextItem => {
    switch (row.kind) {
      case "selection":
        if (!row.seedId || !row.bullets) {
          throw new Error("Malformed selection seed context row");
        }
        return {
          kind: row.kind,
          roleId: row.sourceRoleId,
          seedId: row.seedId,
          bullets: [...row.bullets],
          ...(row.uncertaintySeedId ? { uncertaintySeedId: row.uncertaintySeedId } : {}),
        };
      case "skip":
        return { kind: row.kind, roleId: row.sourceRoleId };
      case "feedback":
      case "ownFeedback":
        if (!row.feedbackRequestId || !row.seedId || row.text === undefined) {
          throw new Error("Malformed feedback seed context row");
        }
        return {
          kind: row.kind,
          roleId: row.sourceRoleId,
          feedbackRequestId: row.feedbackRequestId,
          seedId: row.seedId,
          text: row.text,
        };
      case "target":
        if (
          !row.feedbackRequestId ||
          !row.seedId ||
          !row.bullets ||
          row.text === undefined
        ) {
          throw new Error("Malformed target seed context row");
        }
        return {
          kind: row.kind,
          roleId: row.sourceRoleId,
          feedbackRequestId: row.feedbackRequestId,
          seedId: row.seedId,
          bullets: [...row.bullets],
          text: row.text,
        };
      default: {
        const exhaustive: never = row.kind;
        return exhaustive;
      }
    }
  });
  const snapshot = canonicalizeSeedSnapshot({ v: 1, items });
  assertSeedSnapshotWithinLimits(snapshot);
  return snapshot;
}

export function contributionHashesFromRows(
  rows: readonly SeedBatchContextRowLike[]
): Map<PdSubsectionRoleId, string> {
  const hashes = new Map<PdSubsectionRoleId, string>();
  for (const row of rows) {
    const existing = hashes.get(row.sourceRoleId);
    if (existing !== undefined && existing !== row.contributionHash) {
      throw new Error(`Conflicting contribution hash for ${row.sourceRoleId}`);
    }
    hashes.set(row.sourceRoleId, row.contributionHash);
  }
  return hashes;
}
