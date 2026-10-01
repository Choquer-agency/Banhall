import { describe, expect, it } from "vitest";
import fixtureRaw from "../../test-data/placeholder-bare-token-replay.json?raw";
import type { Id } from "../_generated/dataModel";
import { restoreResponse, withPlaceholders } from "../ai/placeholderClient";
import type { GenerationClient, GenerationResponse } from "../ai/openrouterCore";
import { citeQuote, validateCitation, type FrozenSource } from "./citations";
import { pseudonymize, restorePlaceholders, type PlaceholderMap } from "./deidentify";

/**
 * Review 2026-09-25: an offline replay of the production analyzer and Brief
 * with claude-sonnet-5 (fictional projects) returned placeholders without
 * their brackets, such as `CLIENT_1_BRAND` in a Brief storyline and "led by
 * PERSON_2" in an analysis, and they survived restoration. These are the
 * saved raw responses, restored the way the placeholder client restores
 * every response.
 */
type Fixture = {
  inputs: Record<string, { project: { clientName: string }; transcript: string; map: PlaceholderMap }>;
  responses: Array<{ callId: string; input: string; toolName: string; toolInput: Record<string, unknown> }>;
};
const fixture = JSON.parse(fixtureRaw) as Fixture;

/**
 * The saved maps were frozen before entries carried the `bare` mark, so they
 * stand for a generation reserved before the fix. `marked` is the same map as
 * a generation reserved since then freezes it.
 */
function marked(map: PlaceholderMap): PlaceholderMap {
  return map.map((entry) => ({ ...entry, bare: true }));
}

const ANY_ID = /(?:CLIENT|PERSON)_\d+/;

function restored(callId: string) {
  const saved = fixture.responses.find((response) => response.callId === callId)!;
  const input = fixture.inputs[saved.input];
  const response: GenerationResponse = {
    content: [{ type: "tool_use", id: "tool_1", name: saved.toolName, input: saved.toolInput }],
  };
  const block = restoreResponse(response, marked(input.map)).content[0];
  if (block.type !== "tool_use") throw new Error("expected a tool_use block");
  return { saved, input, output: block.input as Record<string, unknown> };
}

function source(content: string): FrozenSource {
  return { _id: "src_t1" as Id<"generationSources">, content, contentHash: "fixture" };
}

describe("replayed model output with bare placeholders (review 2026-09-25)", () => {
  it("carries bare ids in every saved response, which is what this replay tests", () => {
    for (const saved of fixture.responses) {
      const text = JSON.stringify(saved.toolInput);
      expect(text, saved.callId).toMatch(/(?<![\p{L}\p{N}_[])(?:CLIENT|PERSON)_\d+(?:_[A-Z]+)?(?![\p{L}\p{N}_\]])/u);
    }
  });

  it("restores the Helios analyzer's CLIENT_1_BRAND to the client's name", () => {
    const { saved, output } = restored("helios__sonnet5__analyzer__r1");
    expect(JSON.stringify(saved.toolInput)).toContain("CLIENT_1_BRAND");
    const text = JSON.stringify(output);
    expect(text).not.toMatch(ANY_ID);
    expect(text).toContain("Verdant Grid");
  });

  it("restores the Cedarline analyzer's CLIENT_1 and 'led by PERSON_2' to real names", () => {
    const { saved, output } = restored("cedarline__sonnet5__analyzer__r2");
    expect(String(saved.toolInput.company_context)).toMatch(/^CLIENT_1 manufactures .*led by PERSON_2\)/);
    expect(JSON.stringify(output)).not.toMatch(ANY_ID);
    expect(String(output.company_context)).toMatch(/^Cedarline Systems manufactures .*led by Priya Shah\)/);
  });

  it("restores the Helios Brief storyline, and every quote still resolves to the same exact offsets", () => {
    const { saved, input, output } = restored("helios__sonnet5__brief__r2");
    expect(String(saved.toolInput.storyline)).toMatch(/^CLIENT_1_BRAND builds controllers/);
    expect(String(output.storyline)).toMatch(/^Verdant Grid builds controllers/);
    expect(JSON.stringify(output)).not.toMatch(ANY_ID);

    const transcript = source(input.transcript);
    const quotesOf = (brief: Record<string, unknown>) =>
      ["storylineClaims", "claimExclusions", "confidenceMap"].flatMap((key) =>
        ((brief[key] as Array<{ quote: string }> | undefined) ?? []).map((entry) => entry.quote)
      );
    const before = quotesOf(saved.toolInput);
    const after = quotesOf(output);
    expect(after.length).toBeGreaterThan(10);
    after.forEach((quote, index) => {
      const citation = citeQuote([transcript], quote);
      expect(citation, quote).not.toBeNull();
      expect(validateCitation(transcript, citation!)).toBe(true);
      // Where the bracket-only restore located this quote, it still does.
      expect(citation).toEqual(citeQuote([transcript], before[index]));
    });
  });

  it("resolves a quote cut from the masked transcript to exact offsets in the real one", async () => {
    const { transcript } = fixture.inputs.helios;
    const map = marked(fixture.inputs.helios.map);
    const masked = pseudonymize(transcript, map);
    expect(restorePlaceholders(masked, map)).toBe(transcript);
    const at = masked.indexOf("[PERSON_");
    expect(at).toBeGreaterThanOrEqual(0);
    const quote = masked.slice(at, masked.indexOf("\n", at));
    const inner: GenerationClient = {
      messages: {
        create: async () => ({
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "submit_generation_brief",
              input: { storyline: "CLIENT_1_BRAND and PERSON_1 agreed.", storylineClaims: [{ text: "x", quote }] },
            },
          ],
        }),
      },
    };
    const response = await withPlaceholders(inner, map).messages.create({
      model: "claude-sonnet-5",
      max_tokens: 10,
      messages: [{ role: "user", content: transcript }],
    });
    const block = response.content[0];
    if (block.type !== "tool_use") throw new Error("expected a tool_use block");
    const output = block.input as { storyline: string; storylineClaims: Array<{ quote: string }> };
    expect(output.storyline).toBe("Verdant Grid and Jordan Ellis agreed.");
    const restoredQuote = output.storylineClaims[0].quote;
    expect(restoredQuote).not.toMatch(ANY_ID);
    const citation = citeQuote([source(transcript)], restoredQuote)!;
    expect(citation.startOffset).toBe(transcript.indexOf(restoredQuote));
    expect(validateCitation(source(transcript), citation)).toBe(true);
  });

  it("leaves bare ids as written under a map frozen before the mark, and still restores bracketed ones", () => {
    for (const saved of fixture.responses) {
      const { map } = fixture.inputs[saved.input];
      expect(map.some((entry) => entry.bare), saved.input).toBe(false);
      const response: GenerationResponse = {
        content: [{ type: "tool_use", id: "tool_1", name: saved.toolName, input: saved.toolInput }],
      };
      const block = restoreResponse(response, map).content[0];
      if (block.type !== "tool_use") throw new Error("expected a tool_use block");
      // The saved responses hold bare ids only, so each comes back unchanged.
      expect(JSON.stringify(saved.toolInput)).not.toMatch(/\[(?:CLIENT|PERSON)_/);
      expect(block.input, saved.callId).toEqual(saved.toolInput);
    }
    const { map } = fixture.inputs.helios;
    expect(restorePlaceholders("CLIENT_1_BRAND and PERSON_1 agreed.", map)).toBe("CLIENT_1_BRAND and PERSON_1 agreed.");
    expect(restorePlaceholders("[CLIENT_1_BRAND] and [PERSON_1] agreed.", map)).toBe("Verdant Grid and Jordan Ellis agreed.");
  });
});
