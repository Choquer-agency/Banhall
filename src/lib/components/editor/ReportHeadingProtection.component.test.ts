import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import Editor from "./Editor.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";
import { parseCanonicalReport } from "$lib/reportSections";

/**
 * Review f1 (2026-09-25): in the reading presentation the "Line 24x" headings
 * are drawn as a label and question with no editable text, so no user edit may
 * change, convert, wrap, split, merge or delete them. External content (the
 * server's copy) must still replace them.
 */

const S242 = "The team could not tell whether the loop stays stable. It varied the load.";
const S244 = "Trials held one condition steady.\n\nEach trial recorded the response.";
const S246 = "The work showed how load and settings interact.";

function content(title = "Report", s244 = S244): string {
  return JSON.stringify(buildTiptapDocument(title, S242, s244, S246));
}

const headingList = (doc: PMNode) =>
  doc.content.content.filter((node) => node.type.name === "heading").map((node) => node.textContent);

async function mount(initial = content()) {
  const result = await render(Editor, { content: initial, presentation: "reading" });
  await expect.poll(() => result.container.querySelector(".tiptap-editor")).not.toBeNull();
  const element = result.container.querySelector(".tiptap-editor");
  if (!element || !("editor" in element) || !(element.editor instanceof TiptapEditor)) {
    throw new Error("Mounted Tiptap editor instance is unavailable");
  }
  return { ...result, tiptap: element.editor };
}

/** Positions around the Line 244 heading: the end of 242's last paragraph and the start of 244's first. */
function around244(doc: PMNode) {
  let before = -1;
  let after = -1;
  let seen = false;
  doc.forEach((node, offset) => {
    if (node.type.name === "heading" && node.textContent.startsWith("Line 244")) seen = true;
    else if (!seen && node.type.name === "paragraph") before = offset + node.nodeSize - 1;
    else if (seen && after < 0 && node.type.name === "paragraph") after = offset + 1;
  });
  return { before, after };
}

function expectIntact(tiptap: TiptapEditor, original: string) {
  const saved = JSON.stringify(tiptap.getJSON());
  expect(headingList(tiptap.state.doc)).toEqual(headingList(tiptap.schema.nodeFromJSON(JSON.parse(original))));
  const before = parseCanonicalReport(original);
  const after = parseCanonicalReport(saved);
  expect(after.diagnostics).toEqual([]);
  for (const key of ["s242", "s244", "s246"] as const) {
    expect(after.sections[key].plainText).toBe(before.sections[key].plainText);
  }
}

function insideSectionHeading(tiptap: TiptapEditor): boolean {
  const { $from, $to } = tiptap.state.selection;
  return [$from, $to].some(($pos) => $pos.depth >= 1 && $pos.node(1).type.name === "heading" && /^Line 24/.test($pos.node(1).textContent));
}

const BACKWARD_KEYS = [
  "{Backspace}",
  "{Shift>}{Backspace}{/Shift}",
  "{Meta>}{Backspace}{/Meta}",
  "{Control>}{Backspace}{/Control}",
  "{Alt>}{Backspace}{/Alt}",
  "{Control>}h{/Control}",
];
const FORWARD_KEYS = [
  "{Delete}",
  "{Meta>}{Delete}{/Meta}",
  "{Control>}{Delete}{/Control}",
  "{Alt>}{Delete}{/Alt}",
  "{Control>}d{/Control}",
  "{Alt>}d{/Alt}",
  "{Control>}{Alt>}{Backspace}{/Alt}{/Control}",
];

describe("Section heading protection (reading presentation)", () => {
  for (const keys of BACKWARD_KEYS) {
    it(`does not merge the first paragraph into the heading on ${keys}`, async () => {
      const original = content();
      const { tiptap } = await mount(original);
      tiptap.commands.focus();
      tiptap.commands.setTextSelection(around244(tiptap.state.doc).after);
      await userEvent.keyboard(keys);
      await userEvent.keyboard(keys);
      expectIntact(tiptap, original);
    });
  }

  for (const keys of FORWARD_KEYS) {
    it(`does not merge the heading into the previous paragraph on ${keys}`, async () => {
      const original = content();
      const { tiptap } = await mount(original);
      tiptap.commands.focus();
      tiptap.commands.setTextSelection(around244(tiptap.state.doc).before);
      await userEvent.keyboard(keys);
      await userEvent.keyboard(keys);
      await userEvent.keyboard(keys);
      expectIntact(tiptap, original);
    });
  }

  for (const [label, forward, back] of [
    ["ArrowRight", "{ArrowRight}", "{ArrowLeft}"],
    ["ArrowDown", "{ArrowDown}", "{ArrowUp}"],
  ] as const) {
    it(`keeps the caret out of the heading on ${label} and its reverse`, async () => {
      const original = content();
      const { tiptap } = await mount(original);
      tiptap.commands.focus();
      tiptap.commands.setTextSelection(around244(tiptap.state.doc).before);
      for (let i = 0; i < 3; i++) {
        await userEvent.keyboard(forward);
        expect(insideSectionHeading(tiptap)).toBe(false);
      }
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard("{Backspace}{Backspace}");
      tiptap.commands.setTextSelection(around244(tiptap.state.doc).after);
      for (let i = 0; i < 3; i++) {
        await userEvent.keyboard(back);
        expect(insideSectionHeading(tiptap)).toBe(false);
      }
      expect(headingList(tiptap.state.doc)).toEqual(headingList(tiptap.schema.nodeFromJSON(JSON.parse(original))));
    });
  }

  it("moves a caret placed inside a heading to just after it", async () => {
    const { tiptap } = await mount();
    const headingStart = around244(tiptap.state.doc).after - 2; // inside the heading text
    tiptap.commands.setTextSelection(headingStart);
    expect(insideSectionHeading(tiptap)).toBe(false);
  });

  const spanning = (tiptap: TiptapEditor) => {
    const { before, after } = around244(tiptap.state.doc);
    return { from: before - 5, to: after + 5 };
  };

  for (const [label, run] of [
    ["Paragraph", (t: TiptapEditor) => t.chain().focus().setParagraph().run()],
    ["Bullet list", (t: TiptapEditor) => t.chain().focus().toggleBulletList().run()],
    ["Quote", (t: TiptapEditor) => t.chain().focus().toggleBlockquote().run()],
    ["Heading 3", (t: TiptapEditor) => t.chain().focus().toggleHeading({ level: 3 }).run()],
    ["Backspace", async () => userEvent.keyboard("{Backspace}")],
    ["typing", async () => userEvent.keyboard("x")],
    ["paste", (t: TiptapEditor) => t.view.pasteText("pasted words")],
  ] as const) {
    it(`refuses ${label} over a selection that spans a heading`, async () => {
      const original = content();
      const { tiptap } = await mount(original);
      tiptap.commands.focus();
      tiptap.commands.setTextSelection(spanning(tiptap));
      await run(tiptap);
      expectIntact(tiptap, original);
    });
  }

  it("still applies a paste inside one Section", async () => {
    const { tiptap } = await mount();
    tiptap.commands.focus();
    tiptap.commands.setTextSelection(around244(tiptap.state.doc).after);
    tiptap.view.pasteText("Pasted. ");
    expect(parseCanonicalReport(JSON.stringify(tiptap.getJSON())).sections.s244.plainText).toContain("Pasted. Trials");
  });

  it("removes an empty paragraph under a heading with Backspace", async () => {
    const original = content();
    const { tiptap } = await mount(original);
    tiptap.commands.focus();
    const { after } = around244(tiptap.state.doc);
    tiptap.commands.setTextSelection(after);
    tiptap.commands.insertContentAt(after - 1, { type: "paragraph" });
    tiptap.commands.setTextSelection(after);
    const count = tiptap.state.doc.childCount;
    await userEvent.keyboard("{Backspace}");
    expect(tiptap.state.doc.childCount).toBe(count - 1);
    expectIntact(tiptap, original);
  });

  it("accepts external content that replaces the headings", async () => {
    const { tiptap, rerender } = await mount(content());
    const next = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Other" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Line 242 - Scientific or Technological Uncertainty" }] },
        { type: "paragraph", content: [{ type: "text", text: "Server wording." }] },
      ],
    });
    await rerender({ content: next, presentation: "reading" });
    await expect.poll(() => headingList(tiptap.state.doc)).toEqual(["Other", "Line 242 - Scientific or Technological Uncertainty"]);
    expect(tiptap.state.doc.textContent).toContain("Server wording.");
  });

  it("still undoes ordinary edits", async () => {
    const original = content();
    const { tiptap } = await mount(original);
    tiptap.commands.focus();
    tiptap.commands.setTextSelection(around244(tiptap.state.doc).after);
    await userEvent.keyboard("Hello ");
    expect(tiptap.state.doc.textContent).toContain("Hello Trials");
    tiptap.commands.undo();
    expectIntact(tiptap, original);
  });

  describe("selection toolbar", () => {
    async function selectWithMouse(tiptap: TiptapEditor, from: number, to: number) {
      tiptap.view.dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      tiptap.commands.setTextSelection({ from, to });
      await expect.poll(() => document.querySelector("[data-selection-toolbar]")).not.toBeNull();
    }
    const blockButton = () => document.querySelector<HTMLButtonElement>('[data-selection-toolbar] button[title="Block type"]');

    it("hides the block-type menu when the selection touches a Section heading", async () => {
      const { tiptap } = await mount();
      const { before, after } = around244(tiptap.state.doc);
      await selectWithMouse(tiptap, before - 5, after + 5);
      expect(blockButton()).toBeNull();
      expect(document.querySelector('[data-selection-toolbar] button[title="Bold (Cmd+B)"]')).not.toBeNull();
      await selectWithMouse(tiptap, after, after + 5);
      await expect.poll(() => blockButton()).not.toBeNull();
    });

    it("keeps the block label current as the selection moves", async () => {
      const { tiptap } = await mount();
      const { after } = around244(tiptap.state.doc);
      await selectWithMouse(tiptap, after, after + 5);
      await expect.poll(() => blockButton()?.textContent?.trim()).toBe("Paragraph");
      tiptap.commands.toggleBulletList();
      const $pos = tiptap.state.selection.$from;
      await selectWithMouse(tiptap, $pos.pos, $pos.pos + 3);
      await expect.poll(() => blockButton()?.textContent?.trim()).toBe("Bullet list");
    });

    it("keeps a quiet Strikethrough button (decision 19)", async () => {
      const { tiptap } = await mount();
      const { after } = around244(tiptap.state.doc);
      await selectWithMouse(tiptap, after, after + 6);
      const strike = document.querySelector<HTMLButtonElement>('[data-selection-toolbar] button[title="Strikethrough"]');
      expect(strike).not.toBeNull();
      strike!.click();
      expect(tiptap.isActive("strike")).toBe(true);
    });
  });

  it("shows the editor hint in muted ink for contrast", async () => {
    const { container } = await mount();
    const hint = container.querySelector<HTMLElement>("[data-report-editor-hint]")!;
    // --color-ink-muted #6B7F7B
    expect(getComputedStyle(hint).color).toBe("rgb(107, 127, 123)");
  });

  it("runs the block handle hit area to the text edge", async () => {
    const { container, tiptap } = await mount();
    const heading = container.querySelector<HTMLElement>("[data-report-section-heading='244']")!;
    const rect = heading.getBoundingClientRect();
    heading.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: rect.left + 20, clientY: rect.top + 4 }));
    await expect.poll(() => container.querySelector("[data-block-handle]")).not.toBeNull();
    const handle = container.querySelector<HTMLElement>("[data-block-handle]")!.getBoundingClientRect();
    expect(Math.round(handle.right)).toBe(Math.round(tiptap.view.dom.getBoundingClientRect().left));
  });
});
