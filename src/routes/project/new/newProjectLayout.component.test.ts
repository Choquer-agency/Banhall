import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import { chooseMode, fillBasics, openTranscriptPaste, setInputValue } from "./newProjectTestSupport";

/**
 * Board E1 on one page, and H1 (tablet, 1024) and H2 (phone, 390): numbered
 * sections, the right column "How should we write it?" with Step by step as
 * the default, the mode switch copy, Cancel, and below desktop the section
 * chips and the sticky bottom bar.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

beforeEach(() => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
});

describe("E1 desktop layout", () => {
  beforeEach(async () => {
    await page.viewport(1440, 900);
  });

  it("shows the four numbered sections and the right column, with Step by step selected", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-right-column]")).not.toBeNull();
    const sections = [...document.querySelectorAll<HTMLElement>("[data-new-project-section]")];
    expect(sections.map((section) => text(section.querySelector("div")))).toEqual([
      "01 Project The basics",
      "02 Interview Transcripts the PD is written from",
      "03 Supporting documents Optional. Anything that backs up the claim. Add",
      "04 Details Optional",
    ]);
    expect(text(document.querySelector("h1"))).toBe("New project");
    expect(text(document.querySelector("[data-new-project-subtitle]"))).toBe(
      "Add the interview and the basics. You become the project Owner."
    );
    const column = document.querySelector<HTMLElement>("[data-right-column]")!;
    expect(getComputedStyle(column).width).toBe("360px");
    expect(text(column.querySelector("h2"))).toBe("How should we write it?");
    const cards = [...column.querySelectorAll<HTMLElement>("[data-write-mode]")];
    expect(cards.map((card) => [card.dataset.writeMode, card.getAttribute("aria-checked")])).toEqual([
      ["iterative", "true"],
      ["single", "false"],
      ["compare", "false"],
    ]);
    expect(text(cards[0])).toBe("Step by step Recommended Pick the ideas first. We write after.");
    expect(text(cards[1])).toBe("Single draft One full draft, straight to the editor.");
    expect(text(cards[2])).toBe("Compare two drafts Two drafts. You keep the better one.");
    expect(column.querySelector('[data-model-picker="field"]')).not.toBeNull();
    expect(text(column.querySelector("[data-start-button]"))).toBe("Start step by step");
    expect(text(column.querySelector("[data-start-note]"))).toBe("You will check your files before anything starts.");
    // No section chips or bottom bar on desktop.
    expect(document.querySelector("[data-section-chips]")).toBeNull();
    expect(document.querySelector("[data-bottom-bar]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/[‐-―·]/);
  });

  it("names the start button after the mode", async () => {
    await render(NewProjectPage, {});
    const button = () => text(document.querySelector("[data-start-button]"));
    await expect.poll(button).toBe("Start step by step");
    document.querySelector<HTMLElement>('[data-write-mode="single"]')!.click();
    await expect.poll(button).toBe("Start single draft");
    document.querySelector<HTMLElement>('[data-write-mode="compare"]')!.click();
    await expect.poll(button).toBe("Start two drafts");
    // Compare shows the two model slots.
    expect(document.querySelectorAll('[aria-label="Models to compare"]')).toHaveLength(1);
  });

  it("switches the copy for Review a written PD", async () => {
    await render(NewProjectPage, {});
    await chooseMode("Review a written PD");
    expect(text(document.querySelector("[data-new-project-subtitle]"))).toBe(
      "Add the draft and the basics. You become the project Owner."
    );
    const active = document.querySelector<HTMLElement>('[aria-label="Project mode"] [aria-checked="true"]')!;
    await expect.poll(() => getComputedStyle(active).backgroundColor).toBe("rgb(8, 122, 117)");
    expect(getComputedStyle(active).color).toBe("rgb(255, 255, 255)");
  });

  it("styles Cancel as the filled destructive button and leaves for My work", async () => {
    await render(NewProjectPage, {});
    const cancel = document.querySelector<HTMLButtonElement>("[data-new-project-cancel]")!;
    expect(text(cancel)).toBe("Cancel");
    expect(getComputedStyle(cancel).backgroundColor).toBe("rgb(254, 226, 226)");
    cancel.click();
    await expect.poll(() => __navigationCalls.map((call) => call.url)).toContain("/my-work");
  });

  it("drops the old Consultant header tooltip", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-right-column]")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Consultant · ");
    expect(document.body.textContent).not.toContain("Set automatically to the signed-in user");
  });
});

describe("H1 tablet (1024)", () => {
  beforeEach(async () => {
    await page.viewport(1024, 900);
  });

  it("shows section chips, the inline mode section and the bottom bar", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-section-chips]")).not.toBeNull();
    expect(document.querySelector("[data-right-column]")).toBeNull();
    const chips = [...document.querySelectorAll<HTMLElement>("[data-section-chip]")];
    expect(chips.map((chip) => text(chip))).toEqual([
      "Project",
      "Interview",
      "Supporting documents",
      "Details",
      "How to write it",
    ]);
    // The mode cards sit in a row with the short descriptions.
    const modes = document.querySelector<HTMLElement>("#section-mode [data-write-mode-cards]")!;
    expect(getComputedStyle(modes).display).toBe("grid");
    expect(text(modes.querySelector('[data-write-mode="single"]'))).toBe("Single draft One full draft");
    expect(text(modes.querySelector('[data-write-mode="compare"]'))).toBe("Compare two drafts Two drafts, keep one");

    const bar = document.querySelector<HTMLElement>("[data-bottom-bar]")!;
    expect(getComputedStyle(bar).height).toBe("64px");
    expect(getComputedStyle(bar).position).toBe("sticky");
    // A blocking problem replaces the Ready line in danger ink.
    expect(text(bar.querySelector("[data-bottom-summary]"))).toBe("Add a client and a title");
    expect(document.querySelector<HTMLButtonElement>("[data-bottom-start]")!.disabled).toBe(true);

    await fillBasics();
    await openTranscriptPaste();
    setInputValue("#transcript", "Interviewer: What was uncertain?\nEngineer: The seal.");
    await expect.poll(() => text(bar.querySelector("[data-bottom-summary]"))).toBe(
      "Ready: 1 transcript, 0 supporting documents"
    );
    expect(document.querySelector<HTMLButtonElement>("[data-bottom-start]")!.disabled).toBe(false);
    expect(getComputedStyle(document.querySelector("[data-bottom-start]")!).height).toBe("40px");
  });

  it("scrolls to a section from its chip and marks it current", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-section-chips]")).not.toBeNull();
    const chip = document.querySelector<HTMLButtonElement>('[data-section-chip="section-details"]')!;
    chip.click();
    await expect.poll(() => chip.getAttribute("aria-current")).toBe("true");
    const done = document.querySelector<HTMLElement>('[data-section-chip="section-mode"]')!;
    expect(getComputedStyle(done).backgroundColor).toBe("rgb(234, 242, 241)");
  });
});

describe("H2 phone (390)", () => {
  beforeEach(async () => {
    await page.viewport(390, 844);
  });

  it("uses short labels, full-width controls and a 48px start button, with 44px touch targets", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-section-chips]")).not.toBeNull();
    expect(text(document.querySelector('[data-section-chip="section-supporting"]'))).toBe("Supporting");
    const modes = [...document.querySelectorAll<HTMLElement>('[aria-label="Project mode"] [role="radio"]')];
    expect(modes.map((mode) => text(mode))).toEqual(["Write a new PD", "Review a PD"]);
    // Mode cards stack as rows; Industry and the Model select stay (not on the board).
    expect(getComputedStyle(document.querySelector("#section-mode [data-write-mode-cards]")!).display).toBe("flex");
    expect(document.querySelector("#industry")).not.toBeNull();
    expect(document.querySelector('#section-mode [data-model-picker="field"]')).not.toBeNull();
    const start = document.querySelector<HTMLElement>("[data-bottom-start]")!;
    expect(getComputedStyle(start).height).toBe("48px");
    expect(start.getBoundingClientRect().width).toBeGreaterThan(300);
    // Coarse pointers get 44px targets.
    for (const selector of ["#title", "[data-section-chip]", "[data-write-mode]", "[data-open-paste]"]) {
      expect(document.querySelector(selector)!.className, selector).toMatch(/pointer-coarse:(min-)?h-11/);
    }
  });
});
