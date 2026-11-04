import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
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

  it("shows a renamed title before save settles and restores the old title on refusal", async () => {
    let rejectSave!: (error: Error) => void;
    const save = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    await render(EditableText, {
      value: "Old title",
      placeholder: "Untitled project",
      label: "internal project title",
      variant: "heading",
      required: true,
      optimisticSave: true,
      onSave: () => save,
    });
    await page.getByRole("button", { name: "Edit internal project title" }).click();
    await page.getByRole("textbox", { name: "Edit internal project title" }).fill("New title");
    await page.getByRole("button", { name: "Save internal project title" }).click();
    await expect.element(page.getByRole("heading", { name: "New title" })).toBeVisible();
    rejectSave(new Error("refused"));
    await expect.element(page.getByRole("heading", { name: "Old title" })).toBeVisible();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Couldn’t save. Try again.");
  });
});
