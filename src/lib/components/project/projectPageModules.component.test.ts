import { afterEach, describe, expect, it, vi } from "vitest";
import { isProjectPageLink, preloadOnProjectLinkIntent } from "./projectPageModules";

/**
 * 2026-09-28 load measurement: Home and Projects start loading the project
 * page as soon as a project link is hovered, touched or focused, so the
 * click that follows never waits on the page's code.
 */
const link = (href: string, target?: string) => {
  const anchor = document.createElement("a");
  anchor.href = href;
  if (target) anchor.target = target;
  anchor.innerHTML = "<span>Open</span>";
  document.body.append(anchor);
  return anchor;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("project page links", () => {
  it("recognises same-origin project pages only", () => {
    expect(isProjectPageLink(link("/project/k970abc"))).toBe(true);
    expect(isProjectPageLink(link("/project/k970abc/?tab=report"))).toBe(true);
    expect(isProjectPageLink(link("/project/new"))).toBe(false);
    expect(isProjectPageLink(link("/project/questionnaire"))).toBe(false);
    expect(isProjectPageLink(link("/project/k970abc/financial"))).toBe(false);
    expect(isProjectPageLink(link("/projects"))).toBe(false);
    expect(isProjectPageLink(link("https://example.com/project/k970abc"))).toBe(false);
    expect(isProjectPageLink(link("/project/k970abc", "_blank"))).toBe(false);
  });

  it("loads the page once on the first hover, focus or touch of a project link", () => {
    const load = vi.fn(async () => ({ default: null }));
    const stop = preloadOnProjectLinkIntent(document, load);
    const other = link("/projects");
    const project = link("/project/k970abc");

    other.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(load).not.toHaveBeenCalled();

    project.querySelector("span")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    project.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);

    stop();
  });

  it("asks again after a failed load and stops listening once removed", async () => {
    const load = vi.fn(async () => {
      throw new Error("offline");
    });
    const stop = preloadOnProjectLinkIntent(document, load);
    const project = link("/project/k970abc");

    project.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    project.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(2);

    stop();
    await Promise.resolve();
    project.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
