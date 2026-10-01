import { describe, expect, it } from "vitest";
import { placeOf } from "./readingFacts";

/**
 * Review 2026-09-26 (P3): a reused Brief's facts are placed in one mutation
 * (`copyBriefToReadingFactsHandler`), up to 30 entries across the
 * generation's transcripts in the Brief's order. Each transcript is parsed
 * once for the whole mutation, so placing them stays well under Convex's
 * 1 s mutation limit with several large transcripts. Names are fictional.
 */
function bigTranscript(name: string, targetChars: number): string {
  const block = [
    "Dana Whitfield: What did you measure on the feeder rig this week?",
    "",
    `${name}: We logged flow and temperature every hour and the drift stayed within band.`,
    "",
  ].join("\n");
  return block.repeat(Math.ceil(targetChars / block.length));
}

describe("placing a reused Brief's facts", () => {
  it("parses each of several large transcripts once, however the entries alternate", () => {
    const names = ["Priya Raman", "Marcus Lindqvist", "Wen Zhao", "Amara Osei"];
    const sources = names.map((name, index) => ({
      _id: `source-${index}`,
      kind: "transcript" as const,
      label: `Interview ${index + 1}`,
      content: bigTranscript(name, 450_000),
    }));
    const started = performance.now();
    let firstRound = 0;
    const places = [];
    for (let entry = 0; entry < 30; entry += 1) {
      const source = sources[entry % sources.length];
      const offset = Math.floor((source.content.length * (entry + 1)) / 31);
      const at = source.content.lastIndexOf("We logged", offset);
      places.push(placeOf(source, { startOffset: at, endOffset: at + 20 }));
      if (entry === sources.length - 1) firstRound = performance.now() - started;
    }
    const elapsed = performance.now() - started;
    expect(places.map((place) => place.speaker)).toEqual(
      Array.from({ length: 30 }, (_, entry) => names[entry % names.length])
    );
    // Four parses of 450 000 characters, not thirty: the 26 entries after
    // the first round cost little next to it (uncached they cost about six
    // rounds more), whatever the machine's speed.
    expect(elapsed).toBeLessThan(firstRound * 2.5);
    expect(elapsed).toBeLessThan(1000);
  });
});
