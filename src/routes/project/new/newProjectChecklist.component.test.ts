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
    const stroke = (id: string) =>
      document.querySelector(`[data-checklist-row="${id}"] svg path`)!.getAttribute("stroke");
    expect(stroke("transcripts")).toBe("var(--color-success)");
    expect(stroke("unreadable")).toBe("var(--color-danger)");
    expect(stroke("duplicate")).toBe("var(--color-warning)");
    expect(stroke("supporting")).toBe("var(--color-ink-faint)");
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
    start.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("disables the start while a row blocks, with the exact previous-year message", async () => {
    await render(StartChecklist, props({ previousYearMessage: PREVIOUS_YEAR_ONLY_MESSAGE }));
    expect(text(document.querySelector('[data-checklist-row="previous-year"]'))).toContain(PREVIOUS_YEAR_ONLY_MESSAGE);
    expect(document.querySelector<HTMLButtonElement>("[data-start-button]")!.disabled).toBe(true);
  });

  it("shows the progress line in place of the note while starting", async () => {
    await render(StartChecklist, props({}, { busy: true, busyLabel: "Reading FrostLine test log.xlsx, then starting..." }));
    expect(text(document.querySelector("[data-start-note]"))).toBe("Reading FrostLine test log.xlsx, then starting...");
    expect(document.querySelector("[data-start-note]")!.getAttribute("role")).toBe("status");
    expect(document.querySelector<HTMLButtonElement>("[data-start-button]")!.disabled).toBe(true);
  });
});
