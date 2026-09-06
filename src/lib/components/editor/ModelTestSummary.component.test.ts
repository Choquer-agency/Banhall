import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import ModelTestSummary from "./ModelTestSummary.svelte";

const query = "generations:getCandidateScoreSummary";
// The query is stubbed; this opaque fixture ID never reaches a Convex server.
const generationId = "generation-q5" as Id<"generations">;
const first = { optionPosition: 2, model: "model-a", label: "Model A", score: 3, qaScore: 61, chosen: false };
const second = { optionPosition: 2, model: "model-b", label: "Model B", score: 9, qaScore: 94, chosen: true };

function cells(container: HTMLElement) {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent?.replace(/\s+/g, " ").trim()),
  );
}

beforeEach(() => __resetConvexStub());

describe("ModelTestSummary row identity", () => {
  it("renders repeated positions with distinct labels", async () => {
    __setQueryData(query, { rows: [first, second] });
    const { container } = await render(ModelTestSummary, { generationId });
    expect(cells(container)).toEqual([
      ["Option 2", "Model A", "3/10", "61/100"],
      ["Option 2 Chosen", "Model B", "9/10", "94/100"],
    ]);
    for (const row of container.querySelectorAll("tbody tr")) {
      await expect.element(page.elementLocator(row)).toBeVisible();
    }
    await page.screenshot({ path: "../../../../.vitest-attachments/Q5/distinct-collision-after.png" });
  });

  it("preserves rows with identical positions and models, even when only scores differ", async () => {
    __setQueryData(query, { rows: [first, { ...first, score: 8 }] });
    const { container } = await render(ModelTestSummary, { generationId });
    expect(cells(container)).toEqual([
      ["Option 2", "Model A", "3/10", "61/100"],
      ["Option 2", "Model A", "8/10", "61/100"],
    ]);
    await page.screenshot({ path: "../../../../.vitest-attachments/Q5/collision-after.png" });
  });

  it("updates, reorders, adds and removes colliding rows through the mounted query", async () => {
    __setQueryData(query, { rows: [first] });
    const { container } = await render(ModelTestSummary, { generationId });
    expect(cells(container)).toEqual([["Option 2", "Model A", "3/10", "61/100"]]);

    __setQueryData(query, { rows: [first, second] });
    await tick();
    expect(cells(container)).toEqual([
      ["Option 2", "Model A", "3/10", "61/100"],
      ["Option 2 Chosen", "Model B", "9/10", "94/100"],
    ]);
    __setQueryData(query, { rows: [second, first] });
    await tick();
    expect(cells(container)).toEqual([
      ["Option 2 Chosen", "Model B", "9/10", "94/100"],
      ["Option 2", "Model A", "3/10", "61/100"],
    ]);
    for (const empty of [undefined, null]) {
      __setQueryData(query, empty);
      await tick();
      expect(container.querySelector("table")).toBeNull();
      expect(container.textContent?.trim()).toBe("");
      __setQueryData(query, { rows: [first, second] });
      await tick();
      expect(cells(container)).toEqual([
        ["Option 2", "Model A", "3/10", "61/100"],
        ["Option 2 Chosen", "Model B", "9/10", "94/100"],
      ]);
    }
    __setQueryData(query, { rows: [second, { ...first, label: "Model B", score: 0, qaScore: null }] });
    await tick();
    expect(cells(container)).toEqual([
      ["Option 2 Chosen", "Model B", "9/10", "94/100"],
      ["Option 2", "Model B", "0/10", "—"],
    ]);
    __setQueryData(query, { rows: [
      { ...first, label: "Renamed", score: 10, qaScore: 0, chosen: true },
      { ...second, score: 1, qaScore: null, chosen: false },
      { ...first, optionPosition: 1 },
    ] });
    await tick();
    expect(cells(container)).toEqual([
      ["Option 2 Chosen", "Renamed", "10/10", "0/100"],
      ["Option 2", "Model B", "1/10", "—"],
      ["Option 1", "Model A", "3/10", "61/100"],
    ]);
    __setQueryData(query, { rows: [second] });
    await tick();
    expect(cells(container)).toEqual([["Option 2 Chosen", "Model B", "9/10", "94/100"]]);
    __setQueryData(query, { rows: [] });
    await tick();
    expect(container.querySelector("table")).toBeNull();
    __setQueryData(query, { rows: [{ ...first }, { ...first }] });
    await tick();
    expect(cells(container)).toEqual([
      ["Option 2", "Model A", "3/10", "61/100"],
      ["Option 2", "Model A", "3/10", "61/100"],
    ]);
  });

  it("preserves unique rows in server order and existing headings", async () => {
    __setQueryData(query, { rows: [second, { ...first, optionPosition: 1 }] });
    const { container } = await render(ModelTestSummary, { generationId });
    expect([...container.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual([
      "Option", "Model", "Your score", "AI QA score",
    ]);
    expect(cells(container)).toEqual([
      ["Option 2 Chosen", "Model B", "9/10", "94/100"],
      ["Option 1", "Model A", "3/10", "61/100"],
    ]);
    await page.screenshot({ path: "../../../../.vitest-attachments/Q5/unique-current.png" });
  });

  it.each([undefined, null, { rows: [] }])("renders quietly for summary %j", async (summary) => {
    __setQueryData(query, summary);
    const { container } = await render(ModelTestSummary, { generationId });
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent?.trim()).toBe("");
  });
});
