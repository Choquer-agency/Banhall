import { describe, expect, it } from "vitest";
import { parseTranscriptTurns } from "../../shared/transcriptParse";
import {
  FACT_WINDOW_OVERLAP_TURNS,
  isEvidenceRole,
  locateQuote,
  needsSpeakerCheck,
  matchTokens,
  mergeNearDuplicates,
  modelTurns,
  packFactId,
  parsePackFactId,
  planFactWindows,
  renderFactPack,
  renderTurnLine,
  verifyFacts,
  type FactTurn,
  type PackFact,
  type PackTurnInfo,
} from "./transcriptFacts";
import { buildPlaceholderMap } from "./deidentify";
import type { TranscriptSpeakerRole } from "./transcriptValidators";

const CONTENT = [
  "Dana Whitfield [00:00:03]: What made the forecast hard? Was it the cloud cover?",
  "Priya Shah [00:00:09]: Um, we we couldn’t forecast net load fast enough when cloud cover changed. It was the cloud cover, honestly.",
  "Dana Whitfield [00:01:02]: So the forecast failed on cloudy days?",
  "Priya Shah [00:01:05]: The gradient boosted model hit 71 percent accuracy on sunny days and 38 percent on cloudy days.",
].join("\n\n");

const ROLES: Record<string, TranscriptSpeakerRole> = { "Dana Whitfield": "interviewer", "Priya Shah": "client" };

function factTurns(content: string, roles = ROLES): FactTurn[] {
  return parseTranscriptTurns(content).map((turn) => ({
    index: turn.index,
    speakerLabel: turn.speakerLabel,
    role: turn.speakerLabel ? (roles[turn.speakerLabel] ?? "unknown") : "unknown",
    startMs: turn.startMs,
    charStart: turn.charStart,
    charEnd: turn.charEnd,
    cleanText: turn.cleanText,
  }));
}

const TURNS = factTurns(CONTENT);

describe("locateQuote", () => {
  it("finds an exact quote in the cited turn with verbatim offsets", () => {
    const quote = "hit 71 percent accuracy on sunny days";
    const found = locateQuote(CONTENT, TURNS, quote, [3]);
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.quote.match).toBe("exact");
    expect(CONTENT.slice(found.quote.charStart, found.quote.charEnd)).toBe(quote);
  });

  it("maps a normalized quote (no filler, no stutter, straight quote, other case) back to the verbatim span", () => {
    const found = locateQuote(CONTENT, TURNS, "We couldn't forecast net load fast enough", [1]);
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.quote.match).toBe("normalized");
    expect(found.quote.exactExcerpt).toBe("we we couldn’t forecast net load fast enough");
    expect(CONTENT.slice(found.quote.charStart, found.quote.charEnd)).toBe(found.quote.exactExcerpt);
  });

  it("searches two turns either side, then the whole transcript, when the cited turn is wrong", () => {
    const found = locateQuote(CONTENT, TURNS, "38 percent on cloudy days", [0]);
    expect(found.kind === "found" && found.turn.index).toBe(3);
    const anywhere = locateQuote(CONTENT, TURNS, "38 percent on cloudy days", []);
    expect(anywhere.kind === "found" && anywhere.turn.index).toBe(3);
  });

  it("never takes evidence from an interviewer turn (decision 25)", () => {
    expect(locateQuote(CONTENT, TURNS, "So the forecast failed on cloudy days", [2]).kind).toBe("not_client_only");
    // The same words in a client turn are found there instead.
    const both = locateQuote(CONTENT, TURNS, "It was the cloud cover", [0]);
    expect(both.kind === "found" && both.turn.index).toBe(1);
  });

  it("never takes evidence from an `other` speaker, such as a vendor or a note taker (decision 25)", () => {
    const content = [
      "Dana Whitfield: What did the vendor say?",
      "Vendor Rep: Our inverter firmware cannot report ramps faster than a minute.",
      "Priya Shah: We confirmed the ramps were shorter than a minute on cloudy days.",
    ].join("\n\n");
    const turns = factTurns(content, { ...ROLES, "Vendor Rep": "other" });
    expect(locateQuote(content, turns, "inverter firmware cannot report ramps faster", [1]).kind).toBe("not_client_only");
    const verified = verifyFacts({
      content,
      turns,
      proposals: [
        { type: "context", claim: "The vendor said the firmware is slow.", turnIndexes: [1], quotes: ["inverter firmware cannot report ramps faster"] },
        { type: "result", claim: "Ramps were shorter than a minute.", turnIndexes: [2], quotes: ["ramps were shorter than a minute"] },
      ],
    });
    // The vendor's words back nothing: that fact is kept as context only.
    expect(verified.facts.map((fact) => [fact.type, fact.quotes.length])).toEqual([
      ["context", 0],
      ["result", 1],
    ]);
  });

  it("keeps a turn with no known speaker citable (every turn of an unlabelled transcript)", () => {
    const content = "What made the forecast hard?\n\nWe couldn't forecast net load fast enough when cloud cover changed.";
    const turns = factTurns(content);
    expect(turns.every((turn) => turn.role === "unknown")).toBe(true);
    const found = locateQuote(content, turns, "forecast net load fast enough", [1]);
    expect(found.kind === "found" && found.turn.role).toBe("unknown");
    expect(isEvidenceRole("unknown")).toBe(true);
    expect(needsSpeakerCheck("unknown")).toBe(true);
    expect(needsSpeakerCheck("client")).toBe(false);
    expect(isEvidenceRole("other")).toBe(false);
    expect(isEvidenceRole("interviewer")).toBe(false);
  });

  it("refuses quotes too short to back a claim, and text that is not there", () => {
    expect(locateQuote(CONTENT, TURNS, "cloud cover", [1]).kind).toBe("too_short");
    expect(locateQuote(CONTENT, TURNS, "we replaced the inverter firmware", [1]).kind).toBe("not_found");
  });

  it("property: every located span slices exactly to its excerpt", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const words = ["flow", "the", "Feeder", "voltage", "um", "held", "at", "71%", "“stable”", "we", "rig", "cloudy", "day's"];
    for (let run = 0; run < 60; run += 1) {
      const lines: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const speaker = i % 2 === 0 ? "Dana" : "Priya";
        const body = Array.from({ length: 8 + Math.floor(random() * 10) }, () => words[Math.floor(random() * words.length)]);
        lines.push(`${speaker}: ${body.join(random() < 0.3 ? "  " : " ")}.`);
      }
      const content = lines.join(random() < 0.5 ? "\n\n" : "\n");
      const turns = factTurns(content, { Dana: "interviewer", Priya: "client" });
      for (const turn of turns.filter((t) => t.role === "client")) {
        const tokens = matchTokens(content.slice(turn.charStart, turn.charEnd), turn.charStart);
        if (tokens.length < 4) continue;
        const from = Math.floor(random() * (tokens.length - 3));
        const quote = content.slice(tokens[from].start, tokens[from + 3].end);
        const located = locateQuote(content, turns, random() < 0.5 ? quote.toUpperCase() : quote, [turn.index]);
        if (located.kind !== "found") continue;
        expect(content.slice(located.quote.charStart, located.quote.charEnd)).toBe(located.quote.exactExcerpt);
      }
    }
  });
});

describe("verifyFacts", () => {
  it("keeps verified facts, keeps interviewer-only facts as context without a quote, and drops the rest", () => {
    const { facts, counts } = verifyFacts({
      content: CONTENT,
      turns: TURNS,
      proposals: [
        {
          type: "result",
          claim: "The model reached 71 percent accuracy on sunny days and 38 percent on cloudy days.",
          turnIndexes: [3],
          quotes: ["hit 71 percent accuracy on sunny days and 38 percent on cloudy days"],
        },
        {
          type: "uncertainty",
          claim: "They could not forecast net load fast enough when cloud cover changed.",
          turnIndexes: [1],
          quotes: ["we couldn't forecast net load fast enough when cloud cover changed"],
        },
        {
          type: "result",
          claim: "The forecast failed on cloudy days.",
          turnIndexes: [2],
          quotes: ["So the forecast failed on cloudy days"],
        },
        { type: "experiment", claim: "They replaced the firmware.", turnIndexes: [1], quotes: ["we replaced the inverter firmware"] },
        { type: "banana", claim: "Not a type.", turnIndexes: [1], quotes: ["forecast net load fast enough"] },
      ],
    });
    expect(facts.map((fact) => [fact.key, fact.type, fact.quotes.length])).toEqual([
      ["F1", "uncertainty", 1],
      ["F2", "context", 0],
      ["F3", "result", 1],
    ]);
    expect(counts).toEqual({ proposed: 5, verified: 2, dropped: 2 });
    for (const fact of facts) {
      for (const quote of fact.quotes) expect(CONTENT.slice(quote.charStart, quote.charEnd)).toBe(quote.exactExcerpt);
    }
    expect(facts[0].speakerLabel).toBe("Priya Shah");
    expect(facts[0].confidence).toBe(0.8);
    expect(facts[2].confidence).toBe(1);
  });

  it("merges the same fact proposed by two overlapping windows", () => {
    const merged = mergeNearDuplicates([
      {
        type: "result",
        claim: "71 percent on sunny days.",
        turnIndexes: [3],
        quotes: [{ charStart: 10, charEnd: 30, exactExcerpt: "x", match: "exact" as const }],
        confidence: 1,
      },
      {
        type: "result",
        claim: "The model reached 71 percent accuracy on sunny days.",
        turnIndexes: [3],
        quotes: [
          { charStart: 20, charEnd: 40, exactExcerpt: "y", match: "exact" as const },
          { charStart: 90, charEnd: 99, exactExcerpt: "z", match: "normalized" as const },
        ],
        confidence: 0.8,
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].claim).toBe("The model reached 71 percent accuracy on sunny days.");
    expect(merged[0].quotes.map((quote) => quote.charStart)).toEqual([10, 90]);
    expect(merged[0].confidence).toBe(0.8);
  });
});

describe("windows and turn lines", () => {
  it("renders a turn with its id, role and placeholders", () => {
    const map = buildPlaceholderMap({ people: ["Priya Shah"] });
    expect(renderTurnLine(TURNS[3], map)).toBe(
      "[T0003] (client) [PERSON_1]: The gradient boosted model hit 71 percent accuracy on sunny days and 38 percent on cloudy days."
    );
  });

  it("splits long transcripts into overlapping windows that cover every turn", () => {
    const content = Array.from({ length: 120 }, (_, i) => `${i % 2 ? "Priya" : "Dana"}: ${Array.from({ length: 200 }, (_, j) => `w${j}`).join(" ")} turn ${i}.`).join("\n\n");
    const turns = factTurns(content, { Dana: "interviewer", Priya: "client" });
    const windows = planFactWindows(turns, 5_000);
    expect(windows.length).toBeGreaterThan(3);
    const covered = new Set(windows.flat().map((turn) => turn.index));
    expect(covered.size).toBe(modelTurns(turns).length);
    for (let i = 1; i < windows.length; i += 1) {
      const previous = windows[i - 1].map((turn) => turn.index);
      expect(previous.slice(-FACT_WINDOW_OVERLAP_TURNS)).toEqual(
        windows[i].slice(0, FACT_WINDOW_OVERLAP_TURNS).map((turn) => turn.index)
      );
    }
  });

  it("drops empty turns and exact repeats from the model's view", () => {
    const repeated = factTurns("Priya: We built a rig.\n\nPriya: We built a rig.\n\nDana: Okay.", {});
    expect(modelTurns(repeated).map((turn) => turn.cleanText)).toEqual(["We built a rig.", "Okay."]);
  });
});

describe("fact pack", () => {
  const facts: PackFact[] = [
    {
      key: "F2",
      type: "result",
      claim: "The model reached 71 percent accuracy on sunny days.",
      turnIndexes: [3],
      quotes: [{ charStart: 300, charEnd: 340, exactExcerpt: "hit 71 percent accuracy on sunny days" }],
      speakerLabel: "Priya Shah",
    },
    {
      key: "F1",
      type: "uncertainty",
      claim: "They could not forecast net load fast enough.",
      turnIndexes: [1],
      quotes: [{ charStart: 100, charEnd: 140, exactExcerpt: "couldn’t forecast net load\nfast enough" }],
      speakerLabel: "Priya Shah",
    },
    {
      key: "F3",
      type: "result",
      claim: "The forecast failed on cloudy days.",
      turnIndexes: [2],
      quotes: [{ charStart: 200, charEnd: 230, exactExcerpt: "So the forecast failed on cloudy days" }],
      speakerLabel: "Dana Whitfield",
    },
  ];
  const turnInfo = new Map<number, PackTurnInfo>([
    [1, { speakerLabel: "Priya Shah", startMs: 9_000, charStart: 90, charEnd: 190 }],
    [2, { speakerLabel: "Dana Whitfield", startMs: 62_000, charStart: 195, charEnd: 240 }],
    [3, { speakerLabel: "Priya Shah", startMs: 65_000, charStart: 250, charEnd: 400 }],
  ]);
  const roles = new Map<string, TranscriptSpeakerRole>([
    ["Priya Shah", "client"],
    ["Dana Whitfield", "interviewer"],
  ]);

  it("renders byte-identical text whatever order the facts arrive in", () => {
    const a = renderFactPack({ position: 2, label: "Helios kickoff" }, facts, { roles, turnInfo });
    const b = renderFactPack({ position: 2, label: "Helios kickoff" }, [...facts].reverse(), { roles, turnInfo });
    expect(a).toBe(b);
    expect(a).toBe(
      [
        "Transcript 2: Helios kickoff\nVerified facts. Cite a fact by its id; quotes are verbatim from the transcript.",
        '[F2-1] (uncertainty) They could not forecast net load fast enough.\n  > "couldn’t forecast net load fast enough" (Priya Shah, client, 00:00:09)',
        "[F2-3] (context) The forecast failed on cloudy days.",
        '[F2-2] (result) The model reached 71 percent accuracy on sunny days.\n  > "hit 71 percent accuracy on sunny days" (Priya Shah, client, 00:01:05)',
      ].join("\n\n")
    );
  });

  it("drops a quote whose speaker is now the interviewer, and keeps the highest-ranked facts under a cap", () => {
    const capped = renderFactPack({ position: 1, label: "A" }, facts, { roles, turnInfo, maxChars: 260 });
    expect(capped).toContain("[F1-1] (uncertainty)");
    expect(capped).not.toContain("[F1-3]");
    expect(capped).toMatch(/\[\d more facts omitted to fit\.\]$/);
  });

  it("round-trips pack fact ids", () => {
    expect(packFactId(3, "F12")).toBe("F3-12");
    expect(parsePackFactId("F3-12")).toEqual({ position: 3, key: "F12" });
    expect(parsePackFactId("F3")).toBeNull();
  });
});
