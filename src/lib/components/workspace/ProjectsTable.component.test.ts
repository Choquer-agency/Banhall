import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ProjectsTable, { type ProjectsTableRow } from "./ProjectsTable.svelte";

const baseRow: ProjectsTableRow = {
  id: "p1",
  title: "Thermal model rewrite",
  clientName: "Northline Labs",
  workflowStage: "drafting",
  legacyStatus: "draft",
  owner: { kind: "canonical", label: "Olivia Owner" },
  generationActivity: null,
  updatedDate: "Jul 29, 2026",
};

describe("ProjectsTable", () => {
  it("renders one truthful row with a project link, stage badge, owner, and date", async () => {
    await render(ProjectsTable, { rows: [baseRow] });

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/project/p1"]'));
    expect(links).toHaveLength(1);
    expect(links.every((link) => link.textContent?.includes("Thermal model rewrite"))).toBe(true);
    expect(links[0].classList.contains("min-h-11")).toBe(true);
    expect(document.querySelector('[data-stage-badge="drafting"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Northline Labs");
    expect(document.body.textContent).toContain("Olivia Owner");
    expect(document.body.textContent).toContain("Jul 29, 2026");
    // Client name stays plain compatibility text, never its own link.
    expect(Array.from(document.querySelectorAll("a")).every((link) => link.getAttribute("href") === "/project/p1")).toBe(true);
    expect(document.querySelector("table")).toBeNull();
  });

  it("qualifies legacy status and legacy writer fallbacks instead of implying canonical data", async () => {
    await render(ProjectsTable, {
      rows: [
        {
          ...baseRow,
          id: "p2",
          workflowStage: undefined,
          legacyStatus: "review",
          owner: { kind: "legacy_writer", label: "Wendy Writer" },
        },
      ],
    });

    expect(document.querySelectorAll("[data-legacy-status-qualifier]")).toHaveLength(2);
    expect(document.body.textContent).toContain("Wendy Writer");
    expect(document.querySelectorAll("[data-owner-legacy-qualifier]")).toHaveLength(2);
  });

  it("shows an unresolved canonical owner as unavailable, never as the legacy writer", async () => {
    await render(ProjectsTable, {
      rows: [
        {
          ...baseRow,
          id: "p4",
          owner: { kind: "canonical_unresolved" },
        },
      ],
    });

    expect(document.querySelectorAll("[data-owner-unavailable]")).toHaveLength(2);
    expect(document.querySelector("[data-owner-legacy-qualifier]")).toBeNull();
    expect(document.body.textContent).not.toContain("Wendy Writer");
  });

  it("labels generation activity separately from stage and shows truthful empty owners", async () => {
    await render(ProjectsTable, {
      rows: [
        {
          ...baseRow,
          id: "p3",
          generationActivity: "generating",
          owner: { kind: "none" },
        },
      ],
    });

    expect(document.querySelectorAll('[data-generation-activity="generating"]')).toHaveLength(2);
    // The visible "No owner recorded" text IS the accessible name — no
    // redundant aria-label on a generic (name-prohibited) span.
    const ownerNone = document.querySelectorAll("[data-owner-none]");
    expect(ownerNone).toHaveLength(2);
    for (const cell of ownerNone) {
      expect(cell.textContent).toContain("No owner recorded");
      expect(cell.hasAttribute("aria-label")).toBe(false);
    }
  });

  it("applies column preferences to the desktop and mobile projections", async () => {
    await render(ProjectsTable, {
      rows: [baseRow],
      columns: {
        clientName: true,
        stage: true,
        owner: false,
        generationActivity: false,
        updated: true,
      },
    });

    expect(document.body.textContent).not.toContain("Olivia Owner");
    expect(document.querySelector('[data-generation-activity]')).toBeNull();
    expect(document.body.textContent).toContain("Northline Labs");
    expect(document.body.textContent).toContain("Jul 29, 2026");
  });
});
