import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { Editor as TiptapEditor } from "@tiptap/core";
import Editor from "./Editor.svelte";
import ReadOnlyEditor from "../review/ReadOnlyEditor.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";
import { reportSectionMetrics } from "$lib/reportSections";

/**
 * 2026-10-29 (owner): an [INFERRED: what it rests on] marker shows as a
 * chip apart from the amber gap, read by assistive technology as "Inferred,
 * check this: <reason>" (review round 1, P3-9: a hidden, non-editable
 * prefix, not an aria-label). Deleting it accepts the inference, in one
 * key press at the chip (P2-5); the text stays plain in the saved document.
 */

const REASON = "the source asks for stability over time, not single-point checks";
const MARK = `[INFERRED: ${REASON}]`;
const S242 = "The team could not tell whether the cold room would settle under load. [GAP: Confirm the test range.]";
const S244 = `Readiness was first judged from single readings. ${MARK} The team then held each sample for an hour.`;
const S246 = "The work showed how load and settings affect settling.";

function content(s244 = S244): string {
  return JSON.stringify(buildTiptapDocument("Cold room readiness", S242, s244, S246));
}

async function mount(presentation: "classic" | "reading", text = content()) {
  const saved: string[] = [];
  const result = await render(Editor, {
    content: text,
    presentation,
    onUpdate: (json: string) => {
      saved.push(json);
    },
  });
  await expect.poll(() => result.container.querySelector(".tiptap-editor")).not.toBeNull();
  const element = result.container.querySelector(".tiptap-editor");
  if (!element || !("editor" in element) || !(element.editor instanceof TiptapEditor)) {
    throw new Error("Mounted Tiptap editor instance is unavailable");
  }
  return { ...result, saved, tiptap: element.editor };
}

/** The document range of the first occurrence of `text`. */
function rangeOf(tiptap: TiptapEditor, text: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  tiptap.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return !found;
    const at = node.text.indexOf(text);
    if (at >= 0) found = { from: pos + at, to: pos + at + text.length };
    return false;
  });
  if (!found) throw new Error(`"${text}" is not in the document`);
  return found;
}

const rgb = (color: string) => color.replace(/\s+/g, "");

/**
 * Put the cursor at `pos` and wait until the editor has focus there: Tiptap
 * applies focus on a later frame, so a key pressed sooner goes to the page.
 */
async function placeCursor(tiptap: TiptapEditor, pos: number) {
  tiptap.chain().setTextSelection(pos).focus().run();
  await expect.poll(() => tiptap.view.hasFocus() && tiptap.state.selection.from === pos).toBe(true);
}

describe("Inference chips in the report editor", () => {
  for (const presentation of ["classic", "reading"] as const) {
    it(`shows the marker as a labelled chip, apart from the gap (${presentation})`, async () => {
      const { container } = await mount(presentation);
      const chip = container.querySelector<HTMLElement>("mark.report-inferred");
      expect(chip?.textContent).toBe(MARK);
      // Screen readers hear "Inferred, check this:" right before the marker's own words.
      const prefix = chip!.previousElementSibling as HTMLElement;
      expect(prefix.matches("[data-inferred-note-prefix]")).toBe(true);
      expect(prefix.textContent).toBe("Inferred, check this: ");
      expect(prefix.isContentEditable).toBe(false);
      expect(prefix.classList.contains("sr-only")).toBe(true);
      expect(getComputedStyle(prefix).position).toBe("absolute");
      expect(prefix.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      expect(`${prefix.textContent}${chip!.textContent}`).toBe(`Inferred, check this: ${MARK}`);
      expect(chip?.hasAttribute("aria-label")).toBe(false);
      const gap = container.querySelector<HTMLElement>('mark[data-color="#FEF3C7"]');
      expect(gap?.textContent).toBe("[GAP: Confirm the test range.]");
      // Only the inference is a chip of this kind; the gap keeps its own.
      expect(container.querySelectorAll("mark.report-inferred")).toHaveLength(1);
      expect(gap?.classList.contains("report-inferred")).toBe(false);
      const chipStyle = getComputedStyle(chip!);
      const gapStyle = getComputedStyle(gap!);
      // The lagoon inference tokens, never the amber gap ones.
      expect(rgb(chipStyle.backgroundColor)).toBe("rgb(213,243,241)");
      expect(rgb(chipStyle.color)).toBe("rgb(6,95,91)");
      expect(rgb(chipStyle.backgroundColor)).not.toBe(rgb(gapStyle.backgroundColor));
      expect(Number(chipStyle.fontWeight)).toBeLessThanOrEqual(500);
      // The same size as the gap chip beside it.
      expect(chipStyle.fontSize).toBe(gapStyle.fontSize);
    });
  }

  it("keeps the marker as plain text in the saved document and out of the counts", async () => {
    const original = content();
    const { tiptap, component, saved } = await mount("reading", original);
    tiptap.chain().focus().insertContentAt(rangeOf(tiptap, "an hour.").to, " Added.").run();
    await component.flushPendingSave();
    const last = saved.at(-1)!;
    expect(last).toContain(MARK);
    // No mark, class or prefix from the chip is stored.
    expect(last).not.toContain("report-inferred");
    expect(last).not.toContain("Inferred, check this");
    expect(reportSectionMetrics(original).s244.words).toBe(
      reportSectionMetrics(content("Readiness was first judged from single readings. The team then held each sample for an hour.")).s244.words
    );
  });

  it("accepts the inference when the writer deletes the chip, and keeps the sentence", async () => {
    const { container, tiptap, component, saved } = await mount("reading");
    const { from, to } = rangeOf(tiptap, ` ${MARK}`);
    tiptap.chain().focus().deleteRange({ from, to }).run();
    await expect.poll(() => container.querySelectorAll("mark.report-inferred").length).toBe(0);
    await component.flushPendingSave();
    const last = saved.at(-1)!;
    expect(last).not.toContain("[INFERRED");
    expect(last).toContain("Readiness was first judged from single readings. The team then held each sample for an hour.");
  });

  // Review round 1 (P2-5): real key presses, not a programmatic deleteRange.
  it("removes the whole marker, and the space before it, with one Backspace at the chip's end", async () => {
    const { container, tiptap, component, saved } = await mount("reading");
    await placeCursor(tiptap, rangeOf(tiptap, MARK).to);
    await userEvent.keyboard("{Backspace}");
    await expect.poll(() => container.querySelectorAll("mark.report-inferred").length).toBe(0);
    await component.flushPendingSave();
    const last = saved.at(-1)!;
    expect(last).not.toContain("[INFERRED");
    expect(last).not.toContain("INFERRED: the source");
    expect(last).toContain("Readiness was first judged from single readings. The team then held each sample for an hour.");
  });

  it("removes the whole marker with one Delete at the chip's start, or one Backspace inside it", async () => {
    const atStart = await mount("classic");
    await placeCursor(atStart.tiptap, rangeOf(atStart.tiptap, MARK).from);
    await userEvent.keyboard("{Delete}");
    await expect.poll(() => atStart.tiptap.getText()).not.toContain("INFERRED");
    expect(atStart.tiptap.getText()).toContain("Readiness was first judged from single readings. The team then held each sample for an hour.");
    await atStart.unmount();

    const inside = await mount("classic");
    await placeCursor(inside.tiptap, rangeOf(inside.tiptap, "stability").from);
    await userEvent.keyboard("{Backspace}");
    await expect.poll(() => inside.tiptap.getText()).not.toContain("INFERRED");
  });

  it("leaves Backspace alone away from a chip, and on a gap", async () => {
    const { tiptap } = await mount("classic");
    await placeCursor(tiptap, rangeOf(tiptap, "an hour.").to);
    await userEvent.keyboard("{Backspace}");
    await expect.poll(() => tiptap.getText().includes("an hour.")).toBe(false);
    expect(tiptap.getText()).toContain("for an hour");
    expect(tiptap.getText()).toContain(MARK);
    await placeCursor(tiptap, rangeOf(tiptap, "[GAP: Confirm the test range.]").to);
    await userEvent.keyboard("{Backspace}");
    await expect.poll(() => tiptap.getText().includes("range.]")).toBe(false);
    expect(tiptap.getText()).toContain("[GAP: Confirm the test range.");
  });

  it("stops showing a chip once part of the marker is deleted, as typing back restores it", async () => {
    const { container, tiptap } = await mount("classic");
    const end = rangeOf(tiptap, MARK).to;
    tiptap.chain().focus().deleteRange({ from: end - 1, to: end }).run();
    await expect.poll(() => container.querySelectorAll("mark.report-inferred").length).toBe(0);
    tiptap.chain().focus().insertContentAt(end - 1, "]").run();
    await expect.poll(() => container.querySelectorAll("mark.report-inferred").length).toBe(1);
  });

  it("shows a marker the writer types, or one an applied card brings, the same way", async () => {
    const { container, tiptap } = await mount("classic", content("Readiness was judged from single readings."));
    expect(container.querySelectorAll("mark.report-inferred")).toHaveLength(0);
    tiptap.chain().focus().insertContentAt(rangeOf(tiptap, "readings.").to, " [INFERRED: the plan names no other check]").run();
    await expect.poll(() => container.querySelector("mark.report-inferred")?.textContent).toBe("[INFERRED: the plan names no other check]");
    expect(container.querySelectorAll("[data-inferred-note-prefix]")).toHaveLength(1);
  });

  it("names an empty marker too", async () => {
    const { container } = await mount("classic", content("Readiness was judged from single readings. [INFERRED:]"));
    expect(container.querySelector("mark.report-inferred")?.textContent).toBe("[INFERRED:]");
    expect(container.querySelector("[data-inferred-note-prefix]")?.textContent).toBe("Inferred, check this: ");
  });

  // Review round 1 (P2-4): two notes with the same words each go to their own place.
  it("shows the listed note itself when two notes in a Line have the same words", async () => {
    const text = `First one stays put. ${MARK}\n\nSecond one stays put. ${MARK}`;
    const { container, component } = await mount("classic", content(text));
    expect(container.querySelectorAll("mark.report-inferred")).toHaveLength(2);
    expect(component.showNote({ section: "s244", text: MARK, occurrence: 1 })).toBe(true);
    await expect.poll(() => container.querySelectorAll(".ai-ref-highlight").length).toBeGreaterThan(0);
    const highlighted = [...container.querySelectorAll<HTMLElement>(".ai-ref-highlight")];
    expect(highlighted.map((node) => node.closest("p")?.textContent?.startsWith("Second one stays put."))).toEqual(highlighted.map(() => true));
    expect(highlighted.map((node) => node.textContent).join("")).toBe(MARK);
    expect(component.showNote({ section: "s244", text: MARK, occurrence: 0 })).toBe(true);
    await expect.poll(() => container.querySelector(".ai-ref-highlight")?.closest("p")?.textContent?.startsWith("First one stays put.")).toBe(true);
    // A note the report no longer holds there is not found.
    expect(component.showNote({ section: "s244", text: MARK, occurrence: 2 })).toBe(false);
    expect(component.showNote({ section: "s242", text: MARK, occurrence: 0 })).toBe(false);
  });
});

describe("Inference chips in the client review view", () => {
  it("shows the same chip, with its hidden prefix", async () => {
    const { container } = await render(ReadOnlyEditor, { content: content() });
    await expect.poll(() => container.querySelector("mark.report-inferred")).not.toBeNull();
    expect(container.querySelector("mark.report-inferred")?.textContent).toBe(MARK);
    expect(container.querySelector("[data-inferred-note-prefix]")?.textContent).toBe("Inferred, check this: ");
  });
});
