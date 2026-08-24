import { describe, expect, it } from "vitest";
import {
  BANNED_DELETIONS,
  BANNED_REPLACEMENTS,
  BANNED_SCAN_TERMS,
  SCAN_ONLY_TERMS,
  bannedTermPattern,
  scrubBannedWords,
} from "./bannedWords";

describe("replacement table round-trips", () => {
  it.each(BANNED_REPLACEMENTS.map(([term, replacement]) => ({ term, replacement })))(
    "replaces $term with $replacement",
    ({ term, replacement }) => {
      const out = scrubBannedWords(`The report described a ${term} result here.`);
      expect(out).not.toMatch(bannedTermPattern(term));
      expect(out).toContain(replacement);
    }
  );

  it.each(BANNED_DELETIONS.map((term) => ({ term })))(
    "deletes $term without residue",
    ({ term }) => {
      const out = scrubBannedWords(`The result ${term} held under load.`);
      expect(out).toBe("The result held under load.");
    }
  );
});

describe("adjective and adverb forms", () => {
  // prompts.ts bans both forms; the old scrubber's /\bsubstantially?\b/ only
  // ever matched the adverb.
  it("catches substantial AND substantially", () => {
    expect(scrubBannedWords("A substantial gain, achieved substantially faster.")).toBe(
      "A considerable gain, achieved considerably faster."
    );
  });

  it("catches significant AND significantly", () => {
    expect(scrubBannedWords("A significant gain, achieved significantly faster.")).toBe(
      "A marked gain, achieved markedly faster."
    );
  });

  it("matches inflections of leverage/harness/revolutionize tense-for-tense", () => {
    expect(
      scrubBannedWords(
        "The team leveraged caching, leverages batching, and is leveraging both."
      )
    ).toBe("The team used caching, uses batching, and is using both.");
    expect(scrubBannedWords("By harnessing data, they harnessed real load.")).toBe(
      "By using data, they used real load."
    );
    expect(scrubBannedWords("It revolutionized what it revolutionizes.")).toBe(
      "It changed what it changes."
    );
  });
});

describe("case preservation", () => {
  it("carries a sentence-initial capital onto the replacement", () => {
    expect(scrubBannedWords("Novel approach was tested.")).toBe(
      "New approach was tested."
    );
    expect(scrubBannedWords("Delving into the logs revealed a race.")).toBe(
      "Examining the logs revealed a race."
    );
    expect(scrubBannedWords("Cutting-edge tooling was rejected.")).toBe(
      "Advanced tooling was rejected."
    );
  });

  it("keeps mid-sentence matches lowercase", () => {
    expect(scrubBannedWords("The company built a novel cache.")).toBe(
      "The company built a new cache."
    );
  });

  it("carries ALL-CAPS onto the replacement", () => {
    expect(scrubBannedWords("The NOVEL and CUTTING-EDGE design.")).toBe(
      "The NEW and ADVANCED design."
    );
  });
});

describe("deletion punctuation and whitespace cleanup", () => {
  // Chosen behavior: deletion consumes the trailing comma + whitespace, drops
  // both commas of a parenthetical, and re-capitalizes the word that now opens
  // the sentence. The old scrubber left ", the…" orphans and lowercase starts.
  it("sentence-initial connective: comma consumed, next word capitalized", () => {
    expect(scrubBannedWords("Fundamentally, the architecture had to change.")).toBe(
      "The architecture had to change."
    );
    expect(scrubBannedWords("Furthermore, the tests passed.")).toBe(
      "The tests passed."
    );
    expect(scrubBannedWords("It failed. Moreover, the retry failed too.")).toBe(
      "It failed. The retry failed too."
    );
  });

  it("parenthetical: both commas removed", () => {
    expect(scrubBannedWords("The design was, fundamentally, a rewrite.")).toBe(
      "The design was a rewrite."
    );
  });

  it("mid-sentence adverb: single space remains", () => {
    expect(scrubBannedWords("The team fundamentally reworked the parser.")).toBe(
      "The team reworked the parser."
    );
  });

  it("sentence-final adverb: no space left before the period", () => {
    expect(scrubBannedWords("The failure mode differed fundamentally.")).toBe(
      "The failure mode differed."
    );
  });

  it("clause comma before the deleted word survives when it belongs to the sentence", () => {
    expect(scrubBannedWords("The cache warmed, fundamentally changing latency.")).toBe(
      "The cache warmed, changing latency."
    );
  });

  it("stacked connectives are fully removed in one scrub", () => {
    expect(scrubBannedWords("Moreover, additionally, the results held.")).toBe(
      "The results held."
    );
  });

  it("already-capitalized word after a sentence-initial deletion is untouched", () => {
    expect(scrubBannedWords("Furthermore, CRA requires evidence.")).toBe(
      "CRA requires evidence."
    );
  });
});

describe("word-boundary safety", () => {
  // Decision: matching is strict whole-word. Derived forms not in the table
  // ("novelty", "uniquely", "transformation") pass through untouched, and
  // "transform" itself is scan-only (it is also a technical noun), so the
  // scrubber never rewrites it.
  it("never mangles mid-word or derived forms", () => {
    const text =
      "The novelty of the transformation was to transform uniquely shaped inputs.";
    expect(scrubBannedWords(text)).toBe(text);
  });

  it("replaces transformative but not transformation", () => {
    // a/an agreement is out of scope for a mechanical scrubber — documented.
    expect(scrubBannedWords("A transformative transformation.")).toBe(
      "A important transformation."
    );
  });
});

describe("stability", () => {
  const fixture = [
    "Fundamentally, the novel system leveraged a robust, seamless cache.",
    "Furthermore, substantial gains were substantiated significantly.",
    "The team was, moreover, harnessing a state-of-the-art paradigm.",
    "Additionally, delving into the ecosystem revealed synergy.",
  ].join(" ");

  it("scrubbing twice equals scrubbing once", () => {
    const once = scrubBannedWords(fixture);
    expect(scrubBannedWords(once)).toBe(once);
  });

  it("replaces every occurrence, not just the first", () => {
    expect(scrubBannedWords("A novel cache and a novel index; both novel.")).toBe(
      "A new cache and a new index; both new."
    );
  });

  it("scrubbed output contains no scrubbable term", () => {
    const out = scrubBannedWords(fixture);
    for (const [term] of BANNED_REPLACEMENTS) {
      expect(out).not.toMatch(bannedTermPattern(term));
    }
    for (const term of BANNED_DELETIONS) {
      expect(out).not.toMatch(bannedTermPattern(term));
    }
  });
});

describe("scan list", () => {
  // Coverage is by pattern, not literal membership: a redundant phrase is
  // dropped from the scan list when a shorter listed term already matches
  // every occurrence of it ("delving into" is covered by "delving").
  const scannedBySomeTerm = (term: string) =>
    BANNED_SCAN_TERMS.some((t) => bannedTermPattern(t).test(term));

  it("covers every scrubbable term and all scan-only terms", () => {
    for (const [term] of BANNED_REPLACEMENTS)
      expect(scannedBySomeTerm(term), term).toBe(true);
    for (const term of BANNED_DELETIONS)
      expect(scannedBySomeTerm(term), term).toBe(true);
    for (const term of SCAN_ONLY_TERMS)
      expect(scannedBySomeTerm(term), term).toBe(true);
  });

  it("covers the canonical banned list from convex/ai/prompts.ts", () => {
    // Inlined from SHARED_WRITING_RULES (prompts.ts is the human-facing
    // canon); a word dropped from the tables breaks this test.
    const canon = [
      "substantial", "substantially", "significant", "significantly",
      "unique", "groundbreaking", "cutting-edge", "state-of-the-art",
      "comprehensive", "robust", "holistic", "synergy",
      "leverage", "harness", "revolutionize", "transform", "game-changing",
      "fundamentally", "paradigm", "ecosystem",
      "formed the foundation", "paved the way", "serves as a testament",
      "measurable improvement",
      "furthermore", "moreover", "additionally",
      "leveraging", "harnessing", "revolutionizing", "spearheading",
      "delving into",
      "pivotal", "seamless", "novel", "pioneering", "revolutionary",
    ];
    for (const term of canon) expect(scannedBySomeTerm(term), term).toBe(true);
  });

  it("bannedTermPattern is whole-word and handles hyphens and phrases", () => {
    expect("their cutting-edge work").toMatch(bannedTermPattern("cutting-edge"));
    expect("a cutting-edger").not.toMatch(bannedTermPattern("cutting-edge"));
    expect("paved  the\nway forward").toMatch(bannedTermPattern("paved the way"));
    expect("transformation").not.toMatch(bannedTermPattern("transform"));
  });
});
