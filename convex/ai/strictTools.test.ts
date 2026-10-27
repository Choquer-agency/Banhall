import { describe, expect, it } from "vitest";
import { STRICT_LIMITS, strictToolSchema, strictTools } from "./strictTools";
import { adaptAnthropicRequest } from "./instrument";
import { BRIEF_SCHEMA } from "../lib/briefRequest";
import { ANALYSIS_SCHEMA } from "./analyzerAgent";
import { CHRONOLOGY_SCHEMA } from "./chronologyAgent";
import { ANALYSIS_TOOL_SCHEMA } from "./styleAnalysis";
import { FACTS_SCHEMA } from "./transcriptFactsAgent";
import { rulesSchema } from "./learning";
import { PD_REVIEW_SCHEMA } from "./reviewAgent";
import { seedTools } from "./seeds";
import { seedToolSchema } from "../lib/seedContract";
import { seedToolSchemaForFacts } from "../lib/seedFacts";
import { CONDENSE_SCHEMA } from "./condenseAgent";
import { SPEAKER_ROLES_SCHEMA } from "./speakerRolesAgent";
import { QA_SCHEMA } from "./qaAgent";
import { summaryPlanSelfCheckSchemaFor } from "./selfCheck";
import { CONSISTENCY_SCHEMA, SELF_CHECK_SCHEMA } from "./promptDefinitions";
import { RETRIEVAL_BRIEF_SCHEMA } from "./brain/query";
import { FACTS_MATCH_SOURCES_RULE_ID, RESULTS_AGAINST_TARGETS_RULE_ID } from "../lib/seedRevisions";

/** Every schema a structured call forces, as the app sends it. */
const FORCED_SCHEMAS: Record<string, unknown> = {
  brief: BRIEF_SCHEMA,
  analyzer: ANALYSIS_SCHEMA,
  chronology: CHRONOLOGY_SCHEMA,
  styleAnalysis: ANALYSIS_TOOL_SCHEMA,
  transcriptFacts: FACTS_SCHEMA,
  learning: rulesSchema("Rules."),
  pdReview: PD_REVIEW_SCHEMA,
  condense: CONDENSE_SCHEMA,
  speakerRoles: SPEAKER_ROLES_SCHEMA,
  selfCheck: SELF_CHECK_SCHEMA,
  // With one plan check, so no list must hold two or more items.
  summarySelfCheck: summaryPlanSelfCheckSchemaFor([{ label: "Line 242 names the uncertainty" }], [{ itemId: "item-1" }]),
  summarySelfCheckFacts: summaryPlanSelfCheckSchemaFor([], [{ ruleId: FACTS_MATCH_SOURCES_RULE_ID }]),
  summarySelfCheckTargets: summaryPlanSelfCheckSchemaFor([], [{ ruleId: RESULTS_AGAINST_TARGETS_RULE_ID }]),
  consistency: CONSISTENCY_SCHEMA,
  retrievalBrief: RETRIEVAL_BRIEF_SCHEMA,
};

describe("strict tool schemas (live check, 2026-10-26)", () => {
  it.each(Object.entries(FORCED_SCHEMAS))("%s can be sent strict", (_name, schema) => {
    expect(strictToolSchema(schema)).not.toBeNull();
  });

  it("QA's schema has more optional fields than strict allows, so it is sent as before", () => {
    expect(strictToolSchema(QA_SCHEMA)).toBeNull();
  });

  it("a Summary Self-check with one verdict per two or more items is sent as before (live A/B, 2026-10-26)", () => {
    const schema = summaryPlanSelfCheckSchemaFor(
      [{ label: "Line 242 names the uncertainty" }, { label: "Line 242 states the objective" }],
      [{ itemId: "item-1" }, { skippedRoleId: "role-1" }, { droppedSeedId: "seed-1" }, { ruleId: FACTS_MATCH_SOURCES_RULE_ID }]
    );
    expect(strictToolSchema(schema)).toBeNull();
    const tools = [{ name: "submit_self_check", input_schema: schema }];
    expect(strictTools(tools, "submit_self_check")).toEqual(tools);
  });

  it.each([
    ["shared", seedToolSchema()],
    ["facts", seedToolSchemaForFacts()],
  ] as const)("the four Seed tools (%s citations) are all strict, whichever is forced", (_mode, base) => {
    for (const kind of ["shared", "experiment", "advancement", "result"] as const) {
      const { tools, toolName } = seedTools(base, kind);
      const sent = strictTools(tools, toolName) as Array<{ strict?: boolean }>;
      expect(sent.every((tool) => tool.strict === true), kind).toBe(true);
    }
    // The same bytes whichever tool is forced, so the cached tools prefix is shared.
    expect(JSON.stringify(strictTools(seedTools(base, "shared").tools, "x"))).toBe(
      JSON.stringify(strictTools(seedTools(base, "result").tools, "y"))
    );
  });

  it("closes every object, drops what strict refuses and names each bound in the description", () => {
    const converted = strictToolSchema({
      type: "object",
      properties: {
        reason: { type: "string", maxLength: 400, description: "Why." },
        items: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", properties: { id: { type: "string", pattern: "^a" } }, required: ["id"] } },
        score: { type: "integer", minimum: 0, maximum: 100 },
        when: { type: "string", format: "date" },
        note: { type: "string", format: "markdown" },
        either: { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, oneOf: [{ required: ["a"] }, { required: ["b"] }] },
      },
      required: ["reason", "items", "score", "when", "either"],
    });
    expect(converted?.schema).toEqual({
      type: "object",
      properties: {
        reason: { type: "string", description: "Why. (at most 400 characters.)" },
        items: {
          type: "array",
          minItems: 1,
          items: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
          description: "(at most 3 items.)",
        },
        score: { type: "integer", description: "(at least 0, at most 100.)" },
        when: { type: "string", format: "date" },
        note: { type: "string" },
        either: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          additionalProperties: false,
          description: "(exactly one of a, b.)",
        },
      },
      required: ["reason", "items", "score", "when", "either"],
      additionalProperties: false,
    });
    // note, either.a and either.b are optional.
    expect(converted?.optional).toBe(3);
  });

  it("a bound is left unsaid only when the description already gives it", () => {
    const said = strictToolSchema({
      type: "object",
      properties: {
        a: { type: "string", maxLength: 32, description: "Return at most 32 bytes." },
        b: { type: "array", maxItems: 1, items: { type: "string" }, description: "Line 1-based." },
      },
      required: ["a", "b"],
    })?.schema as { properties: Record<string, { description: string }> };
    expect(said.properties.a.description).toBe("Return at most 32 bytes.");
    expect(said.properties.b.description).toBe("Line 1-based. (at most 1 item.)");
  });

  it("refuses what strict cannot say: extra keys, no properties, other oneOf, too many optional or union parameters", () => {
    expect(strictToolSchema({ type: "object", properties: {}, additionalProperties: { type: "string" } })).toBeNull();
    expect(strictToolSchema({ type: "object" })).toBeNull();
    expect(strictToolSchema({ type: "object", properties: { a: { type: "object" } }, required: ["a"] })).toBeNull();
    expect(
      strictToolSchema({ type: "object", properties: { a: { type: "string" } }, oneOf: [{ properties: { a: { const: "x" } } }] })
    ).toBeNull();
    const many = (count: number, make: (index: number) => unknown) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, make(index)]));
    expect(strictToolSchema({ type: "object", properties: many(STRICT_LIMITS.optional + 1, () => ({ type: "string" })) })).toBeNull();
    expect(
      strictToolSchema({
        type: "object",
        properties: many(STRICT_LIMITS.unions + 1, () => ({ type: ["string", "null"] })),
        required: Object.keys(many(STRICT_LIMITS.unions + 1, () => 0)),
      })
    ).toBeNull();
  });

  it("makes only the forced tool strict when all of them together pass a limit, and touches no server tool", () => {
    const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`p${i}`, { type: "string" }])) };
    const tools = [
      { name: "a", input_schema: wide },
      { name: "b", input_schema: wide },
      { type: "web_search_20260209", name: "web_search" },
    ];
    const sent = strictTools(tools, "b") as Array<Record<string, unknown>>;
    expect(sent.map((tool) => tool.strict ?? false)).toEqual([false, true, false]);
    expect(sent[2]).toBe(tools[2]);
  });

  it("the unforced path sends the forced tool strict; a model that takes a forced call gets the request unchanged", () => {
    const request = {
      max_tokens: 1000,
      system: "System.",
      tools: [{ name: "submit_generation_brief", description: "Brief.", input_schema: BRIEF_SCHEMA }],
      tool_choice: { type: "tool", name: "submit_generation_brief" },
      messages: [{ role: "user", content: "Evidence." }],
    };
    const adapted = adaptAnthropicRequest({ ...request, model: "claude-sonnet-5-5" }) as { tools: Array<Record<string, unknown>> };
    expect(adapted.tools[0]).toMatchObject({ name: "submit_generation_brief", strict: true });
    expect((adapted.tools[0]!.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    const forced = { ...request, model: "claude-sonnet-5" };
    expect(adaptAnthropicRequest(forced)).toBe(forced);
  });
});
