import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import SelectInput from "./SelectInput.svelte";

const items = [
  { value: "updated", label: "Recently edited" },
  { value: "created", label: "Recently created" },
];

describe("SelectInput accessible name", () => {
  it("uses the explicit ariaLabel when provided", async () => {
    await render(SelectInput, { items, value: "updated", ariaLabel: "Sort projects" });
    expect(document.querySelector('input[aria-label="Sort projects"]')).not.toBeNull();
  });

  it("falls back to the placeholder for existing callers", async () => {
    await render(SelectInput, { items, value: "", placeholder: "Stage" });
    expect(document.querySelector('input[aria-label="Stage"]')).not.toBeNull();
  });
});
