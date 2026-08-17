import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Input from "./Input.svelte";

describe("Input borderless field contract", () => {
  it("uses no perimeter and keeps the focus indicator inset", async () => {
    await render(Input, { id: "name", label: "Name" });
    const input = document.querySelector<HTMLInputElement>("#name")!;

    expect(input.classList.contains("field-control")).toBe(true);
    expect(getComputedStyle(input).borderTopWidth).toBe("0px");

    await userEvent.tab();
    expect(document.activeElement).toBe(input);
    expect(input.matches(":focus-visible")).toBe(true);
    await expect.poll(() => getComputedStyle(input).boxShadow).not.toContain("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(input).boxShadow).toContain("inset");
  });

  it("marks errors semantically and paints validation inside the field", async () => {
    await render(Input, { id: "email", label: "Email", error: "Email is required" });
    const input = document.querySelector<HTMLInputElement>("#email")!;

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(getComputedStyle(input).borderTopWidth).toBe("0px");
    expect(getComputedStyle(input).boxShadow).toContain("inset");
  });
});
