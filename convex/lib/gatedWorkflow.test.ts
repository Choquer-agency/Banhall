import { describe, expect, it } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { resolveGatedWorkflow } from "./gatedWorkflow";

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
