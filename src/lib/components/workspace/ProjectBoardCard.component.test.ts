import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectBoardCard from "./ProjectBoardCard.svelte";
import type { ProjectsTableRow } from "./ProjectsTable.svelte";

function row(overrides: Partial<ProjectsTableRow> = {}): ProjectsTableRow {
  return {
    id: "p1",
    title: "Northline Labs — SR&ED narrative",
    clientName: "Northline Labs",
    workflowStage: "drafting",
    legacyStatus: "draft",
    owner: { kind: "canonical", label: "Olivia Owner" },
    generationActivity: null,
    createdDate: "Mar 10, 2026",
    updatedDate: "Jul 29, 2026",
    ...overrides,
  };
}

describe("ProjectBoardCard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the Obvious tinted-shell anatomy: column-colour shell, white inset panel, no status chip", async () => {
    await render(ProjectBoardCard, { row: row() });

    // Drafting rides the blue category tint on the SHELL; the inset panel is
    // the neutral white surface (Obvious full-markup evidence 2026-08-10).
    const card = document.querySelector<HTMLElement>("[data-project-board-card]");
    expect(card?.className).toContain("bg-blue-50/70");
    expect(card?.className).toContain("rounded-xl");
    expect(card?.className).toContain("shadow-sm");
    expect(card?.className).toContain("cursor-pointer");
    expect(card?.className).toContain("min-h-40");
    expect(card!.getBoundingClientRect().height).toBeGreaterThanOrEqual(160);
    const inset = document.querySelector<HTMLElement>("[data-card-content] > div");
    expect(inset?.className).toContain("bg-surface");
    expect(inset?.className).toContain("rounded-[10px]");
    expect(inset?.className).toContain("flex-1");
    expect(document.querySelector("[data-card-content]")?.className).toContain("flex-1");
    // No stage chip on the card — the tint + column chip carry stage.
    expect(document.querySelector("[data-card-stage]")).toBeNull();
    expect(document.querySelector("[data-stage-badge]")).toBeNull();

    // Tighter metadata rhythm + one shared (sans) type for every row,
    // dates included.
    const fields = document.querySelector<HTMLElement>("[data-card-content] .space-y-1");
    expect(fields).not.toBeNull();
    expect(document.querySelector("[data-created-date]")?.className).not.toContain("text-data");
    expect(document.querySelector("[data-updated-date]")?.className).not.toContain("text-data");

    // Client and Owner carry DISTINCT icons (building vs person).
    const clientPath = document.querySelector('[data-card-field="client"] svg path')?.getAttribute("d");
    const ownerPath = document.querySelector('[data-card-field="owner"] svg path')?.getAttribute("d");
    expect(clientPath).toBeTruthy();
    expect(ownerPath).toBeTruthy();
    expect(clientPath).not.toBe(ownerPath);
  });

  it("renders the project fields as compact icon rows", async () => {
    await render(ProjectBoardCard, { row: row() });

    expect(document.querySelector('[data-card-field="client"]')?.textContent).toContain(
      "Northline Labs"
    );
    expect(document.querySelector('[data-card-field="owner"]')?.textContent).toContain(
      "Olivia Owner"
    );
    expect(document.querySelector('[data-card-field="created"]')?.textContent).toContain(
      "Created Mar 10, 2026"
    );
    expect(document.querySelector('[data-card-field="updated"]')?.textContent).toContain(
      "Updated Jul 29, 2026"
    );
    expect(document.querySelector('[data-card-field="identity"]')?.textContent).toContain(
      "Writing"
    );
    expect(document.querySelector('[data-card-field="identity"]')?.textContent).toContain(
      "FY not set"
    );
    expect(document.querySelectorAll("[data-card-field] svg")).toHaveLength(6);
  });

  it("renders the current handoff as With — assignee, kind, and due (2026-08-10 amendment)", async () => {
    await render(ProjectBoardCard, {
      row: row({
        handoff: {
          assigneeLabel: "Rita Reviewer",
          kindLabel: "Internal review",
          dueDate: "Sep 1, 2026",
        },
      }),
    });

    const field = document.querySelector<HTMLElement>('[data-card-field="handoff"]');
    expect(field?.textContent).toContain("With");
    expect(field?.textContent).toContain("Rita Reviewer");
    expect(field?.textContent).toContain("Internal review");
    expect(field?.textContent).toContain("due Sep 1, 2026");
  });

  it("renders no handoff row when the project has no open blocking handoff", async () => {
    await render(ProjectBoardCard, { row: row() });

    expect(document.querySelector('[data-card-field="handoff"]')).toBeNull();
  });

  it("omits the created row when legacy data has no creation date", async () => {
    await render(ProjectBoardCard, { row: row({ createdDate: undefined }) });

    expect(document.querySelector('[data-card-field="created"]')).toBeNull();
    expect(document.querySelector('[data-card-field="updated"]')?.textContent).toContain(
      "Jul 29, 2026"
    );
  });

  it("labels legacy writers and stage-less projects explicitly", async () => {
    await render(ProjectBoardCard, {
      row: row({
        workflowStage: undefined,
        owner: { kind: "legacy_writer", label: "Wanda Writer" },
      }),
    });

    expect(document.querySelector("[data-owner-legacy-qualifier]")?.textContent).toContain(
      "Writer · legacy"
    );
    expect(document.querySelector("[data-legacy-status-qualifier]")?.textContent).toContain(
      "Legacy status"
    );
  });

  it("keeps the paused cue dashed (violet held tone) without adding drag semantics", async () => {
    await render(ProjectBoardCard, { row: row({ workflowStage: "on_hold" }) });

    const card = document.querySelector<HTMLElement>("[data-project-board-card]");
    expect(card?.className).toContain("border-dashed");
    expect(card?.className).toContain("bg-violet-50/70");
    expect(card?.getAttribute("draggable")).toBeNull();
    expect(card?.getAttribute("role")).toBeNull();
  });

  it("suppresses client metadata on client-scoped boards", async () => {
    await render(ProjectBoardCard, { row: row(), showClient: false });

    expect(document.querySelector('[data-card-field="client"]')).toBeNull();
    expect(document.querySelector('[data-card-field="owner"]')).not.toBeNull();
  });

  it("suppresses the fiscal-year chip when its parent folder supplies the context", async () => {
    await render(ProjectBoardCard, {
      row: row({ fiscalYear: 2025 }),
      showFiscalYear: false,
    });

    expect(document.querySelector("[data-card-fiscal-year]")).toBeNull();
    expect(document.querySelector('[data-card-field="identity"]')?.textContent).toContain("Writing");
    expect(
      document.querySelector<HTMLElement>("[data-project-board-card]")!.getBoundingClientRect().height
    ).toBeGreaterThanOrEqual(160);
  });

  it("keeps Stage and Type together on the same compact metadata row", async () => {
    await render(ProjectBoardCard, { row: row(), showStage: true });

    const identity = document.querySelector<HTMLElement>('[data-card-field="identity"]');
    expect(identity?.querySelector('[data-stage-badge="drafting"]')).not.toBeNull();
    expect(identity?.querySelector("[data-card-project-type]")?.textContent).toContain("Writing");
    expect(document.querySelector('[data-card-field="stage"]')).toBeNull();
  });

  it("carries the workflow-stage color into the project title and number", async () => {
    await render(ProjectBoardCard, {
      row: row({ projectNumber: "12", workflowStage: "drafting" }),
    });

    expect(document.querySelector("[data-recent-title]")?.className).toContain("text-blue-700");
    expect(document.querySelector("[data-card-project-number]")?.className).toContain(
      "text-blue-700"
    );
  });

  it("keeps its complete identity responsive in a narrow card", async () => {
    await page.viewport(320, 700);
    const screen = await render(ProjectBoardCard, {
      row: row({
        projectNumber: "10A",
        title: "A long experimental development project title that needs truncation",
        sredTitle: "A long SR&ED technical title that also needs responsive truncation",
        clientName: "Acuity Insights with an extended recorded client name",
        owner: {
          kind: "canonical",
          label: "An owner with a longer display name",
        },
        handoff: {
          assigneeLabel: "A reviewer with a longer display name",
          kindLabel: "Internal review",
          dueDate: "September 30, 2026",
        },
      }),
    });
    screen.container.style.width = "240px";

    const card = document.querySelector<HTMLElement>("[data-project-board-card]")!;
    const number = document.querySelector<HTMLElement>("[data-card-project-number]")!;
    const title = document.querySelector<HTMLElement>("[data-recent-title]")!;
    const sredTitle = document.querySelector<HTMLElement>("[data-card-sred-title]")!;
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    expect(number.className).toContain("rounded-md");
    expect(number.className).toContain("border");
    expect(number.className).toContain("bg-surface");
    expect(number.getAttribute("aria-label")).toBe("Project number 10A");
    expect(title.className).toContain("truncate");
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    expect(sredTitle.className).toContain("truncate");
    expect(sredTitle.scrollWidth).toBeGreaterThan(sredTitle.clientWidth);
    expect(document.querySelector('[data-card-field="client"] span:last-child')?.className).toContain(
      "line-clamp-2"
    );
    expect(document.querySelector('[data-card-field="handoff"] span:last-child')?.className).toContain(
      "line-clamp-2"
    );
  });

  it("keeps the entire card navigable through the stretched project link", async () => {
    await render(ProjectBoardCard, { row: row() });

    const card = document.querySelector<HTMLElement>("[data-project-board-card]");
    const anchor = card?.querySelector<HTMLAnchorElement>("a");
    expect(anchor?.getAttribute("href")).toBe("/project/p1");
    expect(anchor?.className).toContain("after:absolute");
    expect(card!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});
