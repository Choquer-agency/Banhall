import { describe, expect, test } from "vitest";
import {
  buildExternalBrief,
  buildOpenRouterRequest,
  canonicalizeSourceUrl,
  parseOpenRouterResearchResponse,
  parseReviewerResult,
  projectEvidenceSearchQuery,
  redactExternalText,
  selectProjectEvidence,
} from "./core";

describe("Contextual Research core", () => {
  describe("research redaction", () => {
    test.each([
      ["(613) 555-0134", "[redacted phone]"],
      ["Call (613) 555-0134 today.", "Call [redacted phone] today."],
      ["Contact:(613) 555-0134!", "Contact:[redacted phone]!"],
      ["Call(613) 555-0134 today.", "Call[redacted phone] today."],
      ["Call+16135550134 today.", "Call[redacted phone] today."],
      ["6135550134", "[redacted phone]"],
      ["613.555.0134", "[redacted phone]"],
      ["613-555-0134", "[redacted phone]"],
      ["613 555 0134", "[redacted phone]"],
      ["613-555 0134", "[redacted phone]"],
      ["1-613-555-0134", "[redacted phone]"],
      ["+1 (613) 555-0134", "[redacted phone]"],
      ["+16135550134", "[redacted phone]"],
      ["(613)5550134; +1-604-555-0199", "[redacted phone]; [redacted phone]"],
    ])("consumes the complete phone in %s", (input, expected) => {
      expect(redactExternalText(input, [])).toBe(expected);
    });

    test.each([
      "sample6135550134",
      "sample613-555-0134",
      "_6135550134",
      "26135550134",
      "6135550134sample",
      "613-555-0134sample",
      "(613) 555-0134sample",
      "6135550134_",
      "61355501342",
    ])("retains word-boundary protection for %s", (input) => {
      expect(redactExternalText(input, [])).toBe(input);
    });

    test("preserves existing URL and email redaction behavior", () => {
      expect(redactExternalText(
        "Email JANE+lab@Example.org; see (https://example.org/paper), http://example.net/page.",
        []
      )).toBe("Email [redacted email]; see ([redacted URL]), [redacted URL]");
    });

    test("replaces overlapping names longest-first and regex-special names literally", () => {
      expect(redactExternalText(
        "ACME FARMS and acme use A+B (Lab). AAB Lab stays; Al stays; Acmeology changes.",
        [" Acme ", "Acme Farms", "A+B (Lab)", "Acme", "Al", ""]
      )).toBe("[redacted] and [redacted] use [redacted]. AAB Lab stays; Al stays; [redacted]ology changes.");
    });

    test("preserves trim, space and tab collapse, and paragraph normalization", () => {
      expect(redactExternalText(" \t First  \t paragraph.\n\n\nSecond\t  paragraph. \t ", []))
        .toBe("First paragraph.\n\nSecond paragraph.");
    });
  });

  test("redacts the complete parenthesized phone in the outbound selected passage", () => {
    const brief = buildExternalBrief({
      selectedText: "Call (613) 555-0134 about the cultivar trial (24 samples at 5 C).",
      surroundingContext: "",
      instruction: "Find the scientific baseline.",
      knownNames: [],
    });

    expect(brief).toContain("Selected report passage:\nCall [redacted phone] about the cultivar trial (24 samples at 5 C).");
    expect(brief).not.toContain("([redacted phone]");
    expect(brief).not.toContain("613");
    expect(brief).not.toContain("555-0134");
  });

  test("redacts known client identifiers from the external brief", () => {
    const brief = buildExternalBrief({
      selectedText: "Acme Farms measured canes for jane@acme.example at 604-555-0199.",
      surroundingContext: "Johnny Test at Acme Farms documented the cultivar.",
      instruction: "Find the scientific baseline.",
      projectTitle: "Acme Farms raspberry trial",
      industry: "Agriculture",
      knownNames: ["Acme Farms", "Johnny Test"],
    });

    expect(brief).not.toMatch(/Acme Farms/i);
    expect(brief).not.toMatch(/Johnny Test/i);
    expect(brief).not.toContain("jane@acme.example");
    expect(brief).not.toContain("604-555-0199");
    expect(brief).toContain("raspberry");
    expect(brief).toContain("Do not infer or assert");
  });

  test("uses native GPT search and never configures Exa", () => {
    const request = buildOpenRouterRequest({
      provider: "gpt",
      model: "openai/gpt-5.6-sol",
      system: "system",
      prompt: "prompt",
    });
    expect(request).toMatchObject({
      tools: [
        {
          type: "openrouter:web_search",
          parameters: { engine: "native", max_total_results: 15 },
        },
      ],
      max_tool_calls: 5,
    });
    expect(JSON.stringify(request)).not.toContain("exa");
  });

  test("lets Perplexity use its own native deep-research path", () => {
    const request = buildOpenRouterRequest({
      provider: "perplexity",
      model: "perplexity/sonar-deep-research",
      system: "system",
      prompt: "prompt",
    });
    expect(request.tools).toBeUndefined();
    expect(request.web_search_options).toEqual({ search_context_size: "medium" });
  });

  test("normalizes nested citations and keeps the strongest excerpt", () => {
    const result = parseOpenRouterResearchResponse({
      id: "gen-1",
      choices: [
        {
          message: {
            content: "Supported answer",
            annotations: [
              {
                type: "url_citation",
                url_citation: {
                  url: "https://Example.com/article/?utm_source=test#part",
                  title: "Example research",
                  content: "Short",
                },
              },
              {
                type: "url_citation",
                url_citation: {
                  url: "https://example.com/article",
                  title: "Example research",
                  content: "A much longer supporting excerpt.",
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 34,
        cost: 0.12,
        prompt_tokens_details: { cached_tokens: 5 },
        server_tool_use: { web_search_requests: 2 },
      },
    });

    expect(result.responseId).toBe("gen-1");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      url: "https://example.com/article",
      title: "Example research",
      content: "A much longer supporting excerpt.",
    });
    // Cached tokens are split out of inputTokens (same semantics as every
    // other OpenRouter call — see openRouterUsage).
    expect(result.usage).toEqual({
      inputTokens: 7,
      outputTokens: 34,
      cacheReadInputTokens: 5,
      costUsd: 0.12,
      webSearchRequests: 2,
    });
  });

  test("keeps a provider-reported cost when token counters are absent", () => {
    const result = parseOpenRouterResearchResponse({
      choices: [{ message: { content: "Answer" } }],
      usage: { cost: 0.5 },
    });
    expect(result.usage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: 0.5,
    });
  });

  test("accepts provider citation URL fallbacks when annotations are absent", () => {
    const result = parseOpenRouterResearchResponse({
      choices: [{ message: { content: "Answer", citations: ["https://example.org/paper"] } }],
      usage: {},
    });
    expect(result.citations).toEqual([
      { url: "https://example.org/paper", title: "example.org" },
    ]);
  });

  test("rejects non-web source URLs", () => {
    expect(canonicalizeSourceUrl("file:///etc/passwd")).toBeNull();
    expect(canonicalizeSourceUrl("javascript:alert(1)")).toBeNull();
  });

  test("retrieves bounded, relevant project excerpts", () => {
    const evidence = selectProjectEvidence(
      [
        {
          id: "doc-1",
          title: "Cultivar notes",
          content:
            "The raspberry canes were measured weekly.\n\nA separate paragraph about irrigation.\n\nThe raspberry height comparison was recorded in the field log.",
        },
        {
          id: "doc-2",
          title: "Unrelated",
          content: "Invoice and payment terms only.",
        },
      ],
      "Find the raspberry plant height comparison",
      3
    );
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.documentId === "doc-1")).toBe(true);
    expect(evidence.length).toBeLessThanOrEqual(2);
  });

  test("builds a bounded project-document search query", () => {
    const query = projectEvidenceSearchQuery(
      "Research the raspberry raspberry cultivar height comparison using project records"
    );
    expect(query).toContain("raspberry");
    expect(query.split(" ").filter((term) => term === "raspberry")).toHaveLength(1);
    expect(query.length).toBeLessThanOrEqual(800);
  });

  test("validates and bounds structured reviewer output", () => {
    const result = parseReviewerResult(
      JSON.stringify({
        answer: "External sources establish a general baseline.",
        evidenceBoundary: "Project documents do not establish the client's result.",
        confidence: "medium",
        warnings: ["Do not turn the baseline into a client-specific result."],
        claims: [
          {
            text: "The external baseline is supported.",
            evidenceKind: "external",
            support: "supported",
            sourceKeys: ["E1", "E1"],
          },
        ],
        proposedText: "Published sources describe the general baseline; project evidence is required for actual results.",
        proposalRationale: "Keeps external and client evidence separate.",
      })
    );
    expect(result.confidence).toBe("medium");
    expect(result.claims[0]?.sourceKeys).toEqual(["E1"]);
    expect(result.proposedText).toContain("project evidence");
  });
});
