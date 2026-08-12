import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import HomeStartProject from "./HomeStartProject.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";

describe("HomeStartProject", () => {
  beforeEach(() => {
    __resetNavigation();
    takeProjectStart();
    document.body.innerHTML = "";
  });

  it("starts the existing wizard with editable title and pasted transcript", async () => {
    await render(HomeStartProject, { greeting: "Good morning, Olivia" });

    const title = document.querySelector<HTMLInputElement>("[data-home-start-input]")!;
    title.value = "  Solar tracker prototype  ";
    title.dispatchEvent(new InputEvent("input", { bubbles: true }));
    // Paste entry is an explicit option: the textarea appears once chosen.
    expect(document.querySelector("[data-home-transcript-input]")).toBeNull();
    document.querySelector<HTMLButtonElement>("[data-home-transcript-paste]")!.click();
    await expect.poll(() => document.querySelector("[data-home-transcript-input]")).not.toBeNull();
    const transcript = document.querySelector<HTMLTextAreaElement>("[data-home-transcript-input]")!;
    transcript.value = "Interview transcript text";
    transcript.dispatchEvent(new InputEvent("input", { bubbles: true }));

    document.querySelector<HTMLFormElement>("[data-home-start-form]")!.requestSubmit();

    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/project/new");
    expect(takeProjectStart()).toEqual({
      title: "Solar tracker prototype",
      transcriptText: "Interview transcript text",
      transcriptFileName: null,
    });
  });

  it("centers the opening composition as one chrome-free prompt box", async () => {
    await render(HomeStartProject, { greeting: "Good morning" });

    expect(document.querySelector("[data-home-start-suggestion]")).toBeNull();
    expect(document.querySelector("[data-home-start-suggestions]")).toBeNull();
    const centered = document.querySelector<HTMLElement>("[data-home-start-centered]")!;
    const welcome = document.querySelector<HTMLElement>("[data-home-welcome]")!;
    const form = document.querySelector<HTMLElement>("[data-home-start-form]")!;
    expect(centered.className).toContain("mx-auto");
    // 46rem = Obvious's ~736px prompt column (2026-08-10 spacing pass).
    expect(centered.className).toContain("max-w-[46rem]");
    // The shader wash renders in the workspace scroll owner (see
    // HomeParity), container-width — not inside this component.
    expect(welcome.className).toContain("text-center");
    expect(form.className).toContain("text-left");
    expect(form.className).toContain("bg-surface");
    // Radius consistency (2026-08-10): containers share the board-card
    // rounded-xl scale.
    expect(form.className).toContain("rounded-xl");
    // Full-opacity hairline, no hover/focus-within treatment (2026-08-10
    // owner direction) — the caret and control focus rings carry state.
    expect(form.className).toContain("border-line");
    expect(form.className).not.toContain("border-line-soft");
    expect(form.className).not.toContain("focus-within:");
    expect(form.className).not.toContain("hover:");
    expect(form.className).not.toContain("shadow");

    // …so the fields inside stay chrome-free: no underline, no hover/focus
    // classes, and the default black focus outline suppressed. The transcript
    // textarea appears via the explicit Paste option.
    document.querySelector<HTMLButtonElement>("[data-home-transcript-paste]")!.click();
    await expect.poll(() => document.querySelector("[data-home-transcript-input]")).not.toBeNull();
    const title = document.querySelector<HTMLInputElement>("[data-home-start-input]")!;
    const transcript = document.querySelector<HTMLTextAreaElement>("[data-home-transcript-input]")!;
    for (const control of [title, transcript]) {
      expect(control.className).toContain("input-chromeless");
      expect(control.className).toContain("outline-none");
      expect(control.className).not.toContain("border-b");
      expect(control.className).not.toContain("hover:");
      expect(control.className).not.toContain("focus:");
      expect(control.className).not.toContain("focus-visible:");
    }

    // Prompt toolbar anatomy: one segmented paste/attach toggle left, round
    // icon send right; labels remain in the DOM for assistive tech. Quiet by
    // design: no hover treatments inside the box.
    const modeGroup = document.querySelector<HTMLElement>("[data-home-transcript-mode]")!;
    expect(modeGroup.getAttribute("role")).toBe("group");
    const paste = document.querySelector<HTMLButtonElement>("[data-home-transcript-paste]")!;
    const attach = document.querySelector<HTMLButtonElement>("[data-home-transcript-attach]")!;
    expect(paste.textContent).toContain("Paste");
    expect(paste.getAttribute("aria-pressed")).toBe("true");
    expect(attach.textContent).toContain("Attach file");
    expect(attach.getAttribute("aria-pressed")).toBe("false");
    for (const control of [paste, attach, document.querySelector("[data-home-start-submit]")!]) {
      expect(control.className).not.toContain("hover:");
    }
    expect(
      document.querySelector('[data-home-start-submit][aria-label="Start project"]')
    ).not.toBeNull();
    expect(document.querySelector('label[for="home-project-title"]')?.className).toContain("sr-only");
    expect(document.querySelector('label[for="home-transcript"]')?.className).toContain("sr-only");

    // Fixed top offset, no vertical centering (recents stay above the
    // laptop fold), with the generous top pad (2026-08-10 owner direction).
    const section = document.querySelector<HTMLElement>("[data-home-start]")!;
    expect(section.className).not.toContain("justify-center");
    expect(section.className).not.toContain("min-h-");
    expect(section.className).toContain("pt-24");
  });

  it("keeps empty submission truthful by opening a blank wizard", async () => {
    await render(HomeStartProject, { greeting: "Good morning" });
    document.querySelector<HTMLFormElement>("[data-home-start-form]")!.requestSubmit();

    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/project/new");
    expect(takeProjectStart()).toEqual({ title: "", transcriptText: "", transcriptFileName: null });
  });
});
