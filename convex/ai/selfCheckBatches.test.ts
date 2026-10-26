/**
 * 2026-10-26 (P0 item 2; owner: check big Lines in batches instead of
 * refusing): a Line whose Summary Self-check does not fit one request is
 * checked in the requests planSummarySelfCheckBatches plans. These tests
 * drive runModelSelfCheck with a client that answers each request for
 * exactly the labels and plan checks its checklist lists.
 */
import { describe, expect, it, vi } from "vitest";
import {
  runModelSelfCheck,
  NOT_CHECKED_REASON,
  type SelfCheckModelInput,
  type SelfCheckPlanCheck,
} from "./selfCheck";
import { OutputLimitError, type GenerationClient, type GenerationMessageParams } from "./openrouterCore";
import { ActionTimeBudgetError } from "./actionDeadline";
import { SUMMARY_PLAN_SELF_CHECK_REQUEST } from "./promptDefinitions";
import {
  FACTS_MATCH_SOURCES_RULE_ID,
  planSummarySelfCheckBatches,
  projectFrozenSummaryPlanChecks,
  projectSummaryOrdinaryChecks,
} from "../lib/seedRevisions";

const RULES = 70;

const items: SelfCheckPlanCheck[] = ["a", "b", "c"].map((letter) => ({
  itemId: `item-${letter}`,
  roleId: "active_uncertainties",
  mergedItemIds: [`item-${letter}`],
  instruction: "cover",
  confirmedExclusion: false,
  support: "source_supported",
  wording: [`Uncertainty ${letter}.`],
  relationshipReferences: [],
  sourceReferences: [],
}));
const facts: SelfCheckPlanCheck = {
  ruleId: FACTS_MATCH_SOURCES_RULE_ID,
  roleId: "active_uncertainties",
  mergedItemIds: [],
  instruction: "match_sources",
  confirmedExclusion: false,
  wording: [],
  relationshipReferences: [],
  sourceReferences: [],
};
const planChecks = [...items, facts];

const input: SelfCheckModelInput = {
  section: "242",
  text: "One paragraph states the uncertainty.",
  storylineText: "Frozen storyline.",
  confidenceMap: [{ text: "Confidence entry.", confidence: "partial" }],
  glossaryCandidates: [],
  rules: Array.from({ length: RULES }, (_, index) => ({ instruction: `Rule ${index + 1}.` })),
  model: "claude-sonnet-5",
  planChecks,
  planChecksBlock: projectFrozenSummaryPlanChecks(planChecks),
  sourceFacts: { body: "The trial ran at 8 degrees C.", documentsComplete: true, items: [] } as never,
};

const ordinary = projectSummaryOrdinaryChecks({
  storylineText: input.storylineText,
  confidenceMap: input.confidenceMap,
  glossaryTerms: [],
  rules: input.rules,
});
const batches = planSummarySelfCheckBatches({ ordinaryChecks: ordinary, planChecks, includeStorylineQuestion: true });

/** The labels and plan ids a request's checklist lists, in order. */
function listed(params: GenerationMessageParams) {
  const user = params.messages[0]!.content;
  const text = typeof user === "string" ? user : user.map((block) => ("text" in block ? block.text : "")).join("");
  const labels = [...text.matchAll(/^- (\S+) \(check (\w+)\)$/gm)].map(([, label, check]) => ({ label: label!, check: check! }));
  const items = [...text.matchAll(/^- itemId (\S+)$/gm)].map(([, id]) => id!);
  const rules = [...text.matchAll(/^- ruleId (\S+)$/gm)].map(([, id]) => id!);
  return { text, labels, items, rules };
}

type Answer = { verdicts: unknown[]; planVerdicts: unknown[]; storylineQuestion?: unknown };

/** A complete answer for what the request lists, every check applied. */
function answerFor(params: GenerationMessageParams): Answer {
  const { labels, items, rules } = listed(params);
  return {
    verdicts: labels.map(({ label, check }) => ({ paragraph: 1, check, instruction: label, outcome: "applied", reason: "Applied." })),
    planVerdicts: [
      ...items.map((itemId) => ({ itemId, paragraph: 1, outcome: "applied", reason: "Applied." })),
      ...rules.map((ruleId) => ({ ruleId, paragraph: 1, outcome: "applied", reason: "Applied.", findings: [] })),
    ],
  };
}

function toolReply(params: GenerationMessageParams, input: unknown, stopReason = "tool_use") {
  return {
    content: [{ type: "tool_use" as const, id: "self-check", name: params.tool_choice?.name ?? "submit_self_check", input }],
    stop_reason: stopReason,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

/** A client whose `n`th request (0-based, in send order) may answer differently. */
function client(answer: (params: GenerationMessageParams, index: number) => unknown) {
  let sent = 0;
  const create = vi.fn(async (params: GenerationMessageParams) => answer(params, sent++));
  return { create, client: { messages: { create } } as unknown as GenerationClient };
}

describe("a Line checked in several requests (2026-10-26)", () => {
  it("is split as sign-off admitted it: two requests, the rules and the Storyline question in the first", () => {
    expect(ordinary).toHaveLength(RULES + 2);
    expect(batches).toHaveLength(2);
    expect(batches[0]!.planChecks[0]).toBe(facts);
    expect(batches[0]!.includeStorylineQuestion).toBe(true);
    expect(batches[1]!.includeStorylineQuestion).toBe(false);
  });

  it("sends each request only its own labels, plan checks and rules, and merges the verdicts in the Line's order", async () => {
    const { create, client: fake } = client((params, index) => ({
      ...toolReply(params, {
        ...answerFor(params),
        ...(index === 0
          ? { storylineQuestion: { question: "Which?", sectionClaim: "Claim.", confidenceEntry: 1, storylineAlternative: "Alt." } }
          : {}),
      }),
    }));
    const result = await runModelSelfCheck(fake, input);

    expect(create).toHaveBeenCalledTimes(2);
    const requests = create.mock.calls.map(([params]) => listed(params));
    // Every label and plan check is asked exactly once, by its own request.
    expect(requests.map((request) => request.labels.map((entry) => entry.label))).toEqual(
      batches.map((batch) => batch.ordinaryChecks.map((check) => check.label))
    );
    expect(requests.map((request) => request.items)).toEqual(
      batches.map((batch) => batch.planChecks.flatMap((check) => (check.itemId ? [check.itemId] : [])))
    );
    expect(requests.map((request) => request.rules)).toEqual([[FACTS_MATCH_SOURCES_RULE_ID], []]);
    // The sources and the facts rule come only with the facts check.
    expect(requests[0]!.text).toContain("[SOURCE FACTS]");
    expect(requests[1]!.text).not.toContain("[SOURCE FACTS]");
    // Each request says it is one of several; inline labels mark only its own.
    for (const [index, request] of requests.entries()) {
      expect(request.text).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.batchRequest.note);
      const own = new Set(batches[index]!.ordinaryChecks.map((check) => check.label));
      const marked = [...request.text.matchAll(/\[(rule:R\d+)\] \[R\d+\]/g)].map(([, label]) => label!);
      expect(marked.length).toBeGreaterThan(0);
      expect(marked.every((label) => own.has(label))).toBe(true);
    }
    // The second request lists no rule, so its CONTENT PLAN CHECKS block
    // holds only its own items.
    expect(requests[1]!.text).not.toContain(FACTS_MATCH_SOURCES_RULE_ID);
    // Merged in the Line's order, every label checked, nothing not checked.
    expect(result.verdicts.map((verdict) => verdict.notChecked ?? false)).toEqual(ordinary.map(() => false));
    expect(result.verdicts.map((verdict) => verdict.instruction)).toEqual(ordinary.map((check) => check.instruction));
    expect(result.planVerdicts.map((verdict) => verdict.itemId ?? verdict.ruleId)).toEqual(
      planChecks.map((check) => check.itemId ?? check.ruleId)
    );
    expect(result.storylineQuestion).toMatchObject({ question: "Which?" });
  });

  it("drops a verdict for a label another request lists without counting it as invalid", async () => {
    const all = ordinary.map((check) => ({ paragraph: 1, check: check.check, instruction: check.label, outcome: "applied", reason: "Applied." }));
    const { client: fake } = client((params) => {
      const own = answerFor(params);
      // Every label of the Line, in each answer: without the rule, the 64
      // foreign labels would outnumber the request's own and reject it.
      return toolReply(params, { ...own, verdicts: all });
    });
    const result = await runModelSelfCheck(fake, input);
    expect(result.verdicts.filter((verdict) => verdict.notChecked)).toEqual([]);
    expect(result.verdicts).toHaveLength(ordinary.length);
  });

  it("leaves only an unusable request's labels and plan checks not checked", async () => {
    const { client: fake } = client((params) => {
      // The request without the facts rule is cut off at its output limit.
      if (!listed(params).rules.length) return toolReply(params, { verdicts: [], planVerdicts: [] }, "max_tokens");
      return toolReply(params, answerFor(params));
    });
    const result = await runModelSelfCheck(fake, input);
    const second = new Set(batches[1]!.ordinaryChecks.map((check) => check.instruction));
    const notChecked = result.verdicts.filter((verdict) => verdict.notChecked);
    expect(notChecked.map((verdict) => verdict.instruction).sort()).toEqual([...second].sort());
    expect(notChecked.every((verdict) => verdict.reason === NOT_CHECKED_REASON)).toBe(true);
    const checked = result.verdicts.filter((verdict) => !verdict.notChecked);
    expect(checked).toHaveLength(batches[0]!.ordinaryChecks.length);
    // The second request's items are not checked; the first request's facts verdict stands.
    for (const itemId of batches[1]!.planChecks.flatMap((check) => (check.itemId ? [check.itemId] : []))) {
      expect(result.planVerdicts.find((verdict) => verdict.itemId === itemId)?.reason).not.toBe("Applied.");
    }
  });

  it("fails the whole check when every request is unusable", async () => {
    const { client: fake } = client((params) => toolReply(params, { verdicts: [], planVerdicts: [] }, "max_tokens"));
    await expect(runModelSelfCheck(fake, input)).rejects.toBeInstanceOf(OutputLimitError);
  });

  it("fails the whole check on any other failure, after every request has settled", async () => {
    let settled = 0;
    const { create, client: fake } = client(async (params) => {
      if (!listed(params).rules.length) throw new ActionTimeBudgetError();
      await new Promise((resolve) => setTimeout(resolve, 5));
      settled += 1;
      return toolReply(params, answerFor(params));
    });
    await expect(runModelSelfCheck(fake, input)).rejects.toBeInstanceOf(ActionTimeBudgetError);
    expect(create).toHaveBeenCalledTimes(2);
    expect(settled).toBe(1);
  });
});

describe("a follow-up's failure (2026-10-26, round 2 design review)", () => {
  // A Line that fits one request: the first answer misses one label.
  const small: SelfCheckModelInput = { ...input, rules: input.rules.slice(0, 3) };

  it("leaves the missing labels not checked when the follow-up's answer is unusable", async () => {
    const { client: fake } = client((params, index) => {
      const answer = answerFor(params);
      if (index === 0) return toolReply(params, { ...answer, verdicts: answer.verdicts.slice(1) });
      return toolReply(params, { verdicts: [], planVerdicts: [] }, "max_tokens");
    });
    const result = await runModelSelfCheck(fake, small);
    expect(result.verdicts.filter((verdict) => verdict.notChecked).map((verdict) => verdict.instruction)).toEqual(["Storyline"]);
  });

  it("fails the whole check when the follow-up runs out of time, as a first answer would", async () => {
    const { create, client: fake } = client((params, index) => {
      const answer = answerFor(params);
      if (index === 0) return toolReply(params, { ...answer, verdicts: answer.verdicts.slice(1) });
      throw new ActionTimeBudgetError();
    });
    await expect(runModelSelfCheck(fake, small)).rejects.toBeInstanceOf(ActionTimeBudgetError);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
