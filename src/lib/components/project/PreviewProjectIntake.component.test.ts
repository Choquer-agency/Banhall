import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/**
 * 2026-08-08 Obvious-parity amendment (second), project half — the
 * NO-REPORT/INTAKE state of the preview workbench:
 * - desktop ≥lg: split workbench (left context pane with files+transcript,
 *   right primary intake/generation surface), each pane owning its own
 *   vertical scroll inside the h-dvh containment, with a keyboard-operable
 *   resizable separator;
 * - narrow screens: explicit Work/Context aria-pressed switches, one pane
 *   visible at a time;
 * - a11y P0s from the authenticated audit: exactly one h1 whose accessible
 *   name is the project title (edit control an adjacent sibling, never
 *   contaminating the heading name), and the Files panel as a true
 *   disclosure (aria-expanded + aria-controls resolving to a real region).
 * The state stays honest — no chat or report surface is implied.
 */
function seedIntakeProject() {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Acme FY24 thermal narrative",
    sredTitle: "",
    clientName: "Acme Labs",
    writer: "Wren Writer",
    interviewer: "",
    interviewees: [],
    createdAt: 1753747200000,
    fiscalYearEnd: null,
    industry: null,
    scienceCode: null,
    tagIds: [],
    mode: "full",
    status: "draft",
    workflowStage: "intake",
    shareToken: "tok-1",
    createdBy: "u-1",
  });
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getLatestGeneration", null);
  __setQueryData("pdReviews:getLatestPdReview", null);
  __setQueryData("reportViews:getViewSummary", null);
  __setQueryData("tags:listTags", []);
  __setQueryData("documents:listDocuments", []);
  __setQueryData("transcripts:getTranscript", {
    _id: "t-1",
    projectId: "project-1",
    content: "Interviewer: describe the thermal uncertainty.\nEngineer: we could not predict flow.",
  });
  __setQueryData("users:getCurrentUser", {
    _id: "u-1",
    role: "writer",
    firstName: "Wren",
    lastName: "Writer",
    email: "wren@example.test",
  });
}

const workbench = () => document.querySelector<HTMLElement>("[data-intake-workbench]");
const pane = (name: "work" | "context") =>
  document.querySelector<HTMLElement>(`[data-intake-pane="${name}"]`);

async function mountIntake(width: number, height = 900) {
  __setPageUrl("/project/project-1");
  __setPageParams({ id: "project-1" });
  seedIntakeProject();
  await browserPage.viewport(width, height);
  await render(PreviewProjectPage, {});
  await expect.poll(() => workbench()).not.toBeNull();
}

describe("PreviewProjectPage intake workbench", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("splits into independent context/work scroll panes with a resizable separator at desktop", async () => {
    await mountIntake(1440);

    const work = pane("work")!;
    const context = pane("context")!;
    // Both panes visible at lg+.
    expect(getComputedStyle(work).display).not.toBe("none");
    expect(getComputedStyle(context).display).not.toBe("none");
    // Scroll ownership: the workbench clips, each pane scrolls itself —
    // the ~27k-px transcript can never own document height again.
    expect(workbench()!.className).toContain("overflow-hidden");
    expect(work.className).toContain("overflow-y-auto");
    expect(context.querySelector(".overflow-y-auto")).not.toBeNull();
    // Context pane carries the source material; work pane the intake surface.
    expect(context.textContent).toContain("Interviewer: describe the thermal uncertainty.");
    expect(context.textContent).toContain("Files");
    expect(work.textContent).toContain("Draft generation");
    expect(work.textContent).toContain("Generate Report");
    // Keyboard-operable separator with truthful value semantics.
    const separator = document.querySelector<HTMLElement>('[aria-label="Resize context panel"]');
    expect(separator).not.toBeNull();
    expect(separator!.getAttribute("aria-valuemin")).toBe("24");
    expect(separator!.getAttribute("aria-valuemax")).toBe("55");
    expect(Number(separator!.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(24);
    // No chat is implied anywhere in the intake state.
    expect(document.querySelector('[aria-label="AI assistant"]')).toBeNull();
  });

  it("uses explicit Work/Context switches with one visible pane at a time on narrow screens", async () => {
    await mountIntake(700);

    const switches = document.querySelector<HTMLElement>('[aria-label="Project intake pane"]')!;
    const workButton = Array.from(switches.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Work"
    )!;
    const contextButton = Array.from(switches.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Context"
    )!;
    // ≥44px touch targets.
    expect(workButton.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(workButton.getAttribute("aria-pressed")).toBe("true");
    expect(getComputedStyle(pane("work")!).display).not.toBe("none");
    expect(getComputedStyle(pane("context")!).display).toBe("none");

    contextButton.click();
    await expect.poll(() => contextButton.getAttribute("aria-pressed")).toBe("true");
    expect(workButton.getAttribute("aria-pressed")).toBe("false");
    expect(getComputedStyle(pane("context")!).display).not.toBe("none");
    expect(getComputedStyle(pane("work")!).display).toBe("none");
  });

  it("keeps exactly one h1 named by the project title, with the edit control as an adjacent sibling", async () => {
    await mountIntake(1440);

    const headings = Array.from(document.querySelectorAll("h1"));
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toContain("Acme FY24 thermal narrative");
    // The heading name is the title itself — no edit-control contamination.
    expect(headings[0].textContent).not.toContain("Edit");
    // The editable in-body title is a level-2 heading whose edit button sits
    // BESIDE the heading, never inside it.
    const editButton = document.querySelector<HTMLElement>(
      '[aria-label="Edit internal project title"]'
    );
    expect(editButton).not.toBeNull();
    expect(editButton!.closest("h1, h2")).toBeNull();
    const bodyTitle = Array.from(document.querySelectorAll("h2")).find((h) =>
      h.textContent?.includes("Acme FY24 thermal narrative")
    );
    expect(bodyTitle).toBeDefined();
  });

  it("exposes the Files panel as a real disclosure: aria-expanded state and a resolvable aria-controls region", async () => {
    await mountIntake(1440);

    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.hasAttribute("aria-expanded") && b.textContent?.includes("Files")
    );
    expect(trigger).toBeDefined();
    expect(trigger!.getAttribute("aria-expanded")).toBe("false");
    const controlsId = trigger!.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();

    trigger!.click();
    await expect.poll(() => trigger!.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => document.getElementById(controlsId!)).not.toBeNull();
  });
});
