import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import EditableText from "./EditableText.svelte";

describe("EditableText interaction state", () => {
  it("reveals the heading editor without auto-focusing or hover-coloring it", async () => {
    await render(EditableText, {
      value: "Project 25135",
      placeholder: "Untitled project",
      label: "internal project title",
      variant: "heading",
      required: true,
      onSave: vi.fn(),
    });

    await userEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label="Edit internal project title"]')!);

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Edit internal project title"]')!;
    expect(input.classList.contains("field-control--quiet")).toBe(true);
    expect(document.activeElement).not.toBe(input);
    expect(input.matches(":focus")).toBe(false);
    expect(getComputedStyle(input).borderTopWidth).toBe("0px");

    const background = getComputedStyle(input).backgroundColor;
    await userEvent.hover(input);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(input.matches(":hover")).toBe(true);
    expect(getComputedStyle(input).backgroundColor).toBe(background);
  });
});
