import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import StatusCallout from "./StatusCallout.svelte";

const paragraph = createRawSnippet(() => ({ render: () => `<p data-testid="body">Adaptive cold storage controls, Drafting.</p>` }));
const customIcon = createRawSnippet(() => ({ render: () => `<span data-testid="custom-icon"></span>` }));

const box = () => document.body.querySelector<HTMLElement>("[data-status-callout]")!;
const colour = (element: Element | null) => getComputedStyle(element!).color;
const fill = (element: Element | null) => getComputedStyle(element!).backgroundColor;

// Box surface, border, title ink, paragraph ink, primary action fill.
const FAMILIES = {
  danger: ["rgb(254, 242, 242)", "rgb(252, 165, 165)", "rgb(153, 27, 27)", "rgb(185, 28, 28)", "rgb(220, 38, 38)"],
  warning: ["rgb(255, 251, 235)", "rgb(253, 230, 138)", "rgb(146, 64, 14)", "rgb(180, 83, 9)", "rgb(180, 83, 9)"],
  success: ["rgb(240, 253, 244)", "rgb(187, 247, 208)", "rgb(22, 101, 52)", "rgb(21, 128, 61)", "rgb(21, 128, 61)"],
} as const;

describe("StatusCallout", () => {
  it("keeps the box, paragraph and buttons in the box's own colour family", async () => {
    for (const [tone, [surface, border, title, body, action]] of Object.entries(FAMILIES)) {
      const view = await render(StatusCallout, {
        tone: tone as keyof typeof FAMILIES,
        title: "Cedarline already has this project for FY 2026",
        children: paragraph,
        primaryAction: { label: "Open that project" },
        secondaryAction: { label: "It is a different project" },
      });
      const root = box();
      expect(root.dataset.statusCallout).toBe(tone);
      expect(fill(root)).toBe(surface);
      expect(getComputedStyle(root).borderTopColor).toBe(border);
      expect(colour(root.querySelector("p.font-medium"))).toBe(title);
      expect(colour(root.querySelector('[data-testid="body"]'))).toBe(body);

      const [primary, secondary] = root.querySelectorAll("button");
      expect(primary.textContent).toBe("Open that project");
      expect(fill(primary)).toBe(action);
      expect(colour(primary)).toBe("rgb(255, 255, 255)");
      expect(secondary.textContent).toBe("It is a different project");
      expect(colour(secondary)).toBe(title);
      expect(getComputedStyle(secondary).textDecorationLine).toBe("underline");
      view.unmount();
    }
  });

  it("runs the actions and renders an href action as a link", async () => {
    const onclick = vi.fn();
    await render(StatusCallout, {
      tone: "warning",
      title: "Project already exists",
      primaryAction: { label: "Open that project", href: "/project/abc" },
      secondaryAction: { label: "It is a different project", onclick },
    });
    const link = box().querySelector("a");
    expect(link?.getAttribute("href")).toBe("/project/abc");
    expect(link?.textContent).toBe("Open that project");
    box().querySelector("button")!.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it("puts the actions under the text when stacked", async () => {
    await render(StatusCallout, {
      tone: "danger",
      title: "Two files could not be read",
      children: paragraph,
      primaryAction: { label: "Replace file" },
    });
    const button = box().querySelector("button")!;
    const title = box().querySelector("p.font-medium")!;
    expect(button.getBoundingClientRect().top).toBeGreaterThan(title.getBoundingClientRect().bottom);
  });

  it("keeps one row in the inline layout, with a custom icon and a dismiss control", async () => {
    const onDismiss = vi.fn();
    await render(StatusCallout, {
      tone: "danger",
      layout: "inline",
      title: "Follow-up call, Sep 19.pdf",
      children: paragraph,
      icon: customIcon,
      primaryAction: { label: "Replace file" },
      onDismiss,
      dismissLabel: "Remove file",
    });
    const iconSlot = box().querySelector('[data-testid="custom-icon"]')?.parentElement;
    expect(iconSlot).toBeTruthy();
    // The custom icon replaces the tone icon; the only svg left is the dismiss X.
    expect(iconSlot?.querySelector("svg")).toBeNull();
    expect(box().querySelectorAll("svg")).toHaveLength(1);

    const replace = [...box().querySelectorAll("button")].find((b) => b.textContent === "Replace file")!;
    const title = box().querySelector("p.font-medium")!;
    expect(replace.getBoundingClientRect().left).toBeGreaterThan(title.getBoundingClientRect().left);
    expect(Math.abs(replace.getBoundingClientRect().top - title.getBoundingClientRect().top)).toBeLessThan(24);

    const dismiss = box().querySelector<HTMLButtonElement>('button[aria-label="Remove file"]')!;
    expect(colour(dismiss)).toBe("rgb(220, 38, 38)");
    dismiss.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses the solid status colour for the default icon and passes the role through", async () => {
    await render(StatusCallout, { tone: "success", title: "Invite sent", role: "status" });
    expect(box().getAttribute("role")).toBe("status");
    expect(colour(box().querySelector("svg")?.parentElement ?? null)).toBe("rgb(22, 163, 74)");
  });
});
