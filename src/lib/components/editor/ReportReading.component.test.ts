import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import { Editor as TiptapEditor } from "@tiptap/core";
import Editor from "./Editor.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";
import { parseCanonicalReport, reportSectionMetrics } from "$lib/reportSections";

/**
 * The reading presentation (ui-design-final.md section 8, board 2.1) changes
 * how the report renders, never what it stores: the "Line 24x" headings stay
 * in the document for export, QA and section detection.
 */

const SHORT_242 =
  "The team could not tell whether the control loop would stay stable under variable load. [GAP: Confirm the test range.]";
// About 670 words: inside 5% of the 700-word cap for Line 244.
const NEAR_LIMIT_244 = Array.from(
  { length: 67 },
  (_, i) => `Trial ${i + 1} held one condition steady to record the response.`
)
  .reduce<string[]>((paragraphs, sentence, i) => {
    if (i % 10 === 0) paragraphs.push(sentence);
    else paragraphs[paragraphs.length - 1] += ` ${sentence}`;
    return paragraphs;
  }, [])
  .join("\n\n");
const SHORT_246 = "The work showed how load and settings interact to affect temperature stability.";

function reportContent(): string {
  return JSON.stringify(buildTiptapDocument("Adaptive cold storage controls", SHORT_242, NEAR_LIMIT_244, SHORT_246));
}

async function mountReading(content = reportContent()) {
  const saved: string[] = [];
  const result = await render(Editor, {
    content,
    presentation: "reading",
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

describe("Report reading presentation", () => {
  it("shows each Section as one small all-caps label, with no CRA question", async () => {
    const { container } = await mountReading();
    const headings = [...container.querySelectorAll<HTMLElement>("[data-report-section-heading]")];
    expect(headings.map((h) => h.dataset.reportSectionHeading)).toEqual(["242", "244", "246"]);
    const label = (h: HTMLElement) =>
      `${h.querySelector(".report-section-heading__number")?.textContent} ${h.querySelector(".report-section-heading__name")?.textContent}`;
    expect(headings.map(label)).toEqual([
      "242 Technological uncertainty",
      "244 Work performed",
      "246 Technological advancement",
    ]);
    // Owner, 2026-10-21: the label is the Section's heading; the CRA
    // question no longer shows.
    expect(headings.map((h) => h.querySelector("h3")?.textContent)).toEqual([
      "242 Technological uncertainty",
      "244 Work performed",
      "246 Technological advancement",
    ]);
    expect(container.textContent).not.toContain("What scientific or technological");
    // The stored heading wording never shows, and neither does the end-of-Section pill.
    expect(container.textContent).not.toContain("Line 242");
    expect(container.querySelectorAll(".cra-section-end")).toHaveLength(0);
    // Sans body in the reading column (owner, 2026-10-21: no serif).
    const editor = container.querySelector(".tiptap-editor") as HTMLElement;
    expect(getComputedStyle(editor).fontFamily).toContain("Geist");
    expect(getComputedStyle(editor).fontWeight).toBe("300");
    // 48px between Sections; the label 8px above its first paragraph.
    expect(getComputedStyle(headings[1]).marginTop).toBe("48px");
    expect(getComputedStyle(headings[1].nextElementSibling!).marginTop).toBe("8px");
    expect(getComputedStyle(editor).fontSize).toBe("15px");
    expect(getComputedStyle(editor).lineHeight).toBe("25px");
    const title = getComputedStyle(headings[0].querySelector("h3")!);
    expect(title.fontSize).toBe("13px");
    expect(title.textTransform).toBe("uppercase");
    expect(title.fontWeight).toBe("500");
    expect(title.fontFamily).not.toContain("Georgia");
    // Halfway between ink-muted (107, 127, 123) and ink-faint (147, 165, 161).
    const channels = (title.color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const rgb = channels.every((c) => c <= 1) ? channels.map((c) => Math.round(c * 255)) : channels;
    expect(rgb).toEqual([127, 146, 142]);
  });

  // Owner, 2026-10-21: the meter shows only once a Section is over a CRA
  // limit; near the limit, nothing shows.
  it("shows the limit meter only on a Section over a CRA limit", async () => {
    const near = await mountReading();
    const nearMeters = [...near.container.querySelectorAll<HTMLElement>("[data-report-limit-meter]")];
    expect(nearMeters.map((m) => m.hidden)).toEqual([true, true, true]);
    await near.unmount();

    const over = `${NEAR_LIMIT_244}\n\n${NEAR_LIMIT_244.split("\n\n")[0]}`;
    const content = JSON.stringify(buildTiptapDocument("Adaptive cold storage controls", SHORT_242, over, SHORT_246));
    const metrics = reportSectionMetrics(content);
    expect(metrics.s244.words).toBeGreaterThan(700);
    const { container } = await mountReading(content);
    const meters = [...container.querySelectorAll<HTMLElement>("[data-report-limit-meter]")];
    expect(meters.map((m) => m.hidden)).toEqual([true, false, true]);
    const meter = meters[1];
    expect(meter.dataset.limitState).toBe("over");
    expect(meter.querySelector(".report-limit-meter__text")?.textContent).toBe(
      `${metrics.s244.lines} / 100 lines, ${metrics.s244.words} / 700 words`
    );
    expect(meter.querySelector(".report-limit-meter__bar")).not.toBeNull();
  });

  it("keeps the [GAP] highlight in the body", async () => {
    const { container } = await mountReading();
    const gap = container.querySelector<HTMLElement>('mark[data-color="#FEF3C7"]');
    expect(gap?.textContent).toBe("[GAP: Confirm the test range.]");
    expect(getComputedStyle(gap!).fontSize).toBe("15px");
  });

  it("saves the exact Line 24x headings after an edit, so export and QA read the same Sections", async () => {
    const original = reportContent();
    const { tiptap, component } = await mountReading(original);
    const firstParagraphEnd = (() => {
      let end = -1;
      tiptap.state.doc.forEach((node, offset) => {
        if (end < 0 && node.type.name === "paragraph") end = offset + node.nodeSize - 1;
      });
      return end;
    })();
    tiptap.chain().focus().insertContentAt(firstParagraphEnd, " Added.").run();
    await component.flushPendingSave();
    const saved = JSON.stringify(tiptap.getJSON());

    const headingTexts = (json: string) =>
      (JSON.parse(json).content as Array<{ type: string; content?: Array<{ text?: string }> }>)
        .filter((node) => node.type === "heading")
        .map((node) => (node.content ?? []).map((c) => c.text ?? "").join(""));
    expect(headingTexts(saved)).toEqual(headingTexts(original));

    const before = parseCanonicalReport(original);
    const after = parseCanonicalReport(saved);
    expect(after.diagnostics.filter((d) => d.code !== "UNRESOLVED_GAP")).toEqual([]);
    expect(after.sections.s244.plainText).toBe(before.sections.s244.plainText);
    expect(after.sections.s246.plainText).toBe(before.sections.s246.plainText);
    expect(after.sections.s242.plainText).toBe(`${before.sections.s242.plainText} Added.`);
  });

  it("does not join prose into a hidden Section heading", async () => {
    const original = reportContent();
    const { tiptap } = await mountReading(original);
    // Cursor at the start of the first paragraph under Line 244.
    let target = -1;
    let afterHeading = false;
    tiptap.state.doc.forEach((node, offset) => {
      if (node.type.name === "heading" && node.textContent.startsWith("Line 244")) afterHeading = true;
      else if (afterHeading && target < 0 && node.type.name === "paragraph") target = offset + 1;
    });
    tiptap.commands.focus();
    tiptap.commands.setTextSelection(target);
    await userEvent.keyboard("{Backspace}");
    expect(parseCanonicalReport(JSON.stringify(tiptap.getJSON())).sections.s244.plainText).toBe(
      parseCanonicalReport(original).sections.s244.plainText
    );
    expect(
      tiptap.state.doc.content.content.filter((node) => node.type.name === "heading").map((node) => node.textContent)
    ).toContain("Line 244 — Work Performed");
  });

  it("keeps the classic presentation unchanged for the rollback page", async () => {
    const { container } = await render(Editor, { content: reportContent() });
    await expect.poll(() => container.querySelector(".tiptap-editor")).not.toBeNull();
    expect(container.querySelector("[data-report-section-heading]")).toBeNull();
    expect(container.querySelector(".tiptap-editor h2")?.textContent).toBe(
      "Line 242 — Scientific/Technological Uncertainty"
    );
  });
});
