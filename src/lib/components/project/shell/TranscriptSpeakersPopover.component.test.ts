import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TranscriptSpeakersPopover from "./TranscriptSpeakersPopover.svelte";

/**
 * Speakers chip and popover (2026-09-24; owner decisions 24 and 25): one row
 * per speaker with a verbatim sample line and a role select; "Needs a check"
 * in gray until a consultant confirms.
 */
const speakers = [
  {
    label: "Dana Whitfield",
    role: "interviewer" as const,
    roleSource: "heuristic" as const,
    turnCount: 12,
    sample: "What made that hard? Couldn't you just use standard grid controls?",
  },
  {
    label: "Priya Shah",
    role: "unknown" as const,
    roleSource: "heuristic" as const,
    turnCount: 11,
    sample: "We could not forecast net load fast enough when cloud cover changed.",
  },
];

const chip = () => document.querySelector<HTMLElement>('[data-speakers-chip="t1"]');

describe("TranscriptSpeakersPopover", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await page.viewport(1280, 800);
  });

  it("shows no chip for a transcript that names no speakers", async () => {
    await render(TranscriptSpeakersPopover, { transcriptId: "t1", transcriptLabel: "Notes", status: "unchecked" });
    expect(chip()).toBeNull();
  });

  it("marks a transcript that needs a check in gray, regular weight", async () => {
    await render(TranscriptSpeakersPopover, {
      transcriptId: "t1",
      transcriptLabel: "Helios kickoff",
      status: "needs_check",
      speakers,
    });
    const note = document.querySelector<HTMLElement>("[data-speakers-needs-check]")!;
    expect(note.textContent).toBe("Needs a check");
    expect(note.className).toContain("text-ink-muted");
    expect(Number(getComputedStyle(note).fontWeight)).toBeLessThanOrEqual(500);
    expect(chip()?.getAttribute("aria-label")).toBe("Speakers in Helios kickoff, needs a check");
  });

  it("lists each speaker with a sample line and sets a role from the select", async () => {
    const onOpenChange = vi.fn();
    const onSetRole = vi.fn();
    await render(TranscriptSpeakersPopover, {
      transcriptId: "t1",
      transcriptLabel: "Helios kickoff",
      status: "needs_check",
      speakers,
      onOpenChange,
      onSetRole,
    });
    await userEvent.click(chip()!);
    await vi.waitFor(() => expect(document.querySelector('[data-speakers-popover="t1"]')).not.toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    const rows = [...document.querySelectorAll("[data-speaker-row]")];
    expect(rows.map((row) => row.getAttribute("data-speaker-row"))).toEqual(["Dana Whitfield", "Priya Shah"]);
    expect(rows[1].textContent).toContain("We could not forecast net load");
    const priyaRole = document.querySelector<HTMLElement>('[data-speaker-role="Priya Shah"]')!;
    expect(priyaRole.textContent?.trim()).toBe("Choose a role");
    expect(document.querySelector('[data-speaker-role="Dana Whitfield"]')?.textContent?.trim()).toBe("Interviewer");

    await userEvent.click(priyaRole);
    await vi.waitFor(() => expect(document.querySelector('[data-speaker-role-option="client"]')).not.toBeNull());
    await userEvent.click(document.querySelector<HTMLElement>('[data-speaker-role-option="client"]')!);
    expect(onSetRole).toHaveBeenCalledWith("Priya Shah", "client");
    // The popover stays open for the next speaker.
    expect(document.querySelector('[data-speakers-popover="t1"]')).not.toBeNull();
  });

  it("confirms the roles as they stand with Looks right", async () => {
    const onConfirm = vi.fn();
    await render(TranscriptSpeakersPopover, {
      transcriptId: "t1",
      transcriptLabel: "Helios kickoff",
      status: "needs_check",
      speakers,
      onConfirm,
    });
    await userEvent.click(chip()!);
    await vi.waitFor(() => expect(document.querySelector("[data-speakers-confirm]")).not.toBeNull());
    await userEvent.click(document.querySelector<HTMLElement>("[data-speakers-confirm]")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("drops the check note and the confirm button once confirmed", async () => {
    await render(TranscriptSpeakersPopover, {
      transcriptId: "t1",
      transcriptLabel: "Helios kickoff",
      status: "confirmed",
      speakers: speakers.map((row) => ({ ...row, roleSource: "consultant" as const })),
    });
    expect(document.querySelector("[data-speakers-needs-check]")).toBeNull();
    await userEvent.click(chip()!);
    await vi.waitFor(() => expect(document.querySelector('[data-speakers-popover="t1"]')).not.toBeNull());
    expect(document.querySelector("[data-speakers-confirm]")).toBeNull();
  });
});
