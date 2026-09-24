import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Rollback-purity sentinel for the /project/[id] two-cohort boundary.
 *
 * `CurrentProjectPage.svelte` is the frozen rollback surface for the report
 * route; `PreviewProjectPage.svelte` is the Obvious-inspired preview
 * workbench. ~1.6k lines are intentionally duplicated between them, so no
 * type check or behavioral test notices a preview feature leaking into the
 * current file (or the files being swapped). This test pins the boundary at
 * the source level:
 *
 * - The four preview-only markers (verified by diffing the two files on
 *   2026-08-06) must NEVER appear in the current file and must ALL appear in
 *   the preview file.
 * - Both files must contain stable shared report anchors, so gutting or
 *   swapping either file fails loudly instead of passing vacuously.
 *
 * If a legitimate preview refactor renames one of these markers, this test
 * failing is the desired behavior: update the marker list consciously, as a
 * boundary-contract change, rather than weakening the assertion.
 */

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

const currentSrc = read("./CurrentProjectPage.svelte");
const previewSrc = read("./PreviewProjectPage.svelte");
const detailsMoreSrc = read("./details/DetailsMore.svelte");

/**
 * Preview-only tokens: assistant full screen, mobile pane switching, the
 * resizable 400px side slot and panel toolbar of the final UI
 * (ui-design-final.md sections 2 and 8), the Details panel, and the cohort
 * marker the route-shape component test keys on. Updated 2026-09-24 when the
 * final shell replaced the left assistant rail (`--assistant-width`,
 * `lg:flex-row-reverse`).
 */
const PREVIEW_ONLY_MARKERS = [
  "chatFocus",
  "mobileWorkspaceView",
  "--side-panel-width",
  "<PanelToolbar",
  "<DetailsPanel",
  'data-report-cohort="preview"',
] as const;

/** Stable anchors from the shared report region — present in both cohorts. */
const SHARED_REPORT_ANCHORS = ["workspaceMaximized", 'aria-label="Resize assistant panel"'] as const;

describe("project page rollback-purity boundary", () => {
  it("keeps every preview-only marker out of CurrentProjectPage.svelte", () => {
    for (const marker of PREVIEW_ONLY_MARKERS) {
      expect(currentSrc, `preview-only marker "${marker}" leaked into CurrentProjectPage.svelte`).not.toContain(
        marker
      );
    }
  });

  it("keeps every preview-only marker present in PreviewProjectPage.svelte", () => {
    for (const marker of PREVIEW_ONLY_MARKERS) {
      expect(previewSrc, `preview marker "${marker}" vanished from PreviewProjectPage.svelte`).toContain(marker);
    }
  });

  it("switches the report between the 660px reading column and full width", () => {
    expect(previewSrc).toContain('data-project-workspace class="flex min-h-0 w-full flex-1 flex-col overflow-hidden"');
    expect(previewSrc).toContain('data-report-width={workspaceMaximized ? "full" : "reading"}');
    expect(previewSrc).toContain('"mx-auto max-w-[708px] px-6"');
    expect(previewSrc).toContain('sidePanelOpen ? "px-6 lg:px-12" : "px-6 lg:px-24"');
    expect(previewSrc).toContain("min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto");
  });

  it("keeps project metadata in the Details panel instead of an inline disclosure", () => {
    expect(previewSrc).toContain("<DetailsMore");
    expect(previewSrc).not.toContain("data-project-details-toggle");
    expect(previewSrc).not.toContain("projectDetailsOpen");
  });

  it("keeps workflow editing in the Details panel instead of a header popover", () => {
    expect(previewSrc).not.toContain("<ProjectWorkflowMenu");
    expect(previewSrc).not.toContain("<ProjectHighlights");
  });

  it("presents project type as immutable project identity", () => {
    expect(detailsMoreSrc).toContain("PROJECT_TYPE_LABELS[effectiveProjectType(project)]");
    for (const src of [previewSrc, detailsMoreSrc]) {
      expect(src).not.toContain("api.projects.setProjectType");
      expect(src).not.toContain('ariaLabel="Project type"');
    }
  });

  it("finds the shared report anchors in both files (guards against file swap/gutting)", () => {
    for (const anchor of SHARED_REPORT_ANCHORS) {
      expect(currentSrc, `shared anchor "${anchor}" missing from CurrentProjectPage.svelte`).toContain(anchor);
      expect(previewSrc, `shared anchor "${anchor}" missing from PreviewProjectPage.svelte`).toContain(anchor);
    }
  });
});
