import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import CurrentWorkLedgerFixture from "./CurrentWorkLedgerFixture.svelte";

describe("Current My Work ledger presentation", () => {
  it("uses semantic desktop table headers and explicit due text", async () => {
    await render(CurrentWorkLedgerFixture);
    expect(document.querySelectorAll('th[scope="col"]')).toHaveLength(6);
    expect(document.body.textContent).toContain("Due today");
    expect(document.body.textContent).toContain("With Morgan Manager");
  });

  it("keeps mobile data order and 44px actions", async () => {
    await render(CurrentWorkLedgerFixture, { mobile: true });
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Work")).toBeLessThan(text.indexOf("Due"));
    expect(text.indexOf("Due")).toBeLessThan(text.indexOf("With"));
    for (const button of document.querySelectorAll("button")) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
