import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveGatedWorkflow, resolveSeedPhase } from "./gatedWorkflow";

describe("resolveGatedWorkflow", () => {
  it("resolves an absent discriminator on iterative generations to sections", () => {
    expect(resolveGatedWorkflow({ candidateMode: "iterative" })).toBe("sections");
  });

  it.each(["awaiting_input", "completed"] as const)(
    "preserves the legacy workflow for an old %s generation",
    (status) => {
      const generation = { candidateMode: "iterative", status } satisfies
        Pick<Doc<"generations">, "candidateMode" | "status">;
      expect(resolveGatedWorkflow(generation)).toBe("sections");
    }
  );

  it("recognizes a seeds reservation before subsection initialization", () => {
    const generation = {
      candidateMode: "iterative", status: "reserved", gatedWorkflow: "seeds",
    } satisfies Pick<Doc<"generations">, "candidateMode" | "status" | "gatedWorkflow">;
    expect(resolveGatedWorkflow(generation)).toBe("seeds");
  });

  it("honors an explicit section workflow", () => {
    expect(resolveGatedWorkflow({ candidateMode: "iterative", gatedWorkflow: "sections" }))
      .toBe("sections");
  });

  it.each(["single", "compare", undefined] as const)(
    "does not infer a gated workflow for mode %s",
    (candidateMode) => {
      expect(resolveGatedWorkflow({ candidateMode })).toBeUndefined();
    }
  );
});

type PhaseInput = Parameters<typeof resolveSeedPhase>[0];
type GenerationStatus = Doc<"generations">["status"];

const SUMMARY_VERSION_ID = "summary-version-1" as Id<"summaryVersions">;

/** A Seeds generation row projection; `signed` assigns a frozen Summary id. */
function seeds(status: GenerationStatus, signed = false): PhaseInput {
  return {
    candidateMode: "iterative",
    gatedWorkflow: "seeds",
    status,
    summaryVersionId: signed ? SUMMARY_VERSION_ID : undefined,
  };
}

describe("resolveSeedPhase", () => {
  it.each<{ name: string; generation: PhaseInput }>([
    {
      name: "legacy iterative row without a discriminator",
      generation: { candidateMode: "iterative", status: "awaiting_input" },
    },
    {
      name: "explicit sections row",
      generation: { candidateMode: "iterative", gatedWorkflow: "sections", status: "awaiting_input" },
    },
    {
      name: "signed explicit sections row",
      generation: {
        candidateMode: "iterative",
        gatedWorkflow: "sections",
        status: "failed",
        summaryVersionId: SUMMARY_VERSION_ID,
      },
    },
    { name: "single-model row", generation: { candidateMode: "single", status: "awaiting_input" } },
    { name: "compare row", generation: { candidateMode: "compare", status: "completed" } },
    { name: "row without a candidate mode", generation: { status: "failed" } },
  ])("is undefined for a $name whether or not seed rows exist", ({ generation }) => {
    expect(resolveSeedPhase(generation, true)).toBeUndefined();
    expect(resolveSeedPhase(generation, false)).toBeUndefined();
  });

  it.each([
    ["completed unsigned run with rows", seeds("completed"), true, "completed"],
    ["completed signed run without rows", seeds("completed", true), false, "completed"],
    ["signed run that failed while drafting", seeds("failed", true), true, "draftFailed"],
    ["signed run that failed with no rows", seeds("failed", true), false, "draftFailed"],
    ["signed reserved run (recovery reservation)", seeds("reserved", true), false, "drafting"],
    ["signed running run", seeds("running", true), true, "drafting"],
    ["signed run still marked awaiting_input", seeds("awaiting_input", true), true, "drafting"],
    // The signed branch precedes the terminal check, so a signed superseded
    // row still projects its Summary as drafting rather than closing it.
    ["signed superseded run", seeds("superseded", true), true, "drafting"],
    ["unsigned failed run with rows", seeds("failed"), true, "closed"],
    ["unsigned failed run without rows", seeds("failed"), false, "closed"],
    ["unsigned superseded run with rows", seeds("superseded"), true, "closed"],
    ["unsigned superseded run without rows", seeds("superseded"), false, "closed"],
    ["awaiting_input run with rows", seeds("awaiting_input"), true, "seeding"],
    ["awaiting_input run without rows", seeds("awaiting_input"), false, "initializing"],
    ["reserved run without rows", seeds("reserved"), false, "initializing"],
    ["reserved run with rows", seeds("reserved"), true, "initializing"],
    ["running run with rows", seeds("running"), true, "initializing"],
    ["running run without rows", seeds("running"), false, "initializing"],
    ["awaiting_selection run with rows", seeds("awaiting_selection"), true, "initializing"],
  ] as const)("projects a %s to %s", (_name, generation, hasSeedRows, expected) => {
    expect(resolveSeedPhase(generation, hasSeedRows)).toBe(expected);
  });

  it("closes a cancelled-shaped failed row even while its seed rows still exist", () => {
    // The exact shape cancelIterativeGeneration writes for an unsigned run.
    const cancelled = {
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      status: "failed",
      summaryVersionId: undefined,
      currentStep: "Cancelled",
      error: "Cancelled by writer",
    } satisfies Partial<Doc<"generations">>;
    expect(resolveSeedPhase(cancelled, true)).toBe("closed");
    expect(resolveSeedPhase(cancelled, false)).toBe("closed");
  });

  it("uses the stored seeds discriminator even when the candidate mode is absent", () => {
    const stored = { gatedWorkflow: "seeds", status: "awaiting_input" } satisfies
      Pick<Doc<"generations">, "gatedWorkflow" | "status">;
    expect(resolveSeedPhase(stored, true)).toBe("seeding");
    expect(resolveSeedPhase(stored, false)).toBe("initializing");
    expect(resolveSeedPhase({ ...stored, status: "failed" }, true)).toBe("closed");
  });
});
