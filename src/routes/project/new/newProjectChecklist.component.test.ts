import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import StartChecklist from "$lib/components/project-new/StartChecklist.svelte";
import { buildChecklist, type ChecklistInput } from "$lib/components/project-new/newProjectChecklist";
import { PREVIOUS_YEAR_ONLY_MESSAGE } from "../../../../shared/previousYear";

/**
 * "Before you start" (E1, E5, E6): each row's icon and ink by state, the
 * start button disabled by a blocking row, row actions, and the note that
 * becomes the progress line while a start runs. The row rules themselves are
 * unit-tested in newProjectChecklist.test.ts.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const INPUT: ChecklistInput = {
  mode: "generate",
  clientName: "Cedarline Systems",
  title: "Cold storage",
  transcripts: { count: 2, words: 14_820 },
  unreadableTranscripts: 1,
  fiscalYearSet: false,
  scienceCodeSet: true,
  supporting: { count: 3, reading: 1 },
  duplicateName: true,
  previousYearMessage: null,
  noSource: false,
  projectNumberInvalid: false,
  overCapMessage: null,
  writtenPd: "missing",
};

function props(overrides: Partial<ChecklistInput> = {}, extra: Record<string, unknown> = {}) {
  return {
    rows: buildChecklist({ ...INPUT, ...overrides }),
    startLabel: "Start step by step",
    note: "You will check your files before anything starts.",
    onStart: vi.fn(),
    onAction: vi.fn(),
    ...extra,
  };
}

describe("StartChecklist", () => {
  it("draws each state with its icon colour and ink", async () => {
    await render(StartChecklist, props());
    const rows = [...document.querySelectorAll<HTMLElement>("[data-checklist-row]")];
    expect(rows.map((row) => [row.dataset.checklistRow, row.dataset.state])).toEqual([
      ["duplicate", "warning"],
      ["transcripts", "done"],
      ["unreadable", "danger"],
      ["fiscal-science", "pending"],
      ["supporting", "reading"],
    ]);
    // The board icons (16px, stroke 1.8) in each state's colour (E1, E5, E6).
    const icon = (id: string) => document.querySelector<SVGElement>(`[data-checklist-row="${id}"] svg`)!;
    const colour = (id: string) => getComputedStyle(icon(id)).color;
    expect(colour("transcripts")).toBe("rgb(22, 163, 74)");
    expect(colour("unreadable")).toBe("rgb(220, 38, 38)");
    expect(colour("duplicate")).toBe("rgb(217, 119, 6)");
    expect(colour("supporting")).toBe("rgb(147, 165, 161)");
    expect(icon("transcripts").querySelector("path")!.getAttribute("d")).toBe(
      "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M8.5 12.3l2.4 2.4 4.6-4.9"
    );
    expect(icon("unreadable").querySelector("path")!.getAttribute("d")).toBe(
      "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7.5V13 M12 16.3v.2"
    );
    expect(icon("supporting").querySelector("path")!.getAttribute("d")).toBe("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2");
    expect([icon("transcripts").getAttribute("width"), icon("transcripts").getAttribute("stroke-width")]).toEqual(["16", "1.8"]);
    // A problem row reads in ink; its action carries the colour (E5, E6).
    const rowText = (id: string) => document.querySelector<HTMLElement>(`[data-checklist-row="${id}"] > span`)!;
    expect(getComputedStyle(rowText("unreadable")).color).toBe("rgb(22, 33, 31)");
    expect(getComputedStyle(rowText("duplicate")).color).toBe("rgb(22, 33, 31)");
    expect(getComputedStyle(document.querySelector('[data-checklist-action="unreadable"]')!).color).toBe("rgb(185, 28, 28)");
    expect(getComputedStyle(document.querySelector('[data-checklist-action="duplicate"]')!).color).toBe("rgb(180, 83, 9)");
    expect(text(document.querySelector('[data-checklist-row="duplicate"] [data-checklist-action]'))).toBe("Check");
    expect(getComputedStyle(document.querySelector("[data-start-checklist]")!).borderRadius).toBe("14px");
  });

  it("runs row actions and the start", async () => {
    const onAction = vi.fn();
    const onStart = vi.fn();
    await render(StartChecklist, props({}, { onAction, onStart }));
    document.querySelector<HTMLButtonElement>('[data-checklist-action="unreadable"]')!.click();
    expect(onAction).toHaveBeenCalledWith("unreadable");
    const start = document.querySelector<HTMLButtonElement>("[data-start-button]")!;
    expect(start.disabled).toBe(false);
    expect(getComputedStyle(start).backgroundColor).toBe("rgb(10, 58, 56)");
    expect(getComputedStyle(start).height).toBe("42px");
    const arrow = start.querySelector("svg")!;
    expect([arrow.getAttribute("width"), arrow.getAttribute("stroke-width")]).toEqual(["14", "1.8"]);
    expect(arrow.querySelector("path")!.getAttribute("d")).toBe("M4.5 12h15 M13.5 6l6 6-6 6");
    start.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("disables the start while a row blocks, with the exact previous-year message", async () => {
    await render(StartChecklist, props({ previousYearMessage: PREVIOUS_YEAR_ONLY_MESSAGE }));
    expect(text(document.querySelector('[data-checklist-row="previous-year"]'))).toContain(PREVIOUS_YEAR_ONLY_MESSAGE);
    expect(document.querySelector<HTMLButtonElement>("[data-start-button]")!.disabled).toBe(true);
  });

  it("draws E4's plain start for a review: no box, a 36px button and only the rows still to do", async () => {
    const ready = { mode: "review" as const, writtenPd: "ready" as const, duplicateName: false, unreadableTranscripts: 0, fiscalYearSet: true, supporting: { count: 0, reading: 0 } };
    await render(StartChecklist, props(ready, { variant: "plain", startLabel: "Start the review", note: "You get a feedback report. Your draft is never changed." }));
    const box = document.querySelector<HTMLElement>("[data-start-checklist]")!;
    expect(box.dataset.startChecklist).toBe("plain");
    expect(getComputedStyle(box).borderTopWidth).toBe("0px");
    expect(box.textContent).not.toContain("Before you start");
    expect(document.querySelectorAll("[data-checklist-row]")).toHaveLength(0);
    const start = document.querySelector<HTMLButtonElement>("[data-start-button]")!;
    expect(getComputedStyle(start).height).toBe("36px");
    expect(getComputedStyle(start).borderTopLeftRadius).toBe("8px");
    expect(start.querySelector("svg")).toBeNull();
    expect(getComputedStyle(document.querySelector("[data-start-note]")!).lineHeight).toBe("16px");
  });

  it("keeps a blocking row visible in the plain start so a disabled button says why", async () => {
    await render(StartChecklist, props({ mode: "review", writtenPd: "missing", duplicateName: false, unreadableTranscripts: 0 }, { variant: "plain" }));
    expect(document.querySelector('[data-checklist-row="written-pd"]')).not.toBeNull();
    expect(document.querySelector('[data-checklist-row="client-title"]')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-start-button]")!.disabled).toBe(true);
  });

  it("shows the progress line in place of the note while starting", async () => {
    await render(StartChecklist, props({}, { busy: true, busyLabel: "Reading FrostLine test log.xlsx, then starting..." }));
    expect(text(document.querySelector("[data-start-note]"))).toBe("Reading FrostLine test log.xlsx, then starting...");
    expect(document.querySelector("[data-start-note]")!.getAttribute("role")).toBe("status");
    expect(document.querySelector<HTMLButtonElement>("[data-start-button]")!.disabled).toBe(true);
  });
});
