import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { Editor as TiptapEditor } from "@tiptap/core";
import Editor from "./Editor.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";
import { EVIDENCE_REBUILD_DELAY_MS, type EvidenceClaim } from "./evidenceView";

/**
 * Client request 2026-11-02: the Evidence view. Off by default; while on,
 * sentences linked to a source are tinted green with a solid underline,
 * inferred or unsupported ones red with a dashed underline, the rest plain.
 * A key explains it, and the sentence under the pointer or the cursor says
 * why. It never changes the document or schedules a save.
 */

const MARK = "[INFERRED: the source stresses stability over time]";
const S242 = "The team could not tell whether the cold room would settle under load.";
const S244 = `Readiness was first judged from single readings. ${MARK} The team then held each sample for an hour.`;
const S246 = "The work showed how load and settings affect settling.";
const QUOTE = { exactExcerpt: "we never knew if the room had settled", speaker: "Client", timestampStart: "00:12:30" };

const CLAIMS: EvidenceClaim[] = [
  { claimId: "242-1", section: "242", claimText: S242, state: "approved", sources: [QUOTE] },
  { claimId: "244-1", section: "244", claimText: S244, state: "needs_review", sources: [QUOTE] },
  { claimId: "246-1", section: "246", claimText: S246, state: "unsupported", sources: [] },
];

function content(): string {
  return JSON.stringify(buildTiptapDocument("Cold room readiness", S242, S244, S246));
}

type Props = {
  evidenceView?: boolean;
  evidenceClaims?: readonly EvidenceClaim[] | null;
  withSwitch?: boolean;
  presentation?: "classic" | "reading";
};

async function mount(options: Props = {}) {
  const { evidenceView = false, withSwitch = true, presentation = "reading" } = options;
  // An explicit undefined means "still loading", not the default record.
  const evidenceClaims = "evidenceClaims" in options ? options.evidenceClaims : CLAIMS;
  const saved: string[] = [];
  const changes: boolean[] = [];
  const props = {
    content: content(),
    presentation,
    onUpdate: (json: string) => {
      saved.push(json);
    },
    evidenceView,
    evidenceClaims,
    ...(withSwitch ? { onEvidenceViewChange: (on: boolean) => changes.push(on) } : {}),
  };
  const result = await render(Editor, props);
  await expect.poll(() => result.container.querySelector(".tiptap-editor")).not.toBeNull();
  const element = result.container.querySelector(".tiptap-editor");
  if (!element || !("editor" in element) || !(element.editor instanceof TiptapEditor)) {
    throw new Error("Mounted Tiptap editor instance is unavailable");
  }
  return { ...result, saved, changes, tiptap: element.editor, props };
}

function marked(container: HTMLElement, kind: "supported" | "unsupported"): string[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-evidence="${kind}"]`)].map((el) => el.textContent ?? "");
}

function posOf(tiptap: TiptapEditor, text: string): number {
  let found = -1;
  tiptap.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text);
  });
  if (found < 0) throw new Error(`"${text}" is not in the document`);
  return found;
}

describe("Evidence view in the report editor", () => {
  it("is off by default: the switch shows, unchecked, with no key and no colour", async () => {
    const { container } = await mount();
    const toggle = page.getByRole("switch", { name: "Evidence view" });
    await expect.element(toggle).toBeInTheDocument();
    await expect.element(toggle).toHaveAttribute("aria-checked", "false");
    expect(container.querySelector("[data-evidence-legend]")).toBeNull();
    expect(container.querySelector("[data-evidence]")).toBeNull();
  });

  it("shows no switch when the page does not offer the view", async () => {
    const { container } = await mount({ withSwitch: false });
    expect(container.querySelector("[data-evidence-toolbar]")).toBeNull();
  });

  it("asks the page to turn it on when the switch is pressed", async () => {
    const { changes } = await mount();
    await page.getByRole("switch", { name: "Evidence view" }).click();
    expect(changes).toEqual([true]);
  });

  for (const presentation of ["classic", "reading"] as const) {
    it(`colours sentences by the claim record and [INFERRED] markers, leaving the text alone (${presentation})`, async () => {
      const { container, tiptap, saved } = await mount({ evidenceView: true, presentation });
      const before = JSON.stringify(tiptap.getJSON());
      await expect.poll(() => marked(container, "supported")).toEqual([S242, "The team then held each sample for an hour."]);
      expect(marked(container, "unsupported")).toEqual(["Readiness was first judged from single readings.", S246]);
      // The chip keeps its own look, outside the colour.
      const chip = container.querySelector<HTMLElement>("mark.report-inferred");
      expect(chip?.textContent).toBe(MARK);
      expect(chip?.closest("[data-evidence]")).toBeNull();
      expect(JSON.stringify(tiptap.getJSON())).toBe(before);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(saved).toEqual([]);
    });
  }

  it("draws the two kinds with token tints and different underline styles", async () => {
    const { container } = await mount({ evidenceView: true });
    await expect.poll(() => container.querySelector('[data-evidence="supported"]')).not.toBeNull();
    const supported = getComputedStyle(container.querySelector<HTMLElement>('[data-evidence="supported"]')!);
    const unsupported = getComputedStyle(container.querySelector<HTMLElement>('[data-evidence="unsupported"]')!);
    const root = getComputedStyle(document.documentElement);
    const rgb = (hex: string) => {
      const value = hex.trim().replace("#", "");
      return `rgb(${[0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)).join(", ")})`;
    };
    expect(supported.backgroundColor).toBe(rgb(root.getPropertyValue("--color-evidence-supported-bg")));
    expect(unsupported.backgroundColor).toBe(rgb(root.getPropertyValue("--color-evidence-unsupported-bg")));
    expect(supported.textDecorationLine).toContain("underline");
    expect(supported.textDecorationStyle).toBe("solid");
    expect(unsupported.textDecorationLine).toContain("underline");
    expect(unsupported.textDecorationStyle).toBe("dashed");
    // The words keep the report's ink.
    expect(supported.color).toBe(unsupported.color);
  });

  it("shows the key while on, with a line counting what it found", async () => {
    await mount({ evidenceView: true });
    const legend = page.getByRole("list", { name: "Evidence view key" });
    await expect.element(legend).toBeInTheDocument();
    await expect.element(legend).toHaveTextContent("Linked to a source (solid underline)");
    await expect.element(legend).toHaveTextContent("Inferred or not backed (dashed underline)");
    await expect.element(legend).toHaveTextContent("Plain: no source data to check");
    await expect
      .element(page.getByText("2 sentences linked to a source, 2 sentences inferred or not backed."))
      .toBeInTheDocument();
  });

  it("says why on hover, and at the cursor", async () => {
    const { container, tiptap } = await mount({ evidenceView: true });
    await expect.poll(() => container.querySelector('[data-evidence-basis="marker"]')).not.toBeNull();
    const inferred = container.querySelector<HTMLElement>('[data-evidence-basis="marker"]')!;
    expect(inferred.title).toBe("Inferred: not stated in the sources. The AI's reason: the source stresses stability over time");
    await userEvent.hover(inferred);
    const status = () => container.querySelector("[data-evidence-status]")?.textContent?.trim();
    await expect.poll(status).toBe(inferred.title);
    await userEvent.unhover(inferred);

    tiptap.chain().setTextSelection(posOf(tiptap, "The team could") + 4).focus().run();
    await expect
      .poll(status)
      .toBe("Source checked by a reviewer: “we never knew if the room had settled” (Client, 00:12:30)");
    tiptap.chain().setTextSelection(posOf(tiptap, "The work showed") + 4).run();
    await expect.poll(status).toBe("Not backed by a source: no source quote is linked to this paragraph.");
  });

  it("with no claim record, colours only the inferred sentence and says so", async () => {
    const { container } = await mount({ evidenceView: true, evidenceClaims: null });
    await expect.poll(() => marked(container, "unsupported")).toEqual(["Readiness was first judged from single readings."]);
    expect(marked(container, "supported")).toEqual([]);
    await expect
      .element(page.getByText("This version has no claim record, so only sentences with an [INFERRED] note are coloured: 1 sentence."))
      .toBeInTheDocument();
  });

  it("says the record is loading until it arrives", async () => {
    await mount({ evidenceView: true, evidenceClaims: undefined });
    await expect.element(page.getByText("Loading the claim record...")).toBeInTheDocument();
  });

  it("turns off cleanly when the page turns it off", async () => {
    const { container, rerender, props } = await mount({ evidenceView: true });
    await expect.poll(() => container.querySelector("[data-evidence]")).not.toBeNull();
    await rerender({ ...props, evidenceView: false });
    await expect.poll(() => container.querySelector("[data-evidence]")).toBeNull();
    expect(container.querySelector("[data-evidence-legend]")).toBeNull();
  });

  it("keeps typing cheap: an edited paragraph is worked out again after a pause", async () => {
    const { container, tiptap } = await mount({ evidenceView: true });
    await expect.poll(() => marked(container, "supported")).toContain(S242);
    tiptap.chain().setTextSelection(posOf(tiptap, "under load") + "under load".length).focus().run();
    await userEvent.keyboard(" today");
    // The edited paragraph no longer matches its claim: once typing pauses it goes plain.
    await new Promise((resolve) => setTimeout(resolve, EVIDENCE_REBUILD_DELAY_MS + 200));
    await expect.poll(() => marked(container, "supported")).toEqual(["The team then held each sample for an hour."]);
  });
});
