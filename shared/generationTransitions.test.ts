import { describe, expect, it } from "vitest";
import {
  ACTIVE_GENERATION_STATUSES,
  GENERATION_FLOWS,
  GENERATION_STATUSES,
  GENERATION_STATUS_TRANSITIONS,
  generationFlowOf,
  isGenerationStatusTransitionAllowed,
  isPostQaTransitionAllowed,
  isRedraftTransitionAllowed,
  isTerminalGenerationStatus,
  POST_QA_STATES,
  REDRAFT_STATES,
  TERMINAL_GENERATION_STATUSES,
  type GenerationFlow,
  type GenerationStatus,
  type PostQaState,
  type RedraftState,
} from "./generationTransitions";

/**
 * The approved status table (docs/product-domain.md, 2026-09-25), written out
 * by hand so a change to the shared table fails here until the amendment and
 * this list agree. `flow: from -> to`.
 */
const EXPECTED_STATUS_MOVES: Record<GenerationFlow, Array<[GenerationStatus, GenerationStatus]>> = {
  compare: [
    ["reserved", "running"],
    ["reserved", "failed"],
    ["running", "running"],
    ["running", "awaiting_selection"],
    ["running", "failed"],
    ["awaiting_selection", "completed"],
    ["awaiting_selection", "superseded"],
    ["awaiting_selection", "failed"],
    ["awaiting_input", "failed"],
  ],
  single: [
    ["reserved", "running"],
    ["reserved", "failed"],
    ["running", "running"],
    ["running", "completed"],
    ["running", "failed"],
    ["awaiting_selection", "completed"],
    ["awaiting_selection", "failed"],
    ["awaiting_input", "failed"],
  ],
  sections: [
    ["reserved", "running"],
    ["reserved", "failed"],
    ["running", "running"],
    ["running", "awaiting_input"],
    ["running", "failed"],
    ["awaiting_input", "running"],
    ["awaiting_input", "completed"],
    ["awaiting_input", "failed"],
    ["awaiting_selection", "failed"],
  ],
  seed_stage: [
    ["reserved", "running"],
    ["reserved", "failed"],
    ["running", "running"],
    ["running", "awaiting_input"],
    ["running", "failed"],
    ["awaiting_input", "awaiting_input"],
    ["awaiting_input", "running"],
    ["awaiting_input", "failed"],
    ["awaiting_selection", "failed"],
  ],
  seed_drafting: [
    ["reserved", "running"],
    ["reserved", "failed"],
    ["running", "running"],
    ["running", "completed"],
    ["running", "failed"],
    ["awaiting_input", "failed"],
    ["awaiting_selection", "failed"],
  ],
};

const EXPECTED_POST_QA_MOVES: Array<[PostQaState, PostQaState]> = [
  ["none", "running"],
  ["done", "running"],
  ["failed", "running"],
  ["running", "done"],
  ["running", "failed"],
  // Legacy settle without an attempt id.
  ["none", "done"],
  ["none", "failed"],
  ["done", "done"],
  ["done", "failed"],
  ["failed", "done"],
  ["failed", "failed"],
];

const EXPECTED_REDRAFT_MOVES: Array<[RedraftState, RedraftState]> = [
  ["none", "running"],
  ["completed", "running"],
  ["failed", "running"],
  ["running", "running"],
  ["running", "completed"],
  ["running", "failed"],
];

function key(from: string, to: string) {
  return `${from}->${to}`;
}

describe("generation status table", () => {
  for (const flow of GENERATION_FLOWS) {
    const allowed = new Set(EXPECTED_STATUS_MOVES[flow].map(([from, to]) => key(from, to)));
    for (const from of GENERATION_STATUSES) {
      for (const to of GENERATION_STATUSES) {
        const expected = allowed.has(key(from, to));
        it(`${flow}: ${from} -> ${to} is ${expected ? "allowed" : "refused"}`, () => {
          expect(isGenerationStatusTransitionAllowed(flow, from, to)).toBe(expected);
        });
      }
    }
  }

  it("never leaves a terminal status", () => {
    for (const flow of GENERATION_FLOWS) {
      for (const from of TERMINAL_GENERATION_STATUSES) {
        for (const to of GENERATION_STATUSES) {
          expect(isGenerationStatusTransitionAllowed(flow, from, to)).toBe(false);
        }
      }
    }
  });

  it("never re-enters reserved", () => {
    for (const flow of GENERATION_FLOWS) {
      for (const from of GENERATION_STATUSES) {
        expect(isGenerationStatusTransitionAllowed(flow, from, "reserved")).toBe(false);
      }
    }
  });

  it("lets every active status of every flow fail, so project deletion is never refused", () => {
    for (const flow of GENERATION_FLOWS) {
      for (const from of ACTIVE_GENERATION_STATUSES) {
        expect(isGenerationStatusTransitionAllowed(flow, from, "failed")).toBe(true);
      }
    }
  });

  it("names at least one call site for every edge and no duplicate edges", () => {
    const seen = new Set<string>();
    for (const edge of GENERATION_STATUS_TRANSITIONS) {
      expect(edge.sites.length).toBeGreaterThan(0);
      expect(edge.flows.length).toBeGreaterThan(0);
      const edgeKey = key(edge.from, edge.to);
      expect(seen.has(edgeKey), edgeKey).toBe(false);
      seen.add(edgeKey);
    }
  });

  it("partitions statuses into active and terminal", () => {
    expect([...ACTIVE_GENERATION_STATUSES, ...TERMINAL_GENERATION_STATUSES].sort()).toEqual(
      [...GENERATION_STATUSES].sort()
    );
    for (const status of GENERATION_STATUSES) {
      expect(isTerminalGenerationStatus(status)).toBe(
        (TERMINAL_GENERATION_STATUSES as readonly string[]).includes(status)
      );
    }
  });
});

describe("generation flow", () => {
  it("reads legacy rows without candidateMode as compare", () => {
    expect(generationFlowOf({})).toBe("compare");
    expect(generationFlowOf({ candidateMode: "compare" })).toBe("compare");
    expect(generationFlowOf({ candidateMode: "single" })).toBe("single");
  });

  it("reads iterative rows without a workflow as section approval", () => {
    expect(generationFlowOf({ candidateMode: "iterative" })).toBe("sections");
    expect(generationFlowOf({ candidateMode: "iterative", gatedWorkflow: "sections" })).toBe(
      "sections"
    );
  });

  it("splits the seed workflow at Summary sign-off", () => {
    expect(generationFlowOf({ candidateMode: "iterative", gatedWorkflow: "seeds" })).toBe(
      "seed_stage"
    );
    expect(
      generationFlowOf({
        candidateMode: "iterative",
        gatedWorkflow: "seeds",
        summaryVersionId: "summary",
      })
    ).toBe("seed_drafting");
  });
});

describe("post-QA sub-state table", () => {
  const allowed = new Set(EXPECTED_POST_QA_MOVES.map(([from, to]) => key(from, to)));
  for (const from of POST_QA_STATES) {
    for (const to of POST_QA_STATES) {
      const expected = allowed.has(key(from, to));
      it(`${from} -> ${to} is ${expected ? "allowed" : "refused"}`, () => {
        expect(isPostQaTransitionAllowed(from, to)).toBe(expected);
      });
    }
  }
});

describe("redraft sub-state table", () => {
  const allowed = new Set(EXPECTED_REDRAFT_MOVES.map(([from, to]) => key(from, to)));
  for (const from of REDRAFT_STATES) {
    for (const to of REDRAFT_STATES) {
      const expected = allowed.has(key(from, to));
      it(`${from} -> ${to} is ${expected ? "allowed" : "refused"}`, () => {
        expect(isRedraftTransitionAllowed(from, to)).toBe(expected);
      });
    }
  }
});
