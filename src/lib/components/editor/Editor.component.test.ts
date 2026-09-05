import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import Editor from "./Editor.svelte";
import type { FindReplaceMatch } from "./types";

/**
 * PERF-1 pin for the writer editor's search surface. These assertions describe
 * the behaviour the batched search index must preserve, so the suite passes
 * both before and after `docSearch.ts` exists — the counts that prove the
 * optimisation live in `docSearch.test.ts` and `scripts/bench/editor-search.mjs`,
 * where the fixture document instance can be spied on.
 *
 * `projectRoute.component.test.ts` deliberately holds the report pages in
 * loading states and never mounts this component, so this is the first suite
 * that drives the real editor.
 */

const PARAGRAPHS = [
  "The system evaluated thermal stability against the measured reference baseline.",
  "The System evaluated thermal stability under a sustained mechanical load.",
  "Experiment 1: thermal cycling of the coupon assembly.",
  "Experiment 2: fatigue loading of the bracket assembly.",
  "Experiment 3: corrosion exposure of the aluminium panel.",
  "Experiment 4: vibration sweep of the housing enclosure.",
  "Experiment 5: creep testing of the titanium fastener.",
  "Experiment 6: impact testing of the composite shell.",
  "Experiment 7: acoustic damping of the isolation mount.",
  "Experiment 8: thermal shock cycling of the elastomer seal.",
  "Experiment 9: pressure decay measurement of the pressure vessel.",
  "The team resolved the uncertainty by iterating on the damping geometry until the measured response converged.",
] as const;

const HEADINGS = [
  { level: 1, text: "Line 242 - Technological uncertainties", after: 0 },
  { level: 2, text: "Line 244 - Work performed", after: 4 },
  { level: 3, text: "Line 246 - Technological advancement", after: 8 },
] as const;

function seedContent(): string {
  const content: unknown[] = [];
  PARAGRAPHS.forEach((text, i) => {
    for (const h of HEADINGS) {
      if (h.after === i) {
        content.push({ type: "heading", attrs: { level: h.level }, content: [{ type: "text", text: h.text }] });
      }
    }
    content.push({ type: "paragraph", content: [{ type: "text", text }] });
  });
  return JSON.stringify({ type: "doc", content });
}

/**
 * 20 preview pairs. Nine `Experiment N:` labels and eight noun phrases occur
 * once each; `thermal stability` occurs twice in the document and is listed
 * twice in the batch (the duplicate-pair case, decorations pushed twice);
 * `measured reference baseline` carries an empty replacement.
 *
 * The duplicate pair pushes four strike decorations but ProseMirror collapses
 * the two identical inline decorations over each range into a single span, so
 * the strikes read as one element per occurrence while the widgets — which are
 * never merged — show the duplicate four times. Both are baseline behaviour.
 *   removed elements = 9 + 2 + 1 + 8 = 20
 *   added widgets    = 9 + 4 + 0 + 8 = 21   (no widget for the empty replacement)
 */
const PREVIEW_PAIRS = [
  ...Array.from({ length: 9 }, (_, i) => ({ find: `Experiment ${i + 1}:`, replaceWith: `Trial ${i + 1}:` })),
  { find: "thermal stability", replaceWith: "thermal behaviour" },
  { find: "thermal stability", replaceWith: "thermal behaviour" },
  { find: "measured reference baseline", replaceWith: "" },
  { find: "coupon assembly", replaceWith: "coupon stack" },
  { find: "bracket assembly", replaceWith: "bracket stack" },
  { find: "aluminium panel", replaceWith: "aluminium plate" },
  { find: "housing enclosure", replaceWith: "housing shroud" },
  { find: "titanium fastener", replaceWith: "titanium stud" },
  { find: "composite shell", replaceWith: "composite casing" },
  { find: "isolation mount", replaceWith: "isolation bracket" },
  { find: "elastomer seal", replaceWith: "elastomer gasket" },
];
const EXPECTED_REMOVED = 20;
const EXPECTED_ADDED = 21;

const removed = () => document.querySelectorAll(".proposal-removed").length;
const added = () => document.querySelectorAll(".proposal-added").length;

/** Top-level block text of a serialized Tiptap document, in document order. */
function blockTexts(json: string): string[] {
  const doc = JSON.parse(json) as { content?: { content?: { text?: string }[] }[] };
  return (doc.content ?? []).map((node) => (node.content ?? []).map((c) => c.text ?? "").join(""));
}

async function mountEditor() {
  const saved: string[] = [];
  const result = await render(Editor, {
    content: seedContent(),
    onUpdate: (json: string) => {
      saved.push(json);
    },
  });
  await expect.poll(() => result.container.querySelector(".tiptap-editor")).not.toBeNull();
  return { ...result, saved };
}

describe("Editor search surface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders merged strikes per occurrence and insertion widgets per replacement pair", async () => {
    const { component } = await mountEditor();

    component.previewProposal(PREVIEW_PAIRS);
    await expect.poll(removed).toBe(EXPECTED_REMOVED);
    expect(added()).toBe(EXPECTED_ADDED);

    // The struck spans are the actual document casing, including the pair whose
    // occurrences differ in case.
    const struck = [...document.querySelectorAll(".proposal-removed")].map((el) => el.textContent);
    expect(struck.filter((t) => t === "thermal stability")).toHaveLength(2);
    expect(struck).toContain("measured reference baseline");
    expect([...document.querySelectorAll(".proposal-added")].filter((el) => el.textContent === "thermal behaviour")).toHaveLength(4);

    component.clearProposalPreview();
    await expect.poll(removed).toBe(0);
    expect(added()).toBe(0);
  });

  it("returns find/replace matches sorted by position with smart-case replacements", async () => {
    const { component } = await mountEditor();

    const matches: FindReplaceMatch[] = component.findReplaceMatches([
      { find: "thermal cycling", replaceWith: "thermal ramping" },
      { find: "the system evaluated thermal stability", replaceWith: "the system assessed thermal stability" },
    ]);

    expect(matches.map((m) => m.from)).toEqual([...matches.map((m) => m.from)].sort((a, b) => a - b));
    expect(matches.map((m) => m.text)).toEqual([
      "The system evaluated thermal stability",
      "The System evaluated thermal stability",
      "thermal cycling",
    ]);
    // Capitalized match → capitalized replacement; lowercase match → untouched.
    expect(matches.map((m) => m.replaceWith)).toEqual([
      "The system assessed thermal stability",
      "The system assessed thermal stability",
      "thermal ramping",
    ]);
  });

  it("replaceRange edits the serialized document at exactly that range", async () => {
    const { component, saved } = await mountEditor();

    const before = blockTexts(seedContent());
    const [first] = component.findReplaceMatches([
      { find: "the system evaluated thermal stability", replaceWith: "the system assessed thermal stability" },
    ]);
    component.replaceRange(first.from, first.to, first.replaceWith);
    await component.flushPendingSave();

    expect(saved.length).toBeGreaterThan(0);
    const after = blockTexts(saved[saved.length - 1]);
    const changed = after.map((t, i) => (t === before[i] ? null : i)).filter((i) => i !== null);
    expect(changed).toEqual([1]);
    expect(after[1]).toBe(before[1].replace(first.text, first.replaceWith));
  });

  it("highlights the expected paragraph for exact, fragment and paraphrase references", async () => {
    const { component } = await mountEditor();

    const highlighted = () =>
      [...document.querySelectorAll(".ai-ref-highlight")].map(
        (el) => el.closest("p, h1, h2, h3")?.textContent ?? ""
      );

    for (const [needle, expected] of [
      // exact
      ["Experiment 5: creep testing of the titanium fastener.", PARAGRAPHS[6]],
      // leading fragment: the tail was edited after the model quoted it
      [
        "The team resolved the uncertainty by iterating on the damping geometry until the numbers settled.",
        PARAGRAPHS[11],
      ],
      // short quote with an edited tail: falls through to block overlap
      ["Experiment 9: pressure readings", PARAGRAPHS[10]],
      // paraphrase
      ["vibration sweep performed across the housing enclosure", PARAGRAPHS[5]],
    ] as const) {
      component.clearHighlight();
      await expect.poll(() => document.querySelectorAll(".ai-ref-highlight").length).toBe(0);
      component.highlightText([needle]);
      await expect.poll(() => document.querySelectorAll(".ai-ref-highlight").length).toBeGreaterThan(0);
      expect(new Set(highlighted()), `needle: ${needle}`).toEqual(new Set([expected]));
    }
  });
});
