/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { sha256 } from "../lib/contracts";
import { FACTS_VERSION, type FactTurn } from "../lib/transcriptFacts";
import { buildPlaceholderMap } from "../lib/deidentify";
import { parseTranscriptTurns } from "../../shared/transcriptParse";
import { instrumentedAnthropic } from "./instrument";
import {
  citationsExtractor,
  citationsRequest,
  extractTranscriptFacts,
  FACTS_CITATIONS_INSTRUCTION,
  FACTS_REQUEST,
  FACTS_SCHEMA,
  FACTS_STRUCTURED_INSTRUCTION,
  FACTS_SYSTEM_PROMPT,
  parseCitationsResponse,
  stripTurnPrefix,
  structuredExtractor,
} from "./transcriptFactsAgent";
import type { GenerationClient, GenerationMessageParams } from "./openrouterCore";

const modules = import.meta.glob("../**/*.ts");

const CONTENT = [
  "Dana Whitfield [00:00:03]: What made the forecast hard for Verdant Grid?",
  "Priya Shah [00:00:09]: At Verdant Grid we couldn’t forecast net load fast enough when cloud cover changed.",
  "Dana Whitfield [00:01:02]: So the forecast failed on cloudy days?",
  "Priya Shah [00:01:05]: The gradient boosted model hit 71 percent accuracy on sunny days and 38 percent on cloudy days.",
].join("\n\n");

const TURNS: FactTurn[] = parseTranscriptTurns(CONTENT).map((turn) => ({
  index: turn.index,
  speakerLabel: turn.speakerLabel,
  role: turn.speakerLabel === "Priya Shah" ? "client" : "interviewer",
  startMs: turn.startMs,
  charStart: turn.charStart,
  charEnd: turn.charEnd,
  cleanText: turn.cleanText,
}));

const MAP = buildPlaceholderMap({ clientName: "Verdant Grid", people: ["Dana Whitfield", "Priya Shah"] });

describe("the facts contract is pinned to FACTS_VERSION", () => {
  /**
   * Stored facts are reused on (transcript, text hash, FACTS_VERSION). Any
   * change to the prompt, the instructions, the schema or the request
   * constants must bump FACTS_VERSION in convex/lib/transcriptFacts.ts and
   * update BOTH literals below.
   *
   * 2026-09-24: first version (phase 3, the transcript method).
   */
  it("hashes the prompt, instructions, schema and request", async () => {
    const hash = await sha256(
      [
        FACTS_SYSTEM_PROMPT,
        FACTS_CITATIONS_INSTRUCTION,
        FACTS_STRUCTURED_INSTRUCTION,
        JSON.stringify(FACTS_SCHEMA),
        JSON.stringify(FACTS_REQUEST),
      ].join("\n---\n")
    );
    expect(FACTS_VERSION).toBe("1");
    expect(hash).toBe("2d253b48759604eef40b00234f2d023d9c9eb38ac6dcd5e6889b7ba17b93a556");
  });
});

describe("citations response parsing", () => {
  const lines = TURNS.map((turn) => ({ turnIndex: turn.index, text: `[T000${turn.index}] (x) y` }));

  it("reads TYPE | claim lines and attaches each block's citations to its line", () => {
    const facts = parseCitationsResponse(
      [
        { type: "text", text: "uncertainty | " },
        {
          type: "text",
          text: "They could not forecast net load fast enough",
          citations: [
            {
              type: "content_block_location",
              cited_text: "[T0001] (client) [PERSON_2]: At [CLIENT_1] we couldn’t forecast net load fast enough when cloud cover changed.",
              document_index: 0,
              document_title: "Interview transcript window",
              start_block_index: 1,
              end_block_index: 2,
            },
          ],
        },
        { type: "text", text: ".\nresult | " },
        {
          type: "text",
          text: "71 percent on sunny days",
          citations: [
            {
              type: "content_block_location",
              cited_text: "hit 71 percent accuracy on sunny days",
              document_index: 0,
              document_title: null,
              start_block_index: 3,
              end_block_index: 3,
            },
          ],
        },
        { type: "text", text: "\nNot a fact line" },
      ],
      lines
    );
    expect(facts).toEqual([
      {
        type: "uncertainty",
        claim: "They could not forecast net load fast enough.",
        turnIndexes: [1],
        quotes: ["At [CLIENT_1] we couldn’t forecast net load fast enough when cloud cover changed."],
      },
      { type: "result", claim: "71 percent on sunny days", turnIndexes: [3], quotes: ["hit 71 percent accuracy on sunny days"] },
    ]);
  });

  it("strips the turn prefix a whole-block citation carries", () => {
    expect(stripTurnPrefix("[T0412] (client) [PERSON_2]: We built a rig.")).toBe("We built a rig.");
    expect(stripTurnPrefix("[T0003] (unknown) We built a rig.")).toBe("We built a rig.");
  });
});

describe("citations mode at the SDK request and response boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-facts-key");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  });
  afterEach(() => {
    try {
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("sends a custom-content document with citations and no tools, and verifies the cited quotes", async () => {
    const t = convexTest(schema, modules);
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return Response.json(
          {
            id: "msg_facts",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: [
              { type: "text", text: "uncertainty | " },
              {
                type: "text",
                text: "[CLIENT_1] could not forecast net load fast enough when cloud cover changed",
                citations: [
                  {
                    type: "content_block_location",
                    cited_text: "At [CLIENT_1] we couldn’t forecast net load fast enough",
                    document_index: 0,
                    document_title: "Interview transcript window",
                    start_block_index: 1,
                    end_block_index: 2,
                  },
                ],
              },
              { type: "text", text: "\nresult | " },
              {
                type: "text",
                text: "The forecast failed on cloudy days",
                citations: [
                  {
                    type: "content_block_location",
                    cited_text: "So the forecast failed on cloudy days",
                    document_index: 0,
                    document_title: "Interview transcript window",
                    start_block_index: 2,
                    end_block_index: 3,
                  },
                ],
              },
            ],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 900, output_tokens: 80 },
          },
          { headers: { "request-id": "req_facts" } }
        );
      })
    );

    const usage = { inputTokens: 0, outputTokens: 0 };
    const result = await t.action(async (ctx) =>
      extractTranscriptFacts({
        content: CONTENT,
        turns: TURNS,
        placeholders: MAP,
        extractWindow: citationsExtractor(
          instrumentedAnthropic(ctx, { callSite: "transcript:facts" }),
          "claude-sonnet-5",
          (tokens) => {
            usage.inputTokens += tokens.inputTokens;
            usage.outputTokens += tokens.outputTokens;
          }
        ),
      })
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    const bodyText = await request.text();
    const body = JSON.parse(bodyText);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.system).toBe(FACTS_SYSTEM_PROMPT);
    expect(body.messages[0].content[0]).toEqual({
      type: "document",
      source: {
        type: "content",
        content: [
          { type: "text", text: "[T0000] (interviewer) [PERSON_1]: What made the forecast hard for [CLIENT_1]?" },
          { type: "text", text: "[T0001] (client) [PERSON_2]: At [CLIENT_1] we couldn’t forecast net load fast enough when cloud cover changed." },
          { type: "text", text: "[T0002] (interviewer) [PERSON_1]: So the forecast failed on cloudy days?" },
          { type: "text", text: "[T0003] (client) [PERSON_2]: The gradient boosted model hit 71 percent accuracy on sunny days and 38 percent on cloudy days." },
        ],
      },
      title: "Interview transcript window",
      citations: { enabled: true },
    });
    expect(body.messages[0].content[1]).toEqual({ type: "text", text: FACTS_CITATIONS_INSTRUCTION });
    // Decision 26: no name leaves the app.
    for (const name of ["Dana", "Whitfield", "Priya", "Shah", "Verdant"]) expect(bodyText).not.toContain(name);

    // The quote came back with a placeholder, was restored, and was found
    // in the verbatim client turn; the interviewer's words became context.
    expect(result.facts.map((fact) => [fact.type, fact.claim, fact.quotes.map((quote) => quote.exactExcerpt)])).toEqual([
      [
        "uncertainty",
        "Verdant Grid could not forecast net load fast enough when cloud cover changed",
        ["At Verdant Grid we couldn’t forecast net load fast enough"],
      ],
      ["context", "The forecast failed on cloudy days", []],
    ]);
    const quote = result.facts[0].quotes[0];
    expect(CONTENT.slice(quote.charStart, quote.charEnd)).toBe(quote.exactExcerpt);
    expect(result.counts).toEqual({ proposed: 2, verified: 1, dropped: 0 });
    expect(usage).toEqual({ inputTokens: 900, outputTokens: 80 });
  });

  it("builds the same request shape it sends", () => {
    const request = citationsRequest("claude-sonnet-5", [{ turnIndex: 4, text: "[T0004] (client) A: B." }]);
    expect(request.max_tokens).toBe(FACTS_REQUEST.maxTokens);
    expect(JSON.stringify(request)).not.toContain("tool");
  });
});

describe("structured mode", () => {
  it("reads turn ids and quotes, and never sends names", async () => {
    const seen: GenerationMessageParams[] = [];
    const client: GenerationClient = {
      messages: {
        create: async (params) => {
          seen.push(params);
          return {
            content: [
              {
                type: "tool_use",
                id: "t",
                name: FACTS_REQUEST.toolName,
                input: {
                  facts: [
                    {
                      type: "result",
                      claim: "[PERSON_2] reported 38 percent accuracy on cloudy days.",
                      turnIds: ["T0003", "bogus"],
                      quotes: ["71 percent accuracy on sunny days and 38 percent on cloudy days"],
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    };
    const result = await extractTranscriptFacts({
      content: CONTENT,
      turns: TURNS,
      placeholders: MAP,
      extractWindow: structuredExtractor(client, "openai/gpt-5"),
    });
    expect(JSON.stringify(seen)).not.toContain("Priya");
    expect(seen[0].tools?.[0].name).toBe(FACTS_REQUEST.toolName);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].claim).toBe("Priya Shah reported 38 percent accuracy on cloudy days.");
    expect(result.facts[0].turnIndexes).toEqual([3]);
  });
});
