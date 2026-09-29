import { describe, expect, it } from "vitest";
import { findExactQuoteSpans } from "../../shared/exactQuote";
import {
  MAX_BATCH_SEEDS,
  MAX_BULLET_WORDS,
  MIN_FEEDBACK_SEEDS,
  SEED_TAGS,
  isLongForSeed,
  isOneSeedSentence,
  locateCitations,
  nearestOccurrence,
  seedToolSchema,
  speakerOfTranscriptLine,
  validateBatch,
  validateSeed,
  withQuoteChecks,
  type SeedCandidate,
} from "./seedContract";

function candidate(
  bullets: string[],
  tags: SeedCandidate["tags"] = ["technical"],
  extra: Partial<SeedCandidate> = {}
): SeedCandidate {
  return { bullets, tags, provenance: [], ...extra };
}

const one = "The adaptive controller reduced oscillation under changing loads.";
const two = "The first test overshot the target.";

describe("seed contract", () => {
  it("accepts one sentence with allowlisted abbreviations and decimals", () => {
    expect(isOneSeedSentence("Dr. Rao measured 1.5 volts under load.")).toBe(true);
    expect(isOneSeedSentence("The controller, e.g. the PID variant, settled slowly.")).toBe(
      true
    );
    expect(isOneSeedSentence("One sentence. A second sentence follows.")).toBe(false);
    expect(isOneSeedSentence("An unterminated bullet")).toBe(false);
  });

  it("flags a writer's bullet as long past 25 words or one sentence, never for a missing full stop", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(isLongForSeed(`${words(MAX_BULLET_WORDS)}.`)).toBe(false);
    expect(isLongForSeed(`${words(MAX_BULLET_WORDS + 1)}.`)).toBe(true);
    expect(isLongForSeed("One sentence. A second sentence follows.")).toBe(true);
    expect(isLongForSeed("Dr. Rao measured 1.5 volts under load.")).toBe(false);
    expect(isLongForSeed("An unterminated bullet")).toBe(false);
    expect(isLongForSeed("   ")).toBe(false);
  });

  it("drops an AI Seed whose bullet uses a typographic dash or stand-in, but not a hyphen range", () => {
    for (const bullet of [
      "The controller held the band — even under load.",
      "Trials ran for 10–20 minutes per zone.",
      "The controller held the band -- even under load.",
    ]) {
      const result = validateSeed({ roleId: "company_context", seed: candidate([bullet]) });
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain("BULLET_TYPOGRAPHIC_DASH");
    }
    const clean = validateSeed({
      roleId: "company_context",
      seed: candidate(["Trials ran for 10-20 minutes per zone on a Newton-Raphson solver."]),
    });
    expect(clean.issues.map((issue) => issue.code)).not.toContain("BULLET_TYPOGRAPHIC_DASH");
  });

  it("enforces the exact 25-word boundary", () => {
    const atLimit = `${Array.from({ length: MAX_BULLET_WORDS - 1 }, () => "word").join(
      " "
    )} end.`;
    const overLimit = `word ${atLimit}`;
    expect(validateSeed({ roleId: "goal_problem", seed: candidate([atLimit]) }).ok).toBe(
      true
    );
    expect(validateSeed({ roleId: "goal_problem", seed: candidate([overLimit]) }).ok).toBe(
      false
    );
  });

  it("enforces bullet and tag cardinality and the closed tag vocabulary", () => {
    expect(SEED_TAGS).toHaveLength(6);
    expect(
      validateSeed({ roleId: "goal_problem", seed: candidate([one, two, one]) }).ok
    ).toBe(false);
    expect(
      validateSeed({
        roleId: "goal_problem",
        seed: { bullets: [one], tags: ["invented"], provenance: [] },
      }).ok
    ).toBe(false);
    expect(
      validateSeed({
        roleId: "goal_problem",
        seed: candidate([one], ["technical", "technical"]),
      }).ok
    ).toBe(false);
  });

  it("drops invalid seeds and validates diversity over the survivors", () => {
    const result = validateBatch({
      roleId: "goal_problem",
      mode: "batch",
      seeds: [
        candidate([one], ["technical"]),
        candidate([two], ["conservative"]),
        candidate(["The third approach retained a bounded safety margin."], ["detailed"]),
        candidate(["This is invalid. It has two sentences."], ["aggressive"]),
      ],
    });
    expect(result).toMatchObject({ ok: true, dropped: 1 });
    expect(result.seeds).toHaveLength(3);
  });

  it("requires tag diversity and mixed one/two-bullet forms for larger batches", () => {
    const noTagDiversity = validateBatch({
      roleId: "goal_problem",
      mode: "batch",
      seeds: [candidate([one]), candidate([two]), candidate(["A third option remained stable."])],
    });
    expect(noTagDiversity.ok).toBe(false);
    expect(noTagDiversity.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INSUFFICIENT_TAG_DIVERSITY" }),
      ])
    );

    const noFormDiversity = validateBatch({
      roleId: "goal_problem",
      mode: "batch",
      seeds: [
        candidate([one], ["technical"]),
        candidate([two], ["conservative"]),
        candidate(["A third option remained stable."], ["detailed"]),
        candidate(["The final option reduced implementation risk."], ["aggressive"]),
      ],
    });
    expect(noFormDiversity.ok).toBe(false);
    expect(noFormDiversity.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INSUFFICIENT_FORM_DIVERSITY" }),
      ])
    );

    const five = [
      candidate([one], ["technical"]),
      candidate([two, "The correction then held under load."], ["conservative"]),
      candidate(["A third option remained stable."], ["detailed"]),
      candidate(["The fourth option reduced implementation risk."], ["aggressive"]),
      candidate(["The fifth option preserved the measured tolerance."], ["high_level"]),
    ];
    expect(
      validateBatch({ roleId: "goal_problem", mode: "batch", seeds: five }).ok
    ).toBe(true);
    expect(
      validateBatch({
        roleId: "goal_problem",
        mode: "batch",
        seeds: [...five, candidate(["A sixth valid seed exceeds the batch bound."], ["alternative_angle"])],
      }).ok
    ).toBe(false);
  });

  it("accepts one to three feedback results without batch diversity rules", () => {
    expect(
      validateBatch({
        roleId: "goal_problem",
        mode: "feedback",
        seeds: [candidate([one])],
      }).ok
    ).toBe(true);
    expect(
      validateBatch({
        roleId: "goal_problem",
        mode: "feedback",
        seeds: [candidate([one]), candidate([two]), candidate([one])],
      }).ok
    ).toBe(true);
    expect(
      validateBatch({
        roleId: "goal_problem",
        mode: "feedback",
        seeds: [candidate([one]), candidate([two]), candidate([one]), candidate([two])],
      }).ok
    ).toBe(false);
  });

  it("validates role-11 links against active same-generation snapshot members", () => {
    const seed = candidate([one], ["technical"], {
      uncertaintySeedId: "uncertainty-1",
      experimentSeedIds: ["experiment-1"],
    });
    const references = [
      {
        seedId: "uncertainty-1",
        generationId: "generation-1",
        roleId: "active_uncertainties" as const,
        active: true,
      },
      {
        seedId: "experiment-1",
        generationId: "generation-1",
        roleId: "experimentation" as const,
        active: true,
      },
    ];
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed,
        referenceContext: { generationId: "generation-1", references },
      }).ok
    ).toBe(true);
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed,
        referenceContext: {
          generationId: "generation-2",
          references,
        },
      }).ok
    ).toBe(false);
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed,
        referenceContext: {
          generationId: "generation-1",
          references: references.map((reference) => ({ ...reference, active: false })),
        },
      }).ok
    ).toBe(false);
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed,
        referenceContext: {
          generationId: "generation-1",
          references: references.map((reference) =>
            reference.seedId === "experiment-1"
              ? { ...reference, roleId: "workplan" as const }
              : reference
          ),
        },
      }).ok
    ).toBe(false);
  });

  it("keeps matching frozen provenance and downgrades invalid citations", () => {
    const content = "The controller held the target within tolerance.";
    const excerpt = "held the target";
    const startOffset = content.indexOf(excerpt);
    const frozenSources = [
      {
        sourceId: "source-1",
        generationId: "generation-1",
        content,
        contentHash: "frozen-hash",
      },
    ];
    const valid = validateSeed({
      roleId: "goal_problem",
      seed: candidate([one], ["technical"], {
        provenance: [
          {
            sourceId: "source-1",
            startOffset,
            endOffset: startOffset + excerpt.length,
            exactExcerpt: excerpt,
          },
        ],
      }),
      frozenSources,
    });
    expect(valid.ok && valid.seed).toMatchObject({
      support: "source_supported",
      originalSupport: "source_supported",
      provenance: [{ sourceContentHash: "frozen-hash" }],
    });

    const invalid = validateSeed({
      roleId: "goal_problem",
      seed: candidate([one], ["technical"], {
        provenance: [
          {
            sourceId: "source-1",
            startOffset,
            endOffset: startOffset + excerpt.length,
            exactExcerpt: "different bytes",
          },
        ],
      }),
      frozenSources,
    });
    expect(invalid.ok && invalid.seed).toMatchObject({
      support: "writer_asserted",
      provenance: [],
    });

    const malformed = validateSeed({
      roleId: "goal_problem",
      seed: {
        ...candidate([one]),
        provenance: [{ sourceId: "source-1", startOffset: "zero" }],
      },
      frozenSources,
    });
    expect(malformed.ok && malformed.seed).toMatchObject({
      support: "writer_asserted",
      provenance: [],
    });
  });

  it("builds one bounded forced tool schema spanning every role and mode", () => {
    const schema = seedToolSchema();
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: { seeds: { minItems: MIN_FEEDBACK_SEEDS, maxItems: MAX_BATCH_SEEDS } },
    });
    expect(JSON.stringify(schema)).toContain("uncertaintySeedId");
    expect(JSON.stringify(schema)).toContain("experimentSeedIds");
  });

  it("drops advancement links from every other role (cost phase 1)", () => {
    const linked = { ...candidate([one]), uncertaintySeedId: "u-1", experimentSeedIds: ["e-1"] };
    const result = validateSeed({
      roleId: "goal_problem",
      seed: linked,
      referenceContext: { generationId: "generation-1", references: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed).not.toHaveProperty("uncertaintySeedId");
    expect(result.seed).not.toHaveProperty("experimentSeedIds");
  });

  it("enforces each mode's Seed count in validation, not in the schema", () => {
    const seeds = [candidate([one], ["technical"]), candidate([one], ["detailed"])];
    expect(validateBatch({ roleId: "goal_problem", mode: "feedback", seeds }).issues)
      .not.toContainEqual(expect.objectContaining({ code: "INVALID_BATCH_SIZE" }));
    expect(validateBatch({ roleId: "goal_problem", mode: "batch", seeds }).issues)
      .toContainEqual(expect.objectContaining({ code: "INVALID_BATCH_SIZE" }));
  });

  it("keeps role-11 schema links optional until frozen selections require them", () => {
    const schema = seedToolSchema();
    expect(schema).toMatchObject({
      properties: {
        seeds: {
          items: {
            required: ["bullets", "tags", "provenance"],
            properties: {
              uncertaintySeedId: { type: "string" },
              experimentSeedIds: { type: "array", minItems: 1 },
            },
          },
        },
      },
    });

    const unlinked = candidate([one]);
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed: unlinked,
        referenceContext: { generationId: "generation-1", references: [] },
      }).ok
    ).toBe(true);
    const uncertainty = {
      seedId: "uncertainty-1",
      generationId: "generation-1",
      roleId: "active_uncertainties" as const,
      active: true,
    };
    const experiment = {
      seedId: "experiment-1",
      generationId: "generation-1",
      roleId: "experimentation" as const,
      active: true,
    };
    // A link can be made, so it is required.
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed: unlinked,
        referenceContext: { generationId: "generation-1", references: [uncertainty, experiment] },
      }).ok
    ).toBe(false);
    // 2026-09-29 (first): with an experiment but no uncertainty to pair it
    // with, no link can be right, so the Seed carries none.
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed: unlinked,
        referenceContext: { generationId: "generation-1", references: [experiment] },
      }).ok
    ).toBe(true);
  });
});

describe("an advancement follows the uncertainty its experiments tested (2026-09-29, first amendment)", () => {
  // The run 6 fixture "changed-advancement-links" (Marrowgate, fictional):
  // the writer dropped the cold-water start-up uncertainty (U1) and every
  // picked experiment was a start-up trial.
  const reference = (
    seedId: string,
    roleId: "active_uncertainties" | "experimentation",
    uncertaintySeedId?: string
  ) => ({
    seedId,
    generationId: "generation-1",
    roleId,
    active: true,
    ...(uncertaintySeedId ? { uncertaintySeedId } : {}),
  });
  const advancement = (uncertaintySeedId: string, experimentSeedIds: string[]) =>
    candidate([one], ["technical"], { uncertaintySeedId, experimentSeedIds });
  const check = (seed: SeedCandidate, references: ReturnType<typeof reference>[], roleId: "specific_advancements" | "experimentation" = "specific_advancements") =>
    validateSeed({ roleId, seed, referenceContext: { generationId: "generation-1", references } });

  it("refuses an advancement linked to an uncertainty its experiments did not test", () => {
    const run6 = [
      reference("u2-dosing", "active_uncertainties"),
      reference("u3-sensors", "active_uncertainties"),
      reference("trial-1", "experimentation", "u1-startup"),
      reference("trial-2", "experimentation", "u1-startup"),
    ];
    // The Seed model's run 6 answer: start-up findings linked to the sensor uncertainty.
    const relinked = check(advancement("u3-sensors", ["trial-1", "trial-2"]), run6);
    expect(relinked.ok).toBe(false);
    expect(relinked.issues.map((issue) => issue.code)).toContain("INVALID_ADVANCEMENT_REFERENCE");
    // No picked uncertainty was tested by a picked experiment, so an
    // unlinked Seed is kept (it cannot be approved) instead of failing the Batch.
    expect(check(candidate([one]), run6).ok).toBe(true);
  });

  it("accepts an advancement whose experiments all tested its uncertainty, and refuses a mixed one", () => {
    const references = [
      reference("u2-dosing", "active_uncertainties"),
      reference("u3-sensors", "active_uncertainties"),
      reference("trial-3", "experimentation", "u2-dosing"),
      reference("trial-4", "experimentation", "u2-dosing"),
      reference("trial-5", "experimentation", "u3-sensors"),
    ];
    expect(check(advancement("u2-dosing", ["trial-3", "trial-4"]), references).ok).toBe(true);
    expect(check(advancement("u3-sensors", ["trial-5"]), references).ok).toBe(true);
    expect(check(advancement("u2-dosing", ["trial-3", "trial-5"]), references).ok).toBe(false);
    // Links are required while a pair exists.
    expect(check(candidate([one]), references).ok).toBe(false);
  });

  it("keeps the old rule for experiments that record no uncertainty", () => {
    const references = [
      reference("u2-dosing", "active_uncertainties"),
      reference("u3-sensors", "active_uncertainties"),
      reference("legacy-trial", "experimentation"),
    ];
    expect(check(advancement("u2-dosing", ["legacy-trial"]), references).ok).toBe(true);
    expect(check(advancement("u3-sensors", ["legacy-trial"]), references).ok).toBe(true);
  });

  it("makes an experiment name the picked uncertainty it tested, and nothing else", () => {
    const references = [
      reference("u1-startup", "active_uncertainties"),
      reference("u2-dosing", "active_uncertainties"),
    ];
    const named = check(
      candidate([one], ["technical"], { uncertaintySeedId: "u1-startup", experimentSeedIds: ["trial-9"] }),
      references,
      "experimentation"
    );
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect(named.seed.uncertaintySeedId).toBe("u1-startup");
    // An experiment never links other experiments.
    expect(named.seed).not.toHaveProperty("experimentSeedIds");
    for (const seed of [
      candidate([one]),
      candidate([one], ["technical"], { uncertaintySeedId: "u3-sensors" }),
    ]) {
      const refused = check(seed, references, "experimentation");
      expect(refused.ok).toBe(false);
      expect(refused.issues.map((issue) => issue.code)).toContain("INVALID_EXPERIMENT_REFERENCE");
    }
    // With no uncertainty picked yet, an experiment carries no link.
    expect(check(candidate([one]), [], "experimentation").ok).toBe(true);
    expect(
      check(candidate([one], ["technical"], { uncertaintySeedId: "u1-startup" }), [], "experimentation").ok
    ).toBe(false);
  });
});

/** Offsets of `excerpt` in `content`, as a validated citation carries them. */
function cite(content: string, excerpt: string, from = 0) {
  const startOffset = content.indexOf(excerpt, from);
  if (startOffset < 0) throw new Error(`excerpt not found: ${excerpt}`);
  return { startOffset, endOffset: startOffset + excerpt.length };
}

describe("citation speaker and line", () => {
  // The shape this repo's demo data and test kit use: "Label: speech" turns
  // separated by blank lines, with the name in parentheses on role labels.
  const interview = [
    "Interviewer (Dana): Thanks for the time, Marcus. What did you build?",
    "",
    "Subject (Marcus Lindqvist, CTO): We build controllers for microgrids.",
    "",
    "Dana: What made that hard?",
    "",
    "Marcus: The standard stuff assumes a central operator.",
    "The big unknown was whether we could forecast net load.",
    "",
    "We genuinely did not know if a forecast was possible.",
  ].join("\n");

  it("names the speaker of the line and counts lines from 1", () => {
    expect(
      locateCitations(interview, [
        cite(interview, "Thanks for the time"),
        cite(interview, "We build controllers"),
        cite(interview, "What made that hard?"),
      ])
    ).toEqual([
      { line: 1, speaker: "Dana" },
      { line: 3, speaker: "Marcus Lindqvist" },
      { line: 5, speaker: "Dana" },
    ]);
  });

  it("carries a turn's speaker to its later lines and paragraphs (excerpt mid-turn)", () => {
    expect(
      locateCitations(interview, [
        cite(interview, "forecast net load"),
        cite(interview, "We genuinely did not know"),
      ])
    ).toEqual([
      { line: 8, speaker: "Marcus" },
      { line: 10, speaker: "Marcus" },
    ]);
  });

  it("handles an excerpt at offset 0 that includes the label", () => {
    const content = "Priya: We run four sites, all refrigerated.\nTom: Noted.";
    expect(locateCitations(content, [{ startOffset: 0, endOffset: 25 }])).toEqual([
      { line: 1, speaker: "Priya" },
    ]);
  });

  it("counts CRLF lines the same and keeps the carriage return out of the speaker", () => {
    const content = "Priya Shah: Hello.\r\n\r\nTom: We tested the loop.\r\nIt held.";
    expect(
      locateCitations(content, [cite(content, "We tested"), cite(content, "It held.")])
    ).toEqual([
      { line: 3, speaker: "Tom" },
      { line: 4, speaker: "Tom" },
    ]);
  });

  it("starts at the excerpt's first non-blank character", () => {
    const content = "Priya: First.\n\nTom: Second line.";
    const start = content.indexOf("\n");
    expect(
      locateCitations(content, [{ startOffset: start, endOffset: content.length }])
    ).toEqual([{ line: 3, speaker: "Tom" }]);
  });

  it("reads WebVTT voice spans and ignores cue timings", () => {
    const content = [
      "WEBVTT",
      "",
      "1",
      "00:00:01.000 --> 00:00:04.000",
      "<v Priya Shah>We run four sites.</v>",
      "",
      "2",
      "00:00:04.000 --> 00:00:09.000",
      "<v.loud Tom>The loop oscillated.</v>",
      "",
      "3",
      "00:00:09.000 --> 00:00:12.000",
      "It still does at night.",
    ].join("\n");
    expect(
      locateCitations(content, [
        cite(content, "We run four sites."),
        cite(content, "The loop oscillated."),
        cite(content, "It still does"),
      ])
    ).toEqual([
      { line: 5, speaker: "Priya Shah" },
      { line: 9, speaker: "Tom" },
      { line: 13, speaker: "Tom" },
    ]);
  });

  it("reads name-and-timestamp headers and timestamped labels", () => {
    const content = [
      "Priya Shah  0:03",
      "We run four sites.",
      "",
      "Speaker 2  01:15",
      "Which ones?",
      "[00:02:10] Tom: The coastal ones.",
      "00:02:30 - Priya: And one inland.",
    ].join("\n");
    expect(
      locateCitations(content, [
        cite(content, "We run four sites."),
        cite(content, "Which ones?"),
        cite(content, "The coastal ones."),
        cite(content, "And one inland."),
      ])
    ).toEqual([
      { line: 2, speaker: "Priya Shah" },
      { line: 5, speaker: "Speaker 2" },
      { line: 6, speaker: "Tom" },
      { line: 7, speaker: "Priya" },
    ]);
  });

  it("gives only the line when the text names no speakers", () => {
    const content = [
      "Date: 12 March",
      "Notes from the site visit.",
      "Three things: the loop, the pump and the sensor.",
      "The pump failed twice (see https://example.com: log).",
    ].join("\n");
    expect(
      locateCitations(content, [
        cite(content, "Notes from"),
        cite(content, "the pump and"),
        cite(content, "failed twice"),
      ])
    ).toEqual([{ line: 2 }, { line: 3 }, { line: 4 }]);
  });

  it("returns results in the order given, however the citations are sorted", () => {
    const content = "Priya: One.\nTom: Two.\nPriya: Three.";
    expect(
      locateCitations(content, [
        cite(content, "Three."),
        cite(content, "One."),
        cite(content, "Two."),
        cite(content, "One."),
      ])
    ).toEqual([
      { line: 3, speaker: "Priya" },
      { line: 1, speaker: "Priya" },
      { line: 2, speaker: "Tom" },
      { line: 1, speaker: "Priya" },
    ]);
  });

  it("recognises only name-like labels", () => {
    expect(speakerOfTranscriptLine("Dr. Priya Shah: Yes.")).toBe("Dr. Priya Shah");
    expect(speakerOfTranscriptLine("Ludwig van Beethoven: Yes.")).toBe("Ludwig van Beethoven");
    expect(speakerOfTranscriptLine("Interviewer (Larry): Thanks.")).toBe("Larry");
    expect(speakerOfTranscriptLine("Subject (CTO): Sure.")).toBe("CTO");
    expect(speakerOfTranscriptLine("Priya Shah (00:01:02): Yes.")).toBe("Priya Shah");
    expect(speakerOfTranscriptLine("Q: Why?")).toBeUndefined();
    expect(speakerOfTranscriptLine("Attendees: Priya, Tom")).toBeUndefined();
    expect(speakerOfTranscriptLine("the result was: stable")).toBeUndefined();
    expect(speakerOfTranscriptLine("One two three four five six: too long")).toBeUndefined();
    expect(speakerOfTranscriptLine("10:30 the meeting began")).toBeUndefined();
    expect(speakerOfTranscriptLine("")).toBeUndefined();
  });
});

describe("a Seed excerpt at drifted offsets (placeholders, review 2026-09-25)", () => {
  const content = [
    "Dana: So it failed at 4.2 bar?",
    "Priya: Yes, it failed at 4.2 bar on the second rig.",
  ].join("\n");
  const excerpt = "it failed at 4.2 bar";
  const clientAt = content.lastIndexOf(excerpt);

  it("moves to the occurrence nearest the model's own offset, not the first one", () => {
    expect(nearestOccurrence(content, excerpt, clientAt - 3)).toBe(clientAt);
    expect(nearestOccurrence(content, excerpt, 0)).toBe(content.indexOf(excerpt));
    expect(nearestOccurrence(content, "not here", 5)).toBe(-1);
    const result = validateSeed({
      roleId: "experimentation",
      seed: candidate([one], ["technical"], {
        provenance: [{ sourceId: "s1", startOffset: clientAt - 4, endOffset: clientAt - 4 + excerpt.length, exactExcerpt: excerpt }],
      }),
      frozenSources: [{ sourceId: "s1", content, contentHash: "h1" }],
    });
    expect(result.ok && result.seed.provenance[0].startOffset).toBe(clientAt);
    expect(result.ok && result.seed.support).toBe("source_supported");
  });
});

describe("idea card quotes support their card (2026-09-27, third amendment)", () => {
  // Fictional frozen interview, one line per claim.
  const lines = [
    "Northwind is a test and instrumentation company that installs sensor packages on towers.",
    "Customers ban drilling because a hole in a coated mast starts corrosion or cracks.",
    "Adhesive data sheets assume a cure at room temperature, usually twenty-three degrees.",
    "Our installs happen outdoors between minus five and plus ten degrees.",
  ];
  const content = lines.join("\n");
  const sources = [{ sourceId: "interview", content, contentHash: "sha256:interview" }];
  function cite(line: number) {
    const startOffset = content.indexOf(lines[line]);
    return {
      sourceId: "interview",
      startOffset,
      endOffset: startOffset + lines[line].length,
      exactExcerpt: lines[line],
    };
  }
  const bullets = [
    "Northwind is a test and instrumentation company installing sensor packages on towers.",
    "Customers ban drilling because a hole in a coated mast starts corrosion.",
    "Data sheets assume a cure at room temperature, usually twenty-three degrees.",
    "Installs happen outdoors between minus five and plus ten degrees.",
  ];
  const tags: SeedCandidate["tags"][] = [["high_level"], ["technical"], ["detailed"], ["conservative"]];

  function checked(mode: "batch" | "feedback", seeds: SeedCandidate[]) {
    const result = validateBatch({ roleId: "company_context", mode, seeds, frozenSources: sources });
    return { result, quotes: withQuoteChecks(result.seeds, mode) };
  }

  it("keeps a good Batch unmarked", () => {
    const { result, quotes } = checked(
      "batch",
      bullets.slice(0, 3).map((bullet, index) => candidate([bullet], tags[index], { provenance: [cite(index)] }))
    );
    expect(result.ok).toBe(true);
    expect(quotes.issues).toEqual([]);
    expect(quotes.seeds).toEqual(result.seeds);
  });

  it("marks an unrelated line and a reused excerpt, drops nothing, and stays source-supported", () => {
    const { result, quotes } = checked("batch", [
      candidate([bullets[0]], tags[0], { provenance: [cite(0)] }),
      // Cites the company line for a claim about drilling.
      candidate([bullets[1]], tags[1], { provenance: [cite(0)] }),
      candidate([bullets[2]], tags[2], { provenance: [cite(2)] }),
      // Reuses the data sheet line for a claim it does not quote.
      candidate(["Room-temperature cure assumptions in data sheets do not fit outdoor installs.", "Winter sites run colder than the tested range."], tags[3], {
        provenance: [cite(2)],
      }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.dropped).toBe(0);
    // validateBatch itself never judges quotes: the speaker check runs first.
    expect(result.issues).toEqual([]);
    expect(result.seeds.flatMap((seed) => seed.provenance).some((citation) => citation.needsQuoteCheck)).toBe(false);
    expect(quotes.issues).toEqual([
      { code: "CITATION_UNRELATED", seedIndex: 1, citationIndex: 0 },
      { code: "CITATION_REUSED", seedIndex: 3, citationIndex: 0 },
    ]);
    expect(quotes.seeds).toHaveLength(4);
    expect(quotes.seeds.map((seed) => seed.provenance.map((citation) => citation.needsQuoteCheck ?? false))).toEqual([
      [false],
      [true],
      [false],
      [true],
    ]);
    expect(quotes.seeds.map((seed) => seed.support)).toEqual([
      "source_supported",
      "source_supported",
      "source_supported",
      "source_supported",
    ]);
  });

  it("maps each kept Seed back to its place in the model's answer, after a dropped Seed", () => {
    const { result, quotes } = checked("batch", [
      candidate(["One sentence. Then another one."], tags[0]),
      candidate([bullets[0]], tags[0], { provenance: [cite(0)] }),
      candidate([bullets[1]], tags[1], { provenance: [cite(3)] }),
      candidate([bullets[2]], tags[2], { provenance: [cite(2)] }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.seedIndexes).toEqual([1, 2, 3]);
    expect(quotes.issues).toEqual([{ code: "CITATION_UNRELATED", seedIndex: 1, citationIndex: 0 }]);
    expect(result.seedIndexes[quotes.issues[0].seedIndex]).toBe(2);
  });

  it("underlines a phrase reused from a transcript line with a dash, once the dash becomes a comma (review P3-7)", () => {
    const dashed = "The bond \u2014 once cured \u2014 held at minus five degrees for a week.";
    const dashedSources = [{ sourceId: "dashed", content: dashed, contentHash: "sha256:dashed" }];
    const quote = { sourceId: "dashed", startOffset: 0, endOffset: dashed.length, exactExcerpt: dashed };
    const clean = "The bond, once cured, held at minus five degrees in winter trials.";
    const copied = "The bond \u2014 once cured \u2014 held at minus five degrees.";
    const result = validateBatch({
      roleId: "company_context",
      mode: "feedback",
      seeds: [
        candidate([clean], ["technical"], { provenance: [quote] }),
        candidate([copied], ["detailed"], { provenance: [quote] }),
      ],
      frozenSources: dashedSources,
    });
    // The copied dash is still refused; the recast phrase passes and underlines.
    expect(result.seeds.map((seed) => seed.bullets[0])).toEqual([clean]);
    expect(result.issues.map((issue) => issue.code)).toContain("BULLET_TYPOGRAPHIC_DASH");
    expect(withQuoteChecks(result.seeds, "feedback").issues).toEqual([]);
    expect(findExactQuoteSpans(clean, [dashed]).length).toBe(1);
  });

  it("lets the Revised Seeds of one Feedback request share their line", () => {
    const { result, quotes } = checked("feedback", [
      candidate([bullets[1]], ["technical"], { provenance: [cite(1)] }),
      candidate(["A hole in a coated mast starts corrosion, so customers ban drilling."], ["conservative"], {
        provenance: [cite(1)],
      }),
    ]);
    expect(result.ok).toBe(true);
    expect(quotes.issues).toEqual([]);
  });
});
