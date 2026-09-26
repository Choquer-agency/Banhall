import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Switch from "./Switch.svelte";

describe("Switch (I3)", () => {
  it("draws the 32x18 track, primary when on and gray when off, and toggles by click and Space", async () => {
    const onCheckedChange = vi.fn();
    await render(Switch, { label: "Draft is ready", checked: true, onCheckedChange });
    const control = page.getByRole("switch", { name: "Draft is ready" });
    await expect.element(control).toHaveAttribute("aria-checked", "true");
    const element = control.element() as HTMLElement;
    const box = element.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([32, 18]);
    expect(getComputedStyle(element).backgroundColor).toBe("rgb(8, 122, 117)");
    const thumb = element.firstElementChild as HTMLElement;
    expect(thumb.getBoundingClientRect().width).toBe(14);

    await control.click();
    await expect.element(control).toHaveAttribute("aria-checked", "false");
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    await expect.poll(() => getComputedStyle(element).backgroundColor).toBe("rgb(194, 208, 205)");

    element.focus();
    await userEvent.keyboard(" ");
    await expect.element(control).toHaveAttribute("aria-checked", "true");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
  });
});
