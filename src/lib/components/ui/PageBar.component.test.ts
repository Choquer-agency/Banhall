import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import PageBarFixture from "./PageBarFixture.svelte";

describe("PageBar", () => {
  it("keeps the leading workflow control inside the existing 44px bar", async () => {
    await render(PageBarFixture);

    const bar = document.body.querySelector<HTMLElement>("[data-page-bar-fixture]")!;
    const workflow = document.body.querySelector<HTMLButtonElement>("button")!;
    const back = document.body.querySelector<HTMLAnchorElement>('a[href="/dashboard"]')!;
    expect(bar.getBoundingClientRect().height).toBe(44);
    expect(workflow.getBoundingClientRect().height).toBe(44);
    expect(back.getBoundingClientRect().height).toBe(44);
    expect(document.body.textContent).toContain("Back");
    expect(document.body.textContent).toContain("Workflow");
  });
});
