import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
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

describe("E1 board values", () => {
  beforeEach(async () => {
    await page.viewport(1440, 900);
  });

  it("pads the panel 24 by 40 and draws 36px fields with radius 8", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-form-column]")).not.toBeNull();
    const column = getComputedStyle(document.querySelector("[data-form-column]")!);
    expect([column.paddingTop, column.paddingBottom, column.paddingLeft, column.paddingRight]).toEqual(["24px", "24px", "40px", "40px"]);
    for (const selector of ["#title", "#clientName", "[data-fiscal-year]", "[data-science-code]", "#industry", "#interviewer", "#projectNumber"]) {
      const field = getComputedStyle(document.querySelector(selector)!);
      expect([field.height, field.borderTopLeftRadius, field.paddingLeft], selector).toEqual(["36px", "8px", "10px"]);
    }
    // Labels 12/16 500 in secondary ink.
    const label = getComputedStyle(document.querySelector("#fiscal-year-label")!);
    expect([label.fontSize, label.lineHeight, label.fontWeight]).toEqual(["12px", "16px", "500"]);
    // Section header: 01 in 12px mono faint, the 15px title, the 13px hint.
    const header = document.querySelector<HTMLElement>("#section-project > div")!;
    const [number, title, hint] = [...header.children] as HTMLElement[];
    expect([getComputedStyle(number).fontSize, getComputedStyle(number).color]).toEqual(["12px", "rgb(147, 165, 161)"]);
    expect(getComputedStyle(number).fontFamily).toContain("Geist Mono");
    expect([getComputedStyle(title).fontSize, getComputedStyle(title).fontWeight]).toEqual(["15px", "500"]);
    expect([getComputedStyle(hint).fontSize, getComputedStyle(hint).color]).toEqual(["13px", "rgb(107, 127, 123)"]);
    // The board icons: the calendar in the fiscal year, the chevron in the science code.
    const calendar = document.querySelector("[data-fiscal-year] svg")!;
    expect([calendar.getAttribute("width"), calendar.getAttribute("stroke-width")]).toEqual(["15", "1.5"]);
    const chevron = document.querySelector("[data-science-code] svg")!;
    expect([chevron.getAttribute("width"), chevron.getAttribute("stroke-width")]).toEqual(["14", "1.8"]);
    expect(getComputedStyle(chevron).color).toBe("rgb(147, 165, 161)");
    // Drop transcripts: the 16px lagoon upload arrow.
    const upload = document.querySelector("[data-transcript-drop] svg")!;
    expect(upload.querySelector("path")!.getAttribute("d")).toBe(
      "M12 15.5V4.5 M7.5 9 12 4.5 16.5 9 M4.5 15v4a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4"
    );
    expect(getComputedStyle(upload).color).toBe("rgb(8, 122, 117)");
  });

  it("fills the selected write mode with #F7FCFB and sets Recommended in 11px", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-right-column]")).not.toBeNull();
    // The right column and the drop zones keep the board canvas inside the
    // white workspace scope.
    expect(getComputedStyle(document.querySelector("[data-right-column]")!).backgroundColor).toBe("rgb(249, 252, 251)");
    expect(getComputedStyle(document.querySelector("[data-transcript-drop]")!).backgroundColor).toBe("rgb(249, 252, 251)");
    const selected = document.querySelector<HTMLElement>('[data-right-column] [data-write-mode="iterative"]')!;
    expect(getComputedStyle(selected).backgroundColor).toBe("rgb(247, 252, 251)");
    expect(selected.className).toContain("border-[1.5px]");
    expect(getComputedStyle(selected).borderTopColor).toBe("rgb(8, 122, 117)");
    const other = document.querySelector<HTMLElement>('[data-right-column] [data-write-mode="single"]')!;
    expect(getComputedStyle(other).backgroundColor).toBe("rgb(255, 255, 255)");
    const recommended = getComputedStyle(selected.querySelector("[data-recommended]")!);
    expect([recommended.fontSize, recommended.height, recommended.backgroundColor, recommended.color]).toEqual([
      "11px",
      "20px",
      "rgb(187, 247, 208)",
      "rgb(20, 83, 45)",
    ]);
    // The model field: 36px, radius 8, the 18px AI mark and a faint chevron.
    const model = document.querySelector<HTMLElement>('[data-right-column] [data-model-picker="field"]')!;
    expect([getComputedStyle(model).height, getComputedStyle(model).borderTopLeftRadius]).toEqual(["36px", "8px"]);
    const chevron = [...model.querySelectorAll<SVGElement>("svg")].at(-1)!;
    expect([chevron.getAttribute("width"), chevron.getAttribute("stroke-width")]).toEqual(["14", "1.8"]);
    // Before you start: the checklist box and the 42px start with its arrow.
    const box = getComputedStyle(document.querySelector("[data-start-checklist]")!);
    expect([box.paddingTop, box.borderTopLeftRadius]).toEqual(["18px", "14px"]);
  });

  it("sizes Cancel as the board: 36px, 14px sides, radius 8, 13px 500 in #B91C1C", async () => {
    await render(NewProjectPage, {});
    const cancel = getComputedStyle(document.querySelector("[data-new-project-cancel]")!);
    expect([cancel.height, cancel.paddingLeft, cancel.borderTopLeftRadius, cancel.fontSize, cancel.lineHeight, cancel.fontWeight, cancel.color]).toEqual([
      "36px",
      "14px",
      "8px",
      "13px",
      "18px",
      "500",
      "rgb(185, 28, 28)",
    ]);
  });

  it("matches the E2 add menu", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-add-supporting]")).not.toBeNull();
    const trigger = document.querySelector<HTMLElement>("[data-add-supporting]")!;
    const [plus, chevron] = [...trigger.querySelectorAll("svg")];
    expect([plus.getAttribute("width"), plus.getAttribute("stroke-width")]).toEqual(["12", "2"]);
    expect([chevron.getAttribute("width"), chevron.getAttribute("stroke-width"), chevron.getAttribute("stroke-linejoin")]).toEqual(["11", "2.2", "miter"]);
    await userEvent.click(trigger);
    await expect.poll(() => document.querySelector("[data-add-menu]")).not.toBeNull();
    const menu = getComputedStyle(document.querySelector("[data-add-menu]")!);
    expect([menu.width, menu.paddingTop, menu.borderTopLeftRadius]).toEqual(["300px", "6px", "12px"]);
    expect(menu.boxShadow).toContain("0px 12px 32px");
    const upload = document.querySelector<HTMLElement>("[data-add-upload]")!;
    expect([getComputedStyle(upload).height, getComputedStyle(upload).paddingLeft, getComputedStyle(upload).fontSize]).toEqual(["32px", "8px", "13px"]);
    expect(getComputedStyle(upload.querySelector("span:last-child")!).color).toBe("rgb(147, 165, 161)");
    const book = document.querySelector("[data-add-paste] svg")!;
    expect(book.querySelector("path")!.getAttribute("d")).toBe("M5 4.5h10.5a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z M5 17.5a3 3 0 0 1 3-3h10.5");
    await userEvent.keyboard("{Escape}");
  });

  it("uses the board chrome icons with no Phosphor stand-ins", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-right-column]")).not.toBeNull();
    // Phosphor draws on a 256 grid; every board icon is on 24 (or the file icons).
    expect(document.querySelectorAll('[data-new-project-panel] svg[viewBox="0 0 256 256"]')).toHaveLength(0);
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
    expect(getComputedStyle(bar).height).toBe("72px");
    expect(getComputedStyle(bar).paddingLeft).toBe("32px");
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
    const start = document.querySelector<HTMLElement>("[data-bottom-start]")!;
    expect(getComputedStyle(start).height).toBe("36px");
    expect(getComputedStyle(start).borderTopLeftRadius).toBe("8px");
    expect(getComputedStyle(start).paddingLeft).toBe("16px");
  });

  it("pads the content 28 by 32, splits Client and title in halves, and puts the model in 300px", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-form-column]")).not.toBeNull();
    const column = getComputedStyle(document.querySelector("[data-form-column]")!);
    expect([column.paddingTop, column.paddingLeft]).toEqual(["28px", "32px"]);
    expect(text(document.querySelector("[data-new-project-subtitle]"))).toBe("Add the interview and the basics.");
    const client = document.querySelector<HTMLElement>("#clientName")!.getBoundingClientRect().width;
    const title = document.querySelector<HTMLElement>("#title")!.getBoundingClientRect().width;
    expect(Math.abs(client - title)).toBeLessThan(2);
    const modeCards = [...document.querySelectorAll<HTMLElement>("#section-mode [data-write-mode]")];
    expect(modeCards[0].querySelector("[data-write-mode-radio]")).toBeNull();
    expect(text(modeCards[0])).toBe("Step by step Recommended Pick the ideas first. We write after.");
    expect(getComputedStyle(modeCards[1].querySelector("[data-write-mode-description]")!).fontSize).toBe("12px");
    const model = document.querySelector<HTMLElement>('#section-mode [data-model-picker="field"]')!;
    expect(model.getBoundingClientRect().width).toBe(300);
    const cancel = getComputedStyle(document.querySelector("[data-new-project-cancel]")!);
    expect([cancel.height, cancel.fontSize]).toEqual(["32px", "14px"]);
  });

  it("scrolls to a section from its chip and marks it current", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-section-chips]")).not.toBeNull();
    const chip = document.querySelector<HTMLButtonElement>('[data-section-chip="section-details"]')!;
    chip.click();
    await expect.poll(() => chip.getAttribute("aria-current")).toBe("true");
    // H1 chips: done in the rail-selected wash with fir ink and the 12px
    // tick; the rest on white with a line, 30px tall.
    const done = document.querySelector<HTMLElement>('[data-section-chip="section-mode"]')!;
    expect(getComputedStyle(done).backgroundColor).toBe("rgb(233, 241, 239)");
    expect(getComputedStyle(done).color).toBe("rgb(10, 58, 56)");
    expect(getComputedStyle(done).height).toBe("30px");
    const tick = done.querySelector("svg")!;
    expect([tick.getAttribute("width"), tick.getAttribute("stroke-width")]).toEqual(["12", "2.4"]);
    expect(getComputedStyle(tick).color).toBe("rgb(8, 122, 117)");
    const todo = document.querySelector<HTMLElement>('[data-section-chip="section-interview"]')!;
    expect(getComputedStyle(todo).color).toBe("rgb(107, 127, 123)");
    expect(getComputedStyle(document.querySelector("[data-section-chips]")!).backgroundColor).toBe("rgb(249, 252, 251)");
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
    expect(getComputedStyle(start).fontSize).toBe("16px");
    // H2: the button alone once nothing blocks; the blocking line otherwise.
    expect(text(document.querySelector("[data-bottom-summary]"))).toBe("Add a client and a title");
    // 44px fields with radius 10 and 13px labels; the mode switch leads.
    const title = getComputedStyle(document.querySelector("#title")!);
    expect([title.height, title.borderTopLeftRadius, title.paddingLeft]).toEqual(["44px", "10px", "12px"]);
    expect(getComputedStyle(document.querySelector("#fiscal-year-label")!).fontSize).toBe("13px");
    expect(getComputedStyle(document.querySelector("[data-new-project-subtitle]")!.parentElement!).position).toBe("absolute");
    // Only the selected mode card carries its line (H2).
    const cards = [...document.querySelectorAll<HTMLElement>("#section-mode [data-write-mode]")];
    expect(cards.map((card) => text(card))).toEqual([
      "Step by step Recommended Pick the ideas first. We write after.",
      "Single draft",
      "Compare two drafts",
    ]);
    expect(text(document.querySelector("#section-mode-title"))).toBe("How to write it");
    const cancel = getComputedStyle(document.querySelector("[data-new-project-cancel]")!);
    expect([cancel.height, cancel.fontSize]).toEqual(["44px", "15px"]);
    expect(start.getBoundingClientRect().width).toBeGreaterThan(300);
    // Coarse pointers get 44px targets.
    for (const selector of ["#title", "[data-section-chip]", "[data-write-mode]", "[data-open-paste]"]) {
      expect(document.querySelector(selector)!.className, selector).toMatch(/pointer-coarse:(min-)?h-11/);
    }
  });
});
