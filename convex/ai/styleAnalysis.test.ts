import { describe, expect, it } from "vitest";
import {
  buildStyleAnalysisPrompt,
  styleAnalysisSchema,
} from "./styleAnalysis";
import { STYLE_OVERRIDE_KEYS } from "../../shared/styleOverrides";

describe("buildStyleAnalysisPrompt", () => {
  it("includes every category's key, label context, and the locked tier", () => {
    const { system, user } = buildStyleAnalysisPrompt("Use short sentences.");
    for (const key of STYLE_OVERRIDE_KEYS) {
      expect(user).toContain(`### ${key} —`);
    }
    expect(user).toContain("## Locked CRA tier (never overridable)");
    expect(user).toContain("Use short sentences.");
    expect(system).toContain("addressed=true");
    expect(system).toContain("Be conservative");
  });

  it("bounds oversized instruction documents", () => {
    const { user } = buildStyleAnalysisPrompt("x".repeat(100_000));
    expect(user.length).toBeLessThan(100_000);
  });
});

describe("styleAnalysisSchema", () => {
  it("accepts a complete result and rejects a partial one", () => {
    const complete = {
      categories: Object.fromEntries(
        STYLE_OVERRIDE_KEYS.map((key) => [
          key,
          { addressed: key === "bannedWords", evidence: key === "bannedWords" ? "never use utilize" : null },
        ])
      ),
      lockedConflicts: [{ excerpt: "skip the hypothesis", rule: "Hypothesis content" }],
    };
    expect(styleAnalysisSchema.safeParse(complete).success).toBe(true);
    const partial = {
      categories: { bannedWords: { addressed: true, evidence: null } },
      lockedConflicts: [],
    };
    expect(styleAnalysisSchema.safeParse(partial).success).toBe(false);
  });
});
