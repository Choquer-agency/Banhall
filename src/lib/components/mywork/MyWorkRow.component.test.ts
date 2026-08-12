import { describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import MyWorkRow from "./MyWorkRow.svelte";
import MyWorkRowFixture from "./MyWorkRowFixture.svelte";

const baseProps = {
  href: "/project/project-1",
  title: "Advanced battery research",
  workflowStage: "drafting" as const,
  dueAt: null,
  now: new Date("2026-08-07T12:00:00Z").getTime(),
  context: "Draft report · Northline Labs",
  absentDueLabel: "No due date",
  assignee: { label: "Morgan Manager", initials: "MM" },
};

describe("MyWorkRow", () => {
  it("keeps absent due truth in secondary metadata and preserves the full title row", async () => {
    await browserPage.viewport(390, 844);
    await render(MyWorkRow, { props: baseProps });

    const link = document.querySelector<HTMLAnchorElement>('a[href="/project/project-1"]');
    expect(link?.textContent).toContain("Advanced battery research");
    expect(link?.className).toContain("col-span-2");
    expect(document.querySelector("[data-due-state]")).toBeNull();
    expect(document.querySelector("[data-due-absent]")?.textContent).toBe("No due date");
    expect(document.body.textContent).toContain("Draft report · Northline Labs");
    // The compact mobile row may hide the visible name, but the assignee
    // remains explicitly named for assistive technology — through real
    // sr-only text, never an aria-label on a generic (name-prohibited) span.
    const assignee = document.querySelector("[data-assignee]");
    expect(assignee?.hasAttribute("aria-label")).toBe(false);
    expect(assignee?.textContent).toContain("Assigned to Morgan Manager");
  });

  it("renders optional metadata and actions while allowing no assignee", async () => {
    let completed = false;
    await render(MyWorkRowFixture, {
      props: { onComplete: () => (completed = true) },
    });

    expect(document.querySelector("[data-fixture-metadata]")?.textContent).toBe("Review");
    expect(document.querySelector("[data-assignee]")).toBeNull();
    const complete = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Complete"
    );
    expect(complete).toBeDefined();
    complete?.click();
    expect(completed).toBe(true);
  });

  it("pins a real overdue date to the first line with a textual overdue state", async () => {
    await render(MyWorkRow, {
      props: {
        ...baseProps,
        dueAt: new Date("2026-08-01T12:00:00Z").getTime(),
      },
    });

    const due = document.querySelector("[data-due-state]");
    expect(due?.getAttribute("data-due-state")).toBe("overdue");
    expect(due?.textContent?.trim()).toBeTruthy();
    expect(due?.className).toContain("text-red-700");
    expect(document.querySelector("[data-due-absent]")).toBeNull();
  });
});
