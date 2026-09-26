import { describe, expect, it } from "vitest";
import {
  avoidTokenCollisions,
  buildPlaceholderMap,
  containsPlaceholderToken,
  pseudonymize,
  restorePlaceholders,
  restorePlaceholdersDeep,
  type PlaceholderMap,
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

/** The restore this file shipped with: bracketed tokens only. */
function bracketedOnlyRestore(text: string, map: PlaceholderMap): string {
  if (map.length === 0 || text === "" || !text.includes("[")) return text;
  const byToken = new Map(map.map((entry) => [entry.token, entry.value]));
  return text.replace(/\[(?:CLIENT|PERSON)_\d+(?:_[A-Z]+)?\]/g, (token) => {
    const exact = byToken.get(token);
    if (exact !== undefined) return exact;
    const parts = /^\[(CLIENT|PERSON)_(\d+)(?:_([A-Z]+))?\]$/.exec(token);
    if (!parts || !parts[3]) return token;
    const base = byToken.get(`[${parts[1]}_${parts[2]}]`);
    if (base === undefined) return token;
    const words = base.split(" ");
    return parts[3] === "FIRST" ? words[0] : parts[3] === "LAST" ? words[words.length - 1] : base;
  });
}

describe("tokens a model writes without brackets (review 2026-09-25)", () => {
  it("restores bare ids the map issued, suffixes and possessives included", () => {
    expect(
      restorePlaceholders(
        "CLIENT_1 hired PERSON_3. CLIENT_1_BRAND's team, led by PERSON_3_FIRST, used CLIENT_1_SHORT kit; PERSON_1_LAST's notes (PERSON_4_LAST) cite CLIENT_1_CAPS.",
        map
      )
    ).toBe(
      "Verdant Grid Technologies Inc. hired Marcus Lindqvist. Verdant Grid's team, led by Marcus, used Verdant Grid Technologies kit; Whitfield's notes (Smith) cite VERDANT GRID TECHNOLOGIES."
    );
    // Line starts and ends, punctuation and markup edges all count as edges.
    expect(restorePlaceholders("PERSON_2\n**CLIENT_1_BRAND**: \"PERSON_2_FIRST\"-led, PERSON_1.", map)).toBe(
      "Wren Writer\n**Verdant Grid**: \"Wren\"-led, Dana Whitfield."
    );
  });

  it("mixes both forms in one pass and never reads a restored name again", () => {
    expect(restorePlaceholders("[PERSON_1] met PERSON_3 and [CLIENT_1_BRAND] met CLIENT_1_BRAND.", map)).toBe(
      "Dana Whitfield met Marcus Lindqvist and Verdant Grid met Verdant Grid."
    );
    const chained = [
      { token: "[PERSON_1]", value: "PERSON_2" },
      { token: "[PERSON_2]", value: "Dana Whitfield" },
    ];
    expect(restorePlaceholders("PERSON_1 and [PERSON_1]", chained)).toBe("PERSON_2 and PERSON_2");
  });

  it("leaves ids the map never issued exactly as written", () => {
    // Bare ids get no variant fallback: only an exact issued id restores.
    const kept = "PERSON_9, PERSON_4_FIRST, CLIENT_1_OTHER, PERSON_1_CAPS and CLIENT_2 stay.";
    expect(restorePlaceholders(kept, map)).toBe(kept);
    // The bracketed form of the same variant still falls back to its base.
    expect(restorePlaceholders("[PERSON_4_FIRST] and [CLIENT_1_OTHER]", map)).toBe("Will and Verdant Grid Technologies Inc.");
  });

  it("never replaces part of a longer identifier, another casing or a spaced form", () => {
    const untouched = [
      "XCLIENT_1",
      "CLIENT_10",
      "CLIENT_12_BRAND",
      "CLIENT_1x",
      "CLIENT_1_",
      "_CLIENT_1",
      "CLIENT_1_BRANDS",
      "CLIENT_1_Brand",
      "PERSON_1éclair",
      "éPERSON_1",
      "PERSON_1٣",
      "client_1",
      "Client_1",
      "[Client_1]",
      "PERSON_ 1",
      "[CLIENT 1]",
      "CLIENT 1",
      "config.CLIENT_1_TIMEOUT",
    ];
    for (const text of untouched) expect(restorePlaceholders(text, map), text).toBe(text);
  });

  it("keeps the bracketed restore byte for byte", () => {
    const bracketed = [
      "[PERSON_9] met [PERSON_1_FIRST].",
      "[[CLIENT_1]]",
      "[CLIENT_1]'s [CLIENT_1_SHORT][PERSON_3_LAST]",
      "[CLIENT_1_OTHER] and [PERSON_7_FIRST] and [PERSON_4_FIRST]",
      "[CLIENT_1_brand] [client_1] [CLIENT 1]",
      "No tokens [at all].",
      pseudonymize(TRANSCRIPT, map),
    ];
    for (const text of bracketed) expect(restorePlaceholders(text, map), text).toBe(bracketedOnlyRestore(text, map));
    // The fast path for text with no token of either form hands the same string back.
    const plain = "Nothing to restore here.";
    expect(restorePlaceholders(plain, map)).toBe(plain);
    // A whole id with a space inside its brackets is a bare id: its edges
    // are "[" and " ", neither a letter, digit nor underscore.
    expect(restorePlaceholders("[CLIENT_1 ] [ PERSON_1]", map)).toBe("[Verdant Grid Technologies Inc. ] [ Dana Whitfield]");
  });

  it("restores bare ids inside nested tool output", () => {
    expect(
      restorePlaceholdersDeep(
        {
          CLIENT_1: "keys stay",
          seeds: [{ bullets: ["CLIENT_1_BRAND built it.", "led by PERSON_3"], n: 2, ok: true }],
          meta: { quotes: [["PERSON_1_FIRST asked."]], ids: ["PERSON_9", "XPERSON_1"], none: null },
        },
        map
      )
    ).toEqual({
      CLIENT_1: "keys stay",
      seeds: [{ bullets: ["Verdant Grid built it.", "led by Marcus Lindqvist"], n: 2, ok: true }],
      meta: { quotes: [["Dana asked."]], ids: ["PERSON_9", "XPERSON_1"], none: null },
    });
  });

  it("detects a source that already carries a bare id this map issued", () => {
    expect(containsPlaceholderToken("the PERSON_1 column", map)).toBe(true);
    expect(containsPlaceholderToken("see CLIENT_1_BRAND.", map)).toBe(true);
    for (const text of ["PERSON_99", "PERSON_4_FIRST", "CLIENT_1_OTHER", "XPERSON_1", "PERSON_10", "client_1"]) {
      expect(containsPlaceholderToken(text, map), text).toBe(false);
    }
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

  it("renumbers past literal bare ids too, so they survive the round trip", () => {
    const source = "PERSON_1 in the log is the rig id. Dana Whitfield exported CLIENT_1_BRAND.csv and PERSON_7_LAST.";
    const safe = avoidTokenCollisions(map, [source]);
    expect(safe).not.toBe(map);
    // Past the highest bare PERSON (7) and CLIENT (1) in the text.
    expect(safe[0]).toEqual({ token: "[CLIENT_2]", value: "Verdant Grid Technologies Inc." });
    expect(safe.find((entry) => entry.value === "Dana Whitfield")?.token).toBe("[PERSON_8]");
    const hidden = pseudonymize(source, safe);
    expect(hidden).toBe("PERSON_1 in the log is the rig id. [PERSON_8] exported CLIENT_1_BRAND.csv and PERSON_7_LAST.");
    expect(restorePlaceholders(hidden, safe)).toBe(source);
    // A model echoing the literal ids bare gets them back unchanged.
    expect(restorePlaceholders("PERSON_1 and CLIENT_1_BRAND, per PERSON_8.", safe)).toBe(
      "PERSON_1 and CLIENT_1_BRAND, per Dana Whitfield."
    );
    // With the plain map, the literal ids would have become real names.
    expect(restorePlaceholders(pseudonymize(source, map), map)).not.toBe(source);
  });

  it("keeps the same map when nothing collides, and is deterministic", () => {
    expect(avoidTokenCollisions(map, ["No tokens here.", "[PERSON_99] is not ours."])).toBe(map);
    expect(avoidTokenCollisions(map, ["PERSON_99, CLIENT_1_OTHER, XPERSON_1, client_1 and CLIENT_10 are not ours."])).toBe(map);
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

  it("masks the same bytes as before bare restoration was added", () => {
    // Pinned from pseudonymize before the 2026-09-25 bare-token change;
    // only restoration changed.
    expect(pseudonymize(TRANSCRIPT, map)).toBe(
      [
        "[PERSON_1] [00:00:03]: Thanks, [PERSON_3_FIRST]. What did [CLIENT_1_SHORT] set out to build?",
        "[PERSON_3]: At [CLIENT_1] we built a controller. [PERSON_3_LAST]'s team ran it; [CLIENT_1_CAPS] paid.",
        "Speaker 2: Will it scale? Ionization is a separate topic.",
      ].join("\n\n")
    );
    expect(pseudonymizeRequest(params, map)).toEqual({
      ...params,
      system: "Write about [CLIENT_1]",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "[PERSON_1] asked [PERSON_3_FIRST].", cache_control: { type: "ephemeral", ttl: "1h" } },
            { type: "text", text: "Tail" },
          ],
        },
      ],
    });
  });

  it("restores bare ids in text and nested tool output before the caller sees them", async () => {
    const inner: GenerationClient = {
      messages: {
        create: async () => ({
          content: [
            { type: "text", text: "CLIENT_1_BRAND's controller, led by PERSON_3; CLIENT_10 stays." },
            {
              type: "tool_use",
              id: "y",
              name: "t",
              input: { claims: [{ text: "PERSON_1_FIRST asked", quote: "At [CLIENT_1] we built a controller." }], ids: ["PERSON_9"] },
            },
          ],
        }),
      },
    };
    const response = await withPlaceholders(inner, map).messages.create(params);
    expect(response.content).toEqual([
      { type: "text", text: "Verdant Grid's controller, led by Marcus Lindqvist; CLIENT_10 stays." },
      {
        type: "tool_use",
        id: "y",
        name: "t",
        input: {
          claims: [{ text: "Dana asked", quote: "At Verdant Grid Technologies Inc. we built a controller." }],
          ids: ["PERSON_9"],
        },
      },
    ]);
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
