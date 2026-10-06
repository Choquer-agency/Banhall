/// <reference types="vite/client" />
/**
 * 2026-10-04 (first), Round 5 (owner approved 2026-10-05, "Build code
 * checks"): the writer's terms, banned words and required openings are
 * measured in code, sent to the one repair as exact issues, and measured
 * again on the final text. Release suite run 5 of 2026-10-05 (fixture
 * writer-settings-document) found Line 242 with no sentence opening "The
 * aim of this work was to" and Line 244 P3 saying "pinhole formation",
 * while the settings rows gave other reasons, clipped.
 *
 * Each test drafts one Line through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed. The writer's settings are the release suite fixture's document.
 * Fictional project.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import schema from "./schema";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import { draftCheckedSection } from "./ai/orderedGeneration";
import { COMPRESSION_REQUEST, ORDERED_PROMPT_SCAFFOLDS } from "./ai/promptDefinitions";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { extractSettingsRules } from "./lib/settingsExtraction";
import { buildFrozenSummaryPlan } from "./lib/seedRevisions";
import type { Id } from "./_generated/dataModel";
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

const SETTINGS = readFileSync(
  path.join(process.cwd(), "scripts/seed-plan-eval/fixtures/writer-settings-document/settings.md"),
  "utf8"
);

function payload(signedOff = false): OrderedPayload {
  return {
    analysis: JSON.stringify({
      company_context: "A fictional panel finisher",
      project_goal: "Powder coat routed MDF doors",
      business_problem: "Lacquer lines were slow",
      scientific_technical_problem: "Heat drove gas out of the board",
      technological_objective: "Full cure without outgassing defects",
      work_performed: {},
      project_status: "completed",
    }),
    brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
    writerFlavor: SETTINGS,
    orderedContext: {
      profileState: "applied",
      // The org turned the House Rule openers off, so the writer's apply.
      categoryOutcomes: [{ category: "openingClauses", mode: "off", effective: true, tier: "org_enforced" }],
      buildOrder: ["242", "244", "246"],
      selfCheckRules: extractSettingsRules(SETTINGS).selfCheckRules,
    },
    frozenStyleGuidance: "",
    ...(signedOff ? { summaryVersionId: "summary-version-velloway" as Id<"summaryVersions"> } : {}),
  } as OrderedPayload;
}

const ITEM_246 = "item-velloway-edge" as Id<"summaryItems">;
/** The Summary Self-check's label for the writer's settings, held. */
const profileHeld = { paragraph: 0, check: "instruction", instruction: "writer:profile", outcome: "applied", reason: "Followed." };
const COVER_246 = "The pilot met the 60 micron edge target on most shaker panels.";
const PLAN_246 = buildFrozenSummaryPlan({
  section: "s246",
  items: [{ itemId: ITEM_246, roleId: "overall_advancement", kind: "standard", bullets: [COVER_246], support: "source_supported" }],
  skippedRoleIds: [],
});

function claim(section: "242" | "244" | "246", glossaryTerms: string[] = [], plan: typeof PLAN_246 | null = null) {
  return {
    projectId: "project-velloway",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: section === "242" ? 0 : 1,
    isFirstInOrder: section === "242",
    priorSections: [],
    briefBlock: "",
    brief: glossaryTerms.length > 0
      ? { storylineText: "", claimExclusions: [], confidenceMap: [], glossaryTerms }
      : null,
    planBlock: plan ? `\n\n${plan.block}` : "",
    planChecksBlock: plan?.checksBlock ?? "",
    planChecks: plan?.checks ?? [],
    editedTerms: [],
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

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
function systemOf(json: Record<string, unknown>): string {
  return typeof json.system === "string"
    ? json.system
    : Array.isArray(json.system)
      ? json.system.map((block: { text?: string }) => block.text ?? "").join("")
      : "";
}

async function draft(
  section: "242" | "244" | "246",
  script: { draft: string; repair: string; checks: unknown[] },
  glossaryTerms: string[] = [],
  plan: typeof PLAN_246 | null = null
) {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const json = JSON.parse(await new Request(input, init).text()) as Record<string, unknown>;
      const user = userOf(json);
      const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
      const stage = tool === "submit_self_check"
        ? "selfCheck"
        : tool ?? (systemOf(json).startsWith(COMPRESSION_REQUEST.system.slice(0, 60))
          ? "compression"
          : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
      sent.push({ stage, user });
      const base = { id: "msg_synthetic", type: "message", role: "assistant", model: json.model, stop_sequence: null, usage: { input_tokens: 40, output_tokens: 8 } };
      if (tool === "submit_self_check") {
        const answer = checks.shift();
        if (answer === undefined) throw new Error("No Self-check answer scripted");
        return Response.json({ ...base, content: [{ type: "tool_use", id: "toolu_check", name: tool, input: answer }], stop_reason: "tool_use" });
      }
      if (tool) throw new Error(`Unexpected tool ${tool}`);
      return Response.json({ ...base, content: [{ type: "text", text: stage === "repair" ? script.repair : script.draft }], stop_reason: "end_turn" });
    })
  );
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const result = await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({ claim: claim(section, glossaryTerms, plan), payload: payload(plan !== null), section, clientFor });
  });
  const note = (instruction: string) => result.notes.find((row) => row.instruction === instruction);
  return { sent, result, note };
}

/** The model judged the whole settings document followed, as run 5's rows read. */
const settingsVerdict = {
  paragraph: 0,
  check: "instruction",
  instruction: "# PD Writing Customized Settings ...",
  outcome: "applied",
  reason: "Terms, banned words and third person all respected.",
};

describe("the writer's wording rules are measured, repaired and measured again (Round 5)", () => {
  it("run 5, Line 244: the banned synonym is found in code, sent to the repair as an exact issue, and the row reads repaired", async () => {
    const drafted = [
      "Velloway Panel Finishing ran two oven trials on routed MDF doors.",
      "Trial 1 measured film build on the edges at 64 microns.",
      "In Trial 2, pinhole formation was tied to panel surface temperature itself.",
    ].join("\n\n");
    const repaired = drafted.replace("pinhole formation", "the formation of outgassing defects");
    const { sent, result, note } = await draft("244", {
      draft: drafted,
      repair: repaired,
      checks: [{ verdicts: [settingsVerdict] }, { verdicts: [settingsVerdict] }],
    });
    const repair = sent.find((request) => request.stage === "repair");
    if (!repair) throw new Error("The measured break was not repaired");
    expect(repair.user).toContain(
      'Paragraph 3: replace "pinhole" with wording that uses "outgassing defects" (the writer\'s settings never allow "pinholes" on its own).'
    );
    expect(result.draftText).toBe(repaired);
    expect(note("Writer's term: outgassing defects")).toMatchObject({
      source: "deterministic",
      outcome: "applied",
      repaired: true,
      reason: '"outgassing defects" used; no banned synonym; repaired',
    });
    expect(note("Writer's banned word: optimize")).toMatchObject({ outcome: "applied" });
  });

  // Rule 12 (lead decision, owner informed): a repair made for a measured
  // rule is kept even when it takes the Line over the writer's cap the
  // checked draft met, and the cap row says so. A shortening pass that
  // would bring the banned synonym back is not kept (Rule 11).
  it("keeps a repair that fixed a measured rule though it took Line 244 over the writer's cap, and the cap row says why", async () => {
    const filler = (count: number) =>
      Array.from({ length: count }, (_, index) => `Trial ${index + 1} logged film build, panel surface temperature and line speed for every routed door in the run.`).join(" ");
    const drafted = [
      "Velloway Panel Finishing ran oven trials on routed MDF doors.",
      `In Trial 2, pinhole formation was tied to panel surface temperature itself. ${filler(25)}`,
    ].join("\n\n");
    const repaired = drafted.replace("pinhole formation", "the formation of outgassing defects") + ` ${filler(4)}`;
    const cap = "- Line 244: no more than 520 words.";
    expect(sectionMetrics(drafted, "s244").words).toBeLessThanOrEqual(520);
    expect(sectionMetrics(repaired, "s244").words).toBeGreaterThan(520);
    const { result, note } = await draft("244", {
      draft: drafted,
      repair: repaired,
      checks: [{ verdicts: [settingsVerdict] }, { verdicts: [settingsVerdict] }],
    });
    expect(result.draftText).toBe(repaired);
    expect(note("Writer's term: outgassing defects")).toMatchObject({ outcome: "applied", repaired: true });
    expect(note(cap)?.reason).toMatch(
      /^exceeds: \d+\/520 words; the repair, kept for what it fixed, took Line 244 over the writer's cap that the checked draft met \(\d+\/520 words\); still over after \d+ shortening passes?\./
    );
  });

  it("run 5, Line 242: a required opening that starts no sentence is repaired, and the model's settings row cannot say it was followed", async () => {
    const drafted = [
      "Velloway Panel Finishing coats routed MDF cabinet doors with a low-temperature powder.",
      "This work aimed to develop a powder finish for routed MDF doors with full edge coverage.",
      "It was not known at the outset whether full cure could be reached below the outgassing onset.",
    ].join("\n\n");
    const repaired = drafted.replace("This work aimed to develop", "The aim of this work was to develop");
    // The repair does not run: the model's first check is all it gets, so
    // its settings row is judged with the measured break still there.
    const unrepaired = await draft("242", { draft: drafted, repair: drafted, checks: [{ verdicts: [settingsVerdict] }] });
    expect(unrepaired.sent.find((request) => request.stage === "repair")?.user).toContain(
      'Open the statement of the objective with "The aim of this work was to".'
    );
    expect(unrepaired.note('Writer\'s opening for the objective statement: "The aim of this work was to"')).toMatchObject({
      outcome: "not_applied",
      reason: 'No sentence of Line 242 opens with "The aim of this work was to", which the writer\'s settings require for the objective statement; repair failed',
    });
    const settingsRow = unrepaired.result.notes.find((row) => row.source === "model");
    expect(settingsRow).toMatchObject({ outcome: "not_applied" });
    expect(settingsRow?.reason).toMatch(/^Not followed in full: no sentence of Line 242 opens with "The aim of this work was to" \(measured by code; see that row\)\./);

    const fixed = await draft("242", {
      draft: drafted,
      repair: repaired,
      checks: [{ verdicts: [settingsVerdict] }, { verdicts: [settingsVerdict] }],
    });
    expect(fixed.result.draftText).toBe(repaired);
    expect(fixed.note('Writer\'s opening for the objective statement: "The aim of this work was to"')).toMatchObject({
      outcome: "applied",
      repaired: true,
    });
  });

  // Round 5 follow-up (release suite run 6 of 2026-10-05): the settings row
  // read not applied with wrong reasons beside true measured rows, and a
  // Glossary Term repair rewrote the writer's own term.
  it("reads a settings verdict that only talks about kept measured rules as applied: no repair", async () => {
    const kept = [
      "Velloway Panel Finishing coats routed MDF cabinet doors with a low-temperature powder.",
      "The aim of this work was to develop a powder finish for routed MDF doors.",
      "It was not known at the outset whether full cure could be reached below the outgassing onset.",
    ].join("\n\n");
    const { sent, result } = await draft("242", {
      draft: kept,
      repair: kept,
      checks: [{ verdicts: [{ ...settingsVerdict, outcome: "not_applied", reason: "P1 opener differs", repairGuidance: "Open P1 with the opener." }] }],
    });
    // Nothing is left to repair.
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    expect(result.draftText).toBe(kept);
    expect(result.notes.find((row) => row.source === "model")).toMatchObject({
      outcome: "applied",
      reason: "Every rule code measures on this Line was kept (see those rows); the Self-check's own remark, which they settle: P1 opener differs",
    });
  });

  // Re-check P2-1 (run 6): a Glossary Term repair rewrote the writer's
  // "edge coverage"; the repair that removes a writer's term is not used.
  it("does not use a repair that removes a term the writer's settings require", async () => {
    const drafted = [
      "Velloway Panel Finishing ran oven trials on routed MDF doors.",
      "Trial 1 measured edge coverage at 64 microns on the routed edges.",
    ].join("\n\n");
    const rewritten = drafted.replace("edge coverage", "film build");
    const { sent, result, note } = await draft("246", {
      draft: drafted,
      repair: rewritten,
      checks: [{
        verdicts: [{ paragraph: 2, check: "glossary", instruction: "Glossary Term: film build", outcome: "not_applied", reason: "P2 uses edge coverage, not film build.", repairGuidance: "Replace edge coverage with film build." }],
      }],
    }, ["film build"]);
    expect(sent.some((request) => request.stage === "repair")).toBe(true);
    expect(result.draftText).toBe(drafted);
    expect(note("Glossary Term: film build")?.reason).toBe(
      'P2 uses edge coverage, not film build.; repair not used (the repaired text removed the last use of "edge coverage", the writer\'s term; the checked draft did not, so it was kept)'
    );
  });

  // Final re-check P2-C1 (lead decision, owner informed): accuracy, the
  // Locked Rules and signed-off items outrank the Writer Profile.
  it("keeps a repair made for a signed-off item though it dropped the writer's term, and that term's row names the loss", async () => {
    const drafted = [
      "Velloway Panel Finishing ran a pilot on routed MDF doors.",
      "The pilot measured edge coverage on the shaker doors.",
    ].join("\n\n");
    const repaired = drafted.replace("The pilot measured edge coverage on the shaker doors.", COVER_246);
    const { sent, result, note } = await draft("246", {
      draft: drafted,
      repair: repaired,
      checks: [
        { verdicts: [profileHeld], planVerdicts: [{ itemId: ITEM_246, mergedItemIds: [ITEM_246], paragraph: 0, outcome: "not_applied", reason: "No paragraph states the 60 micron target.", repairGuidance: "State that the pilot met the 60 micron edge target." }] },
        { verdicts: [profileHeld], planVerdicts: [{ itemId: ITEM_246, mergedItemIds: [ITEM_246], paragraph: 2, outcome: "applied", reason: "P2 states the target." }] },
      ],
    }, [], PLAN_246);
    const repair = sent.find((request) => request.stage === "repair")!;
    // The writer's terms and bans reach the repair (writers with such rules only).
    expect(repair.user).toContain('The writer\'s settings require these terms word for word: "film build", "panel surface temperature", "cure window", "edge coverage", "outgassing defects".');
    expect(repair.user).toContain('The writer\'s settings ban these words, even where the client or the sources use them: never write "DFT", ');
    expect(result.draftText).toBe(repaired);
    expect(note("Writer's term: edge coverage")?.reason).toBe(
      'no banned synonym of "edge coverage"; the repair, kept for what it fixed (which outranks the writer\'s settings), removed the last use of "edge coverage", the writer\'s term'
    );
  });

  it("does not use a repair made only for the Storyline that writes a banned synonym", async () => {
    const drafted = [
      "Velloway Panel Finishing ran oven trials on routed MDF doors.",
      "Trial 1 measured film build at 64 microns on the routed edges.",
    ].join("\n\n");
    const repaired = drafted.replace("film build at 64 microns", "film build at 64 microns, reported as DFT in the log,");
    const { result, note } = await draft("246", {
      draft: drafted,
      repair: repaired,
      checks: [{ verdicts: [{ paragraph: 2, check: "storyline", instruction: "Storyline", outcome: "not_applied", reason: "P2 drifts.", repairGuidance: "Tie P2 to the trials." }] }],
    });
    expect(result.draftText).toBe(drafted);
    expect(note("Storyline")?.reason).toBe(
      'P2 drifts.; repair not used (the repaired text wrote "DFT", which the writer\'s settings ban in favour of "film build"; the checked draft did not, so it was kept)'
    );
  });

  // Greptile on PR #27 at 09852dfa, P1: a repair made for a signed-off item
  // that still fails it, but broke a writer's rule, is not used.
  it("does not use a repair for a signed-off item that broke a writer's rule and left the item unfixed", async () => {
    const drafted = [
      "Velloway Panel Finishing ran a pilot on routed MDF doors.",
      "The pilot measured edge coverage on the shaker doors.",
    ].join("\n\n");
    const repaired = drafted.replace("The pilot measured edge coverage on the shaker doors.", "The pilot measured coating on the shaker doors.");
    const missing = { itemId: ITEM_246, mergedItemIds: [ITEM_246], paragraph: 0, outcome: "not_applied", reason: "No paragraph states the 60 micron target.", repairGuidance: "State that the pilot met the 60 micron edge target." };
    const { result, note } = await draft("246", {
      draft: drafted,
      repair: repaired,
      checks: [
        { verdicts: [profileHeld], planVerdicts: [missing] },
        { verdicts: [profileHeld], planVerdicts: [missing] },
      ],
    }, [], PLAN_246);
    expect(result.draftText).toBe(drafted);
    expect(note("Writer's term: edge coverage")?.reason).toBe('"edge coverage" used; no banned synonym');
    const itemRow = result.notes.find((row) => row.planRef?.itemId === ITEM_246);
    expect(itemRow?.reason).toContain(
      'repair not used (the repaired text removed the last use of "edge coverage", the writer\'s term, and the check of the final text found no issue that outranks the writer\'s settings fixed, so the checked draft was kept)'
    );
  });

  // Greptile on PR #27 at 09852dfa, P2: every loss is explained on its own row.
  it("explains each writer's rule a kept repair broke on that rule's own row", async () => {
    const drafted = [
      "Velloway Panel Finishing ran a pilot on routed MDF doors.",
      "The pilot measured edge coverage on the shaker doors.",
    ].join("\n\n");
    const repaired = drafted.replace("The pilot measured edge coverage on the shaker doors.", `${COVER_246} The log gave it as DFT.`);
    const { result, note } = await draft("246", {
      draft: drafted,
      repair: repaired,
      checks: [
        { verdicts: [profileHeld], planVerdicts: [{ itemId: ITEM_246, mergedItemIds: [ITEM_246], paragraph: 0, outcome: "not_applied", reason: "No paragraph states the 60 micron target.", repairGuidance: "State that the pilot met the 60 micron edge target." }] },
        { verdicts: [profileHeld], planVerdicts: [{ itemId: ITEM_246, mergedItemIds: [ITEM_246], paragraph: 2, outcome: "applied", reason: "P2 states the target." }] },
      ],
    }, [], PLAN_246);
    expect(result.draftText).toBe(repaired);
    expect(note("Writer's term: edge coverage")?.reason).toMatch(/; the repair, kept for what it fixed \(which outranks the writer's settings\), removed the last use of "edge coverage", the writer's term$/);
    expect(note("Writer's term: film build")?.reason).toMatch(/; the repair, kept for what it fixed \(which outranks the writer's settings\), wrote "DFT", which the writer's settings ban in favour of "film build"$/);
  });
});
