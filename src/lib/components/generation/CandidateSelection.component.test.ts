import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import CandidateSelection from "./CandidateSelection.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";
import type { Id } from "../../../../convex/_generated/dataModel";

const sentence = "The fitted trial compared a coated window with the uncoated control at 254 nanometres.";
const paragraphs = (count: number, each: number) =>
  Array.from({ length: count }, () => Array.from({ length: each }, () => sentence).join(" ")).join("\n\n");

beforeEach(() => {
  __resetConvexStub();
  __setQueryData("users:getCurrentUser", { role: "consultant" });
  __setQueryData("reviews:getMyWriterReview", null);
  __setQueryData("reviews:getMyQaItemFeedback", []);
  __setQueryData("generations:getGenerationRecovery", null);
  __setQueryData("generations:getMyCandidateScores", []);
});

describe("CandidateSelection QA rail (2026-09-28, second)", () => {
  it("names a Compare option's Line that is over its CRA limit", async () => {
    __setQueryData("generations:getCandidates", [
      {
        _id: "candidate-1" as Id<"reportCandidates">,
        content: JSON.stringify(
          buildTiptapDocument("Fouling-resistant analyzer", paragraphs(2, 3), paragraphs(3, 4), paragraphs(6, 5))
        ),
        qaScore: null,
        qa: null,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
      },
    ]);
    const { container } = await render(CandidateSelection, {
      generationId: "generation-1" as Id<"generations">,
    });
    const rows = [...container.querySelectorAll<HTMLElement>("[data-qa-line-limit]")];
    expect(rows.map((row) => row.dataset.qaLineLimit)).toEqual(["246"]);
    expect(rows[0].textContent?.trim()).toBe(
      "Line 246 is over the CRA limit: 420 of 350 words, 41 of 50 lines. Shorten it before filing."
    );
  });
});
