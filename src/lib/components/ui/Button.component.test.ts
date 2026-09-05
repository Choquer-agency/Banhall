import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import Button from "./Button.svelte";

/**
 * Button renders either a real <button> or — when `href` is set — an <a>
 * sharing the exact same computed class string. The anchor branch replaced
 * five hand-copied class literals on the unflagged dashboard CTAs and the
 * gate's sign-in link (2026-08-06 hardening slice), so these tests pin:
 *
 * - tag choice and href passthrough,
 * - class parity between the two branches (no style fork),
 * - the 44px `min-h-11` target passed through the `class` prop,
 * - the variant's theme-aware action role,
 * - onclick still firing on the button branch.
 *
 * The historical inventory of layout/transition utilities is deliberately not
 * pinned: it mirrored the implementation rather than a contract, and went
 * stale when 113ef7c broadened the transition to include opacity. Geometry and
 * colour are asserted through computed style or a caller's own measurement.
 */
const label = createRawSnippet(() => ({ render: () => `<span>Go</span>` }));

describe("Button", () => {
  it("renders an anchor with the variant classes and min-h-11 passthrough when href is set", async () => {
    await render(Button, { href: "/project/new", class: "min-h-11", children: label });

    const anchor = document.body.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(document.body.querySelector("button")).toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/project/new");
    expect(anchor?.textContent).toContain("Go");

    const classes = anchor?.className ?? "";
    expect(classes).toContain("min-h-11");
    expect(anchor!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    // Primary variant (default) consumes the theme-aware action role.
    for (const token of ["bg-action-primary", "text-action-primary-foreground", "hover:bg-action-primary-hover", "focus-visible:ring-action-primary"])
      expect(classes).toContain(token);
  });

  it("renders the secondary variant anchor with the secondary tokens", async () => {
    await render(Button, {
      href: "/login",
      variant: "secondary",
      class: "min-h-11",
      children: label,
    });

    const classes = document.body.querySelector("a")?.className ?? "";
    for (const token of ["bg-chrome", "text-ink", "border-line", "hover:bg-primary-wash", "min-h-11"])
      expect(classes).toContain(token);
  });

  it("maps the default action to accessible brand pairs in light and dark themes", async () => {
    const lightView = await render(Button, { children: label });
    const lightButton = document.body.querySelector("button")!;
    expect(getComputedStyle(lightButton).backgroundColor).toBe("rgb(8, 122, 117)");
    expect(getComputedStyle(lightButton).color).toBe("rgb(255, 255, 255)");
    lightView.unmount();

    document.body.setAttribute("data-workspace-theme", "dark");
    await render(Button, { children: label });
    const darkButton = document.body.querySelector("button")!;
    expect(getComputedStyle(darkButton).backgroundColor).toBe("rgb(43, 193, 186)");
    expect(getComputedStyle(darkButton).color).toBe("rgb(10, 58, 56)");
    document.body.removeAttribute("data-workspace-theme");
  });

  it("keeps the anchor and button class strings identical for the same props (no branch drift)", async () => {
    const anchorView = await render(Button, { href: "/x", class: "min-h-11", children: label });
    const anchorClasses = document.body.querySelector("a")?.className;
    anchorView.unmount();

    await render(Button, { class: "min-h-11", children: label });
    const buttonClasses = document.body.querySelector("button")?.className;

    expect(anchorClasses).toBeTruthy();
    expect(anchorClasses).toBe(buttonClasses);
  });

  it("renders a button without href and fires onclick", async () => {
    const onclick = vi.fn();
    await render(Button, { onclick, children: label });

    const button = document.body.querySelector("button");
    expect(button).not.toBeNull();
    expect(document.body.querySelector("a")).toBeNull();
    button?.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it("keeps disabled on the button branch only", async () => {
    const view = await render(Button, { disabled: true, children: label });
    expect(document.body.querySelector("button")?.disabled).toBe(true);
    view.unmount();

    // Anchors never receive the attribute (invalid on <a>); callers do not
    // pass disabled with href, but the branch must not forward it anyway.
    await render(Button, { href: "/x", disabled: true, children: label });
    expect(document.body.querySelector("a")?.hasAttribute("disabled")).toBe(false);
  });
});
