import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import { tick } from "svelte";
import StartRunDialog, {
  type StartRunSource,
  readingMeta,
} from "./StartRunDialog.svelte";

const dialog = () => document.querySelector<HTMLElement>("[data-start-run-dialog]");
const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

async function settle(ms = 350) {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const SOURCES: StartRunSource[] = [
  { id: "t1", kind: "transcript", name: "Priya interview, Sep 12.docx", typeLabel: "Transcript", meta: "9,240 words" },
  { id: "t2", kind: "transcript", name: "Follow-up call, Sep 19.txt", typeLabel: "Transcript", meta: "5,580 words" },
  { id: "d1", kind: "document", name: "Cedarline FY 2025 report, R4.pdf", typeLabel: "Previous-year reports", meta: "3 sections found" },
  { id: "d2", kind: "document", name: "FrostLine test log.xlsx", typeLabel: "Other supporting docs", meta: "", reading: true, readingEtaSeconds: 18 },
];

const MODELS = { title: "Sonnet 5", line: "Writes the ideas. Opus 5.5 writes the report." };

function props(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    mode: "iterative" as const,
    sources: SOURCES,
    models: MODELS,
    onConfirm: vi.fn(),
    ...overrides,
  };
}

describe("StartRunDialog copy by mode", () => {
  it.each([
    ["iterative", "Choose what the ideas come from", "Untick anything you do not want used this time. Files lock once you start.", "Start with 4 files"],
    ["single", "Choose what the draft comes from", "Untick anything you do not want used this time. Files lock once you start.", "Write the draft"],
    ["compare", "Choose what the drafts come from", "Untick anything you do not want used this time. Files lock once you start.", "Write 2 drafts"],
    ["review", "Choose what the review checks against", "Your draft is always reviewed. Untick anything you do not want it checked against.", "Start the review"],
  ] as const)("%s shows its title, subtitle and confirm label", async (mode, title, subtitle, confirm) => {
    await render(StartRunDialog, props({ mode }));
    const node = dialog()!;
    expect(node.getAttribute("role")).toBe("dialog");
    expect(text(node)).toContain(title);
    expect(text(node)).toContain(subtitle);
    expect(text(q("[data-start-run-confirm]"))).toBe(confirm);
    // One AI mark per dialog, Compare included.
    expect(node.querySelectorAll('[data-ai-mark="aurora"]')).toHaveLength(1);
    expect(text(node)).not.toMatch(/[‐-―·]/);
  });

  it("names the models it was given, including the same-model line", async () => {
    await render(StartRunDialog, props({ models: { title: "Sonnet 5", line: "Writes the ideas and the report." } }));
    expect(text(q("[data-start-run-model-title]"))).toBe("Sonnet 5");
    expect(text(q("[data-start-run-model-line]"))).toBe("Writes the ideas and the report.");
  });

  it("uses one file in the singular", async () => {
    await render(StartRunDialog, props({ sources: [SOURCES[0]] }));
    expect(text(q("[data-start-run-confirm]"))).toBe("Start with 1 file");
  });
});

describe("StartRunDialog rows", () => {
  it("ticks every file, shows each row's chip and meta, and shows a file still reading in grey", async () => {
    await render(StartRunDialog, props());
    const rows = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")];
    expect(rows.map((row) => row.dataset.ticked)).toEqual(["true", "true", "true", "true"]);
    expect(rows.map((row) => text(row.querySelector("[data-start-run-chip]")))).toEqual([
      "Transcript",
      "Transcript",
      "Previous-year reports",
      "Other supporting docs",
    ]);
    expect(text(rows[0].querySelector("[data-start-run-meta]"))).toBe("9,240 words");
    const reading = rows[3].querySelector<HTMLElement>("[data-start-run-meta]")!;
    expect(text(reading)).toBe("Still reading, ready in about 20 seconds");
    // F1: the "Still reading" line is the same muted grey as the other metas.
    expect(getComputedStyle(reading).color).toBe("rgb(107, 127, 123)");
    expect(text(q("[data-start-run-reading-note]"))).toBe(
      "Files still being read are used as soon as they are ready. Untick one to start without it."
    );
    expect(rows[0].querySelector("[data-file-icon]")?.getAttribute("data-file-icon")).toBe("docx");
  });

  it("unticking fades the row, changes the count and hides the reading note", async () => {
    await render(StartRunDialog, props());
    q("[data-start-run-check='d2']")!.click();
    await settle(250);
    const row = q("[data-start-run-row='d2']")!;
    expect(row.dataset.ticked).toBe("false");
    // Fades to 55% as on F1 (a short opacity transition runs first).
    await expect.poll(() => getComputedStyle(row.querySelector("[data-start-run-body]")!).opacity).toBe("0.55");
    await expect.poll(() => getComputedStyle(row.querySelector("[data-start-run-chip]")!).opacity).toBe("0.55");
    expect(text(q("[data-start-run-confirm]"))).toBe("Start with 3 files");
    expect(q("[data-start-run-reading-note]")).toBeNull();
  });

  it("returns the unticked files as the leave-out lists", async () => {
    const onConfirm = vi.fn();
    await render(StartRunDialog, props({ onConfirm }));
    q("[data-start-run-check='t2']")!.click();
    q("[data-start-run-check='d1']")!.click();
    await tick();
    q<HTMLButtonElement>("[data-start-run-confirm]")!.click();
    expect(onConfirm).toHaveBeenCalledWith({ transcriptIds: ["t2"], documentIds: ["d1"] });
  });

  it("locks the written PD in a review", async () => {
    const writtenPd: StartRunSource = {
      id: "pd",
      kind: "writtenPd",
      name: "Cedarline cold storage PD, draft v3.docx",
      typeLabel: "Written PD",
      meta: "1,120 words, all 3 sections found",
      locked: true,
    };
    const onConfirm = vi.fn();
    await render(StartRunDialog, props({ mode: "review", sources: [writtenPd, SOURCES[0]], onConfirm }));
    const row = q("[data-start-run-row='pd']")!;
    expect(row.querySelector("[data-start-run-lock]")).not.toBeNull();
    expect(row.querySelector("[data-start-run-check]")).toBeNull();
    expect(text(row.querySelector("[data-start-run-chip]"))).toBe("Being reviewed");
    expect(getComputedStyle(row).height).toBe("56px");
    // Unticking every other file still leaves the draft to review.
    q("[data-start-run-check='t1']")!.click();
    await tick();
    expect(q<HTMLButtonElement>("[data-start-run-confirm]")!.disabled).toBe(false);
    q<HTMLButtonElement>("[data-start-run-confirm]")!.click();
    expect(onConfirm).toHaveBeenCalledWith({ transcriptIds: ["t1"], documentIds: [] });
  });
});

describe("StartRunDialog board values (F1, G1 to G3)", () => {
  it("draws the frame, title, rows, chips and footer at the board sizes", async () => {
    await render(StartRunDialog, props());
    await settle(250);
    const scrim = q("[data-start-run-scrim]")!;
    await expect.poll(() => getComputedStyle(scrim).backgroundColor).toBe("rgba(1, 5, 5, 0.75)");
    const node = dialog()!;
    expect(getComputedStyle(node).boxShadow).toContain("rgba(5, 42, 40, 0.25) 0px 24px 64px");
    expect(getComputedStyle(node).borderRadius).toBe("16px");
    const title = node.querySelector<HTMLElement>("[data-start-run-title]")!;
    expect(getComputedStyle(title).fontSize).toBe("18px");
    expect(getComputedStyle(title).lineHeight).toBe("24px");
    expect(getComputedStyle(title).fontWeight).toBe("500");
    expect(getComputedStyle(title).letterSpacing).toBe("normal");
    // Close: a 32px button with the board's 18px, stroke 2 cross.
    const close = q("[data-start-run-close]")!;
    expect(getComputedStyle(close).width).toBe("32px");
    const cross = close.querySelector("svg")!;
    expect([cross.getAttribute("width"), cross.getAttribute("viewBox"), cross.getAttribute("stroke-width")]).toEqual(["18", "0 0 24 24", "2"]);
    expect(cross.querySelector("path")!.getAttribute("d")).toBe("M18 6 6 18M6 6l12 12");
    const row = q("[data-start-run-row='t1']")!;
    expect(getComputedStyle(row).height).toBe("48px");
    expect(getComputedStyle(row.querySelector("[data-start-run-name]")!).fontSize).toBe("13px");
    const chip = row.querySelector<HTMLElement>("[data-start-run-chip]")!;
    expect(getComputedStyle(chip).fontSize).toBe("11px");
    expect(getComputedStyle(chip).height).toBe("18px");
    expect(getComputedStyle(chip).backgroundColor).toBe("rgb(234, 242, 241)");
    // The tick is the board's 11px, stroke 3.2 check on fir.
    const check = q("[data-start-run-check='t1']")!;
    expect(getComputedStyle(check).backgroundColor).toBe("rgb(10, 58, 56)");
    const tick = check.querySelector("svg")!;
    expect([tick.getAttribute("width"), tick.getAttribute("stroke-width")]).toEqual(["11", "3.2"]);
    expect(tick.querySelector("path")!.getAttribute("d")).toBe("M20 6 9 17l-5-5");
    expect(getComputedStyle(q("[data-start-run-model-title]")!).fontSize).toBe("13px");
    const cancel = q("[data-start-run-cancel]")!;
    expect(getComputedStyle(cancel).height).toBe("36px");
    expect(getComputedStyle(cancel).paddingLeft).toBe("14px");
    expect(getComputedStyle(cancel).borderTopLeftRadius).toBe("8px");
    const confirm = q("[data-start-run-confirm]")!;
    expect(getComputedStyle(confirm).height).toBe("36px");
    expect(getComputedStyle(confirm).paddingLeft).toBe("16px");
  });

  it("marks the draft under review with the G3 chip and lock", async () => {
    const writtenPd: StartRunSource = {
      id: "pd",
      kind: "writtenPd",
      name: "Cedarline cold storage PD, draft v3.docx",
      typeLabel: "Written PD",
      meta: "1,120 words, all 3 sections found",
      locked: true,
    };
    await render(StartRunDialog, props({ mode: "review", sources: [writtenPd, SOURCES[0]] }));
    const row = q("[data-start-run-row='pd']")!;
    const chip = row.querySelector<HTMLElement>("[data-start-run-chip]")!;
    expect(getComputedStyle(chip).backgroundColor).toBe("rgb(225, 242, 239)");
    expect(getComputedStyle(chip).color).toBe("rgb(10, 58, 56)");
    const lock = row.querySelector<HTMLElement>("[data-start-run-lock]")!;
    expect(getComputedStyle(lock).backgroundColor).toBe("rgb(234, 242, 241)");
    const svg = lock.querySelector("svg")!;
    expect([svg.getAttribute("width"), svg.getAttribute("stroke-width"), svg.getAttribute("stroke-linejoin")]).toEqual(["10", "2.6", "round"]);
    expect(svg.querySelector("path")!.getAttribute("d")).toBe(
      "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z M8 11V8a4 4 0 0 1 8 0v3"
    );
  });
});

describe("StartRunDialog blocking", () => {
  it("disables confirm and says why when nothing is left ticked", async () => {
    await render(StartRunDialog, props({ sources: [SOURCES[0]] }));
    q("[data-start-run-check='t1']")!.click();
    await tick();
    const problem = q("[data-start-run-problem]")!;
    expect(text(problem)).toBe("Tick at least one transcript or current file.");
    expect(getComputedStyle(problem).color).toBe("rgb(185, 28, 28)");
    expect(q<HTMLButtonElement>("[data-start-run-confirm]")!.disabled).toBe(true);
  });

  it("runs the caller's rule on the current selection", async () => {
    const validate = vi.fn((excluded: { transcriptIds: string[]; documentIds: string[] }) =>
      excluded.transcriptIds.length === 2 ? "Last year's report alone cannot start a draft." : null
    );
    await render(StartRunDialog, props({ validate }));
    expect(q("[data-start-run-problem]")).toBeNull();
    q("[data-start-run-check='t1']")!.click();
    q("[data-start-run-check='t2']")!.click();
    await tick();
    expect(text(q("[data-start-run-problem]"))).toBe("Last year's report alone cannot start a draft.");
    expect(q<HTMLButtonElement>("[data-start-run-confirm]")!.disabled).toBe(true);
  });

  it("shows an outside blocking message", async () => {
    await render(StartRunDialog, props({ blockingMessage: "Add a client and a title" }));
    expect(text(q("[data-start-run-problem]"))).toBe("Add a client and a title");
    expect(q<HTMLButtonElement>("[data-start-run-confirm]")!.disabled).toBe(true);
  });
});

describe("StartRunDialog footer and keyboard", () => {
  it("styles Cancel as the filled destructive button and the confirm in fir", async () => {
    await render(StartRunDialog, props());
    const cancel = q("[data-start-run-cancel]")!;
    expect(getComputedStyle(cancel).backgroundColor).toBe("rgb(254, 226, 226)");
    expect(getComputedStyle(cancel).color).toBe("rgb(185, 28, 28)");
    expect(getComputedStyle(q("[data-start-run-confirm]")!).backgroundColor).toBe("rgb(10, 58, 56)");
    expect(getComputedStyle(dialog()!).maxWidth).toBe("580px");
  });

  it("Space toggles the focused file, Esc cancels and focus returns to the start button", async () => {
    const start = document.createElement("button");
    start.textContent = "Start step by step";
    document.body.appendChild(start);
    const onCancel = vi.fn();
    await render(StartRunDialog, props({ onCancel, returnFocus: () => start }));
    await settle(50);
    const first = q("[data-start-run-check='t1']")!;
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard(" ");
    await tick();
    expect(q("[data-start-run-row='t1']")!.dataset.ticked).toBe("false");
    await userEvent.keyboard("{Escape}");
    await settle();
    expect(dialog()).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(start);
    start.remove();
  });

  it("Cancel closes without confirming", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await render(StartRunDialog, props({ onConfirm, onCancel }));
    q<HTMLButtonElement>("[data-start-run-cancel]")!.click();
    await settle();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});

describe("readingMeta", () => {
  it("rounds to 5 seconds and falls back when unknown", () => {
    expect(readingMeta(18)).toBe("Still reading, ready in about 20 seconds");
    expect(readingMeta(2)).toBe("Still reading, ready in about 5 seconds");
    expect(readingMeta(null)).toBe("Still reading");
  });
});

describe("StartRunDialog when a run is already going (F6)", () => {
  it("names who started which run and when, and waits for it", async () => {
    const onOpenActiveRun = vi.fn();
    await render(StartRunDialog, props({
      activeRun: { generationId: "g-1", requestedByName: "Larry Moss", isYou: false, candidateMode: "iterative", startedAt: Date.now() - 12 * 60_000 },
      onOpenActiveRun,
    }));
    const box = q("[data-start-run-active] [data-status-callout]")!;
    expect(box.dataset.statusCallout).toBe("warning");
    expect(text(box)).toContain("Larry Moss is already running this project");
    expect(text(box)).toContain("A Step by step run started 12 min ago. One run at a time per project.");
    expect(q<HTMLButtonElement>("[data-start-run-confirm]")!.disabled).toBe(true);
    [...box.querySelectorAll("button")].find((button) => text(button) === "Open it")!.click();
    expect(onOpenActiveRun).toHaveBeenCalledTimes(1);
    [...box.querySelectorAll("button")].find((button) => text(button) === "Close")!.click();
    await settle();
    expect(dialog()).toBeNull();
  });

  it("says You for the writer's own run", async () => {
    await render(StartRunDialog, props({
      activeRun: { generationId: "g-1", requestedByName: "Wendy Park", isYou: true, candidateMode: "single", startedAt: Date.now() },
    }));
    expect(text(q("[data-start-run-active]"))).toContain("You are already running this project");
    expect(text(q("[data-start-run-active]"))).toContain("A Single draft started just now.");
  });
});

describe("activeRunFromError", () => {
  it("reads the GENERATION_ACTIVE details and ignores other errors", async () => {
    const { activeRunFromError } = await import("./StartRunDialog.svelte");
    const error = { data: { code: "GENERATION_ACTIVE", message: "x", generationId: "g-9", requestedByName: "Larry Moss", candidateMode: "compare", startedAt: "1000" } };
    expect(activeRunFromError(error, "Wendy Park")).toEqual({
      generationId: "g-9",
      requestedByName: "Larry Moss",
      isYou: false,
      candidateMode: "compare",
      startedAt: 1000,
    });
    expect(activeRunFromError(error, "Larry Moss")?.isYou).toBe(true);
    expect(activeRunFromError({ data: { code: "INVALID_INPUT" } })).toBeNull();
    expect(activeRunFromError(new Error("boom"))).toBeNull();
  });
});
