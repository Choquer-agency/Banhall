import { expect, test } from "vitest";
import { renderBriefBlock } from "./briefRender";

test("renderBriefBlock: empty brief renders nothing", () => {
  expect(renderBriefBlock("", [])).toBe("");
});

test("renderBriefBlock: storyline-only brief is delimited and contains the narrative", () => {
  const block = renderBriefBlock("The team pursued a repeatable control.", []);
  expect(block).toContain("--- BEGIN [GENERATION BRIEF] ---");
  expect(block).toContain("--- END [GENERATION BRIEF] ---");
  expect(block).toContain("The team pursued a repeatable control.");
});

test("renderBriefBlock: claim exclusions render with a human-readable reason", () => {
  const block = renderBriefBlock("", [
    { group: "claimExclusion", text: "Routine bug fix", reason: "routine_engineering" },
  ]);
  expect(block).toContain("Routine bug fix (routine engineering)");
});

test("renderBriefBlock: confidence map entries render with their confidence level", () => {
  const block = renderBriefBlock("", [
    { group: "confidenceMap", text: "Response time was unmeasured", confidence: "unresolved" },
  ]);
  expect(block).toContain("[unresolved] Response time was unmeasured");
});

test("renderBriefBlock: glossary terms render as a plain list", () => {
  const block = renderBriefBlock("", [
    { group: "glossaryTerm", text: "control loop" },
  ]);
  expect(block).toContain("- control loop");
});

test("renderBriefBlock: storylineQuestion entries are never injected into the section prompt", () => {
  const block = renderBriefBlock("Storyline text", [
    { group: "storylineQuestion", text: "Does evidence contradict the storyline?" },
  ]);
  expect(block).not.toContain("Does evidence contradict the storyline?");
});
