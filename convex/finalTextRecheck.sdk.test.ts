/// <reference types="vite/client" />
/**
 * 2026-10-05 (Round 2, follow-up; owner decision "Small fix + Opus trial"):
 * after every used repair, shortened or not, the Self-check judges the final
 * text again, so no row reports the verdict on the text before the repair.
 *
 * Release suite run 5 (writer-settings-document) recorded Line 242's settings
 * row as not applied, "P4 does not open with required uncertainty phrasing;
 * repaired (deterministic re-check only; not re-verified by the model)",
 * while the final text opened its uncertainty paragraph with that phrasing,
 * and Line 244's as "P6 uses 'panels' not third-person company name
 * throughout" with no first person anywhere. Both repairs were used and not
 * shortened, so the Round 2 re-check did not run and the rows kept the first
 * check's verdicts.
 *
 * Each test drafts one Section through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed. Fictional project.
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
import { COMPRESSION_REQUEST, ORDERED_PROMPT_SCAFFOLDS } from "./ai/promptDefinitions";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { buildFrozenSummaryPlan } from "./lib/seedRevisions";
import { sectionMetrics } from "./lib/lineLimits";
import type { OrderedPayload } from "./lib/orderedChain";

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
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── A fictional project: Brannock Finishing's powder-coated cabinet doors ─

/** The writer's settings document, with no cap, so nothing is shortened. */
const SETTINGS = [
  "# PD Writing Customized Settings",
  'Open each uncertainty paragraph with "It was not known whether".',
  "Write in the third person throughout, naming Brannock Finishing.",
].join("\n\n");

const COVER_242 = "Routed coves on the doors heat unevenly in the oven.";
const DRAFT_242 = [
  "Brannock Finishing coats routed MDF cabinet doors with a low-temperature powder.",
  "The powder maker rated the coating for a cure at 130 C on flat stock.",
  COVER_242,
  "The team did not know whether a cove could reach full cure below the point where the board gives off gas.",
].join("\n\n");
/** The repair opens P4 with the phrasing; within every limit, so not shortened. */
const REPAIRED_242 = DRAFT_242.replace(
  "The team did not know whether",
  "It was not known whether"
);

const COVER_244 = "Trial 1 cured routed doors at 130 C for 12 minutes and measured film build in the coves.";
const DRAFT_244 = [
  "Brannock Finishing ran two oven trials on routed doors.",
  COVER_244,
  "Trial 2 lowered the oven air to 125 C and held the doors for 18 minutes.",
  "The panels in Trial 2 showed fewer pinholes, and Brannock Finishing logged each door.",
].join("\n\n");
/** The repair names the company in P4; within every limit, so not shortened. */
const REPAIRED_244 = DRAFT_244.replace("The panels in Trial 2", "Brannock Finishing's doors in Trial 2");

const ITEM_242 = "item-brannock-coves" as Id<"summaryItems">;
const ITEM_244 = "item-brannock-trial-1" as Id<"summaryItems">;

function plan(section: "242" | "244") {
  return section === "242"
    ? buildFrozenSummaryPlan({
        section: "s242",
        items: [{ itemId: ITEM_242, roleId: "active_uncertainties", kind: "standard", bullets: [COVER_242], support: "source_supported" }],
        skippedRoleIds: ["prior_year_status"],
      })
    : buildFrozenSummaryPlan({
        section: "s244",
        items: [{ itemId: ITEM_244, roleId: "experimentation", kind: "multiple", bullets: [COVER_244], support: "source_supported" }],
        skippedRoleIds: [],
      });
}

function payload(signedOff: boolean): OrderedPayload {
  return {
    analysis: JSON.stringify({
      company_context: "A fictional cabinet door finisher",
      project_goal: "Powder coat routed MDF doors",
      business_problem: "Lacquer lines were slow",
      scientific_technical_problem: "Coves heated unevenly and the board gave off gas",
      technological_objective: "Full cure in the coves without outgassing",
      work_performed: {},
      project_status: "completed",
    }),
    brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
    writerFlavor: SETTINGS,
    orderedContext: {
      profileState: "applied",
      categoryOutcomes: [],
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    },
    frozenStyleGuidance: "",
    ...(signedOff ? { summaryVersionId: "summary-version-brannock" as Id<"summaryVersions"> } : {}),
  } as OrderedPayload;
}

function claimFor(section: "242" | "244", signedOff: boolean) {
  const frozen = signedOff ? plan(section) : null;
  return {
    projectId: "project-brannock",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: section === "242" ? 0 : 1,
    isFirstInOrder: section === "242",
    priorSections: [],
    briefBlock: "",
    brief: null,
    planBlock: frozen ? `\n\n${frozen.block}` : "",
    planChecksBlock: frozen?.checksBlock ?? "",
    planChecks: frozen?.checks ?? [],
    editedTerms: [],
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

// ─── The stubbed provider ──────────────────────────────────────────────────

type Sent = { stage: string; user: string };

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

type Script = { draft: string; repair: string; checks: unknown[]; compressions?: string[] };

function systemOf(json: Record<string, unknown>): string {
  return typeof json.system === "string"
    ? json.system
    : Array.isArray(json.system)
      ? json.system.map((block: { text?: string }) => block.text ?? "").join("")
      : "";
}

/** Scripts one Section: its draft, each shortening pass, its repair and each Self-check answer, in order. */
function installFetch(script: Script): Sent[] {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  const compressions = [...(script.compressions ?? [])];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const json = JSON.parse(await new Request(input, init).text()) as Record<string, unknown>;
      const user = userOf(json);
      const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
      const stage = tool === "submit_self_check"
        ? "selfCheck"
        : tool ??
          (systemOf(json).startsWith(COMPRESSION_REQUEST.system.slice(0, 60))
            ? "compression"
            : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
      sent.push({ stage, user });
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
      const text = stage === "compression"
        ? compressions.shift() ?? ""
        : stage === "repair" ? script.repair : script.draft;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

async function draft(section: "242" | "244", signedOff: boolean, script: Script) {
  const sent = installFetch(script);
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const result = await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({
      claim: claimFor(section, signedOff),
      payload: payload(signedOff),
      section,
      clientFor,
    });
  });
  const settingsRow = result.notes.find((row) => row.source === "model" && row.instruction === SETTINGS);
  return { sent, result, settingsRow };
}

/** The writer's settings verdict: the Summary label, or in Single draft the quoted settings. */
function settingsVerdict(signedOff: boolean, verdict: { outcome: string; reason: string; repairGuidance?: string; paragraph?: number }) {
  return {
    paragraph: verdict.paragraph ?? 0,
    check: "instruction",
    instruction: signedOff ? "writer:profile" : "# PD Writing Customized Settings ...",
    outcome: verdict.outcome,
    reason: verdict.reason,
    ...(verdict.repairGuidance ? { repairGuidance: verdict.repairGuidance } : {}),
  };
}

const planVerdicts242 = [
  { itemId: ITEM_242, mergedItemIds: [ITEM_242], paragraph: 3, outcome: "applied", reason: "P3 states the coves." },
  { skippedRoleId: "prior_year_status", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Absent." },
];
const planVerdicts244 = [
  { itemId: ITEM_244, mergedItemIds: [ITEM_244], paragraph: 2, outcome: "applied", reason: "P2 states Trial 1." },
];

/** Run 5, Line 242: the first check says P4 lacks the opener. */
const OPENER_MISSING = {
  outcome: "not_applied",
  reason: "P4 does not open with required uncertainty phrasing",
  repairGuidance: 'Open P4 with "It was not known whether".',
  paragraph: 4,
};
/** Run 5, Line 244: the first check says P4 does not name the company. */
const THIRD_PERSON_MISSING = {
  outcome: "not_applied",
  reason: "P4 uses 'panels' not third-person company name throughout",
  repairGuidance: "Name Brannock Finishing in P4.",
  paragraph: 4,
};

/** No row may carry the pre-repair verdict's old wordings. */
function expectNoStaleWording(notes: Array<{ reason: string }>) {
  for (const row of notes) {
    expect(row.reason).not.toContain("deterministic re-check only");
    expect(row.reason).not.toContain("not re-verified");
  }
}

describe("every used repair is checked again on the final text (2026-10-05, Round 2, follow-up)", () => {
  it("run 5, Line 242: a repair used and not shortened gets the full Self-check of the final text, and the settings row reads its verdict", async () => {
    const { sent, result, settingsRow } = await draft("242", true, {
      draft: DRAFT_242,
      repair: REPAIRED_242,
      checks: [
        { verdicts: [settingsVerdict(true, OPENER_MISSING)], planVerdicts: planVerdicts242 },
        {
          verdicts: [settingsVerdict(true, { outcome: "applied", reason: "P4 opens with the required phrasing verbatim." })],
          planVerdicts: planVerdicts242,
        },
      ],
    });
    expect(result.draftText).toBe(REPAIRED_242);
    // A signed-off plan run adds no request: the check of the final text
    // that already ran is now the full Self-check.
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "selfCheck"]);
    const final = sent[3]!.user;
    expect(final).toContain("[P4] It was not known whether a cove could reach full cure");
    expect(final).not.toContain("The team did not know whether");
    expect(final).toContain("--- BEGIN [WRITER INSTRUCTIONS] ---");
    // The first check's own request, on the final text.
    expect(final.replace("It was not known whether", "The team did not know whether")).toBe(sent[1]!.user);
    expect(settingsRow).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: "P4 opens with the required phrasing verbatim.; repaired, and checked again on the final text",
    });
    expectNoStaleWording(result.notes);
    expect(JSON.parse(result.selfCheck)).toMatchObject({ status: "repair_attempted", remainingFailures: 0 });
  });

  it("run 5, Line 244: a repair used and not shortened, and the row reads the final text's verdict, not the first check's", async () => {
    const { sent, result, settingsRow } = await draft("244", true, {
      draft: DRAFT_244,
      repair: REPAIRED_244,
      checks: [
        { verdicts: [settingsVerdict(true, THIRD_PERSON_MISSING)], planVerdicts: planVerdicts244 },
        {
          verdicts: [settingsVerdict(true, { outcome: "applied", reason: "Third person throughout; no first person anywhere." })],
          planVerdicts: planVerdicts244,
        },
      ],
    });
    expect(result.draftText).toBe(REPAIRED_244);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "selfCheck"]);
    expect(sent[3]!.user).toContain("Brannock Finishing's doors in Trial 2");
    expect(settingsRow).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: "Third person throughout; no first person anywhere.; repaired, and checked again on the final text",
    });
    expect(settingsRow?.reason).not.toContain("panels");
    expectNoStaleWording(result.notes);
  });

  it("Single draft: a repair used and not shortened adds one Self-check request, and the row reads its verdict", async () => {
    const { sent, result, settingsRow } = await draft("244", false, {
      draft: DRAFT_244,
      repair: REPAIRED_244,
      checks: [
        { verdicts: [settingsVerdict(false, THIRD_PERSON_MISSING)] },
        { verdicts: [settingsVerdict(false, { outcome: "applied", reason: "Third person throughout; no first person anywhere." })] },
      ],
    });
    expect(result.draftText).toBe(REPAIRED_244);
    // The one added request: the Self-check of the final text.
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "selfCheck"]);
    expect(sent[3]!.user).toContain("Brannock Finishing's doors in Trial 2");
    expect(sent[3]!.user).not.toContain("The panels in Trial 2");
    expect(result.notes.filter((row) => row.source === "model")).toEqual([
      expect.objectContaining({
        outcome: "applied",
        repaired: true,
        reason: "Third person throughout; no first person anywhere.; repaired, and checked again on the final text",
      }),
    ]);
    expect(settingsRow).toBeUndefined();
    expectNoStaleWording(result.notes);
  });

  it.each([true, false])(
    "a repair that comes back byte for byte the checked text makes no extra request, and the row keeps the first verdict (signed-off plan: %s)",
    async (signedOff) => {
      const { sent, result } = await draft("242", signedOff, {
        draft: DRAFT_242,
        repair: DRAFT_242,
        checks: [
          signedOff
            ? { verdicts: [settingsVerdict(true, OPENER_MISSING)], planVerdicts: planVerdicts242 }
            : { verdicts: [settingsVerdict(false, OPENER_MISSING)] },
        ],
      });
      expect(result.draftText).toBe(DRAFT_242);
      expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
      expect(result.notes.filter((row) => row.source === "model" && !row.planRef)).toEqual([
        expect.objectContaining({
          outcome: "not_applied",
          repaired: false,
          reason: "P4 does not open with required uncertainty phrasing; the repair left the checked text as it was",
        }),
      ]);
      expectNoStaleWording(result.notes);
      expect(JSON.parse(result.selfCheck)).toMatchObject({ status: "repair_failed", remainingFailures: 1 });
    }
  );

  // Review P2 of the follow-up: on a signed-off plan run the plan rows of a
  // used repair with no check of the final text (the final text is the
  // checked text byte for byte) never claim the repair.
  const itemMissing = {
    itemId: ITEM_242,
    mergedItemIds: [ITEM_242],
    paragraph: 0,
    outcome: "not_applied",
    reason: "No paragraph says the coves heat unevenly",
    repairGuidance: "State that routed coves heat unevenly in the oven.",
  };
  const settingsMet = { outcome: "applied", reason: "Third person and the opener are used." };
  const planRow = (notes: Array<{ planRef?: { itemId?: string } }>) =>
    notes.find((row) => row.planRef?.itemId === ITEM_242);

  it("a repair that came back unchanged leaves the plan row not applied and not repaired (review P2 a)", async () => {
    const { sent, result } = await draft("242", true, {
      draft: DRAFT_242,
      repair: DRAFT_242,
      checks: [{ verdicts: [settingsVerdict(true, settingsMet)], planVerdicts: [itemMissing, planVerdicts242[1]] }],
    });
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
    expect(planRow(result.notes)).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: "No paragraph says the coves heat unevenly; the repair left the checked text as it was",
    });
    expectNoStaleWording(result.notes);
  });

  it("a repair that shortening turned back into the checked text leaves the plan row not applied and not repaired (review P2 b)", async () => {
    const filler = (topic: string) =>
      `The team recorded each ${topic} run in the shop log and compared it with the run before it on the same line.`;
    const paragraphs = (topic: string, count: number) => Array.from({ length: count }, () => filler(topic)).join(" ");
    // Within the Locked cap, over the compression floor: the checked text.
    const checked = `${DRAFT_242}\n\n${paragraphs("oven", 7)}`;
    // Over the Locked cap: the draft and the repair, before shortening.
    const long = `${checked}\n\n${paragraphs("door", 9)}`;
    const repaired = long.replace("The team did not know whether", "It was not known whether");
    expect(sectionMetrics(checked, "s242").overLimit).toBe(false);
    expect(sectionMetrics(long, "s242").overLimit).toBe(true);
    const { sent, result } = await draft("242", true, {
      draft: long,
      repair: repaired,
      compressions: [checked, checked],
      checks: [{ verdicts: [settingsVerdict(true, settingsMet)], planVerdicts: [itemMissing, planVerdicts242[1]] }],
    });
    expect(result.draftText).toBe(checked);
    // The repair was used and shortened back to the checked text: no check
    // of the final text runs.
    expect(sent.map((request) => request.stage)).toEqual(["section", "compression", "selfCheck", "repair", "compression"]);
    expect(planRow(result.notes)).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: "No paragraph says the coves heat unevenly; the repair left the checked text as it was",
    });
    expectNoStaleWording(result.notes);
  });

  // Review P3-1 of the follow-up: in Single draft and Compare the model words
  // its own labels, so the check of the final text can leave out a label the
  // first check found met; it keeps its row, as not checked, and counts as
  // no failure.
  it("Single draft: a met label the check of the final text gave no verdict for keeps its row, not checked (review P3-1)", async () => {
    const hedged = { paragraph: 3, check: "confidence", instruction: "The Trial 2 result is uncertain.", outcome: "applied", reason: "P3 hedges Trial 2." };
    const { sent, result } = await draft("244", false, {
      draft: DRAFT_244,
      repair: REPAIRED_244,
      checks: [
        { verdicts: [settingsVerdict(false, THIRD_PERSON_MISSING), hedged] },
        { verdicts: [settingsVerdict(false, { outcome: "applied", reason: "Third person throughout." })] },
      ],
    });
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "selfCheck"]);
    const rows = result.notes.filter((row) => row.source === "model");
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.instruction === hedged.instruction)).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: "Not checked on the final text (the Self-check gave no verdict for it)",
    });
    expect(JSON.parse(result.selfCheck)).toMatchObject({ status: "repair_attempted", remainingFailures: 0 });
  });
});
