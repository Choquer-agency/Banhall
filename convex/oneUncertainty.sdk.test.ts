/// <reference types="vite/client" />
/**
 * 2026-10-30 (owner, "please fix all properly"): the report's uncertainties,
 * the claimant line and the notes-to-the-writer check, through one drafted
 * Line (draftCheckedSection) with the real Anthropic SDK and the production
 * instrumented client; only `fetch` is stubbed. The data is fictional (a
 * cold-room controls maker, Quillmere Analytics).
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import { withPlaceholders } from "./ai/placeholderClient";
import { draftCheckedSection } from "./ai/orderedGeneration";
import { COMPRESSION_REQUEST, ORDERED_PROMPT_SCAFFOLDS } from "./ai/promptDefinitions";
import {
  CLAIMANT_LINE,
  SECTION_UNCERTAINTY_SCOPE,
  SELF_CHECK_NO_NOTES_RULE,
  SELF_CHECK_SYSTEM_PROMPT,
  SELF_CHECK_UNCERTAINTY_SCOPE_RULE,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
  claimantBlock,
} from "./ai/prompts";
import { reportUncertaintiesBody } from "./ai/selfCheck";
import { NOTES_TO_WRITER } from "./ai/qaChecks";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { buildFrozenSummaryPlan } from "./lib/seedRevisions";
import { buildPlaceholderMap, type PlaceholderMap } from "./lib/deidentify";
import type { OrderedPayload, SectionNumber } from "./lib/orderedChain";
import { stubFetchStreaming } from "./anthropicSse.fixture";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const SONNET = "claude-sonnet-5";
const SUMMARY_VERSION = "summary-version-quillmere" as Id<"summaryVersions">;
const COMPANY = "Quillmere Analytics Ltd.";

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
  stubFetchStreaming(vi, vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const PASSIVE = ["Setpoint tables assume a closed room."];
const ACTIVE = ["Whether a control step can follow the heat load of an open dock door."];
const ANALYSIS = {
  company_context: "A fictional maker of cold-room controllers",
  project_goal: "Hold cold rooms at their setpoint while dock doors stay open",
  business_problem: "Rooms drifted above setpoint during loading",
  scientific_technical_problem: "No control step was known to follow an open door's heat load",
  passive_uncertainties: PASSIVE,
  active_uncertainties: ACTIVE,
  technological_objective: "A control step that follows the door load",
  work_performed: {},
  project_status: "ongoing",
};

const DRAFT_244 = [
  "The team ran the controller with a 30-second step during loading shifts at the warehouse.",
  "The materials do not report what that testing showed.",
].join("\n\n");
const REPAIRED_244 = [
  "The team ran the controller with a 30-second step during loading shifts at the warehouse.",
  "[GAP: what the runs with the 30-second step showed]",
].join("\n\n");

function payload(summaryVersionId?: Id<"summaryVersions">, writerFlavor?: string): OrderedPayload {
  return {
    analysis: JSON.stringify(ANALYSIS),
    brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
    ...(writerFlavor ? { writerFlavor } : {}),
    orderedContext: {
      profileState: writerFlavor ? "applied" : "missing",
      categoryOutcomes: [],
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    },
    frozenStyleGuidance: "",
    ...(summaryVersionId ? { summaryVersionId } : {}),
  } as OrderedPayload;
}

const ITEM = "item-quillmere-work" as Id<"summaryItems">;
function plan244() {
  return buildFrozenSummaryPlan({
    section: "s244",
    items: [{
      itemId: ITEM,
      roleId: "experimentation",
      kind: "standard",
      bullets: ["The team ran the controller with a 30-second step during loading shifts."],
      support: "source_supported",
    }],
    skippedRoleIds: [],
  });
}

function claimFor(options: { plan?: ReturnType<typeof plan244>; claimantName?: string } = {}) {
  const { plan } = options;
  return {
    projectId: "project-quillmere",
    ...(options.claimantName ? { claimantName: options.claimantName } : {}),
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 1,
    isFirstInOrder: false,
    priorSections: [],
    briefBlock: "",
    brief: { storylineText: "", claimExclusions: [], confidenceMap: [], glossaryTerms: [] },
    planBlock: plan ? `\n\n${plan.block}` : "",
    planChecksBlock: plan?.checksBlock ?? "",
    planChecks: plan?.checks ?? [],
    editedTerms: [],
    droppedNotChecked: [],
    answers242: null,
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

type Sent = { stage: string; user: string; system: string; shared: string };

function blocksOf(json: Record<string, unknown>): string[] {
  const messages = (json.messages ?? []) as Array<{ role: string; content: unknown }>;
  return messages
    .filter((message) => message.role === "user")
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : Array.isArray(message.content) ? message.content.map((block: { text?: string }) => block.text ?? "") : []);
}
function systemOf(json: Record<string, unknown>): string {
  const system = json.system as string | Array<{ text?: string }> | undefined;
  return typeof system === "string" ? system : (system ?? []).map((block) => block.text ?? "").join("");
}

/** Scripts one Section: the draft, the repair and each Self-check answer, in order. */
function installFetch(script: { draft: string; repair?: string; checks: unknown[] }): Sent[] {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  stubFetchStreaming(vi, vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const json = JSON.parse(await request.text()) as Record<string, unknown>;
    const blocks = blocksOf(json);
    const user = blocks.join("\n");
    const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
    const stage = tool === "submit_self_check"
      ? sent.some((entry) => entry.stage === "repair") ? "finalCheck" : "selfCheck"
      : tool ?? (user.includes(COMPRESSION_REQUEST.userScaffold.wordsToLimit)
        ? "compression"
        : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
    sent.push({ stage, user, system: systemOf(json), shared: blocks[0] ?? "" });
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
    const text = stage === "repair" ? script.repair ?? script.draft : script.draft;
    return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
  }));
  return sent;
}

async function draft(
  section: SectionNumber,
  claim: ReturnType<typeof claimFor>,
  options: { summaryVersionId?: Id<"summaryVersions">; placeholders?: PlaceholderMap; writerFlavor?: string } = {}
) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => {
        const client = instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient;
        return options.placeholders ? withPlaceholders(client, options.placeholders) : client;
      },
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({ claim, payload: payload(options.summaryVersionId, options.writerFlavor), section, clientFor });
  });
}

describe("Single draft and Compare: the report's uncertainties, the claimant and no notes (real SDK, fetch stubbed)", () => {
  it("drafts with the claimant line and the scope rule, checks the scope, and repairs a note to the writer", async () => {
    const sent = installFetch({ draft: DRAFT_244, repair: REPAIRED_244, checks: [{ verdicts: [] }, { verdicts: [] }] });
    const result = await draft("244", claimFor({ claimantName: COMPANY }));
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCheck"]);
    expect(result.draftText).toBe(REPAIRED_244);

    // The draft: the claimant line closes the shared block; the scope rule follows the Line's instructions.
    const section = sent[0]!;
    expect(section.shared.endsWith(`}${claimantBlock(COMPANY)}`)).toBe(true);
    expect(section.shared.split(CLAIMANT_LINE.prefix)).toHaveLength(2);
    expect(section.user.split(SECTION_UNCERTAINTY_SCOPE)).toHaveLength(2);

    // The Self-check: its scope and notes rules, and the analysis's lists as its last block.
    const check = sent[1]!;
    expect(check.system).toBe(SELF_CHECK_SYSTEM_PROMPT);
    expect(check.system).toContain(SELF_CHECK_UNCERTAINTY_SCOPE_RULE);
    expect(check.system).toContain(SELF_CHECK_NO_NOTES_RULE);
    expect(check.user.endsWith(
      `--- BEGIN [REPORT UNCERTAINTIES] ---\n${reportUncertaintiesBody({ passive: PASSIVE, active: ACTIVE })}\n--- END [REPORT UNCERTAINTIES] ---`
    )).toBe(true);

    // The repair: the same request with the Locked notes fix, the claimant line and the scope rule.
    const repair = sent[2]!;
    expect(repair.user).toContain(`- Paragraph 2: ${NOTES_TO_WRITER.fix} ("The materials do not report"). ${NOTES_TO_WRITER.rule}`);
    expect(repair.shared).toBe(section.shared);
    expect(repair.user.split(SECTION_UNCERTAINTY_SCOPE)).toHaveLength(2);
    // The check of the final text gets the same lists.
    expect(sent[3]!.user).toContain("--- BEGIN [REPORT UNCERTAINTIES] ---");

    expect(result.notes.find((row) => row.instruction === NOTES_TO_WRITER.instruction)).toEqual({
      section: "244",
      source: "deterministic",
      instruction: NOTES_TO_WRITER.instruction,
      outcome: "applied",
      tier: "locked",
      reason: `${NOTES_TO_WRITER.applied}; repaired`,
      repaired: true,
    });
  });

  it("a clean Line gets no notes row and no repair, and no claimant line without a name on the record", async () => {
    const sent = installFetch({ draft: REPAIRED_244, checks: [{ verdicts: [] }] });
    const result = await draft("244", claimFor());
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    expect(sent[0]!.shared).not.toContain(CLAIMANT_LINE.prefix);
    expect(result.notes.some((row) => row.instruction === NOTES_TO_WRITER.instruction)).toBe(false);
  });

  it("the model reads the claimant as its placeholder, and the Line comes back with the name (decision 26)", async () => {
    const map = buildPlaceholderMap({ clientName: COMPANY, companies: [], people: [] });
    const named = "[CLIENT_1] ran the controller with a 30-second step during loading shifts. [GAP: what the runs showed]";
    const sent = installFetch({ draft: named, checks: [{ verdicts: [] }] });
    const result = await draft("244", claimFor({ claimantName: COMPANY }), { placeholders: map });
    expect(sent[0]!.shared.endsWith(`}\n\nCLAIMANT: [CLIENT_1]${CLAIMANT_LINE.rule}`)).toBe(true);
    for (const request of sent) expect(request.user).not.toContain("Quillmere");
    expect(result.draftText).toBe(`${COMPANY} ran the controller with a 30-second step during loading shifts. [GAP: what the runs showed]`);
  });
});

// Review round 1 (plumbing P1-b): the notes check is a Locked Rule, so a
// writer's required wording never keeps a note in the report.
describe("a Locked notes repair outranks the writer's wording (real SDK, fetch stubbed)", () => {
  const SETTINGS =
    "## Glossary\n\nUse these exact terms. Never use the alternatives listed after each one.\n\n- transcript: the text the speech app writes from a call. Never write caption log or text dump.\n";
  const NOTED = [
    "The app labelled each speaker turn in long calls.",
    "The transcript states that the labels drifted after twenty minutes.",
  ].join("\n\n");
  const FIXED = [
    "The app labelled each speaker turn in long calls.",
    "[GAP: how the labels behaved after twenty minutes]",
  ].join("\n\n");

  it("uses the repair that takes the note out, though it drops the writer's required term", async () => {
    const sent = installFetch({ draft: NOTED, repair: FIXED, checks: [{ verdicts: [] }, { verdicts: [] }] });
    const result = await draft("244", claimFor(), { writerFlavor: SETTINGS });
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCheck"]);
    expect(sent[2]!.user).toContain(`- Paragraph 2: ${NOTES_TO_WRITER.fix} ("The transcript states"). ${NOTES_TO_WRITER.rule}`);
    expect(result.draftText).toBe(FIXED);
    expect(result.notes.find((row) => row.instruction === NOTES_TO_WRITER.instruction)).toMatchObject({
      outcome: "applied",
      tier: "locked",
      reason: `${NOTES_TO_WRITER.applied}; repaired`,
      repaired: true,
    });
    // The writer's term row says the repair took it out, and why it was kept.
    expect(result.notes.find((row) => row.instruction === "Writer's term: transcript")?.reason).toBe(
      'no banned synonym of "transcript"; the repair, kept for what it fixed (which outranks the writer\'s settings), removed the last use of "transcript", the writer\'s term'
    );
  });
});

describe("Step by step: the signed-off plan sets the scope (real SDK, fetch stubbed)", () => {
  it("sends the claimant line but no scope rule, no scope or notes Self-check rule and no uncertainty lists", async () => {
    const plan = plan244();
    const covered = { itemId: ITEM, mergedItemIds: [ITEM], paragraph: 1, outcome: "applied", reason: "P1 states the work." };
    const sent = installFetch({ draft: REPAIRED_244, checks: [{ verdicts: [], planVerdicts: [covered] }] });
    await draft("244", claimFor({ plan, claimantName: COMPANY }), { summaryVersionId: SUMMARY_VERSION });
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    expect(sent[0]!.shared.endsWith(claimantBlock(COMPANY))).toBe(true);
    expect(sent[0]!.user).not.toContain(SECTION_UNCERTAINTY_SCOPE);
    expect(sent[1]!.system).toBe(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT);
    expect(sent[1]!.system).not.toContain(SELF_CHECK_UNCERTAINTY_SCOPE_RULE);
    expect(sent[1]!.system).not.toContain(SELF_CHECK_NO_NOTES_RULE);
    expect(sent[1]!.user).not.toContain("REPORT UNCERTAINTIES");
  });
});

describe("the claimant's name is frozen at reservation, with the placeholder map", () => {
  async function setup(placeholders?: "off", clientName = `  ${COMPANY} `) {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const ids = await t.run(async (ctx) => {
      const writerId = await ctx.db.insert("users", { authId: "qa-claimant-writer", role: "writer", firstName: "Wren", lastName: "Writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Cold room control",
        clientName,
        status: "draft",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: "claimant-token",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("transcripts", {
        projectId,
        content: "Interviewer: What did you build?\n\nClient: A controller for cold rooms at Northbay Retail.",
        createdAt: 1,
        position: 0,
      });
      if (placeholders) {
        await ctx.db.insert("appSettings", { key: "transcripts.placeholders", value: placeholders, updatedBy: writerId, updatedAt: 1 });
      }
      return { writerId, projectId };
    });
    const writer = t.withIdentity({ subject: "qa-claimant-writer" });
    const generationId = await writer.mutation(api.generations.requestGeneration, { projectId: ids.projectId, candidateMode: "single" });
    return { t, ...ids, generationId };
  }

  it("freezes the record's name, which every request of the draft reads, and a later rename changes none of them", async () => {
    const f = await setup();
    const generation = await f.t.run((ctx) => ctx.db.get(f.generationId));
    expect(generation?.claimantName).toBe(COMPANY);
    expect(generation?.placeholders?.[0]).toMatchObject({ token: "[CLIENT_1]", value: COMPANY });
    expect((await f.t.query(internal.generations.getGenerationInput, { generationId: f.generationId }))?.claimantName).toBe(COMPANY);
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { clientName: "Quillmere Robotics Inc." }));
    expect((await f.t.query(internal.generations.getGenerationInput, { generationId: f.generationId }))?.claimantName).toBe(COMPANY);
  });

  it("with placeholders switched off, the name is sent as written", async () => {
    const f = await setup("off");
    const generation = await f.t.run((ctx) => ctx.db.get(f.generationId));
    expect(generation?.placeholders).toBeUndefined();
    expect((await f.t.query(internal.generations.getGenerationInput, { generationId: f.generationId }))?.claimantName).toBe(COMPANY);
  });

  // Review round 1 (plumbing P1-a): an empty map is not the switch being off.
  it("with placeholders on, a name too short to hide is frozen but never sent", async () => {
    const f = await setup(undefined, "AB");
    const generation = await f.t.run((ctx) => ctx.db.get(f.generationId));
    expect(generation?.claimantName).toBe("AB");
    expect(generation?.placeholdersOff).toBeUndefined();
    expect(generation?.placeholders ?? []).toEqual([]);
    expect((await f.t.query(internal.generations.getGenerationInput, { generationId: f.generationId }))?.claimantName).toBeUndefined();
  });

  it("with placeholders off, the switch is frozen and even a short name is sent as written", async () => {
    const f = await setup("off", "AB");
    const generation = await f.t.run((ctx) => ctx.db.get(f.generationId));
    expect(generation?.placeholdersOff).toBe(true);
    expect((await f.t.query(internal.generations.getGenerationInput, { generationId: f.generationId }))?.claimantName).toBe("AB");
  });

  it("a generation reserved before froze no name and sends no claimant line", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.patch(f.generationId, { claimantName: undefined }));
    const input = await f.t.query(internal.generations.getGenerationInput, { generationId: f.generationId });
    expect(input).not.toBeNull();
    expect(input?.claimantName).toBeUndefined();
  });
});
