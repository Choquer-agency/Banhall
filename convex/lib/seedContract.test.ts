import { describe, expect, it } from "vitest";
import { findExactQuoteSpans } from "../../shared/exactQuote";
import { unbackedBullets } from "./seedQuoteSupport";
import {
  MAX_BATCH_SEEDS,
  MAX_BULLET_WORDS,
  MIN_FEEDBACK_SEEDS,
  SEED_TAGS,
  isLongForSeed,
  isOneSeedSentence,
  locateCitations,
  nearestOccurrence,
  seedAnswerCounts,
  linkedSeedSchemas,
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
    // 2026-09-29 (first, review P3-3): with no member of this generation to
    // link, no list was sent, so links the model sends anyway are dropped,
    // never stored, and the Seed is kept unlinked (it cannot be approved).
    for (const referenceContext of [
      { generationId: "generation-2", references },
      {
        generationId: "generation-1",
        references: references.map((reference) => ({ ...reference, active: false })),
      },
      {
        generationId: "generation-1",
        references: references.map((reference) =>
          reference.seedId === "experiment-1"
            ? { ...reference, roleId: "workplan" as const }
            : reference
        ),
      },
    ]) {
      const kept = validateSeed({ roleId: "specific_advancements", seed, referenceContext });
      expect(kept.ok).toBe(true);
      if (!kept.ok) continue;
      expect(kept.seed).not.toHaveProperty("uncertaintySeedId");
      expect(kept.seed).not.toHaveProperty("experimentSeedIds");
    }
    // While a link can be made, a link to a non-member is refused.
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed: candidate([one], ["technical"], { uncertaintySeedId: "uncertainty-1", experimentSeedIds: ["experiment-9"] }),
        referenceContext: { generationId: "generation-1", references },
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

  it("builds two fixed linked Seed schemas that require the links, with no ids in them (run 7 re-check)", () => {
    const base = seedToolSchema();
    const item = (schema: unknown) =>
      (schema as { properties: { seeds: { items: { required: string[]; properties: Record<string, unknown> } } } }).properties.seeds.items;
    const { experiment, advancement, result } = linkedSeedSchemas(base);
    expect(item(advancement).required).toEqual(["bullets", "tags", "provenance", "uncertaintySeedId", "experimentSeedIds"]);
    expect(item(advancement).properties.uncertaintySeedId).toEqual({ type: "string" });
    expect(item(advancement).properties.experimentSeedIds).toEqual({ type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } });
    expect(item(experiment).required).toEqual(["bullets", "tags", "provenance", "uncertaintySeedId"]);
    expect(item(experiment).properties.uncertaintySeedId).toEqual({ type: "string" });
    expect(item(experiment).properties).not.toHaveProperty("experimentSeedIds");
    // Fixed: the same bytes every time, and the shared schema never changes.
    expect(JSON.stringify(linkedSeedSchemas(seedToolSchema()))).toBe(JSON.stringify({ experiment, advancement, result }));
    expect(item(base).required).toEqual(["bullets", "tags", "provenance"]);
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
  const check = (
    seed: SeedCandidate,
    references: ReturnType<typeof reference>[],
    roleId: "specific_advancements" | "experimentation" | "overall_advancement" | "goal_improvements" | "project_status" | "hypothesis" | "workplan" = "specific_advancements"
  ) => validateSeed({ roleId, seed, referenceContext: { generationId: "generation-1", references } });

  it("refuses an advancement linked to an uncertainty its experiments did not test", () => {
    const run6 = [
      reference("u2-dosing", "active_uncertainties"),
      reference("u3-sensors", "active_uncertainties"),
      reference("trial-1", "experimentation", "u1-startup"),
      reference("trial-2", "experimentation", "u1-startup"),
    ];
    // No picked uncertainty was tested by a picked experiment, so no link
    // list was sent. The Seed model's run 6 answer (start-up findings linked
    // to the sensor uncertainty) is kept with its links dropped, never
    // stored as a link (review P3-3), and cannot be approved.
    const relinked = check(advancement("u3-sensors", ["trial-1", "trial-2"]), run6);
    expect(relinked.ok).toBe(true);
    if (relinked.ok) {
      expect(relinked.seed).not.toHaveProperty("uncertaintySeedId");
      expect(relinked.seed).not.toHaveProperty("experimentSeedIds");
    }
    expect(check(candidate([one]), run6).ok).toBe(true);
    // With a pair on offer, the same crossed link is refused.
    const withPair = [...run6, reference("trial-5", "experimentation", "u3-sensors")];
    const crossed = check(advancement("u3-sensors", ["trial-1"]), withPair);
    expect(crossed.ok).toBe(false);
    expect(crossed.issues.map((issue) => issue.code)).toContain("INVALID_ADVANCEMENT_REFERENCE");
  });

  it("names why each advancement's links failed (run 7)", () => {
    const references = [
      reference("u-images", "active_uncertainties"),
      reference("u-force", "active_uncertainties"),
      reference("vision", "experimentation", "u-images"),
      reference("camera", "experimentation", "u-images"),
    ];
    const reason = (seed: SeedCandidate) => {
      const result = check(seed, references);
      return result.ok ? null : result.issues.find((issue) => issue.code === "INVALID_ADVANCEMENT_REFERENCE")?.linkReason;
    };
    expect(reason(candidate([one]))).toBe("missing_link");
    expect(reason(advancement("u-images", ["vision", "vision"]))).toBe("duplicate_experiment");
    expect(reason(advancement("u-unpicked", ["vision"]))).toBe("unknown_uncertainty");
    expect(reason(advancement("u-images", ["test-3-unpicked"]))).toBe("unknown_experiment");
    // The force uncertainty no picked experiment tested.
    expect(reason(advancement("u-force", ["vision"]))).toBe("uncertainty_without_tested_experiment");
    const crossed = [...references, reference("u-dosing", "active_uncertainties"), reference("dosing-trial", "experimentation", "u-dosing")];
    expect(check(advancement("u-dosing", ["vision"]), crossed).ok).toBe(false);
    const crossedResult = check(advancement("u-dosing", ["vision"]), crossed);
    expect(crossedResult.ok ? null : crossedResult.issues[0]?.linkReason).toBe("experiment_tested_other");
  });

  it("keeps three valid Seeds for a narrow plan, which three advancements on one pair meet (run 7)", () => {
    const narrow = {
      generationId: "generation-1",
      references: [
        reference("u-images", "active_uncertainties"),
        reference("u-force", "active_uncertainties"),
        reference("vision", "experimentation", "u-images"),
        reference("camera", "experimentation", "u-images"),
      ],
    };
    const images = (text: string, tag: SeedCandidate["tags"][number], experiments: string[]) =>
      candidate([text], [tag], { uncertaintySeedId: "u-images", experimentSeedIds: experiments });
    const onePair = [
      images("Single-angle 2D vision cannot resolve burr height below 0.18 millimetres.", "conservative", ["vision"]),
      images("Glare on machined faces makes 2D burr height estimates read high.", "technical", ["vision"]),
      images("Structured light 3D gave no better depth resolution than 2D.", "detailed", ["camera"]),
    ];
    expect(validateBatch({ roleId: "specific_advancements", mode: "batch", referenceContext: narrow, seeds: onePair })).toMatchObject({ ok: true, minimum: 3 });
    // Two on the pair and one for the force uncertainty: two valid, refused.
    const short = validateBatch({
      roleId: "specific_advancements",
      mode: "batch",
      referenceContext: narrow,
      seeds: [
        ...onePair.slice(0, 2),
        candidate(["A compliant spindle held edge radius in window."], ["detailed"], { uncertaintySeedId: "u-force", experimentSeedIds: ["vision"] }),
      ],
    });
    expect(short).toMatchObject({ ok: false, minimum: 3 });
    expect(seedAnswerCounts(short, 3)).toEqual({
      seedsReturned: 3,
      seedsValid: 2,
      minimum: 3,
      issues: [
        { code: "INVALID_ADVANCEMENT_REFERENCE", reason: "uncertainty_without_tested_experiment", seeds: 1 },
        { code: "INVALID_BATCH_SIZE", seeds: 0 },
      ],
    });
  });

  it("counts an uncertainty and its Feedback revisions as one (review P2-2)", () => {
    // The writer revised the start-up uncertainty through Feedback and
    // picked the revision; the trials still name the original.
    const references = [
      reference("u1-revised", "active_uncertainties"),
      reference("trial-1", "experimentation", "u1-startup"),
    ];
    const referenceContext = {
      generationId: "generation-1",
      references,
      uncertaintyRoots: { "u1-revised": "u1-startup" },
    };
    const linkedToRevision = validateSeed({
      roleId: "specific_advancements",
      seed: advancement("u1-revised", ["trial-1"]),
      referenceContext,
    });
    expect(linkedToRevision.ok).toBe(true);
    if (linkedToRevision.ok) expect(linkedToRevision.seed.uncertaintySeedId).toBe("u1-revised");
    // Without the revision chain no link could be made, so it would be dropped.
    const idOnly = check(advancement("u1-revised", ["trial-1"]), references);
    expect(idOnly.ok && idOnly.seed.uncertaintySeedId).toBe(undefined);
    expect(
      validateSeed({ roleId: "specific_advancements", seed: candidate([one]), referenceContext }).ok
    ).toBe(false);
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
    // A mixed set is refused whole (run 7 re-check, lead decision 1): the
    // text may carry the other experiment's finding, so nothing is narrowed.
    const mixed = check(advancement("u2-dosing", ["trial-3", "trial-5"]), references);
    expect(mixed.ok).toBe(false);
    expect(mixed.issues).toEqual([expect.objectContaining({ code: "INVALID_ADVANCEMENT_REFERENCE", linkReason: "experiment_tested_other" })]);
    expect(check(advancement("u2-dosing", ["trial-5"]), references).ok).toBe(false);
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
    // With no uncertainty picked yet, an experiment carries no link: one the
    // model sends anyway is dropped (review P3-3), never stored.
    expect(check(candidate([one]), [], "experimentation").ok).toBe(true);
    const unrequested = check(candidate([one], ["technical"], { uncertaintySeedId: "u1-startup" }), [], "experimentation");
    expect(unrequested.ok).toBe(true);
    if (unrequested.ok) expect(unrequested.seed).not.toHaveProperty("uncertaintySeedId");
  });

  // 2026-09-30 (fourth): run 11's Marrowgate plan. The acclimation result
  // ("cut cold-water start-up roughly in half ... 31 days at 8 C") was
  // refused in Subsection 11 but survived in Subsections 10 and 13, which
  // recorded no uncertainty.
  describe("Advancement to science and goal improvements record the uncertainties they answer (2026-09-30, fourth)", () => {
    const acclimation = "Stepwise acclimation of seed media cut cold-water start-up roughly in half versus unacclimated seed.";
    const picked = [
      reference("u1-acclimation", "active_uncertainties"),
      reference("u2-nitrite", "active_uncertainties"),
      reference("e1-trial", "experimentation", "u2-nitrite"),
    ];
    const answers = (answeredUncertaintySeedIds?: string[], extra: Partial<SeedCandidate> = {}) =>
      candidate([acclimation], ["technical"], {
        ...(answeredUncertaintySeedIds ? { answeredUncertaintySeedIds } : {}),
        ...extra,
      });

    it("keeps each picked uncertainty a result names, and only those", () => {
      const both = check(answers(["u1-acclimation", "u2-nitrite"], { uncertaintySeedId: "u2-nitrite", experimentSeedIds: ["e1-trial"] }), picked, "overall_advancement");
      expect(both.ok).toBe(true);
      if (!both.ok) return;
      expect(both.seed.answeredUncertaintySeedIds).toEqual(["u1-acclimation", "u2-nitrite"]);
      // A result carries no advancement or experiment link.
      expect(both.seed).not.toHaveProperty("uncertaintySeedId");
      expect(both.seed).not.toHaveProperty("experimentSeedIds");
      // A repeated id is one answer.
      const repeated = check(answers(["u2-nitrite", "u2-nitrite"]), picked, "goal_improvements");
      expect(repeated.ok && repeated.seed.answeredUncertaintySeedIds).toEqual(["u2-nitrite"]);
    });

    it("refuses a result that names no picked uncertainty, one outside the picks, or none for Advancement to science", () => {
      for (const [seed, roleId, reason] of [
        [answers(), "overall_advancement", "missing_link"],
        [answers(), "goal_improvements", "missing_link"],
        // Review P3-1: an empty list has its own reason and hint.
        [answers([]), "overall_advancement", "empty_answers"],
        [answers(["u3-sensors"]), "overall_advancement", "unknown_uncertainty"],
        [answers(["u1-acclimation", "e1-trial"]), "goal_improvements", "unknown_uncertainty"],
      ] as const) {
        const refused = check(seed, picked, roleId);
        expect(refused.ok, `${roleId} ${JSON.stringify(seed.answeredUncertaintySeedIds)}`).toBe(false);
        expect(refused.issues).toEqual([
          expect.objectContaining({ code: "INVALID_RESULT_REFERENCE", linkReason: reason }),
        ]);
      }
    });

    it("lets a goal improvement that only restates the goal answer none", () => {
      const restated = check(answers([]), picked, "goal_improvements");
      expect(restated.ok).toBe(true);
      if (restated.ok) expect(restated.seed.answeredUncertaintySeedIds).toEqual([]);
    });

    it("drops result links where no uncertainty is picked, and on every other step", () => {
      const unrequested = check(answers(["u1-acclimation"]), [], "overall_advancement");
      expect(unrequested.ok).toBe(true);
      if (unrequested.ok) expect(unrequested.seed).not.toHaveProperty("answeredUncertaintySeedIds");
      expect(check(answers(), [], "overall_advancement").ok).toBe(true);
      for (const roleId of ["project_status", "experimentation", "specific_advancements"] as const) {
        const other = check(
          answers(["u1-acclimation"], roleId === "experimentation" ? { uncertaintySeedId: "u2-nitrite" } : roleId === "specific_advancements" ? { uncertaintySeedId: "u2-nitrite", experimentSeedIds: ["e1-trial"] } : {}),
          picked,
          roleId
        );
        expect(other.ok, roleId).toBe(true);
        if (other.ok) expect(other.seed).not.toHaveProperty("answeredUncertaintySeedIds");
      }
    });

    // 2026-09-30 (fifth): run 12's Hypothesis item 8 was the dosing hypothesis
    // of an uncertainty the writer dropped, with no link to show it.
    it("makes a hypothesis and a work plan name at least one picked uncertainty they test or plan work for (2026-09-30, fifth)", () => {
      const dosingHypothesis = "If alkalinity is dosed ahead of each feeding in proportion to feed mass, then TAN will stay under 1 mg per litre.";
      for (const roleId of ["hypothesis", "workplan"] as const) {
        const kept = check(candidate([dosingHypothesis], ["technical"], { answeredUncertaintySeedIds: ["u2-nitrite"], uncertaintySeedId: "u2-nitrite" }), picked, roleId);
        expect(kept.ok, roleId).toBe(true);
        if (kept.ok) {
          expect(kept.seed.answeredUncertaintySeedIds).toEqual(["u2-nitrite"]);
          expect(kept.seed).not.toHaveProperty("uncertaintySeedId");
        }
        for (const [seed, reason] of [
          [candidate([dosingHypothesis]), "missing_link"],
          [candidate([dosingHypothesis], ["technical"], { answeredUncertaintySeedIds: [] }), "empty_answers"],
          [candidate([dosingHypothesis], ["technical"], { answeredUncertaintySeedIds: ["u3-dosing"] }), "unknown_uncertainty"],
        ] as const) {
          const refused = check(seed, picked, roleId);
          expect(refused.ok, `${roleId} ${reason}`).toBe(false);
          expect(refused.issues).toEqual([expect.objectContaining({ code: "INVALID_RESULT_REFERENCE", linkReason: reason })]);
        }
        // No uncertainty picked: no list was sent, so an answer is dropped.
        const unrequested = check(candidate([dosingHypothesis], ["technical"], { answeredUncertaintySeedIds: ["u2-nitrite"] }), [], roleId);
        expect(unrequested.ok && unrequested.seed).not.toHaveProperty("answeredUncertaintySeedIds");
      }
    });

    it("counts a broken result link by reason (run 7 counts)", () => {
      const batch = validateBatch({
        roleId: "overall_advancement",
        mode: "batch",
        seeds: [answers(["u1-acclimation"]), answers(), answers(["u3-sensors"])],
        referenceContext: { generationId: "generation-1", references: picked },
      });
      expect(batch.ok).toBe(false);
      expect(seedAnswerCounts(batch, 3).issues).toEqual(
        expect.arrayContaining([
          { code: "INVALID_RESULT_REFERENCE", reason: "missing_link", seeds: 1 },
          { code: "INVALID_RESULT_REFERENCE", reason: "unknown_uncertainty", seeds: 1 },
        ])
      );
    });

    it("builds a fixed result schema that requires the list, allows it empty and holds no ids", () => {
      const { result } = linkedSeedSchemas(seedToolSchema());
      const item = (result as unknown as { properties: { seeds: { items: { required: string[]; properties: Record<string, unknown> } } } }).properties.seeds.items;
      expect(item.required).toEqual(["bullets", "tags", "provenance", "answeredUncertaintySeedIds"]);
      expect(item.properties.answeredUncertaintySeedIds).toEqual({ type: "array", uniqueItems: true, items: { type: "string" } });
      expect(item.properties).not.toHaveProperty("uncertaintySeedId");
      expect(item.properties).not.toHaveProperty("experimentSeedIds");
      // The shared schema is unchanged: no result field in it.
      expect(JSON.stringify(seedToolSchema())).not.toContain("answeredUncertaintySeedIds");
    });
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

describe("run 6's Seeds with a marked quote (2026-10-04, second, round 3 and its review)", () => {
  // Fictional lines of the release suite fixture's interview (run 6).
  const lines = [
    "Normal powder for steel cures at 160 to 200 C.",
    "The moisture that gives you conductivity is the same moisture that outgasses, so we didn't know if there was any setting that did both.",
    "And that on our board the pinholes track the peak board temperature, not the time.",
    "That the datasheet number is for flat panels.",
  ];
  const content = lines.join("\n");
  const frozenSources = [{ sourceId: "interview", content, contentHash: "sha256:interview" }];
  const cite = (line: number) => {
    const startOffset = content.indexOf(lines[line]);
    return { sourceId: "interview", startOffset, endOffset: startOffset + lines[line].length, exactExcerpt: lines[line] };
  };
  const validated = (bullets: string[], quotes: number[]) => {
    const result = validateSeed({
      roleId: "passive_limitations",
      seed: candidate(bullets, ["technical"], { provenance: quotes.map(cite) }),
      frozenSources,
    });
    if (!result.ok) throw new Error("fixture Seed is invalid");
    return result.seed;
  };
  // Technological limitations item 3 and Specific advancements item 11.
  const limitation = [
    "Standard datasheet powder processes are built for flat steel-like panels, not thick routed MDF.",
    "No prior process showed whether MDF could reach conductivity without heat that triggers outgassing defects.",
  ];
  const advancement = [
    "The team learned that outgassing defects track peak panel surface temperature rather than dwell time on this board.",
    "Trial 1's datasheet process confirmed that heat built for flat steel panels causes severe outgassing defects on routed MDF edges.",
  ];

  it("marks run 6's steel quote on both Seeds and keeps their support and wording, and leaves a well-quoted Seed as it was (review P2-3)", () => {
    const seeds = [validated(limitation, [1, 0]), validated(advancement, [2, 0]), validated(limitation, [3, 1])];
    expect(seeds.map((seed) => seed.support)).toEqual(["source_supported", "source_supported", "source_supported"]);
    const { seeds: checked, issues } = withQuoteChecks(seeds, "feedback");
    expect(issues).toEqual([
      { code: "CITATION_UNRELATED", seedIndex: 0, citationIndex: 1 },
      { code: "CITATION_UNRELATED", seedIndex: 1, citationIndex: 1 },
    ]);
    // Support is unchanged, so the plan and every request read them as before.
    expect(checked.map((seed) => [seed.support, seed.originalSupport])).toEqual([
      ["source_supported", "source_supported"],
      ["source_supported", "source_supported"],
      ["source_supported", "source_supported"],
    ]);
    expect(checked.map((seed) => seed.bullets)).toEqual([limitation, advancement, limitation]);
    expect(checked[2]).toEqual(seeds[2]);
    // The card and the facts check name each Seed's steel sentence.
    expect(checked.map((seed) => unbackedBullets(seed.bullets, seed.provenance))).toEqual([[limitation[0]], [advancement[1]], []]);
  });
});
