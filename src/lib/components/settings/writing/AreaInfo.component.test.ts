import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import AreaInfo from "./AreaInfo.svelte";
import { WRITING_AREAS } from "$lib/settings/writingAreas";

const area = (key: string) => WRITING_AREAS.find((item) => item.key === key)!;
const trigger = () => document.querySelector<HTMLButtonElement>("[data-area-info]")!;
const panel = () => document.querySelector<HTMLElement>("[data-area-info-panel]");

describe("AreaInfo (2026-10-19 meeting)", () => {
  it("opens from the keyboard, closes on Escape and gives focus back to the button", async () => {
    await render(AreaInfo, { area: area("sentenceConstruction"), mode: "writer_choice" });
    expect(trigger().getAttribute("aria-label")).toBe("About Sentence length");
    expect(trigger().tagName).toBe("BUTTON");
    expect(panel()).toBeNull();

    await userEvent.tab();
    expect(document.activeElement).toBe(trigger());
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => panel()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    // The dialog is named by the area.
    const labelledBy = panel()!.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.textContent).toBe("Sentence length");
    expect(panel()!.querySelector("[data-area-info-rule]")?.textContent).toContain("No sentence runs over 40 words.");
    expect(panel()!.querySelector("[data-area-info-example]")?.textContent).toBe(
      "A 55-word sentence about three test runs is split into two shorter sentences.",
    );
    expect(panel()!.querySelector("[data-area-info-on]")?.textContent).toBe(
      "Your instructions set sentence length, voice and how sentences open. The no-dash rule still applies.",
    );

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => panel()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());

    await userEvent.keyboard(" ");
    await expect.poll(() => panel()).not.toBeNull();
  });

  it("opens on a click or tap and closes on a click outside", async () => {
    await render(AreaInfo, { area: area("bannedWords"), mode: "writer_choice" });
    const outside = document.body.appendChild(document.createElement("button"));
    outside.textContent = "Somewhere else";
    // Away from the panel, which opens below the button.
    outside.style.cssText = "position: fixed; right: 0; top: 0;";
    await userEvent.click(trigger());
    await expect.poll(() => panel()).not.toBeNull();
    await userEvent.click(outside);
    await expect.poll(() => panel()).toBeNull();
    outside.remove();
  });

  it("says why the switch is locked when the organization enforces the house rule", async () => {
    await render(AreaInfo, { area: area("repetitionCaps"), mode: "enforced" });
    await userEvent.click(trigger());
    await expect.poll(() => panel()?.querySelector("[data-area-info-mode]")?.textContent).toBe(
      "Your organization always applies this house rule, so its switch is locked.",
    );
  });
});
