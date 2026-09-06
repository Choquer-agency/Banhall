import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { Editor as TiptapEditor } from "@tiptap/core";
import { tick } from "svelte";
import Editor from "./Editor.svelte";
import type { FindReplaceMatch } from "./types";

/** Rendered behavior pins plus actual caller traversal guards. Counting starts
 * after mount and includes previewProposal's one-off scroll lookup. */

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
  { find: "thermal stability", replaceWith: "thermal response" },
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

const removed = (container: HTMLElement) => container.querySelectorAll(".proposal-removed").length;
const added = (container: HTMLElement) => container.querySelectorAll(".proposal-added").length;

/** Top-level block text of a serialized Tiptap document, in document order. */
function blockTexts(json: string): string[] {
  const doc = JSON.parse(json) as { content?: { content?: { text?: string }[] }[] };
  return (doc.content ?? []).map((node) => (node.content ?? []).map((c) => c.text ?? "").join(""));
}

async function mountEditor(content = seedContent()) {
  const saved: string[] = [];
  const result = await render(Editor, {
    content,
    onUpdate: (json: string) => {
      saved.push(json);
    },
  });
  await expect.poll(() => result.container.querySelector(".tiptap-editor")).not.toBeNull();
  return { ...result, saved };
}

/** Observe real root-document walks without replacing search or editor behavior. */
function countDocumentWalks(container: HTMLElement) {
  const element = container.querySelector(".tiptap-editor");
  if (!element || !("editor" in element) || !(element.editor instanceof TiptapEditor)) {
    throw new Error("Mounted Tiptap editor instance is unavailable");
  }
  const doc = element.editor.state.doc;
  const spy = vi.spyOn(doc, "descendants");
  return { count: () => spy.mock.calls.length, restore: () => spy.mockRestore() };
}

describe("Editor search surface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders merged strikes per occurrence and insertion widgets per replacement pair", async () => {
    const { component, container } = await mountEditor();

    component.previewProposal(PREVIEW_PAIRS);
    await expect.poll(() => removed(container)).toBe(EXPECTED_REMOVED);
    expect(added(container)).toBe(EXPECTED_ADDED);

    // The struck spans preserve the original matched text for each occurrence.
    const struck = [...container.querySelectorAll(".proposal-removed")].map((el) => el.textContent);
    expect(struck.filter((t) => t === "thermal stability")).toHaveLength(2);
    expect(struck).toContain("measured reference baseline");
    expect([...container.querySelectorAll(".proposal-added")].filter((el) => el.textContent === "thermal behaviour")).toHaveLength(2);
    expect([...container.querySelectorAll(".proposal-added")].filter((el) => el.textContent === "thermal response")).toHaveLength(2);

    component.clearProposalPreview();
    await expect.poll(() => removed(container)).toBe(0);
    expect(added(container)).toBe(0);
  });

  it("returns find/replace matches sorted by position with smart-case replacements", async () => {
    const { component, container } = await mountEditor();

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
    expect(component.findReplaceMatches([])).toEqual([]);
    expect(component.findReplaceMatches([{ find: "  ", replaceWith: "unused" }])).toEqual([]);
    // Capitalized match → capitalized replacement; lowercase match → untouched.
    expect(matches.map((m) => m.replaceWith)).toEqual([
      "The system assessed thermal stability",
      "The system assessed thermal stability",
      "thermal ramping",
    ]);
  });

  it("batches actual preview construction into one walk plus the scroll lookup", async () => {
    const { component, saved, container } = await mountEditor();
    const prose = container.querySelector(".tiptap-editor")?.textContent;
    const counter = countDocumentWalks(container);
    try {
      component.previewProposal(PREVIEW_PAIRS);
      await expect.poll(() => removed(container)).toBe(EXPECTED_REMOVED);
      expect(added(container)).toBe(EXPECTED_ADDED);
      expect(counter.count()).toBe(2); // One batch and one initial scroll search.
    } finally {
      counter.restore();
    }
    expect(saved).toEqual([]);
    component.clearProposalPreview();
    await expect.poll(() => removed(container)).toBe(0);
    expect(added(container)).toBe(0);
    expect(container.querySelector(".tiptap-editor")?.textContent).toBe(prose);
    expect(saved).toEqual([]);
    await component.flushPendingSave();
    expect(saved).toEqual([seedContent()]);
  });

  it("batches actual findReplaceMatches and preserves duplicate replacement identities", async () => {
    const { component, saved, container } = await mountEditor();
    const prose = container.querySelector(".tiptap-editor")?.textContent;
    const counter = countDocumentWalks(container);
    try {
      const matches = component.findReplaceMatches([
        { find: "", replaceWith: "unused" },
        ...PREVIEW_PAIRS,
        { find: "   ", replaceWith: "unused" },
      ]);
      expect(counter.count()).toBe(1);
      expect(matches).toHaveLength(22);
      expect(matches.map((m) => m.from)).toEqual(matches.map((m) => m.from).sort((a, b) => a - b));
      expect(matches.filter((m) => m.text === "thermal stability").map((m) => m.replaceWith)).toEqual([
        "thermal behaviour", "thermal response", "thermal behaviour", "thermal response",
      ]);
      expect(component.findReplaceMatches([])).toEqual([]);
      expect(component.findReplaceMatches([{ find: "  ", replaceWith: "unused" }])).toEqual([]);
      expect(counter.count()).toBe(1);
    } finally {
      counter.restore();
    }
    await tick();
    expect(saved).toEqual([]);
    await component.flushPendingSave();
    expect(saved).toEqual([seedContent()]);
    expect(container.querySelector(".tiptap-editor")?.textContent).toBe(prose);
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
    const { component, container } = await mountEditor();

    const highlighted = () =>
      [...container.querySelectorAll(".ai-ref-highlight")].map(
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
      await expect.poll(() => container.querySelectorAll(".ai-ref-highlight").length).toBe(0);
      component.highlightText([needle]);
      await expect.poll(() => container.querySelectorAll(".ai-ref-highlight").length).toBeGreaterThan(0);
      expect(new Set(highlighted()), `needle: ${needle}`).toEqual(new Set([expected]));
    }
  });
});


describe("Editor actual JSON search boundaries", () => {
  it.each(["İ target tail", "İ target"])("previews the exact target after expansion in %s", async (text) => {
    const content = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const { component, saved, container } = await mountEditor(content);
    expect(component.findReplaceMatches([{ find: "target", replaceWith: "result" }])).toEqual([
      { from: 3, to: 9, text: "target", replaceWith: "result" },
    ]);
    component.previewProposal([{ find: "target", replaceWith: "result" }]);
    await expect.poll(() => [...container.querySelectorAll(".proposal-removed")].map((el) => el.textContent)).toEqual(["target"]);
    expect([...container.querySelectorAll(".proposal-added")].map((el) => el.textContent)).toEqual(["result"]);
    expect(saved).toEqual([]);
    await component.flushPendingSave();
    expect(saved).toEqual([content]);
  });

  it("passes cross-break matches into visible AI highlights and preview without changing prose", async () => {
    const content = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "alpha" }, { type: "hardBreak" }, { type: "text", text: "beta" },
    ] }] });
    const { component, saved, container } = await mountEditor(content);
    expect(component.findReplaceMatches([{ find: "alphabeta", replaceWith: "wrong" }])).toEqual([]);
    const matches = component.findReplaceMatches([{ find: "alpha\nbeta", replaceWith: "result" }]);
    expect(matches).toEqual([{ from: 1, to: 11, text: "alpha beta", replaceWith: "result" }]);
    const match = matches[0];
    component.highlightRange(match.from, match.to, match.text);
    await expect.poll(() => [...container.querySelectorAll(".ai-ref-highlight")].map((el) => el.textContent).join("")).toBe("alphabeta");
    expect(container.querySelector(".ai-ref-highlight br, br.ai-ref-highlight")).not.toBeNull();
    component.previewProposal([{ find: "alpha beta", replaceWith: "result" }]);
    await expect.poll(() => [...container.querySelectorAll(".proposal-removed")].map((el) => el.textContent).join("")).toBe("alphabeta");
    expect(container.querySelector(".proposal-removed br, br.proposal-removed")).not.toBeNull();
    expect([...container.querySelectorAll(".proposal-added")].map((el) => el.textContent)).toEqual(["result"]);
    component.clearProposalPreview();
    component.clearHighlight();
    await expect.poll(() => container.querySelectorAll(".proposal-removed, .proposal-added, .ai-ref-highlight").length).toBe(0);
    expect(saved).toEqual([]);
    await component.flushPendingSave();
    expect(saved).toEqual([content]);
  });
});


describe("Editor search boundary caller regressions", () => {
  it.each([
    { path: "exact", prefix: "" }, { path: "fragment", prefix: "" }, { path: "paragraph", prefix: "" },
    { path: "exact", prefix: "İ " }, { path: "fragment", prefix: "İ " }, { path: "paragraph", prefix: "İ " },
  ])("keeps $path references with prefix '$prefix' on the later hard-break paragraph", async ({ path, prefix }) => {
    const suffix = " measured thermal stability across repeated experimental loading cycles and observations";
    const first = prefix + "alphabeta" + suffix;
    const content = JSON.stringify({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: first }] },
      { type: "paragraph", content: [
        { type: "text", text: prefix + "alpha" }, { type: "hardBreak" },
        { type: "text", text: "beta" + suffix + " unique calibration" },
      ] },
    ] });
    const { component, container, saved } = await mountEditor(content);
    const needle = path === "exact" ? prefix + "alpha beta"
      : path === "fragment" ? prefix + "alpha beta" + suffix + " revised ending"
      : "unique calibration changed";
    component.highlightText([needle]);
    await expect.poll(() => container.querySelectorAll(".ai-ref-highlight").length).toBeGreaterThan(0);
    const paragraphs = container.querySelectorAll(".tiptap-editor p");
    expect(paragraphs[0].querySelector(".ai-ref-highlight")).toBeNull();
    expect(paragraphs[1].querySelector(".ai-ref-highlight")).not.toBeNull();
    expect(paragraphs[1].querySelector(".ai-ref-highlight br, br.ai-ref-highlight")).not.toBeNull();
    component.clearHighlight();
    await expect.poll(() => container.querySelectorAll(".ai-ref-highlight").length).toBe(0);
    expect(saved).toEqual([]);
    await component.flushPendingSave();
    expect(saved).toEqual([content]);
  });

  it("previews combined Unicode and hard-break spans and replaces only on explicit apply", async () => {
    const content = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", marks: [{ type: "bold" }], text: "İ " },
      { type: "text", text: "alpha" }, { type: "hardBreak" }, { type: "text", text: "beta" },
      { type: "text", marks: [{ type: "italic" }], text: " tail" },
    ] }] });
    const { component, container, saved } = await mountEditor(content);
    const pairs = [{ find: "alpha beta", replaceWith: "result" }];
    const matches = component.findReplaceMatches(pairs);
    expect(matches).toEqual([{ from: 3, to: 13, text: "alpha beta", replaceWith: "result" }]);
    const match = matches[0];
    component.highlightRange(match.from, match.to, match.text);
    component.previewProposal(pairs);
    await expect.poll(() => [...container.querySelectorAll(".proposal-removed")].map((el) => el.textContent).join("")).toBe("alphabeta");
    expect(container.querySelector(".proposal-removed br, br.proposal-removed")).not.toBeNull();
    expect([...container.querySelectorAll(".proposal-added")].map((el) => el.textContent)).toEqual(["result"]);
    expect(container.querySelector(".ai-ref-highlight")).not.toBeNull();
    expect(saved).toEqual([]);
    await component.flushPendingSave();
    expect(saved).toEqual([content]);
    // Apply while both preview and AI decorations are still active.
    component.replaceRange(match.from, match.to, match.replaceWith);
    await component.flushPendingSave();
    expect(JSON.parse(saved.at(-1) ?? "{}")).toEqual({ type: "doc", content: [
      { type: "paragraph", content: [
        { type: "text", marks: [{ type: "bold" }], text: "İ " },
        { type: "text", text: "result" },
        { type: "text", marks: [{ type: "italic" }], text: " tail" },
      ] },
    ] });
    await expect.poll(() => container.querySelectorAll(".proposal-removed, .proposal-added, .ai-ref-highlight").length).toBe(0);
    component.clearProposalPreview();
    component.clearHighlight();
    await expect.poll(() => container.querySelectorAll(".proposal-removed, .proposal-added, .ai-ref-highlight").length).toBe(0);
    expect(container.querySelector(".tiptap-editor p")?.textContent).toBe("İ result tail");
    expect(container.querySelector(".tiptap-editor br")).toBeNull();
  });
});


describe("Editor QA paragraph boundaries", () => {
  it("targets paragraph two across a hard break instead of the concatenated decoy", async () => {
    const content = JSON.stringify({ type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Line 242" }] },
      { type: "paragraph", content: [{ type: "text", text: "İ alphabeta" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [
        { type: "text", text: "İ alpha" }, { type: "hardBreak" }, { type: "text", text: "beta" },
      ] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Line 244" }] },
      { type: "paragraph", content: [{ type: "text", text: "other section" }] },
    ] });
    const { component, container, saved } = await mountEditor(content);
    const paragraphs = container.querySelectorAll(".tiptap-editor p");
    for (const [paragraph, expectedIndex] of [[2, 2], [99, 2], [null, 0], [0, 0]] as const) {
      component.locateSectionParagraph("242", paragraph);
      await expect.poll(() => [...paragraphs].flatMap((node, index) =>
        node.querySelector(".ai-ref-highlight") ? [index] : []
      )).toEqual([expectedIndex]);
      expect(paragraphs[expectedIndex === 2 ? 0 : 2].querySelector(".ai-ref-highlight")).toBeNull();
      expect(paragraphs[3].querySelector(".ai-ref-highlight")).toBeNull();
      expect(container.querySelector("h2 .ai-ref-highlight")).toBeNull();
      if (expectedIndex === 2) expect(paragraphs[2].querySelector(".ai-ref-highlight br, br.ai-ref-highlight")).not.toBeNull();
      component.clearHighlight();
      await expect.poll(() => container.querySelectorAll(".ai-ref-highlight").length).toBe(0);
    }
    component.locateSectionParagraph("missing", 2);
    await tick();
    expect(container.querySelectorAll(".ai-ref-highlight").length).toBe(0);
    expect(saved).toEqual([]);
    await component.flushPendingSave();
    expect(saved).toEqual([content]);
  });
});


it("previews actual heading, list and blockquote hard breaks without joining words", async () => {
  const inline = [
    { type: "text", text: "alpha" }, { type: "hardBreak" }, { type: "text", text: "beta" },
  ];
  const content = JSON.stringify({ type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: inline },
    { type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: inline }] },
    ] },
    { type: "blockquote", content: [{ type: "paragraph", content: inline }] },
  ] });
  const { component, container, saved } = await mountEditor(content);
  expect(component.findReplaceMatches([{ find: "alphabeta", replaceWith: "wrong" }])).toEqual([]);
  const pairs = [{ find: "alpha beta", replaceWith: "result" }];
  expect(component.findReplaceMatches(pairs)).toEqual([
    { from: 1, to: 11, text: "alpha beta", replaceWith: "result" },
    { from: 15, to: 25, text: "alpha beta", replaceWith: "result" },
    { from: 30, to: 40, text: "alpha beta", replaceWith: "result" },
  ]);
  component.previewProposal(pairs);
  component.highlightText(["alpha beta"]);
  await expect.poll(() => added(container)).toBe(3);
  for (const selector of ["h2", "li p", "blockquote p"]) {
    const block = container.querySelector(selector);
    expect(block).not.toBeNull();
    expect(block?.querySelector(".proposal-removed br, br.proposal-removed")).not.toBeNull();
    expect(block?.querySelector(".ai-ref-highlight br, br.ai-ref-highlight")).not.toBeNull();
    expect([...block?.querySelectorAll(".proposal-removed") ?? []].map((el) => el.textContent).join("")).toBe("alphabeta");
    expect(block?.querySelector(".proposal-added")?.textContent).toBe("result");
  }
  expect(saved).toEqual([]);
  component.clearProposalPreview();
  component.clearHighlight();
  await expect.poll(() => container.querySelectorAll(".proposal-removed, .proposal-added, .ai-ref-highlight").length).toBe(0);
  await component.flushPendingSave();
  expect(saved).toEqual([content]);
});
