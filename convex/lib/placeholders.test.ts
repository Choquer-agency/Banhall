import { describe, expect, it } from "vitest";
import {
  avoidTokenCollisions,
  buildPlaceholderMap,
  containsPlaceholderToken,
  pseudonymize,
  restorePlaceholders,
  restorePlaceholdersDeep,
} from "./deidentify";
import { pseudonymizeRequest, restoreResponse, withPlaceholders } from "../ai/placeholderClient";
import type { GenerationClient, GenerationMessageParams } from "../ai/openrouterCore";

const map = buildPlaceholderMap({
  clientName: "Verdant Grid Technologies Inc.",
  people: ["Dana Whitfield", "Wren Writer", "Marcus Lindqvist", "Speaker 2", "Interviewer", "Marcus Lindqvist", "Will Smith"],
});

const TRANSCRIPT = [
  "Dana Whitfield [00:00:03]: Thanks, Marcus. What did Verdant Grid Technologies set out to build?",
  "Marcus Lindqvist: At Verdant Grid Technologies Inc. we built a controller. Lindqvist's team ran it; VERDANT GRID TECHNOLOGIES paid.",
  "Speaker 2: Will it scale? Ionization is a separate topic.",
].join("\n\n");

describe("placeholder map", () => {
  it("names the client first, then each person with their single-name forms, skipping generic labels", () => {
    expect(map).toEqual([
      { token: "[CLIENT_1]", value: "Verdant Grid Technologies Inc." },
      { token: "[CLIENT_1_SHORT]", value: "Verdant Grid Technologies" },
      { token: "[CLIENT_1_BRAND]", value: "Verdant Grid" },
      { token: "[CLIENT_1_CAPS]", value: "VERDANT GRID TECHNOLOGIES" },
      { token: "[PERSON_1]", value: "Dana Whitfield" },
      { token: "[PERSON_1_FIRST]", value: "Dana" },
      { token: "[PERSON_1_LAST]", value: "Whitfield" },
      { token: "[PERSON_2]", value: "Wren Writer" },
      { token: "[PERSON_2_FIRST]", value: "Wren" },
      { token: "[PERSON_2_LAST]", value: "Writer" },
      { token: "[PERSON_3]", value: "Marcus Lindqvist" },
      { token: "[PERSON_3_FIRST]", value: "Marcus" },
      { token: "[PERSON_3_LAST]", value: "Lindqvist" },
      { token: "[PERSON_4]", value: "Will Smith" },
      { token: "[PERSON_4_LAST]", value: "Smith" },
    ]);
  });

  it("is deterministic for the same inputs", () => {
    expect(buildPlaceholderMap({ clientName: "Verdant Grid Technologies Inc.", people: ["Dana Whitfield"] })).toEqual(
      buildPlaceholderMap({ clientName: "Verdant Grid Technologies Inc.", people: ["Dana Whitfield"] })
    );
  });
});

describe("pseudonymize and restore", () => {
  it("hides every name, longest form first, and never the inside of another word", () => {
    const hidden = pseudonymize(TRANSCRIPT, map);
    for (const name of ["Dana", "Whitfield", "Marcus", "Lindqvist", "Verdant", "VERDANT"]) {
      expect(hidden).not.toContain(name);
    }
    expect(hidden).toContain("[PERSON_1] [00:00:03]: Thanks, [PERSON_3_FIRST].");
    expect(hidden).toContain("At [CLIENT_1] we built");
    expect(hidden).toContain("[PERSON_3_LAST]'s team");
    // A common word that is also a first name, and a word containing a name, stay.
    expect(hidden).toContain("Will it scale? Ionization");
  });

  it("round-trips byte for byte, including a verbatim quote cut from the hidden text", () => {
    const hidden = pseudonymize(TRANSCRIPT, map);
    expect(restorePlaceholders(hidden, map)).toBe(TRANSCRIPT);
    const quote = hidden.slice(hidden.indexOf("At [CLIENT_1]"), hidden.indexOf(" paid.") + 6);
    const restored = restorePlaceholders(quote, map);
    expect(TRANSCRIPT.indexOf(restored)).toBeGreaterThan(0);
    expect(restored).toBe(
      "At Verdant Grid Technologies Inc. we built a controller. Lindqvist's team ran it; VERDANT GRID TECHNOLOGIES paid."
    );
  });

  it("leaves unknown tokens alone and restores nested tool output", () => {
    expect(restorePlaceholders("[PERSON_9] met [PERSON_1_FIRST].", map)).toBe("[PERSON_9] met Dana.");
    expect(
      restorePlaceholdersDeep({ seeds: [{ bullets: ["[CLIENT_1_SHORT] built it."], n: 2 }] }, map)
    ).toEqual({ seeds: [{ bullets: ["Verdant Grid Technologies built it."], n: 2 }] });
  });

  it("detects text that already carries a token", () => {
    expect(containsPlaceholderToken("see [PERSON_1]", map)).toBe(true);
    expect(containsPlaceholderToken("see [PERSON_99]", map)).toBe(false);
    // A variant the map never issued still restores through its base.
    expect(containsPlaceholderToken("see [PERSON_2_CAPS]", map)).toBe(true);
  });

  it("restores a variant the model invented through its base token (review 2026-09-25)", () => {
    const oneWord = buildPlaceholderMap({ people: ["Priya", "Dana Whitfield"] });
    expect(oneWord.map((entry) => entry.token)).toEqual(["[PERSON_1]", "[PERSON_2]", "[PERSON_2_FIRST]", "[PERSON_2_LAST]"]);
    expect(restorePlaceholders("[PERSON_1_FIRST] and [PERSON_1_LAST] met [PERSON_2].", oneWord)).toBe(
      "Priya and Priya met Dana Whitfield."
    );
    // No legal suffix, so no SHORT form was issued: the base name stands in.
    expect(restorePlaceholders("[CLIENT_1_SHORT] paid.", buildPlaceholderMap({ clientName: "Acme Robotics", people: [] }))).toBe(
      "Acme Robotics paid."
    );
    expect(restorePlaceholders("[PERSON_7_FIRST] stays.", oneWord)).toBe("[PERSON_7_FIRST] stays.");
  });
});

describe("texts that already hold placeholder-style tokens (review 2026-09-25)", () => {
  const redacted = "[PERSON_1]: We tested it. Dana Whitfield asked [PERSON_2_FIRST] about [CLIENT_1].";

  it("renumbers the map past every token in the texts, so literal tokens survive the round trip", () => {
    const safe = avoidTokenCollisions(map, [redacted]);
    expect(safe).not.toBe(map);
    expect(safe.map((entry) => entry.value)).toEqual(map.map((entry) => entry.value));
    expect(safe[0]).toEqual({ token: "[CLIENT_2]", value: "Verdant Grid Technologies Inc." });
    expect(safe.find((entry) => entry.value === "Dana Whitfield")?.token).toBe("[PERSON_3]");
    const hidden = pseudonymize(redacted, safe);
    expect(hidden).toBe("[PERSON_1]: We tested it. [PERSON_3] asked [PERSON_2_FIRST] about [CLIENT_1].");
    expect(restorePlaceholders(hidden, safe)).toBe(redacted);
    // With the plain map, the literal tokens would have become real names.
    expect(restorePlaceholders(pseudonymize(redacted, map), map)).not.toBe(redacted);
  });

  it("keeps the same map when nothing collides, and is deterministic", () => {
    expect(avoidTokenCollisions(map, ["No tokens here.", "[PERSON_99] is not ours."])).toBe(map);
    expect(avoidTokenCollisions(map, [redacted])).toEqual(avoidTokenCollisions(map, [redacted]));
    expect(avoidTokenCollisions([], [redacted])).toEqual([]);
  });
});

describe("the placeholder client", () => {
  const params: GenerationMessageParams = {
    model: "claude-sonnet-5",
    max_tokens: 100,
    system: "Write about Verdant Grid Technologies Inc.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Dana Whitfield asked Marcus.", cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: "Tail" },
        ],
      },
    ],
    tools: [{ name: "t", input_schema: { type: "object" } }],
  };

  it("hides names in the system prompt and every message block, keeping cache breakpoints", () => {
    const sent = pseudonymizeRequest(params, map);
    expect(sent.system).toBe("Write about [CLIENT_1]");
    expect(sent.messages[0].content).toEqual([
      { type: "text", text: "[PERSON_1] asked [PERSON_3_FIRST].", cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: "Tail" },
    ]);
    expect(sent.tools).toBe(params.tools);
    // Deterministic: the cached prefix is byte-stable across calls.
    expect(JSON.stringify(pseudonymizeRequest(params, map))).toBe(JSON.stringify(sent));
  });

  it("restores text and tool output before the caller sees them", async () => {
    const seen: GenerationMessageParams[] = [];
    const inner: GenerationClient = {
      messages: {
        create: async (request) => {
          seen.push(request);
          return {
            content: [
              { type: "text", text: "[PERSON_3] confirmed." },
              { type: "tool_use", id: "x", name: "t", input: { quote: "At [CLIENT_1] we built a controller." } },
            ],
          };
        },
      },
    };
    const response = await withPlaceholders(inner, map).messages.create(params);
    expect(JSON.stringify(seen[0])).not.toContain("Marcus");
    expect(response.content).toEqual([
      { type: "text", text: "Marcus Lindqvist confirmed." },
      { type: "tool_use", id: "x", name: "t", input: { quote: "At Verdant Grid Technologies Inc. we built a controller." } },
    ]);
    expect(restoreResponse(response, [])).toBe(response);
  });
});
