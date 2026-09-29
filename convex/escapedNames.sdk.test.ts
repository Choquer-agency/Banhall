/// <reference types="vite/client" />
/**
 * 2026-09-29 (second, privacy): names after an escaped line break, tab or
 * CRLF are masked in every request, whatever JSON-encodes the text first.
 *
 * The signed-off plan block, its plan checks, the transcript analysis and
 * the Seed prompt's decisions, Feedback and target blocks are JSON-encoded
 * before the provider boundary masks names. A line break before a name
 * became the letters "\n" glued to it, so the word-edge check skipped it.
 * Placeholder algorithm 5 treats a backslash escape as a word edge.
 *
 * Every request goes through the production placeholder client and the
 * real Anthropic SDK; only `fetch` is stubbed. Every name is fictional.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import { withPlaceholders } from "./ai/placeholderClient";
import { draftCheckedSection } from "./ai/orderedGeneration";
import {
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
  SEED_PROMPT_PROGRAM,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
} from "./ai/promptDefinitions";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { generateStructured } from "./ai/structured";
import {
  buildSeedPrompt,
  buildTrustedContext,
  DEFAULT_CONTEXT_BUDGET,
  seedPromptProjection,
} from "./ai/trustedContext";
import { seedToolSchema } from "./lib/seedContract";
import { buildPlaceholderMap } from "./lib/deidentify";
import { buildFrozenSummaryPlan, canonicalizeSeedSnapshot } from "./lib/seedRevisions";
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
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const MAP = buildPlaceholderMap({
  clientName: "Quillmere Analytics Ltd.",
  people: ["Morgan Hale", "Rosalind Tiwari"],
});
/** A client name and person names after a line break, a tab and a CRLF. */
const WITH_BREAKS =
  "The rig ran in July.\nQuillmere Analytics Ltd. built it.\tMorgan Hale ran it.\r\nQuillmere and Rosalind Tiwari signed.";
const HIDDEN = /Quillmere|Morgan|Hale|Rosalind|Tiwari/;

type Sent = { stage: string; body: string; user: string };

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((block: { text?: string }) => block.text ?? "").join("");
}

describe("names after an escaped break are masked at the request boundary (real SDK, fetch stubbed)", () => {
  it("a Seed request: an edited selection, a Feedback instruction, its target, the Brief and a source", async () => {
    const snapshot = canonicalizeSeedSnapshot({
      v: 1,
      items: [
        { kind: "selection", roleId: "company_context", seedId: "seed-context", bullets: [WITH_BREAKS] },
        { kind: "feedback", roleId: "company_context", feedbackRequestId: "feedback-1", seedId: "seed-context", text: WITH_BREAKS },
        { kind: "ownFeedback", roleId: "goal_problem", feedbackRequestId: "feedback-2", seedId: "seed-goal", text: WITH_BREAKS },
        { kind: "target", roleId: "goal_problem", feedbackRequestId: "feedback-2", seedId: "seed-goal", bullets: [WITH_BREAKS], text: WITH_BREAKS },
      ],
    });
    const request = buildSeedPrompt({
      mode: "feedback",
      objective: "State the goal.",
      brief: { storyline: WITH_BREAKS, entries: [WITH_BREAKS] },
      sources: [{
        sourceId: "source-1",
        label: "Interview",
        kind: "transcript",
        content: `Interviewer: Who built it?\r\n${WITH_BREAKS}`,
        contentHash: "hash-1",
      }],
      projection: seedPromptProjection(snapshot, "goal_problem"),
      writerSettings: { profile: WITH_BREAKS, styleOverrides: {} },
      lengthTarget: "standard",
    });
    // The JSON-encoded blocks hold the escaped breaks glued to the names.
    expect(request.user).toContain("\\nQuillmere Analytics Ltd.");
    expect(request.user).toContain("\\tMorgan Hale");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      bodies.push(await new Request(input, init).text());
      return Response.json({
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: SONNET,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
        content: [{ type: "tool_use", id: "toolu_seed", name: SEED_PROMPT_PROGRAM.request.toolName, input: { seeds: [] } }],
        stop_reason: "tool_use",
      });
    }));
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.action(async (ctx) => {
      await generateStructured(
        withPlaceholders(
          instrumentedAnthropic(ctx, { callSite: "generation:seedFeedback:goal_problem" }) as unknown as GenerationClient,
          MAP
        ),
        {
          system: request.system,
          user: request.userBlocks,
          toolName: SEED_PROMPT_PROGRAM.request.toolName,
          description: SEED_PROMPT_PROGRAM.request.description,
          schema: seedToolSchema() as never,
          maxTokens: SEED_PROMPT_PROGRAM.request.maxTokens,
          model: SONNET,
        }
      );
    });
    expect(bodies).toHaveLength(1);
    const wire = JSON.parse(bodies[0]!) as { system: unknown; messages: Array<{ content: unknown }> };
    const sent = `${textOf(wire.system)}${wire.messages.map((message) => textOf(message.content)).join("")}`;
    expect(sent).not.toMatch(HIDDEN);
    expect(sent).toContain("\\n[CLIENT_1] built it.\\t[PERSON_1] ran it.\\r\\n[CLIENT_1_FIRST] and [PERSON_2] signed.");
  });

  it("a Section's drafting, Self-check, repair and final coverage requests: the plan item, its checks and the analysis", async () => {
    const itemId = "item-escaped" as Id<"summaryItems">;
    const plan = buildFrozenSummaryPlan({
      section: "s242",
      items: [{ itemId, roleId: "company_context", kind: "standard", bullets: [WITH_BREAKS], support: "writer_asserted" }],
      skippedRoleIds: [],
      sourceRefsByItemId: new Map([[itemId, [{ sourceId: "source-1", exactExcerpt: `Q: Who?\r\n${WITH_BREAKS}` }]]]),
    });
    expect(plan.block).toContain("\\nQuillmere Analytics Ltd.");
    expect(plan.checksBlock).toContain("\\tMorgan Hale");
    const payload = {
      analysis: JSON.stringify({
        company_context: WITH_BREAKS,
        project_goal: "A graded filter",
        business_problem: "Filters cracked",
        scientific_technical_problem: "No method",
        technological_objective: "A graded filter",
        work_performed: {},
        project_status: "completed",
      }),
      brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
      orderedContext: { profileState: "missing", categoryOutcomes: [], buildOrder: ["242", "244", "246"], selfCheckRules: [] },
      summaryVersionId: "summary-version-escaped" as Id<"summaryVersions">,
      frozenStyleGuidance: "",
    } satisfies OrderedPayload;
    const claim = {
      projectId: "project-escaped",
      model: SONNET,
      label: "Single draft",
      lengthTarget: "standard",
      orderIndex: 0,
      isFirstInOrder: true,
      priorSections: [],
      briefBlock: "",
      brief: { storylineText: "", claimExclusions: [], confidenceMap: [], glossaryTerms: [] },
      planBlock: `\n\n${plan.block}`,
      planChecksBlock: plan.checksBlock,
      planChecks: plan.checks,
      editedTerms: [],
      writerFeedback: [{ roleId: "company_context", instruction: WITH_BREAKS }],
      glossarySetAside: [],
    } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];

    const draftText = "The company builds grain dryer controllers.\n\nIt wanted early warning of faults.";
    const checks: Array<Array<Record<string, unknown>>> = [
      [{ itemId, mergedItemIds: [itemId], paragraph: 0, outcome: "not_applied", reason: "Not covered.", repairGuidance: "Cover it." }],
      [{ itemId, mergedItemIds: [itemId], paragraph: 1, outcome: "applied", reason: "Covered." }],
    ];
    const sent: Sent[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const body = await new Request(input, init).text();
      const json = JSON.parse(body) as { system: unknown; messages: Array<{ content: unknown }>; tools?: Array<{ name: string }> };
      const user = json.messages.map((message) => textOf(message.content)).join("");
      const tool = json.tools?.[0]?.name ?? null;
      const stage = tool ?? (textOf(json.system).startsWith(COMPRESSION_REQUEST.system.slice(0, 60))
        ? "compression"
        : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
      sent.push({ stage, body, user: `${textOf(json.system)}${user}` });
      const base = { id: "msg_synthetic", type: "message", role: "assistant", model: SONNET, stop_sequence: null, usage: { input_tokens: 40, output_tokens: 8 } };
      if (tool === "submit_self_check") {
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: "toolu_check", name: tool, input: { verdicts: [], planVerdicts: checks.shift() } }],
          stop_reason: "tool_use",
        });
      }
      const text = stage === "repair" ? `${draftText} It built the [CLIENT_1_FIRST] rig.` : draftText;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    }));
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const result = await t.action(async (ctx) => {
      const clientFor = Object.assign(
        (callSite: string) => withPlaceholders(
          instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
          MAP
        ),
        { modelFor: () => SONNET }
      );
      return await draftCheckedSection({ claim, payload, section: "242", clientFor });
    });
    expect(sent.map((request) => request.stage)).toEqual([
      "section", "submit_self_check", "repair", "submit_self_check",
    ]);
    expect(sent[3]!.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction);
    for (const request of sent) {
      expect(request.body, request.stage).not.toMatch(HIDDEN);
      expect(request.user, request.stage).toContain("[CLIENT_1] built it.");
      expect(request.user, request.stage).toContain("[PERSON_1] ran it.");
    }
    // The drafting request's plan and analysis, and the Self-check's plan
    // checks, carry the escaped breaks with the tokens after them.
    expect(sent[0]!.user).toContain("\\n[CLIENT_1] built it.\\t[PERSON_1] ran it.\\r\\n[CLIENT_1_FIRST] and [PERSON_2] signed.");
    expect(sent[1]!.user).toContain("\\n[CLIENT_1] built it.\\t[PERSON_1] ran it.");
    // The model's tokens come back as the names.
    expect(result.draftText).toContain("It built the Quillmere rig.");
  });
});

// Privacy re-check of the escape rule (2026-09-29, second): a literal
// backslash-n before a name, the other escapes (\b, \f, \uXXXX), a control
// character in Feedback, a weak label at the start of an excerpt and a
// hard-wrapped company name, in a Seed request and a Section's requests.
const RECHECK_MAP = buildPlaceholderMap({
  clientName: "Quillmere Analytics Ltd.",
  companies: ["Northern Robotics Inc."],
  people: ["Morgan Hale"],
  phrases: ["Rosalind"],
});
const RECHECK_HIDDEN = /Quillmere|Northern|Robotics|Morgan|Hale|Rosalind/;
/** A literal backslash-n (as a transcript exported it), \b, \f and a control character. */
const LITERAL =
  "Exported\\nQuillmere Analytics Ltd. ran it.\bMorgan Hale checked.\fQuillmere signed.\u0007Morgan agreed.";
/** A weak label that opens the excerpt, and a hard-wrapped company name. */
const EXCERPT = "Rosalind: we tried the rig.\nNorthern\nRobotics Inc. supplied the sensors.";

describe("the privacy re-check cases are masked at the request boundary (real SDK, fetch stubbed)", () => {
  it("a Seed request carrying them in its JSON blocks", async () => {
    const snapshot = canonicalizeSeedSnapshot({
      v: 1,
      items: [
        { kind: "selection", roleId: "company_context", seedId: "seed-context", bullets: [EXCERPT, LITERAL] },
        { kind: "ownFeedback", roleId: "goal_problem", feedbackRequestId: "feedback-2", seedId: "seed-goal", text: LITERAL },
        { kind: "target", roleId: "goal_problem", feedbackRequestId: "feedback-2", seedId: "seed-goal", bullets: [EXCERPT], text: LITERAL },
      ],
    });
    const request = buildSeedPrompt({
      mode: "feedback",
      objective: "State the goal.",
      brief: { storyline: LITERAL, entries: [EXCERPT] },
      sources: [{ sourceId: "source-1", label: "Interview", kind: "transcript", content: EXCERPT, contentHash: "hash-1" }],
      projection: seedPromptProjection(snapshot, "goal_problem"),
      writerSettings: { profile: LITERAL, styleOverrides: {} },
      lengthTarget: "standard",
    });
    expect(request.user).toContain("\\\\nQuillmere Analytics Ltd.");
    expect(request.user).toContain('"Rosalind: we tried');
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      bodies.push(await new Request(input, init).text());
      return Response.json({
        id: "msg_synthetic", type: "message", role: "assistant", model: SONNET, stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
        content: [{ type: "tool_use", id: "toolu_seed", name: SEED_PROMPT_PROGRAM.request.toolName, input: { seeds: [] } }],
        stop_reason: "tool_use",
      });
    }));
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.action(async (ctx) => {
      await generateStructured(
        withPlaceholders(
          instrumentedAnthropic(ctx, { callSite: "generation:seedFeedback:goal_problem" }) as unknown as GenerationClient,
          RECHECK_MAP
        ),
        {
          system: request.system,
          user: request.userBlocks,
          toolName: SEED_PROMPT_PROGRAM.request.toolName,
          description: SEED_PROMPT_PROGRAM.request.description,
          schema: seedToolSchema() as never,
          maxTokens: SEED_PROMPT_PROGRAM.request.maxTokens,
          model: SONNET,
        }
      );
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(RECHECK_HIDDEN);
    const wire = JSON.parse(bodies[0]!) as { messages: Array<{ content: unknown }> };
    const sent = wire.messages.map((message) => textOf(message.content)).join("");
    expect(sent).toContain('"[PERSON_2]: we tried the rig.');
    expect(sent).toContain("[CLIENT_2_WA]\\n[CLIENT_2_WB] [CLIENT_2_WC] supplied");
  });

  it("a Section's drafting, Self-check, repair and final coverage requests: the cited excerpt, the analysis and the Feedback", async () => {
    const itemId = "item-recheck" as Id<"summaryItems">;
    const plan = buildFrozenSummaryPlan({
      section: "s242",
      items: [{ itemId, roleId: "company_context", kind: "standard", bullets: [LITERAL], support: "writer_asserted" }],
      skippedRoleIds: [],
      sourceRefsByItemId: new Map([[itemId, [{ sourceId: "source-1", exactExcerpt: EXCERPT }]]]),
    });
    const payload = {
      analysis: JSON.stringify({
        company_context: `${LITERAL} ${EXCERPT}`,
        project_goal: "A graded filter",
        business_problem: "Filters cracked",
        scientific_technical_problem: "No method",
        technological_objective: "A graded filter",
        work_performed: {},
        project_status: "completed",
      }),
      brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
      orderedContext: { profileState: "missing", categoryOutcomes: [], buildOrder: ["242", "244", "246"], selfCheckRules: [] },
      summaryVersionId: "summary-version-recheck" as Id<"summaryVersions">,
      frozenStyleGuidance: "",
    } satisfies OrderedPayload;
    const claim = {
      projectId: "project-recheck",
      model: SONNET,
      label: "Single draft",
      lengthTarget: "standard",
      orderIndex: 0,
      isFirstInOrder: true,
      priorSections: [],
      briefBlock: "",
      brief: { storylineText: "", claimExclusions: [], confidenceMap: [], glossaryTerms: [] },
      planBlock: `\n\n${plan.block}`,
      planChecksBlock: plan.checksBlock,
      planChecks: plan.checks,
      editedTerms: [],
      // Privacy re-check P1-2: a control character before a name.
      writerFeedback: [{ roleId: "company_context", instruction: "Say it was about\u0007Quillmere Analytics Ltd. and\u0000Morgan Hale." }],
      glossarySetAside: [],
    } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
    const checks: Array<Array<Record<string, unknown>>> = [
      [{ itemId, mergedItemIds: [itemId], paragraph: 0, outcome: "not_applied", reason: "Not covered.", repairGuidance: "Cover it." }],
      [{ itemId, mergedItemIds: [itemId], paragraph: 1, outcome: "applied", reason: "Covered." }],
    ];
    const bodies: Array<{ stage: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const body = await new Request(input, init).text();
      const json = JSON.parse(body) as { system: unknown; messages: Array<{ content: unknown }>; tools?: Array<{ name: string }> };
      const user = json.messages.map((message) => textOf(message.content)).join("");
      const tool = json.tools?.[0]?.name ?? null;
      const stage = tool ?? (user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
      bodies.push({ stage, body });
      const base = { id: "msg_synthetic", type: "message", role: "assistant", model: SONNET, stop_sequence: null, usage: { input_tokens: 40, output_tokens: 8 } };
      if (tool === "submit_self_check") {
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: "toolu_check", name: tool, input: { verdicts: [], planVerdicts: checks.shift() } }],
          stop_reason: "tool_use",
        });
      }
      const text = stage === "repair"
        ? "The company builds controllers.\n\nIt wanted early warning, per [CLIENT_2_WA] [CLIENT_2_WB]."
        : "The company builds controllers.\n\nIt wanted early warning.";
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    }));
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const result = await t.action(async (ctx) => {
      const clientFor = Object.assign(
        (callSite: string) => withPlaceholders(
          instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
          RECHECK_MAP
        ),
        { modelFor: () => SONNET }
      );
      return await draftCheckedSection({ claim, payload, section: "242", clientFor });
    });
    expect(bodies.map((entry) => entry.stage)).toEqual(["section", "submit_self_check", "repair", "submit_self_check"]);
    for (const entry of bodies) expect(entry.body, entry.stage).not.toMatch(RECHECK_HIDDEN);
    // The model's word tokens restore to the words.
    expect(result.draftText).toContain("per Northern Robotics.");
  });
});

// 2026-09-29 (second, privacy): a budget cut through a name sent the
// fragment ("Interview with Quill"), which no placeholder matches.
describe("a budget cut never sends a fragment of a name (real SDK, fetch stubbed)", () => {
  it("the analyzer's trusted context, cut inside the client name, reaches the provider without the fragment", async () => {
    const { userMessage, report } = buildTrustedContext({
      transcriptParts: [{ label: "Kickoff", content: "Interview with Quillmere Analytics Ltd. about the rig." }],
      // 5 tokens are 20 characters: "Interview with Quill" would cut the name.
      budget: { ...DEFAULT_CONTEXT_BUDGET, transcriptTokens: 5 },
    });
    expect(report.sources[0]).toMatchObject({ included: true, truncated: true, includedLength: 15 });
    expect(userMessage).toContain("Interview with \n[TRUNCATED:");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      bodies.push(await new Request(input, init).text());
      return Response.json({
        id: "msg_synthetic", type: "message", role: "assistant", model: SONNET, stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
        content: [{ type: "text", text: "Read." }],
        stop_reason: "end_turn",
      });
    }));
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.action(async (ctx) => {
      await withPlaceholders(
        instrumentedAnthropic(ctx, { callSite: "generation:analyzer" }) as unknown as GenerationClient,
        MAP
      ).messages.create({
        model: SONNET,
        max_tokens: 100,
        system: "Analyse the interview.",
        messages: [{ role: "user", content: userMessage }],
      });
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/Quill/);
  });

  it("final privacy round: a cut inside a hyphenated surname backs off before the whole word", async () => {
    const map = buildPlaceholderMap({ people: ["Dana Whitfield-Smith"] });
    const { userMessage } = buildTrustedContext({
      transcriptParts: [{ label: "Kickoff", content: "Interview with Dana Whitfield-Smith about the rig." }],
      // 7 tokens are 28 characters: "Interview with Dana Whitfield-S".
      budget: { ...DEFAULT_CONTEXT_BUDGET, transcriptTokens: 7 },
    });
    expect(userMessage).toContain("Interview with Dana \n[TRUNCATED:");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      bodies.push(await new Request(input, init).text());
      return Response.json({
        id: "msg_synthetic", type: "message", role: "assistant", model: SONNET, stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
        content: [{ type: "text", text: "Read." }],
        stop_reason: "end_turn",
      });
    }));
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.action(async (ctx) => {
      await withPlaceholders(
        instrumentedAnthropic(ctx, { callSite: "generation:analyzer" }) as unknown as GenerationClient,
        map
      ).messages.create({
        model: SONNET,
        max_tokens: 100,
        system: "Analyse the interview.",
        messages: [{ role: "user", content: userMessage }],
      });
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/Whitfield|Smith|Dana/);
    expect(bodies[0]).toContain("Interview with [PERSON_1_FIRST] ");
  });
});

