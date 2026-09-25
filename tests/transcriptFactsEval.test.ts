import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  contentWords,
  estimateEvalCost,
  evalRunRefusal,
  formatReport,
  recalledBy,
  runFactsEval,
} from "../scripts/transcript-facts-eval/eval";

/**
 * The offline evaluation harness (owner decision 27), run on the test-data
 * transcript through the real Anthropic SDK with only HTTP stubbed: the
 * citations-mode extraction and the condense digest both go through
 * production code, and the report says how many quotes were verified and
 * how much of the digest the facts cover.
 */
const HELIOS = readFileSync(new URL("../test-data/helios-end-to-end-test.txt", import.meta.url), "utf8");

type Block = { type: string; text?: string; source?: { content: Array<{ text: string }> } };

function blockIndex(blocks: Array<{ text: string }>, phrase: string): number {
  const index = blocks.findIndex((block) => block.text.includes(phrase));
  if (index === -1) throw new Error(`No block holds ${phrase}`);
  return index;
}

function cite(blocks: Array<{ text: string }>, phrase: string, citedText = phrase) {
  const index = blockIndex(blocks, phrase);
  return {
    type: "content_block_location",
    cited_text: citedText,
    document_index: 0,
    document_title: "Interview transcript window",
    start_block_index: index,
    end_block_index: index + 1,
  };
}

function message(content: unknown[]) {
  return Response.json({
    id: "msg_eval",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1_000, output_tokens: 200 },
  });
}

/** Names every request is checked for; a test may add the client's. */
const hiddenNames = ["Marcus", "Lindqvist", "Dana", "Whitfield"];

const fakeProvider = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(await new Request(input, init).text()) as {
    tools?: Array<{ name: string }>;
    messages: Array<{ content: string | Block[] }>;
  };
  const sent = JSON.stringify(body);
  // Owner decision 26: no name reaches the model, in either call.
  for (const name of hiddenNames) {
    if (sent.includes(name)) throw new Error(`Name ${name} reached the model`);
  }
  if (body.tools?.[0]?.name === "record_transcript_digest") {
    return message([
      {
        type: "tool_use",
        id: "digest",
        name: "record_transcript_digest",
        input: {
          participants: ["[PERSON_2], CTO"],
          timeline: [],
          technologicalUncertainties: [
            "Whether cluster-level net load could be forecast accurately enough to act ahead of a voltage event",
            "Convergence guarantees for the negotiation under degraded communications",
          ],
          hypotheses: [],
          experiments: [
            {
              problem: "Voltage flicker",
              approach: "Rule-based controller with voltage thresholds triggering battery dispatch",
              result: "Oscillated badly",
              conclusion: "Coordination had to be predictive",
              dates: "",
            },
          ],
          resultsAndNumbers: ["Distributed controller cut voltage excursions by about two-thirds versus the rule-based baseline"],
          namesAndSystems: [],
          keyQuotes: [],
        },
      },
    ]);
  }
  const document = (body.messages[0].content as Block[]).find((block) => block.type === "document")!;
  const blocks = document.source!.content;
  return message([
    { type: "text", text: "uncertainty | " },
    {
      type: "text",
      text: "They did not know whether cluster-level net load could be forecast accurately enough to act ahead of a voltage event",
      citations: [
        cite(
          blocks,
          "The big unknown was whether we could forecast cluster-level net load accurately enough to act ahead of a voltage event"
        ),
      ],
    },
    { type: "text", text: "\nexperiment | " },
    {
      type: "text",
      text: "A rule-based controller with voltage thresholds oscillated badly",
      citations: [cite(blocks, "First we tried a rule-based controller", "First we tried a rule based controller")],
    },
    { type: "text", text: "\nresult | " },
    {
      type: "text",
      text: "The distributed controller cut voltage excursions by about two-thirds",
      citations: [cite(blocks, "cut voltage excursions by about two-thirds")],
    },
    { type: "text", text: "\ncontext | " },
    {
      type: "text",
      text: "Standard grid controls were raised as an alternative",
      citations: [cite(blocks, "Couldn't you just use standard grid controls?")],
    },
    { type: "text", text: "\nresult | " },
    {
      type: "text",
      text: "The controller reduced cost by half",
      citations: [cite(blocks, "cut voltage excursions", "reduced operating cost by half across the fleet")],
    },
  ]);
});

describe("transcript facts evaluation harness", () => {
  it("reports verified quotes and fact recall vs the digest with HTTP stubbed", async () => {
    const client = new Anthropic({ apiKey: "synthetic-eval-key", fetch: fakeProvider as unknown as typeof fetch, maxRetries: 0 });
    const report = await runFactsEval(
      [{ name: "helios", fileName: "helios.txt", text: HELIOS, interviewer: "Dana Whitfield", interviewees: ["Marcus Lindqvist"] }],
      { client, model: "claude-sonnet-5" }
    );
    const [row] = report.transcripts;
    expect(fakeProvider).toHaveBeenCalledTimes(2);
    expect(row.windows).toBe(1);
    expect(row.speakers.find((speaker) => speaker.label === "Dana")?.role).toBe("interviewer");
    expect(row.speakers.find((speaker) => speaker.label === "Marcus Lindqvist")?.role).toBe("client");
    expect(row.facts).toEqual({ proposed: 5, kept: 3, context: 1, dropped: 1 });
    // Five quotes proposed: three found in client turns, one only in the
    // interviewer's words, one not in the transcript at all.
    expect(row.quotes).toEqual({ proposed: 5, verified: 3, notClientOnly: 1, rate: 0.6 });
    expect(row.recall.digestItems).toBe(4);
    expect(row.recall.recalled).toBe(3);
    expect(row.recall.missed).toEqual(["uncertainty: Convergence guarantees for the negotiation under degraded communications"]);
    expect(row.cost.factsUsd).toBeGreaterThan(0);
    expect(row.cost.digestUsd).toBeGreaterThan(0);
    expect(report.totals.verifiedQuoteRate).toBe(0.6);
    expect(report.totals.factRecall).toBe(0.75);

    const text = formatReport(report);
    expect(text).toContain("Verified-quote rate: 60%");
    expect(text).toContain("Fact recall vs digest: 75%");
    expect(text).toContain("helios: uncertainty: Convergence guarantees");
    expect(text).not.toMatch(/[\u2010-\u2015\u2212\u00b7]/);
  });

  it("skips condensing when a stored digest is given, and estimates before any call", async () => {
    fakeProvider.mockClear();
    const client = new Anthropic({ apiKey: "synthetic-eval-key", fetch: fakeProvider as unknown as typeof fetch, maxRetries: 0 });
    const entry = {
      name: "helios",
      text: HELIOS,
      interviewer: "Dana Whitfield",
      digest: [
        {
          participants: [],
          timeline: [],
          technologicalUncertainties: [],
          hypotheses: [],
          experiments: [],
          resultsAndNumbers: ["Voltage excursions cut by about two-thirds"],
          namesAndSystems: [],
          keyQuotes: [],
        },
      ],
    };
    const estimate = estimateEvalCost([entry], "claude-sonnet-5");
    expect(estimate.usd).toBeGreaterThan(0);
    expect(estimate.usd).toBeLessThan(1);
    const report = await runFactsEval([entry], { client, model: "claude-sonnet-5" });
    expect(fakeProvider).toHaveBeenCalledTimes(1);
    expect(report.totals.factRecall).toBe(1);
  });

  it("hides the client's company name given with --client (review 2026-09-25)", async () => {
    fakeProvider.mockClear();
    hiddenNames.push("Verdant");
    try {
      const client = new Anthropic({ apiKey: "synthetic-eval-key", fetch: fakeProvider as unknown as typeof fetch, maxRetries: 0 });
      const report = await runFactsEval(
        [
          {
            name: "helios",
            fileName: "helios.txt",
            text: HELIOS,
            clientName: "Verdant Grid Technologies Inc.",
            interviewer: "Dana Whitfield",
            interviewees: ["Marcus Lindqvist"],
          },
        ],
        { client, model: "claude-sonnet-5" }
      );
      expect(fakeProvider).toHaveBeenCalledTimes(2);
      expect(report.transcripts[0].facts.kept).toBe(3);
    } finally {
      hiddenNames.pop();
    }
  });

  it("refuses the billable run without --client, over the limit or without a key", () => {
    const base = { yes: true, clientName: "Verdant Grid", estimateUsd: 0.4, maxUsd: 1, apiKey: "key" };
    expect(evalRunRefusal(base)).toBeNull();
    expect(evalRunRefusal({ ...base, yes: false, clientName: undefined })).toBeNull();
    expect(evalRunRefusal({ ...base, clientName: undefined })).toMatch(/--client/);
    expect(evalRunRefusal({ ...base, clientName: "  " })).toMatch(/--client/);
    expect(evalRunRefusal({ ...base, estimateUsd: 2 })).toMatch(/--max-usd 1/);
    expect(evalRunRefusal({ ...base, apiKey: undefined })).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("counts recall by shared content words", () => {
    expect([...contentWords("The 15-minute forecast horizon, 71.5 percent")]).toEqual(["15", "minute", "forecast", "horizon", "71.5", "percent"]);
    const fact = {
      key: "F1",
      type: "result" as const,
      claim: "Voltage excursions fell by two thirds.",
      turnIndexes: [1],
      quotes: [],
      confidence: 1,
    };
    expect(recalledBy("voltage excursions cut by about two-thirds", [fact], 0.5)).toBe(true);
    expect(recalledBy("islanding detection sub-200ms disconnect", [fact], 0.5)).toBe(false);
  });
});
