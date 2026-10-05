/// <reference types="vite/client" />
/**
 * 2026-09-30 (third): results stated as the numbers show, no talk about
 * sources, and cleaner Glossary repairs.
 *
 * Release suite runs 6, 10 and 11: Line 246 called 97.8 percent and 2.6
 * percent rejects "close to but not exceeding" the 97 and 3 percent targets
 * they met; Confidence Map repairs wrote "the test memo indicates" and "The
 * two interviewees describe ..." into the prose; a Glossary repair wrote
 * "capture more fine inclusion capture".
 *
 * Every test drafts one Section through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed. The data is fictional (the Pellow abrasive finishing cell).
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import { draftCheckedSection, reportFactsBlock, TARGETS_INSTRUCTION } from "./ai/orderedGeneration";
import {
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
} from "./ai/promptDefinitions";
import { SELF_CHECK_SYSTEM_PROMPT, SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT } from "./ai/prompts";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { buildFrozenSummaryPlan, RESULTS_AGAINST_TARGETS_RULE_ID } from "./lib/seedRevisions";
import { renderBriefBlock } from "./lib/briefRender";
import type { OrderedPayload, SectionNumber } from "./lib/orderedChain";
import { RULES_REPORT_FACTS, SOURCE_TALK, TARGET_MET_RULE } from "../shared/humanProse";

const modules = import.meta.glob("./**/*.ts");
const SONNET = "claude-sonnet-5";
const SUMMARY_VERSION = "summary-version-pellow" as Id<"summaryVersions">;

beforeAll(async () => {
  await import("./modelCatalog");
  await import("./providerCredit");
});
beforeEach(() => {
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── The fictional Pellow plan and Brief ───────────────────────────────────

const ITEM_ADVANCE = "item-pellow-advance" as Id<"summaryItems">;
const STORYLINE = "The cell met its yield and scrap targets once pad pressure was set per zone.";
const CONFIDENCE = [
  { text: "The 95 percent yield target was not fully met in trial two, only approached", confidence: "partial" },
  { text: "The scrap figure after the wear check is given only in the test memo", confidence: "partial" },
];
const GLOSSARY = ["pad pressure map"];
const BRIEF = {
  storylineText: STORYLINE,
  claimExclusions: [],
  confidenceMap: CONFIDENCE.map((entry, index) => ({ ...entry, entryId: `entry-${index}` })),
  glossaryTerms: GLOSSARY,
};
const BRIEF_BLOCK = renderBriefBlock(STORYLINE, [
  ...CONFIDENCE.map((entry) => ({ group: "confidenceMap" as const, ...entry })),
  ...GLOSSARY.map((text) => ({ group: "glossaryTerm" as const, text })),
]);

const DRAFT_246 = [
  "The objective was met. Trial four reached 96.4 percent yield and 1.6 percent scrap, close to but not exceeding the 95 percent and 2 percent targets.",
  "Over 300 parts, the test memo indicates scrap held at 1.5 percent.",
  "The pressure table set pad force per zone.",
].join("\n\n");
const REPAIRED_246 = [
  "The objective was met. Trial four reached 96.4 percent yield and 1.6 percent scrap, meeting the 95 percent yield target and the 2 percent scrap limit.",
  "Over 300 parts, scrap held at about 1.5 percent, a figure not confirmed by a second count.",
  "The pad pressure map set pad force per zone.",
].join("\n\n");

const ANALYSIS = {
  company_context: "A fictional maker of abrasive finishing cells",
  project_goal: "At least 95 percent yield with scrap under 2 percent",
  business_problem: "Manual sanding scrapped 6 percent of parts",
  scientific_technical_problem: "No pad pressure rule held yield across part zones",
  technological_objective: "A per-zone pad pressure method",
  work_performed: {},
  project_status: "completed",
};

function payload(summaryVersionId?: Id<"summaryVersions">): OrderedPayload {
  return {
    analysis: JSON.stringify(ANALYSIS),
    brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
    orderedContext: {
      profileState: "missing",
      categoryOutcomes: [],
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    },
    frozenStyleGuidance: "",
    ...(summaryVersionId ? { summaryVersionId } : {}),
  } as OrderedPayload;
}

function plan246() {
  return buildFrozenSummaryPlan({
    section: "s246",
    items: [{
      itemId: ITEM_ADVANCE,
      roleId: "overall_advancement",
      kind: "standard",
      bullets: ["Per-zone pad pressure lifted yield to 96.4 percent with 1.6 percent scrap."],
      support: "source_supported",
    }],
    skippedRoleIds: [],
    resultsAgainstTargets: true,
  });
}

function claimFor(plan?: ReturnType<typeof plan246>, planWording?: string[][]) {
  return {
    projectId: "project-pellow",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 2,
    isFirstInOrder: false,
    priorSections: [],
    briefBlock: BRIEF_BLOCK,
    brief: BRIEF,
    planBlock: plan ? `\n\n${plan.block}` : "",
    planChecksBlock: plan?.checksBlock ?? "",
    planChecks: plan?.checks ?? [],
    editedTerms: [],
    droppedNotChecked: [],
    answers242: null,
    ...(planWording ? { planWording } : {}),
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

// ─── The stubbed provider ──────────────────────────────────────────────────

type Sent = { stage: string; json: Record<string, unknown>; user: string; system: string };

function userOf(json: Record<string, unknown>): string {
  const messages = (json.messages ?? []) as Array<{ role: string; content: unknown }>;
  return messages
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((block: { text?: string }) => block.text ?? "").join("")
          : "")
    .join("\n");
}
function systemOf(json: Record<string, unknown>): string {
  const system = json.system as string | Array<{ text?: string }> | undefined;
  return typeof system === "string" ? system : (system ?? []).map((block) => block.text ?? "").join("");
}

/** Scripts one Section: the draft, the repair, the compression and each Self-check answer, in order. */
function installFetch(script: { draft: string; repair?: string; compressed?: string; checks: unknown[] }): Sent[] {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const json = JSON.parse(await request.text()) as Record<string, unknown>;
      const user = userOf(json);
      const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
      const stage = tool === "submit_self_check"
        ? user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction) ? "finalCoverage" : "selfCheck"
        : tool ?? (user.includes(COMPRESSION_REQUEST.userScaffold.wordsToLimit)
          ? "compression"
          : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
      sent.push({ stage, json, user, system: systemOf(json) });
      const base = {
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: json.model,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
      };
      if (tool === "submit_self_check") {
        const answer = checks.shift();
        if (answer === undefined) throw new Error("No Self-check answer scripted");
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: "toolu_self_check", name: tool, input: answer }],
          stop_reason: "tool_use",
        });
      }
      if (tool) throw new Error(`Unexpected tool ${tool}`);
      const text = stage === "repair"
        ? script.repair ?? script.draft
        : stage === "compression" ? script.compressed ?? script.draft : script.draft;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

async function draft(section: SectionNumber, claim: ReturnType<typeof claimFor>, summaryVersionId?: Id<"summaryVersions">) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({ claim, payload: payload(summaryVersionId), section, clientFor });
  });
}

// The Summary Self-check's answers, label by label.
const ordinary = {
  storyline: { paragraph: 0, check: "storyline", instruction: "storyline", outcome: "applied", reason: "Matches the Storyline." },
  c1: { paragraph: 0, check: "confidence", instruction: "confidence:C1", outcome: "applied", reason: "Trial two is not stated." },
  c2: {
    paragraph: 2,
    check: "confidence",
    instruction: "confidence:C2",
    outcome: "not_applied",
    reason: "P2 states the memo figure flatly.",
    repairGuidance: "Hedge the scrap figure.",
  },
  g1: {
    paragraph: 3,
    check: "glossary",
    instruction: "glossary:G1",
    outcome: "not_applied",
    reason: "P3 says pressure table.",
    repairGuidance: "Replace pressure table.",
  },
};
const covered = { itemId: ITEM_ADVANCE, mergedItemIds: [ITEM_ADVANCE], paragraph: 1, outcome: "applied", reason: "P1 states the result." };
const targetsMissed = {
  ruleId: RESULTS_AGAINST_TARGETS_RULE_ID,
  mergedItemIds: [],
  paragraph: 1,
  outcome: "not_applied",
  reason: "P1 calls met targets close.",
  repairGuidance: "Say 96.4% met the 95% target and 1.6% met the 2% limit.",
};
const targetsMet = { ruleId: RESULTS_AGAINST_TARGETS_RULE_ID, mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Every comparison matches." };

describe("results, sources and Glossary repairs in a signed-off plan run (real SDK, fetch stubbed)", () => {
  it("drafts with the report-text rules after the Brief, checks the targets, and repairs source talk, the hedge, the Glossary Term and the misstated result", async () => {
    const sent = installFetch({
      draft: DRAFT_246,
      repair: REPAIRED_246,
      checks: [
        { verdicts: Object.values(ordinary), planVerdicts: [covered, targetsMissed] },
        { verdicts: [], planVerdicts: [covered, targetsMet] },
      ],
    });
    const result = await draft("246", claimFor(plan246()), SUMMARY_VERSION);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(REPAIRED_246);

    // Drafting: the rules of shared/humanProse.ts once, right after the Brief.
    const drafting = sent[0]!.user;
    expect(reportFactsBlock()).toBe(`\n\n# ${RULES_REPORT_FACTS}${ORDERED_PROMPT_SCAFFOLDS.reportFacts.brief}`);
    // 2026-10-04 (second, round 4): a Line with the targets check also gets
    // the rule that a target is met only as the sources state it.
    expect(reportFactsBlock(true)).toBe(`\n\n# ${RULES_REPORT_FACTS}\nTargets met, as the sources state them:\n- ${TARGET_MET_RULE}${ORDERED_PROMPT_SCAFFOLDS.reportFacts.brief}`);
    expect(drafting.split(reportFactsBlock(true))).toHaveLength(2);
    expect(drafting).toContain(`${BRIEF_BLOCK}${reportFactsBlock(true)}\n\n# LENGTH (Locked Rule, outranks the plan)`);

    // The Self-check: the Summary rules, the targets check, its rule and schema.
    const check = sent[1]!;
    expect(check.system).toBe(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT);
    expect(check.user).toContain(`"instruction":"match_targets","mergedItemIds":[],"relationshipReferences":[],"roleId":"overall_advancement","ruleId":"results_against_targets"`);
    expect(check.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.resultsAgainstTargets.instruction);
    expect(check.user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.answers242.instruction);
    expect(check.user.endsWith(
      `Return exactly 2 planVerdicts, one for each plan check below:\n- itemId ${ITEM_ADVANCE}\n- ruleId results_against_targets`
    )).toBe(true);
    const tool = (check.json.tools as Array<{ input_schema: { properties: { planVerdicts: { items: { properties: Record<string, { enum?: string[] }>; oneOf: unknown[] } } } } }>)[0]!;
    expect(tool.input_schema.properties.planVerdicts.items.properties.ruleId?.enum).toEqual(["results_against_targets"]);

    // The repair: each fix with its fixed start, the rules again after the Brief.
    const repair = sent[2]!.user;
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.repairGuidance;
    expect(repair).toContain(`- Paragraph 2: ${SOURCE_TALK.fix} ("the test memo indicates"). ${SOURCE_TALK.rule}`);
    expect(repair).toContain(`- Paragraph 2: ${scaffold.hedgeIssue}Hedge the scrap figure.`);
    expect(repair).toContain(`- Paragraph 3: ${scaffold.glossaryIssuePrefix}"pad pressure map"${scaffold.glossaryIssueSuffix}Replace pressure table.`);
    expect(repair).toContain(`- Paragraph 1: ${scaffold.targetsIssue}Say 96.4% met the 95% target and 1.6% met the 2% limit.`);
    expect(repair.split(reportFactsBlock(true))).toHaveLength(2);
    expect(scaffold.targetsIssue).toContain(TARGET_MET_RULE);

    // The final coverage check judges the targets again on the final text.
    expect(sent[3]!.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.resultsAgainstTargets.instruction);

    const rows = result.notes;
    expect(rows.find((row) => row.instruction === SOURCE_TALK.instruction)).toEqual({
      section: "246",
      source: "deterministic",
      instruction: SOURCE_TALK.instruction,
      outcome: "applied",
      tier: "none",
      reason: `${SOURCE_TALK.applied}; repaired`,
      repaired: true,
    });
    expect(rows.find((row) => row.planRef?.ruleId === RESULTS_AGAINST_TARGETS_RULE_ID)).toEqual({
      section: "246",
      source: "model",
      instruction: TARGETS_INSTRUCTION,
      outcome: "applied",
      tier: "none",
      // Round 4: a targets row a repair fixed still says what was wrong.
      reason: "Fixed by the repair: P1 calls met targets close. Every comparison matches.",
      repaired: true,
      planRef: { summaryVersionId: SUMMARY_VERSION, ruleId: RESULTS_AGAINST_TARGETS_RULE_ID, mergedItemIds: [] },
    });
    expect(rows.find((row) => row.source === "model" && row.instruction === "Glossary Term: pad pressure map"))
      .toMatchObject({ outcome: "applied", repaired: true, reason: "P3 says pressure table.; repaired to the Glossary Term" });
    expect(JSON.parse(result.selfCheck).planCoverage).toEqual({ status: "complete", applied: 2, total: 2 });
  });

  it("names the source talk a repair left in, and never makes its fix a Must keep line of the repair's compression", async () => {
    const filler = (index: number) =>
      `Paragraph ${index}: the cell sanded each zone of the housing at a set pad pressure and the finish was measured on every part, comparing each zone with the baseline and noting where the finish changed.`;
    const longRepair = [REPAIRED_246, ...Array.from({ length: 30 }, (_, index) => filler(index + 4))].join("\n\n");
    const compressed = [
      REPAIRED_246.replace("scrap held at about", "the memo states scrap held at about"),
      ...Array.from({ length: 5 }, (_, index) => filler(index + 4)),
    ].join("\n\n");
    const sent = installFetch({
      draft: DRAFT_246,
      repair: longRepair,
      compressed,
      checks: [
        { verdicts: Object.values(ordinary), planVerdicts: [covered, targetsMissed] },
        { verdicts: [], planVerdicts: [covered, targetsMet] },
      ],
    });
    const result = await draft("246", claimFor(plan246()), SUMMARY_VERSION);
    const compressions = sent.filter((request) => request.stage === "compression");
    expect(compressions.length).toBeGreaterThan(0);
    for (const request of compressions) {
      expect(request.user).toContain(COMPRESSION_REQUEST.mustKeep.prefix);
      // The targets fix asks to state something, so it stays; the
      // source-talk fix asks to take words out, so it never does.
      expect(request.user).toContain(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.targetsIssue);
      expect(request.user).not.toContain(SOURCE_TALK.fix);
    }
    expect(result.draftText).toBe(compressed);
    // The final text still names the memo: the row says so. As for every
    // deterministic row a used repair was sent for, it is marked repaired
    // with "repair failed" (assembleSectionNotes).
    expect(result.notes.find((row) => row.instruction === SOURCE_TALK.instruction)).toMatchObject({
      outcome: "not_applied",
      paragraphIndex: 1,
      repaired: true,
      reason: 'names a source in paragraph 2 ("the memo states"); repair failed',
    });
  });
});

describe("the project's own subject comes from every Line (review P2-4, real SDK, fetch stubbed)", () => {
  it("never reports a head noun a signed-off item of another Line uses, and still reports one it does not", async () => {
    const memoDraft = [
      "The objective was met: 96.4 percent yield against the 95 percent target.",
      "Totals taken from the credit memo matched the ledger in 300 parts.",
      "The pad pressure map set pad force per zone.",
    ].join("\n\n");
    const answers = { verdicts: Object.values(ordinary).map((verdict) => ({ ...verdict, outcome: "applied" })), planVerdicts: [covered, targetsMet] };
    installFetch({ draft: memoDraft, checks: [answers] });
    // A Line 242 item names credit memos: the project's subject.
    const subject = await draft("246", claimFor(plan246(), [["Credit memos are matched to parts."], ["Per-zone pad pressure lifted yield."]]), SUMMARY_VERSION);
    expect(subject.notes.find((row) => row.instruction === SOURCE_TALK.instruction)).toMatchObject({ outcome: "applied" });
    installFetch({ draft: memoDraft, repair: memoDraft.replace("taken from the credit memo ", ""), checks: [answers, { verdicts: [], planVerdicts: [covered, targetsMet] }] });
    const other = await draft("246", claimFor(plan246(), [["Per-zone pad pressure lifted yield."]]), SUMMARY_VERSION);
    expect(other.notes.find((row) => row.instruction === SOURCE_TALK.instruction)).toMatchObject({ outcome: "applied", repaired: true });
  });
});

describe("Single draft and Compare are unchanged (real SDK, fetch stubbed)", () => {
  it("sends no report-text rules, finds no source talk and gives a Glossary fix no fixed start", async () => {
    const sent = installFetch({
      draft: DRAFT_246,
      repair: REPAIRED_246,
      checks: [{
        verdicts: [
          { paragraph: 3, check: "glossary", instruction: "pad pressure map", outcome: "not_applied", reason: "P3 says pressure table.", repairGuidance: "Replace pressure table." },
          { paragraph: 2, check: "confidence", instruction: "Scrap figure", outcome: "not_applied", reason: "P2 is flat.", repairGuidance: "Hedge the scrap figure." },
        ],
      }],
    });
    const result = await draft("246", claimFor());
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
    for (const request of sent) {
      expect(request.user).not.toContain(RULES_REPORT_FACTS);
      expect(request.system).not.toContain(RULES_REPORT_FACTS);
    }
    expect(sent[1]!.system).toBe(SELF_CHECK_SYSTEM_PROMPT);
    const repair = sent[2]!.user;
    expect(repair).toContain("- Paragraph 3: Replace pressure table.");
    expect(repair).toContain("- Paragraph 2: Hedge the scrap figure.");
    expect(repair).not.toContain(SOURCE_TALK.fix);
    expect(repair).not.toContain(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.hedgeIssue);
    expect(repair).not.toContain(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.glossaryIssuePrefix);
    expect(result.notes.some((row) => row.instruction === SOURCE_TALK.instruction)).toBe(false);
  });
});
