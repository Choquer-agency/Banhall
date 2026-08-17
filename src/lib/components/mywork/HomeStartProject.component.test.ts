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
    // Paste is the explicit default mode, so its field is ready immediately.
    expect(
      document.querySelector("[data-home-transcript-paste]")?.getAttribute("aria-selected")
    ).toBe("true");
    const transcript = document.querySelector<HTMLTextAreaElement>("[data-home-transcript-input]")!;
    transcript.value = "Interview transcript text";
    transcript.dispatchEvent(new InputEvent("input", { bubbles: true }));

    await expect
      .poll(() => document.querySelector<HTMLButtonElement>("[data-home-start-submit]")?.disabled)
      .toBe(false);

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
    expect(centered.className).toContain("max-w-[var(--container-home)]");
    expect(welcome.className).toContain("text-center");
    expect(form.className).toContain("text-left");
    expect(form.className).toContain("field-control-shell");
    expect(form.className).toContain("field-control-shell--surface");
    expect(getComputedStyle(form).backgroundColor).toBe("rgb(255, 255, 255)");
    // Radius consistency (2026-08-10): containers share the board-card
    // rounded-xl scale.
    expect(form.className).toContain("rounded-xl");
    // The intake is white with a one-pixel inset surface line; interaction
    // changes its color without adding an exterior border or shifting layout.
    expect(getComputedStyle(form).borderTopWidth).toBe("0px");
    expect(getComputedStyle(form).boxShadow).toContain("1px");
    expect(form.className).not.toContain("border-line");
    expect(form.className).not.toContain("focus-within:");
    expect(form.className).not.toContain("hover:");

    // …so the fields inside stay chrome-free: no underline, no hover/focus
    // classes, and the default black focus outline suppressed. The transcript
    // textarea is present because Paste is the default mode.
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
    expect(modeGroup.getAttribute("role")).toBe("tablist");
    const paste = document.querySelector<HTMLButtonElement>("[data-home-transcript-paste]")!;
    const attach = document.querySelector<HTMLButtonElement>("[data-home-transcript-attach]")!;
    expect(paste.textContent).toContain("Paste");
    expect(paste.getAttribute("aria-selected")).toBe("true");
    expect(attach.textContent).toContain("Attach file");
    expect(attach.getAttribute("aria-selected")).toBe("false");
    for (const control of [paste, attach, document.querySelector("[data-home-start-submit]")!]) {
      expect(control.className).not.toContain("hover:");
    }
    const submit = document.querySelector<HTMLButtonElement>("[data-home-start-submit]")!;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-label")).toContain("Add a project name and transcript");
    expect(document.querySelector('label[for="home-project-title"]')?.className).toContain("sr-only");
    expect(document.querySelector('label[for="home-transcript"]')?.className).toContain("sr-only");

    // Removing Home's redundant 49px header must not pull the opening
    // composition upward; the section absorbs that space as breathing room.
    const section = document.querySelector<HTMLElement>("[data-home-start]")!;
    expect(section.className).not.toContain("justify-center");
    expect(section.className).not.toContain("min-h-");
    expect(section.className).toContain("pt-24");
  });

  it("switches Paste and Attach file as exclusive input tabs with Paste selected by default", async () => {
    await render(HomeStartProject, { greeting: "Good morning" });

    const paste = document.querySelector<HTMLButtonElement>("[data-home-transcript-paste]")!;
    const attach = document.querySelector<HTMLButtonElement>("[data-home-transcript-attach]")!;
    expect(paste.getAttribute("role")).toBe("tab");
    expect(attach.getAttribute("role")).toBe("tab");
    expect(paste.getAttribute("aria-selected")).toBe("true");
    expect(attach.getAttribute("aria-selected")).toBe("false");
    expect(document.querySelector("[data-home-transcript-input]")).not.toBeNull();
    expect(document.querySelector("[data-home-transcript-attach-empty]")).toBeNull();

    attach.click();
    await expect.poll(() => attach.getAttribute("aria-selected")).toBe("true");
    expect(paste.getAttribute("aria-selected")).toBe("false");
    expect(document.querySelector("[data-home-transcript-input]")).toBeNull();
    expect(document.querySelector("[data-home-transcript-attach-empty]")).not.toBeNull();
    expect(document.querySelector("[data-home-transcript-browse]")?.textContent).toContain(
      "Choose file"
    );

    paste.click();
    await expect.poll(() => paste.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[data-home-transcript-input]")).not.toBeNull();
    expect(document.querySelector("[data-home-transcript-attach-empty]")).toBeNull();
  });

  it("keeps the composer disabled until title and transcript are present", async () => {
    await render(HomeStartProject, { greeting: "Good morning" });
    const submit = document.querySelector<HTMLButtonElement>("[data-home-start-submit]")!;
    const title = document.querySelector<HTMLInputElement>("[data-home-start-input]")!;
    const transcript = document.querySelector<HTMLTextAreaElement>("[data-home-transcript-input]")!;

    expect(submit.disabled).toBe(true);
    title.value = "Project with no source";
    title.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(submit.disabled).toBe(true);

    transcript.value = "Interview transcript text";
    transcript.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await expect.poll(() => submit.disabled).toBe(false);
  });

  it("opens a deliberately blank wizard from the separate intake action", async () => {
    await render(HomeStartProject, { greeting: "Good morning" });
    document.querySelector<HTMLFormElement>("[data-home-start-form]")!.requestSubmit();
    expect(__navigationCalls).toHaveLength(0);

    document.querySelector<HTMLButtonElement>("[data-home-start-blank]")!.click();
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/project/new");
    expect(takeProjectStart()).toEqual({ title: "", transcriptText: "", transcriptFileName: null });
  });
});
