import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import BriefRailPanel from "./BriefRailPanel.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Story 4 container: the three reads, the one writer (always fenced with the
 * Brief's version), the stale copy, the offer's per-project dismissal, and
 * the rail versus inline chrome.
 */
const generationId = "generation-1" as Id<"generations">;
const projectId = "project-1" as Id<"projects">;
const STORYLINE = "The team pursued a custom control loop.";

const storedBrief = (overrides: Record<string, unknown> = {}) => ({
  _id: "brief-1",
  version: 3,
  storylineText: STORYLINE,
  storylineOrigin: "derived",
  editedSinceGeneration: false,
  canEdit: true,
  entries: [
    {
      _id: "entry-1",
      group: "storyline",
      text: "A cited claim.",
      exactExcerpt: "A cited claim in the transcript.",
      source: { label: "Interview transcript", kind: "transcript" },
    },
  ],
  ...overrides,
});

const recordedInclusion = {
  recorded: true,
  cap: 12,
  documentsInContext: 1,
  documentsTotal: 2,
  rows: [
    { key: "source:t1", kind: "transcript", label: "Interview transcript", inclusion: "condensed" },
    { key: "source:d1", kind: "document", label: "specs.pdf", inclusion: "included" },
    { key: "source:d2", kind: "document", label: "old.pdf", inclusion: "not_included", reason: "archived" },
  ],
};

const storylineField = () => page.getByRole("button", { name: /^Storyline: / });

beforeEach(() => {
  __resetConvexStub();
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("BriefRailPanel", () => {
  it("renders nothing when all three reads come back empty (a legacy generation)", async () => {
    __setQueryData("briefs:getBrief", null);
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", {
      recorded: false,
      cap: 12,
      documentsInContext: 0,
      documentsTotal: 1,
      rows: [{ key: "source:d1", kind: "document", label: "legacy.txt", inclusion: null }],
    });
    const { container } = await render(BriefRailPanel, { generationId, projectId });
    expect(container.querySelector("aside")).toBeNull();
    expect(container.textContent?.trim()).toBe("");
  });

  it("shows the Inputs band while a generation runs, before any Brief exists", async () => {
    __setQueryData("briefs:getBrief", null);
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", recordedInclusion);
    const { container } = await render(BriefRailPanel, { generationId, projectId });
    expect(container.querySelector("aside")?.getAttribute("aria-label")).toBe("Brief");
    expect(container.textContent).toContain("1 of 2 documents in context · cap 12");
    expect(container.textContent).toContain("not included · archived");
    // The inline placement has no close button.
    expect(page.getByRole("button", { name: "Close Brief" }).elements()).toHaveLength(0);
  });

  it("saves an edit through saveEntryEdit with the project, Brief and version fence", async () => {
    __setQueryData("briefs:getBrief", storedBrief());
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", recordedInclusion);
    await render(BriefRailPanel, { generationId, projectId });

    await storylineField().click();
    await userEvent.keyboard(" Now proven.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(__mutationCalls("briefs:saveEntryEdit")).toEqual([
      {
        projectId,
        briefId: "brief-1",
        expectedBriefVersion: 3,
        editedStorylineText: `${STORYLINE} Now proven.`,
      },
    ]);

    // Resolving a question rides the same fenced writer.
    __setQueryData(
      "briefs:getBrief",
      storedBrief({
        entries: [
          {
            _id: "question-1",
            group: "storylineQuestion",
            text: "The section's evidence.",
            exactExcerpt: "evidence",
            source: { label: "Interview transcript", kind: "transcript" },
            question: { questionText: "Which one?" },
          },
        ],
      })
    );
    await page.getByRole("button", { name: "Use the section's evidence" }).click();
    expect(__mutationCalls("briefs:saveEntryEdit")[1]).toEqual({
      projectId,
      briefId: "brief-1",
      expectedBriefVersion: 3,
      entryId: "question-1",
      resolvedBy: "use_evidence",
    });
  });

  it("pins the Brief version when a field opens, so a concurrent edit landing mid-edit is not silently adopted", async () => {
    __setQueryData("briefs:getBrief", storedBrief());
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", recordedInclusion);
    await render(BriefRailPanel, { generationId, projectId });

    await storylineField().click();
    await userEvent.keyboard(" Draft in progress.");

    // Another writer's edit lands while this field is still open: the live
    // query now serves a newer version.
    __setQueryData(
      "briefs:getBrief",
      storedBrief({ _id: "brief-2", version: 4, storylineText: "Someone else's edit." })
    );

    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    // The save is fenced against the version this edit began on, never the
    // version that landed underneath it while the field was open.
    expect(__mutationCalls("briefs:saveEntryEdit")).toEqual([
      {
        projectId,
        briefId: "brief-1",
        expectedBriefVersion: 3,
        editedStorylineText: `${STORYLINE} Draft in progress.`,
      },
    ]);
  });

  it("maps BRIEF_STALE to the stale copy and keeps the draft", async () => {
    __setQueryData("briefs:getBrief", storedBrief());
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", recordedInclusion);
    __setMutationError("briefs:saveEntryEdit", { data: { code: "BRIEF_STALE" } });
    const { container } = await render(BriefRailPanel, { generationId, projectId });

    await storylineField().click();
    await userEvent.keyboard(" Lost to a newer version.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    await expect
      .poll(() => container.querySelector('[role="alert"]')?.textContent?.trim())
      .toContain("The Brief changed while you were editing. Your edit was not saved.");
    const field = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(field?.value).toBe(`${STORYLINE} Lost to a newer version.`);
  });

  it("dismisses the settings offer for this project and remembers it", async () => {
    __setQueryData("briefs:getBrief", null);
    __setQueryData("generations:getContextInclusion", recordedInclusion);
    __setQueryData("writerProfiles:getGenerationWriterSettings", {
      noProfileLine: null,
      offer: { supplyPath: "attachment", fileName: "settings.md" },
    });
    const first = await render(BriefRailPanel, { generationId, projectId });
    expect(first.container.textContent).toContain("Save to your Writer Profile");
    await page.getByRole("button", { name: "Dismiss the Writer Profile offer" }).click();
    await expect
      .poll(() => localStorage.getItem(`banhall_brief_offer_dismissed:${projectId}`))
      .toBe("1");
    expect(first.container.textContent).not.toContain("Save to your Writer Profile");

    document.body.innerHTML = "";
    const second = await render(BriefRailPanel, { generationId, projectId });
    expect(second.container.textContent).not.toContain("Save to your Writer Profile");
  });

  it("stays absent when only an archived document is listed for a legacy generation", async () => {
    __setQueryData("briefs:getBrief", null);
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    // A synthesized row carries a status but the generation recorded nothing.
    __setQueryData("generations:getContextInclusion", {
      recorded: false,
      cap: 12,
      documentsInContext: 0,
      documentsTotal: 1,
      rows: [
        { key: "document:p1", kind: "document", label: "old.pdf", inclusion: "not_included", reason: "archived" },
      ],
    });
    const { container } = await render(BriefRailPanel, { generationId, projectId });
    expect(container.querySelector("aside")).toBeNull();
  });

  it("clears a stale save message once the writer abandons the edit", async () => {
    __setQueryData("briefs:getBrief", storedBrief());
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", recordedInclusion);
    __setMutationError("briefs:saveEntryEdit", { data: { code: "BRIEF_STALE" } });
    const { container } = await render(BriefRailPanel, { generationId, projectId });

    await storylineField().click();
    await userEvent.keyboard(" Lost.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect.poll(() => container.querySelector('[role="alert"]')).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps the rail chrome at 500 weight and 44px targets", async () => {
    __setQueryData("briefs:getBrief", storedBrief());
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", recordedInclusion);
    const { container } = await render(BriefRailPanel, {
      generationId,
      projectId,
      mode: "rail",
      open: true,
      onClose: vi.fn(),
    });
    for (const element of container.querySelectorAll("*")) {
      const weight = Number.parseInt(getComputedStyle(element).fontWeight, 10);
      expect(weight, `${element.tagName} ${element.className}`).toBeLessThanOrEqual(500);
    }
    for (const target of container.querySelectorAll<HTMLElement>("button, a[href]")) {
      expect(
        target.getBoundingClientRect().height,
        target.textContent?.trim() || target.getAttribute("aria-label") || ""
      ).toBeGreaterThanOrEqual(44);
    }
  });

  it("wears the rail card chrome with a close button in rail mode", async () => {
    const onClose = vi.fn();
    __setQueryData("briefs:getBrief", storedBrief());
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", recordedInclusion);
    const { container } = await render(BriefRailPanel, {
      generationId,
      projectId,
      mode: "rail",
      open: true,
      onClose,
    });
    expect(container.querySelector(".chat-rise")).not.toBeNull();
    const close = page.getByRole("button", { name: "Close Brief" });
    expect(close.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
