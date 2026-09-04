import { describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";
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
 * - the tokens the removed literals carried (incl. the 44px `min-h-11`
 *   target via the `class` prop),
 * - onclick still firing on the button branch.
 */
const label = createRawSnippet(() => ({ render: () => `<span>Go</span>` }));

/** Classes every removed anchor literal carried (variant-independent core). */
const CORE_TOKENS = [
  "inline-flex",
  "items-center",
  "justify-center",
  "rounded-lg",
  "px-4",
  "text-sm",
  "font-medium",
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-offset-2",
];

describe("Button", () => {
  it("renders an anchor with the variant classes and min-h-11 passthrough when href is set", async () => {
    await render(Button, { href: "/project/new", class: "min-h-11", children: label });

    const anchor = document.body.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(document.body.querySelector("button")).toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/project/new");
    expect(anchor?.textContent).toContain("Go");

    const classes = anchor?.className ?? "";
    for (const token of [...CORE_TOKENS, "min-h-11"]) expect(classes).toContain(token);
    // Primary variant (default) consumes the theme-aware action role.
    for (const token of ["bg-action-primary", "text-action-primary-foreground", "hover:bg-action-primary-hover", "focus-visible:ring-action-primary"])
      expect(classes).toContain(token);
  });

  it.each([undefined, "/project/new"])("transitions colors and opacity with a reduced-motion escape (href=%s)", async (href) => {
    await render(Button, { href, children: label });
    const control = document.querySelector<HTMLElement>(href ? "a" : "button")!;
    expect(getComputedStyle(control).transitionProperty).toBe("color, background-color, border-color, opacity");
    expect(getComputedStyle(control).transitionDuration).toBe("0.2s");
    try {
      await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
      expect(getComputedStyle(control).transitionProperty).toBe("none");
    } finally {
      await cdp().send("Emulation.setEmulatedMedia", { features: [] });
    }
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
    const onclick = vi.fn();
    const view = await render(Button, { disabled: true, onclick, children: label });
    document.body.querySelector("button")?.click();
    expect(onclick).not.toHaveBeenCalled();
    expect(document.body.querySelector("button")?.disabled).toBe(true);
    view.unmount();

    // Anchors never receive the attribute (invalid on <a>); callers do not
    // pass disabled with href, but the branch must not forward it anyway.
    await render(Button, { href: "/x", disabled: true, children: label });
    expect(document.body.querySelector("a")?.hasAttribute("disabled")).toBe(false);
  });
});
