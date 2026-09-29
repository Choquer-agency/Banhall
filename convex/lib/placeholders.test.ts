import { describe, expect, it } from "vitest";
import {
  avoidTokenCollisions,
  deidentify,
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
      { token: "[CLIENT_1]", value: "Verdant Grid Technologies Inc.", bare: true },
      { token: "[CLIENT_1_SHORT]", value: "Verdant Grid Technologies", bare: true },
      { token: "[CLIENT_1_BRAND]", value: "Verdant Grid", bare: true },
      { token: "[CLIENT_1_CAPS]", value: "VERDANT GRID TECHNOLOGIES", bare: true },
      { token: "[CLIENT_1_FIRST]", value: "Verdant", bare: true },
      { token: "[PERSON_1]", value: "Dana Whitfield", bare: true },
      { token: "[PERSON_1_FIRST]", value: "Dana", bare: true },
      { token: "[PERSON_1_LAST]", value: "Whitfield", bare: true },
      { token: "[PERSON_2]", value: "Wren Writer", bare: true },
      { token: "[PERSON_2_FIRST]", value: "Wren", bare: true },
      { token: "[PERSON_2_LAST]", value: "Writer", bare: true },
      { token: "[PERSON_3]", value: "Marcus Lindqvist", bare: true },
      { token: "[PERSON_3_FIRST]", value: "Marcus", bare: true },
      { token: "[PERSON_3_LAST]", value: "Lindqvist", bare: true },
      { token: "[PERSON_4]", value: "Will Smith", bare: true },
      { token: "[PERSON_4_LAST]", value: "Smith", bare: true },
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
      { token: "[PERSON_1]", value: "PERSON_2", bare: true },
      { token: "[PERSON_2]", value: "Dana Whitfield", bare: true },
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
    expect(safe[0]).toEqual({ token: "[CLIENT_2]", value: "Verdant Grid Technologies Inc.", bare: true });
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
    expect(safe[0]).toEqual({ token: "[CLIENT_2]", value: "Verdant Grid Technologies Inc.", bare: true });
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

describe("maps frozen before bare ids were restored (review 2026-09-25, P3-B1)", () => {
  // A generation reserved before the fix froze its entries without the mark.
  const frozen: PlaceholderMap = map.map(({ token, value }) => ({ token, value }));

  it("leaves bare ids as written and still restores bracketed ones, variants included", () => {
    const bare = "CLIENT_1_BRAND's controller, led by PERSON_3; PERSON_1_FIRST asked.";
    expect(restorePlaceholders(bare, frozen)).toBe(bare);
    expect(restorePlaceholders("[CLIENT_1_BRAND] met [PERSON_3] and [PERSON_4_FIRST].", frozen)).toBe(
      "Verdant Grid met Marcus Lindqvist and Will."
    );
    expect(restorePlaceholders("[PERSON_3] and PERSON_3", frozen)).toBe("Marcus Lindqvist and PERSON_3");
    expect(restorePlaceholdersDeep({ ids: ["PERSON_1", "[PERSON_1]"] }, frozen)).toEqual({ ids: ["PERSON_1", "Dana Whitfield"] });
    // The bracketed restore is the same as under the marked map.
    const hidden = pseudonymize(TRANSCRIPT, frozen);
    expect(restorePlaceholders(hidden, frozen)).toBe(restorePlaceholders(hidden, map));
    expect(containsPlaceholderToken("the PERSON_1 column", frozen)).toBe(false);
    expect(containsPlaceholderToken("the [PERSON_1] column", frozen)).toBe(true);
  });

  it("keeps a model's echo of a source with a literal bare id as written, so its quote still matches", () => {
    // Frozen before the fix, so never renumbered past the source's PERSON_2.
    const source = "PERSON_2 confirmed the valve failed.";
    const old: PlaceholderMap = [
      { token: "[PERSON_1]", value: "Dana Whitfield" },
      { token: "[PERSON_2]", value: "Tom Lee" },
    ];
    expect(restorePlaceholders(source, old)).toBe(source);
    expect(restorePlaceholders(pseudonymize(source, old), old)).toBe(source);
    // The same names in a map built today are marked and renumbered past it.
    const today = avoidTokenCollisions(buildPlaceholderMap({ people: ["Dana Whitfield", "Tom Lee"] }), [source]);
    expect(today.every((entry) => entry.bare)).toBe(true);
    expect(today.find((entry) => entry.value === "Tom Lee")?.token).toBe("[PERSON_4]");
    expect(restorePlaceholders(source, today)).toBe(source);
    expect(restorePlaceholders("PERSON_4 confirmed it.", today)).toBe("Tom Lee confirmed it.");
  });

  it("keeps each entry's mark, or its absence, through renumbering", () => {
    expect(avoidTokenCollisions(map, ["[PERSON_1]"]).every((entry) => entry.bare)).toBe(true);
    const renumbered = avoidTokenCollisions(frozen, ["[PERSON_1]"]);
    expect(renumbered).not.toBe(frozen);
    expect(renumbered.some((entry) => "bare" in entry)).toBe(false);
  });
});

describe("very long literal ids (review 2026-09-25, P3-B3)", () => {
  it("renumbers past a 22-digit id with exact, distinct tokens that restore", () => {
    const huge = "9".repeat(22);
    const source = `Rig PERSON_${huge} logged it. PERSON_1 is the bench. Dana Whitfield and Marcus Lindqvist ran it.`;
    const safe = avoidTokenCollisions(map, [source]);
    const tokens = safe.map((entry) => entry.token);
    for (const token of tokens) expect(token).toMatch(/^\[(?:CLIENT|PERSON)_\d+(?:_[A-Z]+)?\]$/);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(safe.find((entry) => entry.value === "Dana Whitfield")?.token).toBe(`[PERSON_1${"0".repeat(22)}]`);
    expect(safe.find((entry) => entry.value === "Marcus Lindqvist")?.token).toBe(`[PERSON_1${"0".repeat(21)}2]`);
    expect(restorePlaceholders(pseudonymize(source, safe), safe)).toBe(source);
    expect(restorePlaceholders(`PERSON_1${"0".repeat(22)} asked PERSON_${huge}.`, safe)).toBe(`Dana Whitfield asked PERSON_${huge}.`);
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

// Release suite run 6, fixture "Exclusion-matching selection" (commit
// c8ce1fe2, fictional Quillmere Analytics Ltd.): Line 242 opened "Quillmere
// Client builds controllers". The words come from the stored transcript
// analysis, whose company_context read "Quillmere Client (Quillmere/Quillmere
// Analytics Ltd.) is a 25-person company"; no source, Seed or setting says
// "Quillmere Client". The map hid the full and short names ([CLIENT_1],
// [CLIENT_1_SHORT]) but not the word people say, so the analyzer saw "a bit
// about Quillmere" beside "[CLIENT_1] is based in Carrow" and joined the two
// into a name. 2026-09-29 (second): a coined first word is hidden too.
describe("a company's coined first word (release suite run 6)", () => {
  const quillmere = buildPlaceholderMap({
    clientName: "Quillmere Analytics Ltd.",
    people: ["Beatrix Nwachukwu", "Anders Kowalczyk", "Rosalind Tiwari"],
  });
  const analyzerRequest: GenerationMessageParams = {
    model: "claude-sonnet-5",
    max_tokens: 100,
    system: "Analyse the SR&ED interview.",
    messages: [{
      role: "user",
      content: [
        "Beatrix Nwachukwu: Anders, could you start with a bit about Quillmere and what your team does?",
        "Anders Kowalczyk: Sure. Quillmere Analytics Ltd. is based in Carrow, Saskatchewan. We're 25 people.",
        "Signed-off idea: Quillmere builds controllers and cloud analytics for grain dryers.",
      ].join("\n\n"),
    }],
  };

  it("hides the name everywhere the model reads it, so no bare brand sits beside its token", () => {
    expect(quillmere.slice(0, 4)).toEqual([
      { token: "[CLIENT_1]", value: "Quillmere Analytics Ltd.", bare: true },
      { token: "[CLIENT_1_SHORT]", value: "Quillmere Analytics", bare: true },
      { token: "[CLIENT_1_CAPS]", value: "QUILLMERE ANALYTICS", bare: true },
      { token: "[CLIENT_1_FIRST]", value: "Quillmere", bare: true },
    ]);
    const sent = pseudonymizeRequest(analyzerRequest, quillmere);
    const text = JSON.stringify(sent);
    expect(text).not.toContain("Quillmere");
    expect(sent.messages[0].content).toBe([
      "[PERSON_1]: [PERSON_2_FIRST], could you start with a bit about [CLIENT_1_FIRST] and what your team does?",
      "[PERSON_2]: Sure. [CLIENT_1] is based in Carrow, Saskatchewan. We're 25 people.",
      "Signed-off idea: [CLIENT_1_FIRST] builds controllers and cloud analytics for grain dryers.",
    ].join("\n\n"));
    // Before, the map had no single-word form and the model read both.
    const before = quillmere.filter((entry) => entry.token !== "[CLIENT_1_FIRST]");
    const leaked = JSON.stringify(pseudonymizeRequest(analyzerRequest, before));
    expect(leaked).toContain("a bit about Quillmere and");
    expect(leaked).toContain("[CLIENT_1] is based in Carrow");
  });

  it("restores the name the model writes with the tokens, bracketed or bare", async () => {
    const inner: GenerationClient = {
      messages: {
        create: async () => ({
          content: [{
            type: "tool_use",
            id: "analysis",
            name: "submit_analysis",
            input: { company_context: "[CLIENT_1] ([CLIENT_1_FIRST]) is a 25-person company. CLIENT_1_FIRST builds controllers." },
          }],
        }),
      },
    };
    const response = await withPlaceholders(inner, quillmere).messages.create(analyzerRequest);
    expect(response.content).toEqual([{
      type: "tool_use",
      id: "analysis",
      name: "submit_analysis",
      input: { company_context: "Quillmere Analytics Ltd. (Quillmere) is a 25-person company. Quillmere builds controllers." },
    }]);
    // A map frozen before this change restores the variant from its base.
    const frozen = quillmere.filter((entry) => entry.token !== "[CLIENT_1_FIRST]");
    expect(restorePlaceholders("[CLIENT_1_FIRST] builds controllers.", frozen)).toBe("Quillmere builds controllers.");
  });

  it("never hides an ordinary first word, a one-word name or a first word that is also a name", () => {
    for (const clientName of [
      "Northern Robotics Inc.",
      "Advanced Sensing Ltd.",
      "Precision Castings Corp.",
      "Grant Dryer Systems Ltd.",
      "Quillmere Inc.",
      "AB Controls Ltd.",
      "ACME Robotics",
      "3M Canada",
      // Review P3-4: ordinary capitalized technical words.
      "Laser Dynamics Inc.",
      "Hydraulic Systems Ltd.",
      "Polymer Works Ltd.",
      "Carbon Forge Inc.",
      "North-West Controls Ltd.",
    ]) {
      const firstForm = buildPlaceholderMap({ clientName, people: [] })
        .find((entry) => entry.token === "[CLIENT_1_FIRST]");
      expect(firstForm, clientName).toBeUndefined();
    }
    // Review P3-4: a founder's given name on the map is that person, never
    // the company.
    const founder = buildPlaceholderMap({ clientName: "Morgan Hale Engineering Ltd.", people: ["Morgan Hale"] });
    expect(founder.find((entry) => entry.token === "[CLIENT_1_FIRST]")).toBeUndefined();
    expect(pseudonymize("Morgan said Morgan Hale Engineering Ltd. grew.", founder))
      .toBe("[PERSON_1_FIRST] said [CLIENT_1] grew.");
    // Re-check P3-1: only a word the map hides everywhere as a person blocks
    // the company's token. A weak label hidden only as a label, or a word
    // inside a longer label, never does, so "Quillmere" is still hidden.
    for (const input of [
      { clientName: "Quillmere Analytics Ltd.", people: ["Anders Kowalczyk"], phrases: ["Quillmere"] },
      { clientName: "Quillmere Analytics Ltd.", people: ["Dana Whitfield (Quillmere)"] },
    ]) {
      const map = buildPlaceholderMap(input);
      expect(map.find((entry) => entry.token === "[CLIENT_1_FIRST]")?.value, JSON.stringify(input)).toBe("Quillmere");
      expect(pseudonymize("Could you start with a bit about Quillmere?", map))
        .toBe("Could you start with a bit about [CLIENT_1_FIRST]?");
      expect(restorePlaceholders(pseudonymize("About Quillmere.", map), map)).toBe("About Quillmere.");
    }
    // Inner capitals and a hyphen between letters are still coined words.
    for (const [clientName, first] of [
      ["QuillMere Analytics Ltd.", "QuillMere"],
      ["Quill-Mere Analytics Ltd.", "Quill-Mere"],
      ["Bio-Rad Labs Inc.", "Bio-Rad"],
    ] as const) {
      const map = buildPlaceholderMap({ clientName, people: [] });
      expect(map.find((entry) => entry.token === "[CLIENT_1_FIRST]")?.value, clientName).toBe(first);
      expect(pseudonymize(`About ${first} and its work.`, map)).toBe("About [CLIENT_1_FIRST] and its work.");
    }
    // "Quillmere Inc." still hides "Quillmere", as its short form.
    expect(pseudonymize("Quillmere built it.", buildPlaceholderMap({ clientName: "Quillmere Inc.", people: [] })))
      .toBe("[CLIENT_1_SHORT] built it.");
    // A firm's own coined first word is hidden the same way.
    expect(pseudonymize(
      "Northwind wrote it.",
      buildPlaceholderMap({ firms: ["Northwind Advisory"], people: [] })
    )).toBe("[FIRM_1_FIRST] wrote it.");
  });
});

// 2026-09-29 (second, privacy): a JSON-encoded or escaped text writes a line
// break before a name as "\n", which used to glue the letter "n" to the name
// so the word-edge check skipped it and the name reached the provider.
describe("backslash escapes are word edges (placeholder algorithm 5)", () => {
  const map = buildPlaceholderMap({
    clientName: "Quillmere Analytics Ltd.",
    people: ["Morgan Hale"],
    phrases: ["Rosalind"],
  });

  it.each([
    ["\\n"], ["\\t"], ["\\r"], ["\\b"], ["\\f"], ["\\u00a0"], ["\\\""], ["\\\\"], ["\\/"], ["\\r\\n"],
  ])("hides a name right after %s and restores it exactly", (escape) => {
    const text = `x${escape}Quillmere Analytics Ltd. agreed${escape}Morgan Hale ran it${escape}Hale too.`;
    const hidden = pseudonymize(text, map);
    expect(hidden).toBe(`x${escape}[CLIENT_1] agreed${escape}[PERSON_1] ran it${escape}[PERSON_1_LAST] too.`);
    expect(restorePlaceholders(hidden, map)).toBe(text);
  });

  it("hides every name in a JSON-encoded text and restores the decoded text", () => {
    const raw = "Use compliant spindle.\nQuillmere Analytics Ltd. agreed.\tMorgan Hale approved.\r\nQuillmere signed.";
    const encoded = JSON.stringify({ bullets: [raw] });
    const hidden = pseudonymize(encoded, map);
    expect(hidden).not.toMatch(/Quillmere|Morgan|Hale/);
    expect(restorePlaceholdersDeep(JSON.parse(hidden), map)).toEqual({ bullets: [raw] });
  });

  it("never treats an escaped backslash before a letter as an escape", () => {
    // "\\n" is a backslash, then the letter n glued to the name: no edge.
    expect(pseudonymize("a\\\\nQuillmere b", map)).toBe("a\\\\nQuillmere b");
    // An odd run of backslashes ends in an escape again.
    expect(pseudonymize("a\\\\\\nQuillmere b", map)).toBe("a\\\\\\n[CLIENT_1_FIRST] b");
    // Inside a word the letters of an escape are still letters.
    expect(pseudonymize("Xnote\\nfoo", map)).toBe("Xnote\\nfoo");
  });

  it("restores a bare token after an escape, and the collision scan sees it", () => {
    expect(restorePlaceholders("a\\nCLIENT_1_FIRST b\\tPERSON_1", map)).toBe("a\\nQuillmere b\\tMorgan Hale");
    expect(containsPlaceholderToken("a\\nPERSON_1 b", map)).toBe(true);
    const safe = avoidTokenCollisions(map, ["log line\\nPERSON_1 was the rig"]);
    expect(safe.find((entry) => entry.value === "Morgan Hale")?.token).toBe("[PERSON_2]");
    expect(restorePlaceholders(pseudonymize("log line\\nPERSON_1 was Morgan Hale", safe), safe))
      .toBe("log line\\nPERSON_1 was Morgan Hale");
  });

  it("finds a label after an escaped line break, as at the start of a line", () => {
    expect(pseudonymize("{\"t\":\"Q: hi\\nRosalind: yes\\nRosalind 00:01\\n\"}", map))
      .toBe("{\"t\":\"Q: hi\\n[PERSON_2]: yes\\n[PERSON_2] 00:01\\n\"}");
    // Still never in running text.
    expect(pseudonymize("ask\\nRosalind about it", map)).toBe("ask\\nRosalind about it");
  });

  it("redacts after an escape too, in deidentify", () => {
    expect(deidentify("a\\nAcme Farms b\\tAcme", { clientName: "Acme Farms" })).toBe("a\\n[redacted] b\\tAcme");
  });
});
