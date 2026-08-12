import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsBoard from "./ProjectsBoard.svelte";
import type { ProjectsTableRow } from "./ProjectsTable.svelte";
import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
import { WORKFLOW_STAGE_PIPELINE_ORDER } from "../../../../shared/workflowStages";

function row(overrides: Partial<ProjectsTableRow> & { id: string }): ProjectsTableRow {
  return {
    title: `Project ${overrides.id}`,
    clientName: "Northline Labs",
    workflowStage: "drafting",
    legacyStatus: "draft",
    owner: { kind: "canonical", label: "Olivia Owner" },
    generationActivity: null,
    updatedDate: "Jul 29, 2026",
    ...overrides,
  };
}

/**
 * Geometry/scroll assertions run in real Chromium (vitest browser mode), so
 * the board is mounted inside a fixed-height flex harness that stands in for
 * the viewport-bounded workspace `main` (WorkspaceDashboard owns h-dvh; the
 * board only needs a definite flex parent).
 */
async function mountBoard(
  props: {
    rows: ProjectsTableRow[];
    stageCounts?: Record<string, number>;
    countsApproximate?: boolean;
    hideEmpty?: boolean;
    newProjectClientName?: string | null;
    showCardClient?: boolean;
  },
  { width = 1280, height = 800, harnessHeight = 700 } = {}
) {
  await page.viewport(width, height);
  const screen = await render(ProjectsBoard, props);
  screen.container.style.cssText = `display:flex;flex-direction:column;height:${harnessHeight}px;overflow:hidden;`;
  const region = document.querySelector<HTMLElement>('[role="region"][aria-label^="Projects board"]');
  if (!region) throw new Error("board region not rendered");
  return { screen, region };
}

function columnSections(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('section[aria-labelledby^="project-board-"]'));
}

function columnBody(stageId: string): HTMLElement {
  const body = document
    .querySelector(`section[aria-labelledby="project-board-${stageId}"]`)
    ?.querySelector<HTMLElement>('[class*="overflow-y-auto"]');
  if (!body) throw new Error(`column body for ${stageId} not rendered`);
  return body;
}

describe("ProjectsBoard", () => {
  it("renders the canonical stage columns in pipeline order plus the qualified Legacy column with truthful counts", async () => {
    const stageCounts = Object.fromEntries([
      ...WORKFLOW_STAGE_PIPELINE_ORDER.map((stage, index) => [stage, index + 1]),
      ["legacy", 3],
    ]);
    await mountBoard({
      rows: [row({ id: "p1" }), row({ id: "p2", workflowStage: undefined, legacyStatus: "review" })],
      stageCounts,
      countsApproximate: true,
    });

    const ids = columnSections().map((section) => section.getAttribute("aria-labelledby"));
    expect(ids).toEqual([
      ...WORKFLOW_STAGE_PIPELINE_ORDER.map((stage) => `project-board-${stage}`),
      "project-board-legacy",
    ]);
    for (const stage of WORKFLOW_STAGE_PIPELINE_ORDER) {
      const header = document.getElementById(`project-board-${stage}`);
      expect(header?.textContent).toContain(WORKFLOW_STAGE_LABELS[stage]);
    }
    expect(document.getElementById("project-board-legacy")?.textContent).toContain("Legacy status");
    // Approximate counts stay qualified with a plus, never presented as exact.
    expect(
      document.querySelector('section[aria-labelledby="project-board-legacy"] header')?.textContent
    ).toContain("3+");
  });

  it("renders all ten canonical stages full-width at zero count by default, header-only — no empty-state body box", async () => {
    await mountBoard({ rows: [], stageCounts: {} });

    const ids = columnSections().map((section) => section.getAttribute("aria-labelledby"));
    expect(ids).toEqual(WORKFLOW_STAGE_PIPELINE_ORDER.map((stage) => `project-board-${stage}`));
    expect(WORKFLOW_STAGE_PIPELINE_ORDER).toHaveLength(10);
    // Legacy is the compatibility column: never advertised when empty.
    expect(document.getElementById("project-board-legacy")).toBeNull();

    for (const section of columnSections()) {
      // Zero-count lanes render full width — never collapsed rails.
      expect(section.offsetWidth).toBe(320);
      // 2026-08-06 second amendment: the bounded-scan truth lives in the
      // HEADER; the body carries no empty-state box, message, or dashed well.
      expect(section.textContent).not.toContain("No loaded projects in this stage.");
      expect(section.querySelector(".border-dashed")).toBeNull();
      expect(section.querySelector("header")?.textContent).toContain("0");
    }
    // Only intake closes with the creation footer; other columns end bare.
    const footers = document.querySelectorAll("[data-intake-new-project]");
    expect(footers).toHaveLength(1);
    expect(
      document.querySelector('section[aria-labelledby="project-board-intake"] [data-intake-new-project]')
    ).not.toBeNull();
  });

  it("uses same-tone column material: canvas fill, structural radius, no well tint, no border, no shadow", async () => {
    const { region } = await mountBoard({ rows: [row({ id: "p1" })], stageCounts: { drafting: 1 } });

    const regionFill = getComputedStyle(region).backgroundColor;
    for (const section of columnSections()) {
      // Column fill equals the canvas plane (live Obvious measurement:
      // rgb(28,28,28) on rgb(28,28,28)) — same-tone, not a lighter well.
      expect(section.className).not.toContain("bg-white/[0.02]");
      expect(getComputedStyle(section).backgroundColor).toBe(regionFill);
      // Structural radius retained; no border, no shadow.
      expect(section.className).toContain("rounded-xl");
      const style = getComputedStyle(section);
      expect(style.borderStyle).toBe("none");
      expect(style.boxShadow).toMatch(/^none$|^(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+$/);
      expect(section.className).not.toMatch(/bg-(blue|amber|purple|primary)/);
    }
    // The card mirrors Obvious's tinted-shell anatomy (full-markup evidence
    // 2026-08-10): column-colour shell around a white inset panel.
    const article = document.querySelector<HTMLElement>("article");
    expect(article?.className).toContain("bg-blue-50/70");
    expect(article?.querySelector<HTMLElement>("[data-card-content] > div")?.className).toContain("bg-surface");
  });

  it("offers + Add new navigation in every column while creation remains Intake-governed", async () => {
    await mountBoard({ rows: [row({ id: "p1", workflowStage: "intake" })] });
    const footers = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("[data-add-new-project]")
    );
    expect(footers).toHaveLength(WORKFLOW_STAGE_PIPELINE_ORDER.length);
    for (const footer of footers) {
      expect(footer.getAttribute("href")).toBe("/project/new");
      expect(footer.textContent).toContain("Add new");
      expect(footer.getAttribute("aria-label")).toContain("New projects begin in Intake");
      expect(footer.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }

    document.body.innerHTML = "";
    // Client-scoped boards (the per-client lane boards, 2026-08-12) carry
    // the recorded-name prefill on every creation footer — the wizard's own
    // `?client=` param, unrelated to the retired board focus param.
    await mountBoard({
      rows: [row({ id: "p2", workflowStage: "intake" })],
      newProjectClientName: "Acme & Co",
    });
    const scoped = document.querySelector<HTMLAnchorElement>('[data-add-new-project="drafting"]');
    expect(scoped?.getAttribute("href")).toBe(`/project/new?client=${encodeURIComponent("Acme & Co")}`);
    expect(scoped?.getAttribute("aria-label")).toContain("Acme & Co");
  });

  it("hide-empty collapses only provably-empty stages with no inline disclosure (2026-08-12 owner direction: the Display menu switch is the only control)", async () => {
    await mountBoard({
      rows: [row({ id: "p1" })],
      stageCounts: { drafting: 1, intake: 2 },
      hideEmpty: true,
    });

    const ids = columnSections().map((section) => section.getAttribute("aria-labelledby"));
    expect(ids).toEqual(["project-board-intake", "project-board-drafting"]);
    expect(document.querySelector("[data-hidden-stages-disclosure]")).toBeNull();
  });

  it("never hides on loaded-rows-zero: without stageCounts the option is inert (fail honest)", async () => {
    await mountBoard({ rows: [row({ id: "p1" })], hideEmpty: true });
    // No count source → all ten canonical stages render, nothing hidden.
    expect(columnSections()).toHaveLength(10);
    expect(document.querySelector("[data-hidden-stages-disclosure]")).toBeNull();
  });

  it("never hides a stage that still has a loaded row even when the count source says zero", async () => {
    await mountBoard({
      rows: [row({ id: "p1" })],
      stageCounts: { intake: 1, drafting: 0 },
      hideEmpty: true,
    });
    expect(
      document.querySelector('section[aria-labelledby="project-board-drafting"]')
    ).not.toBeNull();
  });

  it("shows the Legacy column as soon as legacy rows or counts exist", async () => {
    await mountBoard({ rows: [row({ id: "l1", workflowStage: undefined, legacyStatus: "review" })] });
    const ids = columnSections().map((section) => section.getAttribute("aria-labelledby"));
    expect(ids).toEqual([
      ...WORKFLOW_STAGE_PIPELINE_ORDER.map((stage) => `project-board-${stage}`),
      "project-board-legacy",
    ]);
  });

  it("makes every column header a focusable, truthfully labelled keyboard target", async () => {
    await mountBoard({
      rows: [row({ id: "p1" })],
      stageCounts: { drafting: 12 },
      countsApproximate: true,
    });

    const headers = Array.from(
      document.querySelectorAll<HTMLElement>(
        'section[data-board-column][aria-labelledby^="project-board-"] > header'
      )
    );
    expect(headers).toHaveLength(WORKFLOW_STAGE_PIPELINE_ORDER.length);
    for (const header of headers) {
      expect(header.tabIndex).toBe(0);
      expect(header.getAttribute("aria-label")).toMatch(
        /, \d+\+? projects( — not fully loaded)?$/
      );
    }
    const draftingHeader = document.querySelector<HTMLElement>(
      'section[aria-labelledby="project-board-drafting"] header'
    );
    expect(draftingHeader?.getAttribute("aria-label")).toBe(
      `${WORKFLOW_STAGE_LABELS.drafting}, 12+ projects`
    );
    draftingHeader?.focus();
    expect(document.activeElement).toBe(draftingHeader);
  });

  it("gives keyboard focus the same card affordance as hover (focus-within border affinity)", async () => {
    await mountBoard({ rows: [row({ id: "p1" })] });

    const article = document.querySelector<HTMLElement>("article");
    const anchor = article?.querySelector<HTMLAnchorElement>("a");
    if (!article || !anchor) throw new Error("card not rendered");
    const idleBorder = getComputedStyle(article).borderColor;
    anchor.focus();
    expect(document.activeElement).toBe(anchor);
    // The border transitions; poll until the focus-within colour lands.
    await expect.poll(() => getComputedStyle(article).borderColor).not.toBe(idleBorder);
  });

  it("never renders 0+: an approximate zero shows 0 with the explicit not-fully-loaded note", async () => {
    await mountBoard({ rows: [], stageCounts: {}, countsApproximate: true });
    const intakeHeader = document.querySelector<HTMLElement>(
      'section[aria-labelledby="project-board-intake"] header'
    );
    expect(intakeHeader?.textContent).toContain("0");
    expect(intakeHeader?.textContent).not.toContain("0+");
    // A bounded/approximate zero is not presented as exact emptiness.
    expect(intakeHeader?.querySelector("[data-unverified-count]")?.textContent).toContain(
      "not fully loaded"
    );
    expect(intakeHeader?.getAttribute("aria-label")).toBe(
      `${WORKFLOW_STAGE_LABELS.intake}, 0 projects — not fully loaded`
    );
  });

  it("presents an exact zero as a bare 0 with no qualifier when counts are exact", async () => {
    await mountBoard({ rows: [], stageCounts: {}, countsApproximate: false });
    const intakeHeader = document.querySelector<HTMLElement>(
      'section[aria-labelledby="project-board-intake"] header'
    );
    expect(intakeHeader?.textContent).not.toContain("0+");
    expect(intakeHeader?.querySelector("[data-unverified-count]")).toBeNull();
    expect(intakeHeader?.getAttribute("aria-label")).toBe(
      `${WORKFLOW_STAGE_LABELS.intake}, 0 projects`
    );
  });

  it("stays truthful when facet counts exist but no rows are loaded: qualified header count plus 'none loaded yet'", async () => {
    await mountBoard({ rows: [], stageCounts: { drafting: 12 }, countsApproximate: true });

    const draftingSection = document.querySelector<HTMLElement>(
      'section[aria-labelledby="project-board-drafting"]'
    );
    const headerText = draftingSection?.querySelector("header")?.textContent ?? "";
    expect(headerText).toContain("12+");
    expect(draftingSection?.querySelector("[data-none-loaded]")?.textContent).toContain(
      "none loaded yet"
    );
    // The truth lives in the header — no body copy claims emptiness.
    expect(draftingSection?.textContent).not.toContain("No loaded projects in this stage.");
    // Zero-count siblings carry no disagreement subtext.
    expect(
      document.querySelector('section[aria-labelledby="project-board-intake"] [data-none-loaded]')
    ).toBeNull();
  });

  it("owns horizontal scroll at the region while columns are fixed 320px, 8px apart, equal height, each scrolling independently", async () => {
    const drafting = Array.from({ length: 12 }, (_, index) => row({ id: `d${index}` }));
    const { region } = await mountBoard({
      rows: [...drafting, row({ id: "i1", workflowStage: "intake" })],
    });

    const regionStyle = getComputedStyle(region);
    expect(regionStyle.overflowX).toBe("auto");
    expect(regionStyle.overflowY).toBe("hidden");

    const track = region.firstElementChild as HTMLElement;
    expect(getComputedStyle(track).columnGap).toBe("8px");

    const sections = columnSections();
    expect(sections.length).toBeGreaterThanOrEqual(2);
    for (const section of sections) expect(section.offsetWidth).toBe(320);
    const heights = new Set(sections.map((section) => section.offsetHeight));
    expect(heights.size).toBe(1);

    // Independent per-column vertical scroll: a long column scrolls inside
    // its own body without moving the page or its sibling columns.
    const draftingBody = columnBody("drafting");
    const intakeBody = columnBody("intake");
    expect(draftingBody.scrollHeight).toBeGreaterThan(draftingBody.clientHeight);
    draftingBody.scrollTop = 120;
    expect(draftingBody.scrollTop).toBeGreaterThan(0);
    expect(intakeBody.scrollTop).toBe(0);
    expect(window.scrollY).toBe(0);
  });

  it("keeps board fields truthful: owner ladder, separate activity chip, legacy qualifier", async () => {
    await mountBoard({
      rows: [
        row({ id: "p1" }),
        row({ id: "p2", owner: { kind: "canonical_unresolved" } }),
        row({ id: "p3", owner: { kind: "legacy_writer", label: "Wendy Writer" } }),
        row({ id: "p4", owner: { kind: "none" }, generationActivity: "generating" }),
        row({ id: "p5", workflowStage: undefined, legacyStatus: "review" }),
      ],
    });

    expect(document.body.textContent).toContain("Olivia Owner");
    expect(document.querySelector("[data-owner-unavailable]")?.textContent).toContain("Owner unavailable");
    expect(document.querySelector("[data-owner-legacy-qualifier]")?.textContent).toContain("Writer · legacy");
    // No-owner truth is real text: a visible em-dash plus sr-only copy —
    // never an aria-label on a generic (name-prohibited) span.
    expect(document.querySelector("[data-owner-none]")?.textContent).toContain("none recorded");
    expect(document.querySelector('[data-generation-activity="generating"]')).not.toBeNull();
    expect(document.querySelector("[data-legacy-status-qualifier]")?.textContent).toContain("Legacy status · review");
  });

  it("offers no drag-and-drop or rename; interactions are project and creation links", async () => {
    await mountBoard({ rows: [row({ id: "p1" }), row({ id: "p2", workflowStage: "intake" })] });

    expect(document.querySelector("[draggable]")).toBeNull();
    expect(document.querySelectorAll("button, input, textarea, select, [contenteditable]")).toHaveLength(0);
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
    const creationLinks = links.filter((link) => link.hasAttribute("data-add-new-project"));
    expect(creationLinks).toHaveLength(WORKFLOW_STAGE_PIPELINE_ORDER.length);
    const cardLinks = links.filter(
      (link) => link.getAttribute("href")?.startsWith("/project/") &&
        !link.hasAttribute("data-add-new-project")
    );
    expect(cardLinks).toHaveLength(2);
    expect(creationLinks.every((link) => link.getAttribute("href") === "/project/new")).toBe(true);
  });

  it("gives the visible stage the full board usable width below md — adjacent card bodies masked, deliberate edge cue, whole-card link intact", async () => {
    const { region } = await mountBoard(
      { rows: [row({ id: "p1" }), row({ id: "i1", workflowStage: "intake" })] },
      { width: 390, height: 844, harnessHeight: 700 }
    );

    // 2026-08-07 correction (supersedes the next-lane card-body peek, which
    // live QA read as broken clipping): below `md` the visible stage takes
    // the scrollport's full usable width (100cqw), masking adjacent card
    // bodies; horizontal continuation is carried by the deliberate
    // right-edge fade cue (and, on the focused board, the explicit
    // "Stage N of M" selector).
    const sections = columnSections();
    const regionStyle = getComputedStyle(region);
    const usableWidth =
      region.clientWidth -
      parseFloat(regionStyle.paddingLeft) -
      parseFloat(regionStyle.paddingRight);
    expect(sections[0].getBoundingClientRect().width).toBeCloseTo(usableWidth, 0);
    // The adjacent column starts at or beyond the scrollport's right edge —
    // no repeated clipped card-body shards at rest.
    expect(sections[1].getBoundingClientRect().left).toBeGreaterThanOrEqual(
      region.getBoundingClientRect().right - 1
    );
    // The region remains the horizontal scroll owner (snap unchanged).
    expect(region.scrollWidth).toBeGreaterThan(region.clientWidth);
    // Deliberate continuation cue: decorative right-edge fade over the
    // scrollport (aria-hidden + pointer-events-none — never a hit target).
    const cue = document.querySelector<HTMLElement>("[data-board-edge-cue]");
    expect(cue).not.toBeNull();
    expect(cue?.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(cue!).pointerEvents).toBe("none");

    // Stretched link: the article is ≥44px tall and its center hit-tests to
    // the title anchor, while the anchor's visible box stays the title row.
    // First card in DOM order sits in the intake column (pipeline order),
    // fully visible at rest — a fair mobile tap target.
    const article = document.querySelector<HTMLElement>("article");
    const anchor = article?.querySelector<HTMLAnchorElement>("a");
    if (!article || !anchor) throw new Error("card not rendered");
    const rect = article.getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(hit).toBe(anchor);
    expect(anchor.getBoundingClientRect().height).toBeLessThan(rect.height);
    expect(anchor.textContent).toContain("Project i1");
    expect(anchor.getAttribute("href")).toBe("/project/i1");
  });

  it("keeps fixed 320px columns from md up and drops the card client line only on client-scoped boards (showCardClient)", async () => {
    await mountBoard({ rows: [row({ id: "p1" })] });
    // Default (flat stage-first board): the card is the only client signal.
    expect(document.querySelector("article")?.textContent).toContain("Northline Labs");
    expect(columnSections()[0].offsetWidth).toBe(320);

    document.body.innerHTML = "";
    // Client-scoped boards (per-client lanes) suppress the redundant client
    // line — the section band already names the client. No other card field
    // changes and nothing is invented in its place.
    await mountBoard({ rows: [row({ id: "p2" })], showCardClient: false });
    const article = document.querySelector<HTMLElement>("article");
    expect(article?.textContent).not.toContain("Northline Labs");
    expect(article?.textContent).toContain("Project p2");
    expect(article?.textContent).toContain("Olivia Owner");
  });
});
