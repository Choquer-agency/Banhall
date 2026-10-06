/// <reference types="vite/client" />
/**
 * 2026-09-30 (first): what the writer dropped stays out of every Line, and
 * every Line 246 advancement answers a Line 242 uncertainty.
 *
 * Release suite run 10 (fixture changed-advancement-links, fictional
 * Marrowgate cold-water biofilter) failed: the writer unticked the
 * seed-fraction uncertainty, but the Brief put its Trial 2 at 6 C back in
 * Line 244 and its result in Line 246, and Line 246 claimed dosing and sensor
 * advancements for uncertainties Line 242 never states.
 *
 * Every test drafts one Section through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed. The data is fictional.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import {
  ANSWERS_242_INSTRUCTION,
  draftCheckedSection,
  leaveOutInstruction,
} from "./ai/orderedGeneration";
import {
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
} from "./ai/promptDefinitions";
import {
  LEAVE_OUT_BREAK_UNLOCATED_REASON,
  PLAN_LEAVE_OUT_NOT_CHECKED_REASON,
} from "./ai/selfCheck";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import {
  buildFrozenSummaryPlan,
  FROZEN_SUMMARY_PLAN_SCAFFOLD,
  line242Reference,
  type FrozenDroppedUncertainty,
} from "./lib/seedRevisions";
import type { OrderedPayload, SectionNumber } from "./lib/orderedChain";

const modules = import.meta.glob("./**/*.ts");
const SONNET = "claude-sonnet-5";
const SUMMARY_VERSION = "summary-version-marrowgate" as Id<"summaryVersions">;

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

// ─── The fictional Marrowgate plan of release suite run 10 ─────────────────

const SEED_FRACTION = [
  "It was unclear what seed fraction would be needed once water dropped further to 6 degrees C.",
  "The team did not know if gains from more seed would keep scaling or flatten at some point.",
];
const DROPPED_ID = "u-seed-fraction";
const DROPPED: FrozenDroppedUncertainty = {
  seedId: DROPPED_ID,
  wording: SEED_FRACTION,
  experiments: [{
    seedId: "e-trial-2",
    wording: ["Trial 2 at 6 C compared 5 and 15 percent acclimated seed.", "The loops took 44 and 29 days."],
  }],
  advancements: [{ seedId: "a-seed-rule", wording: ["Required seed fraction rises as temperature drops."] }],
};
const ITEM_TRIAL_1 = "item-trial-1" as Id<"summaryItems">;
const ITEM_ADVANCEMENT = "item-acclimation-advancement" as Id<"summaryItems">;
const KEPT_UNCERTAINTY = "It was uncertain whether stepwise acclimation from 14 to 8 degrees would beat unacclimated seed enough to hit the 5-week target.";
const LINE_242 = [
  "Marrowgate designs recirculating aquaculture systems for cold-water trout farms.",
  KEPT_UNCERTAINTY,
].join("\n\n");

const DRAFT_244 = [
  "The team kept start-up, feeding spikes and sensor accuracy as separate problems.",
  "It was hypothesized that stepwise acclimation would cut start-up under 5 weeks at 8 C.",
  "Trial 1 ran three loops at 8 C: 66, 47 and 31 days to full nitrification.",
  "Trial 2 at 6 C took 44 days with 5 percent seed and 29 days with 15 percent seed.",
].join("\n\n");
const REPAIRED_244 = DRAFT_244.split("\n\n").slice(0, 3).join("\n\n");
const DRAFT_246 = [
  "Stepwise acclimation cut cold-water start-up to 31 days at 8 C.",
  "This met the under-5-week objective for acclimated seed.",
  "Feed-forward dosing with a 55 percent fill ratio held TAN under 1 mg/L.",
].join("\n\n");
const REPAIRED_246 = DRAFT_246.split("\n\n").slice(0, 2).join("\n\n");

const ANALYSIS = {
  company_context: "A fictional designer of recirculating aquaculture systems",
  project_goal: "Biofilter start-up under 5 weeks at 8 C",
  business_problem: "Start-up took 9 to 10 weeks below 10 C",
  scientific_technical_problem: "Seed media goes into shock in cold water",
  technological_objective: "A cold-water start-up method",
  work_performed: {},
  project_status: "completed",
};
const PAYLOAD = {
  analysis: JSON.stringify(ANALYSIS),
  brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
  orderedContext: {
    profileState: "missing",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: [],
  },
  summaryVersionId: SUMMARY_VERSION,
  frozenStyleGuidance: "",
} satisfies OrderedPayload;

function plan244(dropped: FrozenDroppedUncertainty[] = [DROPPED]) {
  return buildFrozenSummaryPlan({
    section: "s244",
    items: [{
      itemId: ITEM_TRIAL_1,
      roleId: "experimentation",
      kind: "multiple",
      bullets: ["Trial 1 ran three loops at 8 C: 66, 47 and 31 days to full nitrification."],
      support: "writer_asserted",
    }],
    skippedRoleIds: ["prior_year_status"],
    droppedUncertainties: dropped,
  });
}

const ITEM_UNCERTAINTY_242 = "item-acclimation-uncertainty" as Id<"summaryItems">;

function plan246(line242Text?: string) {
  return buildFrozenSummaryPlan({
    section: "s246",
    items: [
      // A Line 242 item: not in Line 246's plan, but in its advancement check.
      {
        itemId: ITEM_UNCERTAINTY_242,
        roleId: "active_uncertainties",
        kind: "standard",
        bullets: [KEPT_UNCERTAINTY],
        support: "source_supported",
      },
      {
        itemId: ITEM_ADVANCEMENT,
        roleId: "specific_advancements",
        kind: "multiple",
        bullets: ["Stepwise acclimation cut cold-water start-up roughly in half at 8 C."],
        support: "writer_asserted",
      },
    ],
    skippedRoleIds: [],
    answers242: line242Text === undefined ? {} : { line242Text },
  });
}

function claimFor(args: {
  section: SectionNumber;
  plan: ReturnType<typeof buildFrozenSummaryPlan>;
  priorSections?: Array<{ section: SectionNumber; text: string }>;
  answers242?: unknown;
  droppedNotChecked?: Array<{ seedId: string; wording: string[] }>;
}) {
  return {
    projectId: "project-marrowgate",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 1,
    isFirstInOrder: false,
    priorSections: args.priorSections ?? [],
    briefBlock: "",
    brief: null,
    planBlock: `\n\n${args.plan.block}`,
    planChecksBlock: args.plan.checksBlock,
    planChecks: args.plan.checks,
    editedTerms: [],
    droppedNotChecked: args.droppedNotChecked ?? [],
    answers242: args.answers242 ?? null,
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

// ─── The stubbed provider ──────────────────────────────────────────────────

type Sent = { stage: string; json: Record<string, unknown>; user: string };

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
function planVerdictSchemaOf(sent: Sent) {
  const tool = (sent.json.tools as Array<{ input_schema: { properties: { planVerdicts: { items: { properties: Record<string, { enum?: string[] }>; oneOf: unknown[] } } } } }>)[0]!;
  return tool.input_schema.properties.planVerdicts.items;
}

/**
 * Scripts one Section: the draft, the repair, each compression answer and
 * each Self-check answer, in order (a raw tool input or plan verdicts).
 */
function installFetch(script: {
  draft: string;
  repair?: string;
  compressed?: string;
  checks: Array<unknown[] | { raw: unknown }>;
}): Sent[] {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const json = JSON.parse(await request.text()) as Record<string, unknown>;
      const user = userOf(json);
      const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
      const followUp = user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.missingFollowUp.prefix.trim());
      const stage = tool === "submit_self_check"
        ? user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction)
          ? "finalCoverage"
          : followUp ? "followUp" : "selfCheck"
        : tool ?? (user.includes(COMPRESSION_REQUEST.userScaffold.wordsToLimit)
          ? "compression"
          : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
      sent.push({ stage, json, user });
      const base = {
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: json.model,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
      };
      if (tool === "submit_self_check") {
        const next = checks.shift();
        if (next === undefined) throw new Error("No Self-check answer scripted");
        const answer = "raw" in next ? next.raw : { verdicts: [], planVerdicts: next };
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: "toolu_self_check", name: tool, input: answer }],
          stop_reason: "tool_use",
        });
      }
      if (tool) throw new Error(`Unexpected tool ${tool}`);
      const text = stage === "repair"
        ? script.repair ?? script.draft
        : stage === "compression"
          ? script.compressed ?? script.draft
          : script.draft;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

async function draft(section: SectionNumber, claim: ReturnType<typeof claimFor>) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({ claim, payload: PAYLOAD, section, clientFor });
  });
}

const skipHonoured = { skippedRoleId: "prior_year_status", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "The role is absent." };
const trialCovered = { itemId: ITEM_TRIAL_1, mergedItemIds: [ITEM_TRIAL_1], paragraph: 3, outcome: "applied", reason: "P3 covers Trial 1." };
const leftOut = { droppedSeedId: DROPPED_ID, mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Nothing on seed fraction at 6 C." };
const stillThere = {
  droppedSeedId: DROPPED_ID,
  mergedItemIds: [],
  paragraph: 4,
  outcome: "not_applied",
  reason: "P4 narrates Trial 2 at 6 C.",
  repairGuidance: "Remove the Trial 2 paragraph.",
};

function rowOf(result: Awaited<ReturnType<typeof draft>>, match: (ref: NonNullable<(typeof result.notes)[number]["planRef"]>) => boolean) {
  const row = result.notes.find((note) => note.planRef && match(note.planRef));
  if (!row) throw new Error("No such plan row");
  return row;
}
function planCoverage(result: Awaited<ReturnType<typeof draft>>) {
  return (JSON.parse(result.selfCheck) as { planCoverage?: unknown }).planCoverage;
}

describe("a dropped uncertainty stays out of every Line (real SDK, fetch stubbed)", () => {
  it("drafts with a LEAVE OUT entry, checks it by droppedSeedId, repairs the Trial 2 paragraph away and records the final text", async () => {
    const sent = installFetch({
      draft: DRAFT_244,
      repair: REPAIRED_244,
      checks: [[skipHonoured, trialCovered, stillThere], [skipHonoured, trialCovered, leftOut]],
    });
    const result = await draft("244", claimFor({ section: "244", plan: plan244() }));

    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(REPAIRED_244);
    // Drafting: the plan's LEAVE OUT entry, with its work as reference.
    const drafting = sent[0]!.user;
    expect(drafting).toContain(`${FROZEN_SUMMARY_PLAN_SCAFFOLD.begin}\n${FROZEN_SUMMARY_PLAN_SCAFFOLD.leaveOutPrecedence}\n${FROZEN_SUMMARY_PLAN_SCAFFOLD.leaveOutFormat}\n`);
    expect(drafting).toContain(
      `{"droppedSeedId":"${DROPPED_ID}","instruction":"${FROZEN_SUMMARY_PLAN_SCAFFOLD.leaveOutInstruction}","kind":"leave_out","relationshipReferences":[{"seedId":"e-trial-2","wording":["Trial 2 at 6 C compared 5 and 15 percent acclimated seed.","The loops took 44 and 29 days."]},{"seedId":"a-seed-rule","wording":["Required seed fraction rises as temperature drops."]}],"wording":${JSON.stringify(SEED_FRACTION)}}`
    );
    // The Self-check: the check, its rule after the data blocks, the checklist and the schema.
    const check = sent[1]!;
    expect(check.user).toContain(`"droppedSeedId":"${DROPPED_ID}","instruction":"leave_out"`);
    expect(check.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.leaveOut.instruction);
    expect(check.user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.answers242.instruction);
    expect(check.user.endsWith(
      "Return exactly 3 planVerdicts, one for each plan check below:\n" +
        `- skippedRoleId prior_year_status\n- itemId ${ITEM_TRIAL_1}\n- droppedSeedId ${DROPPED_ID}`
    )).toBe(true);
    const schema = planVerdictSchemaOf(check);
    expect(schema.properties.droppedSeedId?.enum).toEqual([DROPPED_ID]);
    expect(schema.properties).not.toHaveProperty("ruleId");
    expect(schema.oneOf).toEqual([
      { required: ["itemId"] },
      { required: ["skippedRoleId"] },
      { required: ["droppedSeedId"] },
    ]);
    // The repair gets a fixed start naming the words, then the guidance.
    expect(sent[2]!.user).toContain(
      `- Paragraph 4: leave out the uncertainty the writer dropped ("${SEED_FRACTION.join(" ")}"), the work that tested it and its results, but keep everything a COVER item holds. Remove the Trial 2 paragraph.`
    );
    // The final coverage check judges it again on the final text.
    expect(sent[3]!.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.leaveOut.instruction);
    expect(sent[3]!.user.endsWith(`- droppedSeedId ${DROPPED_ID}`)).toBe(true);
    const row = rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID);
    expect(row).toEqual({
      section: "244",
      source: "model",
      instruction: leaveOutInstruction(SEED_FRACTION),
      outcome: "applied",
      tier: "none",
      reason: "Nothing on seed fraction at 6 C.",
      repaired: true,
      planRef: { summaryVersionId: SUMMARY_VERSION, droppedSeedId: DROPPED_ID, mergedItemIds: [] },
    });
    expect(row.instruction).toBe(
      'Leave out the uncertainty the writer dropped: "It was unclear what seed fraction would be needed once water dropped further to 6 degrees C. The..."'
    );
    expect(planCoverage(result)).toEqual({ status: "complete", applied: 3, total: 3 });
  });

  it("records the dropped uncertainty as not applied when the final text still holds it", async () => {
    installFetch({
      draft: DRAFT_244,
      repair: DRAFT_244.replace("29 days", "about 29 days"),
      checks: [[skipHonoured, trialCovered, stillThere], [skipHonoured, trialCovered, stillThere]],
    });
    const result = await draft("244", claimFor({ section: "244", plan: plan244() }));
    expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID)).toMatchObject({
      outcome: "not_applied",
      paragraphIndex: 3,
      repaired: false,
      reason: "P4 narrates Trial 2 at 6 C.",
    });
    expect(planCoverage(result)).toEqual({ status: "incomplete", applied: 2, total: 3 });
  });

  it("honours a LEAVE OUT by absence, and sends none to the repair when its break names no paragraph", async () => {
    const sent = installFetch({
      draft: DRAFT_244,
      checks: [[skipHonoured, trialCovered, { ...stillThere, paragraph: 0 }]],
    });
    const result = await draft("244", claimFor({ section: "244", plan: plan244() }));
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    const row = rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID);
    expect(row).toMatchObject({ outcome: "not_applied", repaired: false, reason: LEAVE_OUT_BREAK_UNLOCATED_REASON });
    expect(row).not.toHaveProperty("paragraphIndex");
  });

  it("asks once for a missing LEAVE OUT verdict and records it as not checked", async () => {
    const sent = installFetch({
      draft: DRAFT_244,
      checks: [[skipHonoured, trialCovered], []],
    });
    const result = await draft("244", claimFor({ section: "244", plan: plan244() }));
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "followUp"]);
    expect(sent[2]!.user.endsWith(`- droppedSeedId ${DROPPED_ID}\n\n${SUMMARY_PLAN_SELF_CHECK_REQUEST.missingFollowUp.emptyVerdicts}`)).toBe(true);
    expect(planVerdictSchemaOf(sent[2]!).properties.droppedSeedId?.enum).toEqual([DROPPED_ID]);
    expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID)).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: PLAN_LEAVE_OUT_NOT_CHECKED_REASON,
    });
  });

  it("records a LEAVE OUT as not checked when the Self-check fails as a whole", async () => {
    installFetch({ draft: DRAFT_244, checks: [{ raw: {} }] });
    const result = await draft("244", claimFor({ section: "244", plan: plan244() }));
    expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID)).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: "The plan coverage Self-check did not complete.",
    });
  });

  it("never makes a leave-out fix a Must keep line of the repair's compression", async () => {
    const filler = (index: number) =>
      `Paragraph ${index}: the loops were sampled for ammonia, nitrite and nitrate every day and the readings were logged against the acclimation schedule, comparing each loop with its control and noting where the trend changed.`;
    const longRepair = [REPAIRED_244, ...Array.from({ length: 30 }, (_, index) => filler(index + 5))].join("\n\n");
    const compressed = [REPAIRED_244, ...Array.from({ length: 14 }, (_, index) => filler(index + 5))].join("\n\n");
    const sent = installFetch({
      draft: DRAFT_244,
      repair: longRepair,
      compressed,
      checks: [[skipHonoured, trialCovered, stillThere], [skipHonoured, trialCovered, leftOut]],
    });
    const result = await draft("244", claimFor({ section: "244", plan: plan244() }));
    const compressions = sent.filter((request) => request.stage === "compression");
    expect(compressions.length).toBeGreaterThan(0);
    for (const request of compressions) {
      expect(request.user).toContain(COMPRESSION_REQUEST.mustKeep.prefix);
      expect(request.user).toContain("Trial 1 ran three loops at 8 C: 66, 47 and 31 days to full nitrification.");
      expect(request.user).not.toContain("leave out the uncertainty the writer dropped");
    }
    expect(result.draftText).toBe(compressed);
    expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID)).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("names the dropped uncertainties beyond the cap as not checked and never counts the plan complete", async () => {
    installFetch({ draft: DRAFT_244, checks: [[skipHonoured, trialCovered]] });
    const beyond = [
      { seedId: "u-membrane-life", wording: ["It was unknown whether membrane life could pass 3 months."] },
    ];
    const result = await draft("244", claimFor({ section: "244", plan: plan244([]), droppedNotChecked: beyond }));
    const row = rowOf(result, (ref) => ref.droppedSeedId === "u-membrane-life");
    expect(row).toEqual({
      section: "244",
      source: "deterministic",
      instruction: 'Leave out the uncertainty the writer dropped: "It was unknown whether membrane life could pass 3 months."',
      outcome: "not_applied",
      tier: "none",
      reason: "Not checked: the writer dropped more than 3 uncertainties, and only the first 3 are left out and checked. Confirm this Line does not state this one, describe work that tested it or claim its results.",
      repaired: false,
      planRef: { summaryVersionId: SUMMARY_VERSION, droppedSeedId: "u-membrane-life", mergedItemIds: [] },
    });
    expect(planCoverage(result)).toEqual({ status: "incomplete", applied: 2, total: 3 });
  });
});

describe("every Line 246 advancement answers a Line 242 uncertainty (real SDK, fetch stubbed)", () => {
  const advancementCovered = { itemId: ITEM_ADVANCEMENT, mergedItemIds: [ITEM_ADVANCEMENT], paragraph: 1, outcome: "applied", reason: "P1 states it." };
  const answers = { ruleId: "advancements_answer_242", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Every advancement answers Line 242." };
  const strays = {
    ruleId: "advancements_answer_242",
    mergedItemIds: [],
    paragraph: 3,
    outcome: "not_applied",
    reason: "P3 claims dosing, not in Line 242.",
    repairGuidance: "Leave out the dosing and fill ratio advancement.",
  };

  it("tells the drafter, checks the advancements against Line 242's text, repairs a stray one and records the final text", async () => {
    const sent = installFetch({
      draft: DRAFT_246,
      repair: REPAIRED_246,
      checks: [[advancementCovered, strays], [advancementCovered, answers]],
    });
    const result = await draft("246", claimFor({
      section: "246",
      plan: plan246(LINE_242),
      priorSections: [{ section: "242", text: LINE_242 }],
      answers242: { line242Drafted: true },
    }));
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(REPAIRED_246);
    // Drafting: Line 242 as a prior section, then the rule after the plan
    // and the Brief, before the Locked length.
    const drafting = sent[0]!.user;
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.advancementsAnswer242;
    const rule = `${scaffold.heading}${scaffold.drafted}${scaffold.rest}`;
    expect(drafting).toContain(`${ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.itemTitlePrefix}Line 242 (Uncertainty)${ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.itemTitleSuffix}${LINE_242}`);
    expect(drafting).toContain(rule);
    expect(drafting.indexOf(FROZEN_SUMMARY_PLAN_SCAFFOLD.end)).toBeLessThan(drafting.indexOf(rule));
    expect(drafting.indexOf(rule)).toBeLessThan(drafting.indexOf(ORDERED_PROMPT_SCAFFOLDS.planLengthBudget.prefix));
    // Review P3-2: advancements and results only, below the writer's Feedback.
    expect(drafting).toContain(
      "Claim an advancement or a result in this Line only for an uncertainty that Line 242 states. Line 242 is among the previously drafted sections above. Leave out Brief content that claims an advancement or a result for any other uncertainty, even where the Storyline or the Confidence Map supports it. Project status and next steps are not advancements: this rule does not remove them."
    );
    expect(drafting).toContain(
      "The writer's Feedback outranks this rule, as it outranks the Brief. Claim Exclusions still apply to it: never claim excluded work because a Feedback instruction asks for it."
    );
    // The Self-check: Line 242's text as data in the check, its rule and schema.
    const check = sent[1]!;
    expect(check.user).toContain(`"ruleId":"advancements_answer_242","sourceReferences":[],"wording":${JSON.stringify([
      line242Reference({ items: [{ roleId: "active_uncertainties", wording: [KEPT_UNCERTAINTY] }], line242Text: LINE_242 }),
    ])}`);
    expect(check.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.answers242.instruction);
    expect(check.user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.leaveOut.instruction);
    expect(check.user.endsWith(`- itemId ${ITEM_ADVANCEMENT}\n- ruleId advancements_answer_242`)).toBe(true);
    const schema = planVerdictSchemaOf(check);
    expect(schema.properties.ruleId?.enum).toEqual(["advancements_answer_242"]);
    expect(schema.properties).not.toHaveProperty("droppedSeedId");
    expect(schema.oneOf).toEqual([{ required: ["itemId"] }, { required: ["skippedRoleId"] }, { required: ["ruleId"] }]);
    expect(sent[2]!.user).toContain(
      "- Paragraph 3: claim an advancement or a result only for an uncertainty Line 242 states, and leave out the rest, but keep everything a COVER item holds. Leave out the dosing and fill ratio advancement."
    );
    expect(sent[3]!.user.endsWith("- ruleId advancements_answer_242")).toBe(true);
    expect(rowOf(result, (ref) => ref.ruleId === "advancements_answer_242")).toEqual({
      section: "246",
      source: "model",
      instruction: ANSWERS_242_INSTRUCTION,
      outcome: "applied",
      tier: "none",
      reason: "Every advancement answers Line 242.",
      repaired: true,
      planRef: { summaryVersionId: SUMMARY_VERSION, ruleId: "advancements_answer_242", mergedItemIds: [] },
    });
    expect(planCoverage(result)).toEqual({ status: "complete", applied: 2, total: 2 });
  });

  it("lists Line 242's signed-off plan items by step when Line 246 is drafted before Line 242 (review P3-1)", async () => {
    const sent = installFetch({ draft: DRAFT_246, checks: [[advancementCovered, answers]] });
    await draft("246", claimFor({
      section: "246",
      plan: plan246(),
      answers242: {
        line242Drafted: false,
        items: [
          { roleId: "passive_limitations", wording: ["Warm seed goes into shock in 8 degree water."] },
          { roleId: "active_uncertainties", wording: [KEPT_UNCERTAINTY] },
        ],
      },
    }));
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.advancementsAnswer242;
    expect(sent[0]!.user).toContain(
      `${scaffold.heading}${scaffold.planned}${scaffold.rest}\n- Technological limitations: "Warm seed goes into shock in 8 degree water."\n- Technological uncertainties: "${KEPT_UNCERTAINTY}"`
    );
    expect(sent[0]!.user).not.toContain(ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.prefix);
    expect(sent[1]!.user).toContain(`"wording":${JSON.stringify([
      `${FROZEN_SUMMARY_PLAN_SCAFFOLD.line242PlanHeading}\n- Technological uncertainties: ${KEPT_UNCERTAINTY}`,
    ])}`);
  });

  // Review P2-2: a repair made for a leave-out fix must keep what the plan
  // holds. Line 246 P1 mixes the COVER advancement with Brief-only dosing
  // content; the repair drops the whole paragraph.
  const MIXED_246 = [
    "Stepwise acclimation cut cold-water start-up roughly in half at 8 C, and feed-forward dosing held TAN under 1 mg/L.",
    "The start-up method is in use on one client farm.",
  ].join("\n\n");
  const GUTTED_246 = "The start-up method is in use on one client farm.";
  const coveredInP1 = { itemId: ITEM_ADVANCEMENT, mergedItemIds: [ITEM_ADVANCEMENT], paragraph: 1, outcome: "applied", reason: "P1 states it." };
  const dosingInP1 = { ...strays, paragraph: 1, reason: "P1 claims dosing, not in Line 242." };
  const advancementGone = { itemId: ITEM_ADVANCEMENT, mergedItemIds: [ITEM_ADVANCEMENT], paragraph: 0, outcome: "not_applied", reason: "The acclimation advancement is gone." };
  const claim246 = () => claimFor({
    section: "246",
    plan: plan246(LINE_242),
    priorSections: [{ section: "242", text: LINE_242 }],
    answers242: { line242Drafted: true },
  });

  it("keeps the checked draft when a leave-out repair loses a COVER item the first check found covered (review P2-2)", async () => {
    const sent = installFetch({
      draft: MIXED_246,
      repair: GUTTED_246,
      checks: [[coveredInP1, dosingInP1], [advancementGone, answers]],
    });
    const result = await draft("246", claim246());
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(sent[2]!.user).toContain("but keep everything a COVER item holds.");
    expect(result.draftText).toBe(MIXED_246);
    const reason = 'the repaired text no longer covers the signed-off item "Stepwise acclimation cut cold-water start-up roughly in half at 8 C.", and a repair must keep what a COVER item holds, so the checked draft was kept';
    expect(rowOf(result, (ref) => ref.itemId === ITEM_ADVANCEMENT)).toMatchObject({ outcome: "applied", repaired: false, paragraphIndex: 0 });
    expect(rowOf(result, (ref) => ref.ruleId === "advancements_answer_242")).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: `P1 claims dosing, not in Line 242.; repair not used (${reason})`,
    });
  });

  it("keeps such a repair when the checked draft is further over a Locked limit (Locked Rules first)", async () => {
    const filler = (index: number) =>
      `Paragraph ${index}: the loops were sampled for ammonia, nitrite and nitrate every day and the readings were logged against the acclimation schedule for each loop and its control.`;
    const overLimit = [MIXED_246, ...Array.from({ length: 14 }, (_, index) => filler(index + 3))].join("\n\n");
    installFetch({
      draft: overLimit,
      repair: GUTTED_246,
      checks: [[coveredInP1, dosingInP1], [advancementGone, answers]],
    });
    const result = await draft("246", claim246());
    expect(result.draftText).toBe(GUTTED_246);
    expect(rowOf(result, (ref) => ref.itemId === ITEM_ADVANCEMENT)).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: "The acclimation advancement is gone.",
    });
    expect(rowOf(result, (ref) => ref.ruleId === "advancements_answer_242")).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("gives Lines 242 and 244 no advancement rule", async () => {
    const sent = installFetch({ draft: DRAFT_244, checks: [[skipHonoured, trialCovered, leftOut]] });
    await draft("244", claimFor({ section: "244", plan: plan244(), answers242: { line242Drafted: true } }));
    expect(sent[0]!.user).not.toContain(ORDERED_PROMPT_SCAFFOLDS.advancementsAnswer242.heading);
  });
});
