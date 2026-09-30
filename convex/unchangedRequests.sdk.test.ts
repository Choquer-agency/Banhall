/// <reference types="vite/client" />
/**
 * 2026-09-30 (first): requests with no dropped uncertainty and no signed-off
 * plan, and a signed-off plan's Lines 242 and 244 with no dropped
 * uncertainty, are sent byte for byte as before the amendment. Every
 * provider request of one Section drafted through draftCheckedSection (the
 * real Anthropic SDK, the production instrumented client, only `fetch`
 * stubbed) is hashed and compared with the hash this same file produced at
 * commit 5c2350ac, before the amendment. Line 246 of a signed-off plan is
 * not pinned: Rule B changes every such request on purpose.
 *
 * 2026-09-30 (second): Rule C changes every signed-off Line 244 request on
 * purpose. The signedOff244 fixture builds its plan without Rule C's check
 * and claims no Rule C block, so its pin still proves every other part of
 * those requests unchanged. The second block pins, at commit cd419ff1
 * (before that amendment), a Single draft consistency request (Compare
 * sends the same) and a signed-off Line 242 whose governed Glossary Term no
 * signed-off idea uses, which that amendment must leave alone.
 *
 * The first block uses only APIs that existed at 5c2350ac, and the second
 * only APIs that existed at cd419ff1, so each runs there to reproduce its
 * pins.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import { draftCheckedSection } from "./ai/orderedGeneration";
import { ORDERED_PROMPT_SCAFFOLDS, SUMMARY_PLAN_SELF_CHECK_REQUEST } from "./ai/promptDefinitions";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { runConsistencyPass } from "./ai/selfCheck";
import { buildFrozenSummaryPlan } from "./lib/seedRevisions";
import type { OrderedPayload, SectionNumber } from "./lib/orderedChain";

const modules = import.meta.glob("./**/*.ts");
const SONNET = "claude-sonnet-5";

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

// ─── A fictional project: the Harbourline net-pen cleaning robot ──────────

const ANALYSIS = {
  company_context: "A fictional maker of net-pen cleaning robots",
  project_goal: "A robot that cleans a net pen without tearing the mesh",
  business_problem: "Divers cleaned nets by hand",
  scientific_technical_problem: "No brush pressure was known to lift biofouling without tearing mesh",
  technological_objective: "A pressure rule for mesh cleaning",
  work_performed: {},
  project_status: "completed",
};
const DRAFT = [
  "Harbourline Robotics builds cleaning robots for salmon net pens.",
  "It was uncertain which brush pressure lifts biofouling without tearing the mesh.",
  "Tank trials compared three brush pressures on new and aged mesh.",
].join("\n\n");
const REPAIRED = [
  "Harbourline Robotics builds cleaning robots for salmon net pens.",
  "It was uncertain which brush pressure lifts biofouling without tearing aged mesh.",
  "Tank trials compared three brush pressures on new and aged mesh.",
].join("\n\n");

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

const ITEM_UNCERTAINTY = "item-harbourline-uncertainty" as Id<"summaryItems">;
const ITEM_HYPOTHESIS = "item-harbourline-hypothesis" as Id<"summaryItems">;

function signedOffPlan(section: "s242" | "s244") {
  return buildFrozenSummaryPlan({
    section,
    items: [
      {
        itemId: ITEM_UNCERTAINTY,
        roleId: "active_uncertainties",
        kind: "standard",
        bullets: ["It was uncertain which brush pressure lifts biofouling without tearing aged mesh."],
        support: "source_supported",
      },
      {
        itemId: ITEM_HYPOTHESIS,
        roleId: "hypothesis",
        kind: "standard",
        bullets: ["A pressure under 40 kPa would clean aged mesh without tears."],
        support: "writer_asserted",
      },
    ],
    skippedRoleIds: ["prior_year_status"],
  });
}

function claimFor(args: {
  section: SectionNumber;
  plan?: ReturnType<typeof signedOffPlan>;
}) {
  const plan = args.plan;
  return {
    projectId: "project-harbourline",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: args.section === "242" ? 0 : 1,
    isFirstInOrder: args.section === "242",
    priorSections: args.section === "242" ? [] : [{ section: "242", text: DRAFT }],
    briefBlock: "",
    brief: null,
    planBlock: plan ? `\n\n${plan.block}` : "",
    planChecksBlock: plan?.checksBlock ?? "",
    planChecks: plan?.checks ?? [],
    editedTerms: [],
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

type Sent = { stage: string; body: string };

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

/** Scripts the Section: its draft, repair and each Self-check answer, in order. */
function installFetch(script: { repair?: string; checks: unknown[] }): Sent[] {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const body = await request.text();
      const json = JSON.parse(body) as Record<string, unknown>;
      const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
      const user = userOf(json);
      const stage = tool === "submit_self_check"
        ? user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction) ||
          user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.labelsInstruction)
          ? "finalCoverage"
          : "selfCheck"
        : tool ?? (user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
      sent.push({ stage, body });
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
      return Response.json({
        ...base,
        content: [{ type: "text", text: stage === "repair" ? script.repair ?? DRAFT : DRAFT }],
        stop_reason: "end_turn",
      });
    })
  );
  return sent;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function draftAndHash(args: {
  section: SectionNumber;
  plan?: ReturnType<typeof signedOffPlan>;
  script: { repair?: string; checks: unknown[] };
}): Promise<{ stages: string[]; hash: string }> {
  const sent = installFetch(args.script);
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({
      claim: claimFor(args),
      payload: payload(args.plan ? ("summary-version-harbourline" as Id<"summaryVersions">) : undefined),
      section: args.section,
      clientFor,
    });
  });
  return {
    stages: sent.map((request) => request.stage),
    hash: await sha256Hex(JSON.stringify(sent.map((request) => request.body))),
  };
}

const APPLIED = (paragraph: number, reason: string) => ({ paragraph, outcome: "applied", reason });

/**
 * The hashes this file produced at commit 5c2350ac (before the 2026-09-30
 * first amendment), with the same fixture, provider script and SDK.
 */
const PINNED_5C2350AC = {
  single246: "c4c0a61c378bd192a7fc87c7e43e5653fd56b0af16666ad18f50e9eb10a6e1ee",
  single244: "73c15286ba167ebcd364aa5f4d8101d83d03ad148b21480d668efce8946684e2",
  signedOff244: "3388881d9651a5c5107618d6f93066c8b0fe993711d1ed12e8f8e236d82b65ab",
  signedOff242Repaired: "d9c8cd2056f97ec7a0e0f054269decc33281f2cfe224bd3a3d4fdc9143ae77f3",
} as const;

describe("requests without a dropped uncertainty are unchanged (2026-09-30, first)", () => {
  it("sends a single-draft Line 246 and Line 244 byte for byte as before", async () => {
    const single246 = await draftAndHash({
      section: "246",
      script: { checks: [{ verdicts: [] }] },
    });
    const single244 = await draftAndHash({
      section: "244",
      script: { checks: [{ verdicts: [] }] },
    });
    expect(single246.stages).toEqual(["section", "selfCheck"]);
    expect(single244.stages).toEqual(["section", "selfCheck"]);
    expect({ single246: single246.hash, single244: single244.hash }).toEqual({
      single246: PINNED_5C2350AC.single246,
      single244: PINNED_5C2350AC.single244,
    });
  });

  it("sends a signed-off Line 244 with no dropped uncertainty byte for byte as before", async () => {
    const plan = signedOffPlan("s244");
    const result = await draftAndHash({
      section: "244",
      plan,
      script: {
        checks: [{
          verdicts: [],
          planVerdicts: [
            { skippedRoleId: "prior_year_status", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Absent." },
            { itemId: ITEM_HYPOTHESIS, mergedItemIds: [ITEM_HYPOTHESIS], ...APPLIED(2, "Covered.") },
          ],
        }],
      },
    });
    expect(result.stages).toEqual(["section", "selfCheck"]);
    expect(result.hash).toBe(PINNED_5C2350AC.signedOff244);
  });

  it("sends a signed-off Line 242's draft, Self-check, repair and final coverage check byte for byte as before", async () => {
    const plan = signedOffPlan("s242");
    const result = await draftAndHash({
      section: "242",
      plan,
      script: {
        repair: REPAIRED,
        checks: [
          {
            verdicts: [],
            planVerdicts: [{
              itemId: ITEM_UNCERTAINTY,
              mergedItemIds: [ITEM_UNCERTAINTY],
              paragraph: 0,
              outcome: "not_applied",
              reason: "P2 leaves out aged mesh.",
              repairGuidance: "Say the uncertainty is about aged mesh.",
            }],
          },
          {
            verdicts: [],
            planVerdicts: [{ itemId: ITEM_UNCERTAINTY, mergedItemIds: [ITEM_UNCERTAINTY], ...APPLIED(2, "Covered.") }],
          },
        ],
      },
    });
    expect(result.stages).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.hash).toBe(PINNED_5C2350AC.signedOff242Repaired);
  });
});

// ─── 2026-09-30 (second): more requests that must keep their bytes ────────

const GOVERNING_FEEDBACK = [{
  roleId: "company_context",
  instruction: "Call the cleaning head the soft brush, never the scrub pad, here and in every later step.",
}];

function governedClaim() {
  const plan = signedOffPlan("s242");
  return {
    ...(claimFor({ section: "242", plan }) as unknown as Record<string, unknown>),
    brief: { storylineText: "", claimExclusions: [], confidenceMap: [], glossaryTerms: ["scrub pad"] },
    writerFeedback: GOVERNING_FEEDBACK,
    glossarySetAside: [],
    feedbackTerms: [{ term: "scrub pad", feedback: GOVERNING_FEEDBACK }],
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

async function draftClaimAndHash(args: {
  section: SectionNumber;
  claim: Parameters<typeof draftCheckedSection>[0]["claim"];
  script: { repair?: string; checks: unknown[] };
}): Promise<{ stages: string[]; hash: string }> {
  const sent = installFetch(args.script);
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({
      claim: args.claim,
      payload: payload("summary-version-harbourline" as Id<"summaryVersions">),
      section: args.section,
      clientFor,
    });
  });
  return {
    stages: sent.map((request) => request.stage),
    hash: await sha256Hex(JSON.stringify(sent.map((request) => request.body))),
  };
}

async function consistencyHash(): Promise<string> {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const body = await request.text();
      bodies.push(body);
      const json = JSON.parse(body) as { model: string; tools: Array<{ name: string }> };
      return Response.json({
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: json.model,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
        content: [{ type: "tool_use", id: "toolu_consistency", name: json.tools[0]!.name, input: { findings: [] } }],
        stop_reason: "tool_use",
      });
    })
  );
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  await t.action(async (ctx: ActionCtx) =>
    await runConsistencyPass(
      instrumentedAnthropic(ctx, { callSite: "generation:consistency" }) as unknown as GenerationClient,
      {
        sections: [
          { section: "242", text: DRAFT },
          { section: "244", text: REPAIRED },
          { section: "246", text: "A pressure under 40 kPa cleaned aged mesh without tears in 36 to 40 days of trials." },
        ],
        claimExclusions: ["Buying a new winch was routine procurement."],
        glossaryTerms: ["scrub pad"],
        model: SONNET,
      }
    )
  );
  expect(bodies).toHaveLength(1);
  return await sha256Hex(JSON.stringify(bodies));
}

/**
 * The hashes this file produced at commit cd419ff1, before the 2026-09-30
 * second amendment, with the same fixtures, provider script and SDK.
 */
const PINNED_CD419FF1 = {
  singleConsistency: "7856853b58fb0012bbb401a53096faa433fd1b7475d9149ab3c4e1bace3315a5",
  signedOff242Governed: "e47448ddce60f0b9018d8333daad8968e7285a08c51f586d4d7f3c3e27953662",
} as const;

describe("requests the 2026-09-30 (second) amendment leaves alone are unchanged", () => {
  it("sends a single-draft consistency request byte for byte as before (Compare sends the same)", async () => {
    const hash = await consistencyHash();
    expect(hash).toBe(PINNED_CD419FF1.singleConsistency);
  });

  it("sends a signed-off Line 242 whose governed term no signed-off idea uses byte for byte as before", async () => {
    const result = await draftClaimAndHash({
      section: "242",
      claim: governedClaim(),
      script: {
        repair: REPAIRED,
        checks: [
          {
            verdicts: [{
              paragraph: 2,
              check: "instruction",
              instruction: "feedback:F1",
              outcome: "not_applied",
              reason: "P2 names the scrub pad.",
              repairGuidance: "Call it the soft brush.",
            }],
            planVerdicts: [{ itemId: ITEM_UNCERTAINTY, mergedItemIds: [ITEM_UNCERTAINTY], ...APPLIED(2, "Covered.") }],
          },
          {
            verdicts: [{ check: "instruction", instruction: "feedback:F1", ...APPLIED(2, "Follows the Feedback.") }],
            planVerdicts: [{ itemId: ITEM_UNCERTAINTY, mergedItemIds: [ITEM_UNCERTAINTY], ...APPLIED(2, "Covered.") }],
          },
        ],
      },
    });
    expect(result.stages).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.hash).toBe(PINNED_CD419FF1.signedOff242Governed);
  });
});
