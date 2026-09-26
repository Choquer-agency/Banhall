import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Switch from "./Switch.svelte";

describe("Switch (I2, I3)", () => {
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

  it("md (I2) draws the 36x20 track, fir when on and gray when off, with a 16px thumb", async () => {
    await render(Switch, { label: "Word list", size: "md", checked: true });
    const control = page.getByRole("switch", { name: "Word list" });
    const element = control.element() as HTMLElement;
    const box = element.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([36, 20]);
    expect(getComputedStyle(element).backgroundColor).toBe("rgb(10, 58, 56)");
    const thumb = element.firstElementChild as HTMLElement;
    expect(thumb.getBoundingClientRect().width).toBe(16);
    // On: the thumb sits at the right edge, 2px in.
    await expect.poll(() => box.right - thumb.getBoundingClientRect().right).toBe(2);

    await control.click();
    await expect.element(control).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => getComputedStyle(element).backgroundColor).toBe("rgb(194, 208, 205)");
    await expect.poll(() => thumb.getBoundingClientRect().left - box.left).toBe(2);
  });
});
