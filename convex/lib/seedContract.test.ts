import { describe, expect, it } from "vitest";
import {
  MAX_BULLET_WORDS,
  SEED_TAGS,
  isOneSeedSentence,
  seedToolSchema,
  validateBatch,
  validateSeed,
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

  it("builds the bounded role-aware forced tool schema", () => {
    const batch = seedToolSchema("goal_problem", "batch");
    const advancement = JSON.stringify(
      seedToolSchema("specific_advancements", "feedback")
    );
    expect(batch).toMatchObject({ type: "object", additionalProperties: false });
    expect(advancement).toContain("uncertaintySeedId");
    expect(advancement).toContain("experimentSeedIds");
  });

  it("keeps role-11 schema links optional until frozen selections require them", () => {
    const schema = seedToolSchema("specific_advancements", "batch");
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
    expect(
      validateSeed({
        roleId: "specific_advancements",
        seed: unlinked,
        referenceContext: {
          generationId: "generation-1",
          references: [
            {
              seedId: "experiment-1",
              generationId: "generation-1",
              roleId: "experimentation",
              active: true,
            },
          ],
        },
      }).ok
    ).toBe(false);
  });
});
