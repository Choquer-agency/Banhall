/// <reference types="vite/client" />
/**
 * 2026-09-29 (second): the consistency pass reads what it can.
 *
 * Release suite run 6, fixture "Carried old selections" (commit c8ce1fe2,
 * generation k574t7qptvy6ape679gx5w0qm98f9y2m): the Compliance Note read
 * "consistency pass call failed (unknown)", so the pass never ran. The
 * deployment's model outcome rows show both requests (the answer, 815 output
 * tokens, and the structured repair, 862) settled as `invalid_output` on the
 * checking model at 13:45:48Z: the answers ended normally but failed the
 * findings schema, and the stored reason said only "unknown". The deployment
 * recorded six such consistency failures that day, two of them on both
 * attempts. The same model sent the Self-check's planVerdicts as a string
 * that day (run 6, fixed in fe84a8f2).
 *
 * Every test runs runConsistencyPass with the real Anthropic SDK and the
 * production instrumented client; only `fetch` is stubbed. The Lines are
 * fictional.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import { normalizeProviderError, resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { consistencyFailureReason, runConsistencyPass } from "./ai/selfCheck";
import { consistencySummaryNote } from "./lib/selfCheckRules";

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

const SECTIONS = [
  { section: "242" as const, text: "The team set out to grade pore size.\n\nIt was uncertain whether two templates could survive firing." },
  { section: "244" as const, text: "Trial one bonded the templates.\n\nTrial two cut delamination.\n\nTrial three held at 1,450 C." },
  { section: "246" as const, text: "The graded filter met both goals.\n\nIt resolved the third uncertainty about interface behaviour." },
];

/** Each answer is one tool input, in order; a second answer is the structured repair. */
function installFetch(answers: unknown[]): string[] {
  const users: string[] = [];
  const queue = [...answers];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== "https://api.anthropic.com/v1/messages") {
        throw new Error(`Unexpected HTTP transport ${request.url}`);
      }
      const json = JSON.parse(await request.text()) as {
        model: string;
        messages: Array<{ content: string | Array<{ text?: string }> }>;
        tools: Array<{ name: string }>;
      };
      const content = json.messages[0]!.content;
      users.push(typeof content === "string" ? content : content.map((block) => block.text ?? "").join(""));
      const next = queue.shift();
      if (next === undefined) throw new Error("No consistency answer scripted");
      return Response.json({
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: json.model,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
        content: [{ type: "tool_use", id: "toolu_consistency", name: json.tools[0]!.name, input: next }],
        stop_reason: "tool_use",
      });
    })
  );
  return users;
}

async function pass() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await t.action(async (ctx: ActionCtx) =>
    await runConsistencyPass(
      instrumentedAnthropic(ctx, { callSite: "generation:consistency" }) as unknown as GenerationClient,
      { sections: SECTIONS, claimExclusions: [], glossaryTerms: [], model: SONNET }
    )
  );
}

const THIRD = {
  section: "246",
  paragraph: 2,
  sections: ["242", "246"],
  kind: "contradiction",
  issue: "246 P2 claims a third uncertainty that 242 never states.",
};

describe("the consistency pass reads what it can (real SDK, fetch stubbed)", () => {
  it("reads a findings list sent as a JSON string in one request", async () => {
    const users = installFetch([{ findings: JSON.stringify([THIRD]) }]);
    const result = await pass();
    expect(users).toHaveLength(1);
    expect(result).toEqual({
      findings: [{
        section: "246",
        paragraphIndex: 1,
        sections: ["242", "246"],
        kind: "contradiction",
        issue: THIRD.issue,
      }],
      unreadable: 0,
    });
  });

  it("reads a section written as a number or a label and a paragraph written as a number, \"P2\" or \"paragraph 2\"", async () => {
    installFetch([{
      findings: [
        { ...THIRD, section: 246, paragraph: "2", sections: [242, "Line 246"] },
        { ...THIRD, section: "Line 244", paragraph: 3, sections: "[\"244\", \"246\"]", kind: "Excluded claim" },
        { ...THIRD, section: "244", paragraph: "P2" },
        { ...THIRD, section: "244", paragraph: "[P3]" },
        { ...THIRD, section: "242", paragraph: "paragraph 2" },
      ],
    }]);
    const result = await pass();
    expect(result.unreadable).toBe(0);
    expect(result.findings.map((finding) => [finding.section, finding.paragraphIndex, finding.sections, finding.kind]))
      .toEqual([
        ["246", 1, ["242", "246"], "contradiction"],
        ["244", 2, ["244", "246"], "excluded_claim"],
        ["244", 1, ["242", "244", "246"], "contradiction"],
        ["244", 2, ["242", "244", "246"], "contradiction"],
        ["242", 1, ["242", "246"], "contradiction"],
      ]);
  });

  it("review P2-3: an answer none of whose findings can be read is a failed attempt, repaired once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const unreadable = { findings: [{ section: "300", paragraph: 1, sections: [], kind: "style", issue: "x" }, "SECRET-MODEL-TEXT"] };
      const users = installFetch([unreadable, { findings: [THIRD] }]);
      const result = await pass();
      expect(users).toHaveLength(2);
      expect(users[1]).toContain(
        "Your previous tool output was invalid: findings: none of 2 could be read (finding 1: section, kind; finding 2: string, not an object)"
      );
      expect(users[1]).not.toContain("SECRET-MODEL-TEXT");
      expect(result.findings).toHaveLength(1);
      expect(result.unreadable).toBe(0);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("review P2-3: two answers none of whose findings can be read fail the pass with the reason, never a clean run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const unreadable = { findings: [{ section: "244", paragraph: "the second one", sections: [], kind: "contradiction", issue: "x" }] };
      installFetch([unreadable, unreadable]);
      const failure = await pass().then(() => null, (caught: unknown) => caught);
      expect(failure).not.toBeNull();
      const reason = consistencyFailureReason(normalizeProviderError(failure).code, failure);
      expect(reason).toBe(
        "unknown: response failed validation: findings none of 1 could be read (finding 1: paragraph)"
      );
      expect(consistencySummaryNote("246", { ok: false, reason })).toMatchObject({
        outcome: "not_applied",
        reason: "consistency pass call failed (unknown: response failed validation: findings none of 1 could be read (finding 1: paragraph))",
      });
    } finally {
      error.mockRestore();
    }
  });

  it("leaves out one unreadable finding, keeps the others and counts it, never logging model text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      installFetch([{
        findings: [
          THIRD,
          { section: "244", paragraph: 1, sections: [], kind: "style", issue: "SECRET-MODEL-TEXT" },
          "SECRET-MODEL-TEXT",
        ],
      }]);
      const result = await pass();
      expect(result.findings).toHaveLength(1);
      expect(result.unreadable).toBe(2);
      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain(
        "submit_consistency_findings: left out 2 unreadable finding(s): finding 2: kind; finding 3: string, not an object"
      );
      expect(logged).not.toContain("SECRET-MODEL-TEXT");
      expect(consistencySummaryNote("246", { ok: true, findings: 1, unreadable: 2 }).reason).toBe(
        "consistency pass ran over the assembled draft: 1 finding(s); 2 more findings could not be read and were left out"
      );
      expect(consistencySummaryNote("246", { ok: true, findings: 0 }).reason).toBe(
        "consistency pass ran over the assembled draft: 0 finding(s)"
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("an answer whose findings is not a list is repaired once, and a second one names what failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const users = installFetch([{ findings: { first: THIRD } }, { findings: 7 }]);
      const failure = await pass().then(() => null, (caught: unknown) => caught);
      expect(users).toHaveLength(2);
      expect(users[1]).toContain("Your previous tool output was invalid: findings: not a list (object)");
      const reason = consistencyFailureReason(normalizeProviderError(failure).code, failure);
      expect(reason).toBe("unknown: response failed validation: findings not a list (number)");
      // Run 6 read "consistency pass call failed (unknown)".
      expect(consistencySummaryNote("246", { ok: false, reason }).reason).toBe(
        "consistency pass call failed (unknown: response failed validation: findings not a list (number))"
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe("the consistency pass knows the writer's decisions (2026-09-29 second)", () => {
  const BILLING = "Migration of the customer billing portal was routine IT work.";

  it("names the Lines where the writer kept an idea despite a Claim Exclusion, an edit set a Glossary Term aside or the writer's Feedback governs one", async () => {
    const spindle =
      "Call the deburring tool the compliant spindle, never the floating head, here and in every later step";
    const users = installFetch([{ findings: [] }]);
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    await t.action(async (ctx: ActionCtx) =>
      await runConsistencyPass(
        instrumentedAnthropic(ctx, { callSite: "generation:consistency" }) as unknown as GenerationClient,
        {
          sections: SECTIONS,
          claimExclusions: [BILLING, "Dealer training was a business activity."],
          glossaryTerms: ["floating head", "pilot cell"],
          model: SONNET,
          writerPrecedence: {
            keptExclusions: [{ text: BILLING, sections: ["244"] }],
            glossarySetAside: [{ term: "pilot cell", sections: ["244"] }],
            feedbackTerms: [{
              term: "floating head",
              sections: ["246", "242", "244"],
              feedback: [{ roleId: "company_context", instruction: spindle }],
            }],
          },
        }
      )
    );
    expect(users[0]).toContain(
      `--- BEGIN [CLAIM EXCLUSIONS] ---\n- ${BILLING} (the writer kept one signed-off idea with this content in Line 244: do not report that idea, but report any other content that claims this work)\n- Dealer training was a business activity.\n--- END [CLAIM EXCLUSIONS] ---`
    );
    // PR #22 lead decision: the consistency pass is told the same as the
    // drafting request and the Self-check.
    expect(users[0]).toContain(
      "--- BEGIN [GLOSSARY TERMS] ---\n" +
        `- floating head (the writer's Feedback governs this term in Lines 242, 244 and 246: follow the Feedback there, not the Glossary Term; do not report wording that follows it, and report wording that goes against it. The writer's Feedback on Company / Context: ${JSON.stringify(spindle)})\n` +
        "- pilot cell (set aside by the writer's own wording in Line 244; do not report another name for it there)\n" +
        "--- END [GLOSSARY TERMS] ---"
    );
  });

  it("sends the lists as before when the writer made no such decision", async () => {
    const users = installFetch([{ findings: [] }, { findings: [] }]);
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    for (const writerPrecedence of [undefined, { keptExclusions: [], glossarySetAside: [], feedbackTerms: [] }]) {
      await t.action(async (ctx: ActionCtx) =>
        await runConsistencyPass(
          instrumentedAnthropic(ctx, { callSite: "generation:consistency" }) as unknown as GenerationClient,
          {
            sections: SECTIONS,
            claimExclusions: [BILLING],
            glossaryTerms: ["floating head"],
            model: SONNET,
            ...(writerPrecedence ? { writerPrecedence } : {}),
          }
        )
      );
    }
    expect(users[0]).toContain(`--- BEGIN [CLAIM EXCLUSIONS] ---\n- ${BILLING}\n--- END [CLAIM EXCLUSIONS] ---`);
    expect(users[0]).toContain("--- BEGIN [GLOSSARY TERMS] ---\n- floating head\n--- END [GLOSSARY TERMS] ---");
    expect(users[1]).toBe(users[0]);
  });
});
