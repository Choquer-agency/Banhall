import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import BriefRail from "./BriefRail.svelte";
import type { BriefEntryLike } from "$lib/brief";

/**
 * Story 4 acceptance at the component surface: the inclusion rows and their
 * header, inline edit (Cmd/Ctrl+Enter saves, Esc reverts, unchanged saves
 * nothing), the edited origin chip and "Regenerate with this Brief", the
 * Storyline question's two actions, the no-profile line and the save offer,
 * the Inputs band before any Brief exists, and the weight/target audit.
 */
const STORYLINE = "The team pursued a custom control loop to stabilize output.";

const entry = (overrides: Partial<BriefEntryLike> = {}): BriefEntryLike => ({
  _id: Math.random().toString(36).slice(2),
  group: "storyline",
  text: "The team pursued a custom control loop.",
  exactExcerpt: "The team built a custom control loop to stabilize output.",
  source: { label: "Interview transcript", kind: "transcript" },
  ...overrides,
});

const brief = (overrides: Record<string, unknown> = {}) => ({
  _id: "brief-1",
  version: 1,
  storylineText: STORYLINE,
  storylineOrigin: "derived" as const,
  editedSinceGeneration: false,
  entries: [
    entry({}),
    entry({ group: "claimExclusion", text: "Logo redesign is out of scope.", reason: "business_risk" }),
    entry({ group: "confidenceMap", text: "Response time is unresolved.", confidence: "unresolved" }),
    entry({ group: "glossaryTerm", text: "control loop" }),
  ],
  ...overrides,
});

/** 1 Transcript + 40 documents, 12 of them in context under cap 12. */
const inclusion40 = () => ({
  cap: 12,
  documentsInContext: 12,
  documentsTotal: 40,
  rows: [
    { key: "source:t1", kind: "transcript" as const, label: "Interview transcript", inclusion: "included" as const },
    ...Array.from({ length: 40 }, (_, index) => ({
      key: `source:d${index}`,
      kind: "document" as const,
      label: `attachment-${index}.txt`,
      inclusion: (index < 12 ? "included" : "not_included") as "included" | "not_included",
    })),
    // A row whose status was never recorded: no status word, never "included".
    {
      key: "source:unrecorded",
      kind: "document" as const,
      label: "unrecorded.txt",
      inclusion: null,
    },
  ],
});

function props(overrides: Record<string, unknown> = {}) {
  return {
    brief: brief(),
    inclusion: inclusion40(),
    writerSettings: { noProfileLine: null, offer: null },
    generationId: "gen-1",
    canEdit: true,
    offerDismissed: false,
    onSaveEntry: vi.fn(async () => true),
    onSaveStoryline: vi.fn(async () => true),
    onResolveQuestion: vi.fn(),
    onDismissOffer: vi.fn(),
    saveError: null,
    ...overrides,
  };
}

const storylineField = () => page.getByRole("button", { name: /^Storyline: / });

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("BriefRail", () => {
  it("labels the generation Brief and defers newer edits while the generation is active", async () => {
    const { container } = await render(BriefRail, props({
      brief: brief({
        editedSinceGeneration: true,
        version: 4,
        runBriefVersion: 3,
        appliesToNextGeneration: true,
        regenerationDisabled: true,
      }),
      onRegenerate: vi.fn(),
    }));

    expect(container.textContent).toContain("This generation uses Brief v3.");
    expect(container.textContent).toContain("Displayed Brief: v4.");
    expect(container.textContent).toContain("Your newer Brief edits apply to the next generation.");
    await expect.element(page.getByRole("button", { name: "Regenerate with this Brief", exact: true })).toBeDisabled();
    expect(container.textContent).toContain("Available after the active generation finishes.");
  });

  it("lists every document with exactly one status and the counted header", async () => {
    const { container } = await render(BriefRail, props());

    expect(container.textContent).toContain("12 of 40 documents in context, cap 12");
    const statuses = [...container.querySelectorAll("[data-inclusion]")];
    // The Transcript plus the 40 recorded documents, one status word each;
    // the unrecorded row carries none.
    expect(statuses).toHaveLength(41);
    const unrecorded = [...container.querySelectorAll("li")].find((row) =>
      row.textContent?.includes("unrecorded.txt")
    );
    expect(unrecorded).toBeDefined();
    expect(unrecorded!.querySelector("[data-inclusion]")).toBeNull();
    expect(unrecorded!.textContent).not.toContain("included");
    const words = statuses.map((element) => element.textContent?.trim());
    expect(words.filter((word) => word === "included")).toHaveLength(13);
    expect(words.filter((word) => word === "not included")).toHaveLength(28);
    // No not-included document is ever described as included.
    for (const element of statuses) {
      if (element.getAttribute("data-inclusion") === "not_included") {
        expect(element.textContent?.trim()).toBe("not included");
      }
    }
  });

  it("qualifies the header and adds a note when the document listing was cut short (DW-133)", async () => {
    const { container } = await render(
      BriefRail,
      props({ inclusion: { ...inclusion40(), documentsTruncated: true } })
    );
    expect(container.textContent).toContain("12 of 40+ documents in context, cap 12");
    const note = container.querySelector("[data-inclusion-truncated]");
    expect(note?.getAttribute("data-inclusion-truncated")).toBe("documents");
    expect(note?.textContent?.trim()).toBe(
      "Not every document could be listed. The total is a lower bound."
    );

    // A complete listing carries neither the qualifier nor the note.
    document.body.innerHTML = "";
    const complete = await render(BriefRail, props());
    expect(complete.container.textContent).toContain("12 of 40 documents in context, cap 12");
    expect(complete.container.textContent).not.toContain("40+");
    expect(complete.container.querySelector("[data-inclusion-truncated]")).toBeNull();
  });

  it("discloses cut-short frozen sources: both counts qualified and the note names transcripts (DW-133 review 2)", async () => {
    await page.viewport(480, 420);
    // One transcript listed of several frozen, three included documents of an
    // unknown frozen total: neither count is exact. Short on purpose so the
    // note sits inside the capture.
    const partial = {
      cap: 12,
      documentsInContext: 3,
      documentsTotal: 3,
      documentsTruncated: true,
      sourcesTruncated: true,
      rows: [
        { key: "source:t1", kind: "transcript" as const, label: "Interview transcript", inclusion: "included" as const },
        ...Array.from({ length: 3 }, (_, index) => ({
          key: `source:d${index}`,
          kind: "document" as const,
          label: `attachment-${index}.txt`,
          inclusion: "included" as const,
        })),
      ],
    };
    const { container } = await render(BriefRail, props({ inclusion: partial }));
    // Captured before the assertions so the pre-fix run records the old band.
    await page.screenshot({
      path: "../../../../.vitest-attachments/DW-133-review-2/brief-rail-sources-truncated.png",
    });
    expect(container.textContent).toContain("3+ of 3+ documents in context, cap 12");
    const note = container.querySelector("[data-inclusion-truncated]");
    expect(note?.getAttribute("data-inclusion-truncated")).toBe("sources");
    expect(note?.textContent?.trim()).toBe(
      "Not every transcript or document could be listed. Both counts are lower bounds."
    );
    for (const element of container.querySelectorAll("*")) {
      expect(Number.parseInt(getComputedStyle(element).fontWeight, 10)).toBeLessThanOrEqual(500);
    }

    // A cut-short document walk with a complete frozen set keeps the exact
    // numerator: every included document is a frozen source that was read.
    document.body.innerHTML = "";
    const documentsOnly = await render(
      BriefRail,
      props({ inclusion: { ...inclusion40(), documentsTruncated: true } })
    );
    expect(documentsOnly.container.textContent).toContain("12 of 40+ documents in context, cap 12");
    expect(
      documentsOnly.container.querySelector("[data-inclusion-truncated]")?.getAttribute("data-inclusion-truncated")
    ).toBe("documents");
  });

  it("saves an edit with Ctrl+Enter, reverts on Esc and calls nothing when unchanged", async () => {
    const rail = props();
    await render(BriefRail, rail);

    // Ctrl+Enter saves the verbatim text, once.
    await storylineField().click();
    await userEvent.keyboard(" Proven under load.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(rail.onSaveStoryline).toHaveBeenCalledTimes(1);
    expect(rail.onSaveStoryline).toHaveBeenCalledWith(`${STORYLINE} Proven under load.`);

    // Esc reverts without saving.
    rail.onSaveStoryline.mockClear();
    await storylineField().click();
    await userEvent.keyboard(" Never saved.");
    await userEvent.keyboard("{Escape}");
    expect(rail.onSaveStoryline).not.toHaveBeenCalled();
    await expect.element(storylineField()).toBeInTheDocument();

    // An unchanged blur calls nothing.
    await storylineField().click();
    await userEvent.tab();
    expect(rail.onSaveStoryline).not.toHaveBeenCalled();
  });

  it("saves an entry edit through onSaveEntry with the entry it belongs to", async () => {
    const rail = props();
    await render(BriefRail, rail);
    const claim = page.getByRole("button", { name: /^Storyline claim: / });
    await claim.click();
    await userEvent.keyboard(" Revised.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(rail.onSaveEntry).toHaveBeenCalledTimes(1);
    const [entryArg, text] = rail.onSaveEntry.mock.calls[0] as unknown as [BriefEntryLike, string];
    expect(entryArg.group).toBe("storyline");
    expect(text).toBe("The team pursued a custom control loop. Revised.");
  });

  it("shows the edited origin chip and regenerates from the rail", async () => {
    const onRegenerate = vi.fn();
    const { container } = await render(
      BriefRail,
      props({
        brief: brief({
          editedSinceGeneration: true,
          entries: [entry({ edited: true, text: "The writer's corrected claim." })],
        }),
        onRegenerate,
      })
    );
    expect(container.textContent).toContain("edited");
    const regenerate = page.getByRole("button", { name: "Regenerate with this Brief" });
    await regenerate.click();
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("hides the regenerate action until the Brief is edited", async () => {
    await render(BriefRail, props({ onRegenerate: vi.fn() }));
    expect(page.getByRole("button", { name: "Regenerate with this Brief" }).elements()).toHaveLength(0);
  });

  it("resolves a Storyline question with either side", async () => {
    const question = entry({
      group: "storylineQuestion",
      text: "Section 244 shows the loop failed under load.",
      question: { questionText: "Does the section's evidence override the Storyline?" },
    });
    const rail = props({ brief: brief({ entries: [question] }) });
    const { container } = await render(BriefRail, rail);
    expect(container.textContent).toContain("Does the section's evidence override the Storyline?");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Storyline question raised"
    );

    await page.getByRole("button", { name: "Use the section's evidence" }).click();
    expect(rail.onResolveQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ _id: question._id }),
      "use_evidence"
    );
    await page.getByRole("button", { name: "Keep the Storyline" }).click();
    expect(rail.onResolveQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ _id: question._id }),
      "keep_storyline"
    );
  });

  it("does not offer a clipped alternative as the Storyline, and still offers Keep", async () => {
    const question = entry({
      group: "storylineQuestion",
      text: "Section 244 shows the loop failed under load.",
      question: {
        questionText: "Does the section's evidence override the Storyline?",
        alternativeText: "The team discovered the loop's response under load was unknown, so the…",
      },
    });
    const rail = props({ brief: brief({ entries: [question] }) });
    const { container } = await render(BriefRail, rail);
    expect(page.getByRole("button", { name: "Use the section's evidence" }).elements()).toHaveLength(0);
    expect(container.querySelector("[data-question-alternative-clipped]")?.textContent).toContain(
      "The suggested new Storyline was cut short, so it can't replace yours."
    );
    await page.getByRole("button", { name: "Keep the Storyline" }).click();
    expect(rail.onResolveQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ _id: question._id }),
      "keep_storyline"
    );
  });

  it("offers a longer alternative that happens to end in an ellipsis", async () => {
    const question = entry({
      group: "storylineQuestion",
      text: "Section 244 shows the loop failed under load.",
      question: {
        questionText: "Does the section's evidence override the Storyline?",
        alternativeText:
          "The team discovered the loop's response under load was unknown, and measured it across three load bands…",
      },
    });
    const { container } = await render(BriefRail, props({ brief: brief({ entries: [question] }) }));
    expect(page.getByRole("button", { name: "Use the section's evidence" }).elements()).toHaveLength(1);
    expect(container.querySelector("[data-question-alternative-clipped]")).toBeNull();
  });

  it("shows the no-profile line and the save offer, and dismisses the offer", async () => {
    const rail = props({
      writerSettings: {
        noProfileLine: "No Writer Profile applied — House Rules in full.",
        offer: { supplyPath: "writer_notes", fileName: "settings.md" },
      },
    });
    const { container } = await render(BriefRail, rail);
    expect(container.textContent).toContain("No Writer Profile applied — House Rules in full.");
    expect(container.textContent).toContain(
      "Your customized settings were found in Writer's Notes. Save to your Writer Profile?"
    );
    const link = container.querySelector<HTMLAnchorElement>('a[href*="fromGeneration"]');
    expect(link?.getAttribute("href")).toBe("/settings/writing?fromGeneration=gen-1");
    await page.getByRole("button", { name: "Dismiss the Writer Profile offer" }).click();
    expect(rail.onDismissOffer).toHaveBeenCalledTimes(1);
  });

  it("shows the Inputs band before any Brief exists, with no Brief groups", async () => {
    const { container } = await render(BriefRail, props({ brief: null }));
    expect(container.textContent).toContain("12 of 40 documents in context, cap 12");
    expect(container.querySelectorAll("[data-inclusion]").length).toBe(41);
    expect(container.textContent).toContain("unrecorded.txt");
    expect(page.getByRole("button", { name: /Storyline/ }).elements()).toHaveLength(0);
  });

  it("is read-only without edit capability, and shows a stale save message", async () => {
    const { container } = await render(
      BriefRail,
      props({
        canEdit: false,
        saveError: "The Brief changed while you were editing. Your edit was not saved.",
      })
    );
    expect(storylineField().elements()).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The Brief changed while you were editing. Your edit was not saved."
    );
  });

  it("keeps every weight at 500 or below, every target at 44px, and never says approve", async () => {
    const question = entry({
      group: "storylineQuestion",
      text: "Section 244 shows the loop failed under load.",
      question: { questionText: "Does the evidence override the Storyline?" },
    });
    const { container } = await render(
      BriefRail,
      props({
        brief: brief({ editedSinceGeneration: true, entries: [...brief().entries, question] }),
        writerSettings: {
          noProfileLine: "No Writer Profile applied — House Rules in full.",
          offer: { supplyPath: "attachment", fileName: "settings.md" },
        },
        onRegenerate: vi.fn(),
      })
    );

    for (const element of container.querySelectorAll("*")) {
      const weight = Number.parseInt(getComputedStyle(element).fontWeight, 10);
      expect(weight, element.tagName + " " + element.className).toBeLessThanOrEqual(500);
    }
    for (const target of container.querySelectorAll<HTMLElement>("button, a[href]")) {
      expect(
        target.getBoundingClientRect().height,
        target.textContent?.trim() || target.getAttribute("aria-label") || ""
      ).toBeGreaterThanOrEqual(44);
    }
    for (const target of container.querySelectorAll("button")) {
      expect(target.textContent ?? "").not.toMatch(/approve|accept|confirm/i);
    }
  });
});
