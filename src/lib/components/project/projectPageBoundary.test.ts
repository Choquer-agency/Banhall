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

/**
 * Preview-only tokens: chat focus mode, mobile pane switching, resizable
 * assistant rail layout, and the cohort marker the route-shape component
 * test keys on.
 */
const PREVIEW_ONLY_MARKERS = [
  "chatFocus",
  "mobileWorkspaceView",
  "--assistant-width",
  "lg:flex-row-reverse",
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

  it("lets the preview workbench and report surface fill their available width", () => {
    expect(previewSrc).toContain('data-project-workspace class="mx-auto flex min-h-0 w-full max-w-full');
    expect(previewSrc).toContain('data-report-surface class={`w-full max-w-full px-4');
    expect(previewSrc).toContain("min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto");
  });

  it("keeps secondary project metadata behind an accessible disclosure", () => {
    expect(previewSrc).toContain("data-project-details-toggle");
    expect(previewSrc).toContain("aria-expanded={projectDetailsOpen}");
    expect(previewSrc).toContain("<Disclosure id={projectDetailsBodyId} open={projectDetailsOpen}>");
  });

  it("keeps workflow editing in the Stage highlight instead of the project header", () => {
    expect(previewSrc).not.toContain("<ProjectWorkflowMenu");
  });

  it("presents project type as immutable project identity", () => {
    expect(previewSrc).toContain("{PROJECT_TYPE_LABELS[effectiveProjectType(project)]}");
    expect(previewSrc).not.toContain("api.projects.setProjectType");
    expect(previewSrc).not.toContain('ariaLabel="Project type"');
  });

  it("finds the shared report anchors in both files (guards against file swap/gutting)", () => {
    for (const anchor of SHARED_REPORT_ANCHORS) {
      expect(currentSrc, `shared anchor "${anchor}" missing from CurrentProjectPage.svelte`).toContain(anchor);
      expect(previewSrc, `shared anchor "${anchor}" missing from PreviewProjectPage.svelte`).toContain(anchor);
    }
  });
});
