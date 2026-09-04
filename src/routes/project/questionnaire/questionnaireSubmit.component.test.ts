import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import QuestionnairePage from "./+page.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * The self-serve questionnaire is the other writer of `createProject`: it
 * folds its answers into a single transcript, so it must send the same
 * `transcripts: [...]` list shape as the wizard and no transcript id to
 * generation.
 */
function buttonByText(text: string) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
}

async function clickText(text: string) {
  await expect.poll(() => buttonByText(text)?.disabled).toBe(false);
  buttonByText(text)!.click();
}

function setInputValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Walks the wizard from the first question to the review step. */
async function advanceToReview() {
  for (let i = 0; i < 8; i += 1) await clickText("Next");
  await clickText("Review");
  await expect
    .poll(() => document.body.textContent)
    .toContain("Review & Submit");
}

beforeEach(() => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  __setQueryData("users:getMyUser", {
    _id: "user-1",
    role: "writer",
    firstName: "Wendy",
  });
});

describe("/project/questionnaire submit", () => {
  it("sends one labelled transcript item and no transcript id to generation", async () => {
    __setMutationResult("projects:createProject", {
      projectId: "project-q",
      transcriptIds: ["transcript-q"],
    });
    await render(QuestionnairePage, {});

    await clickText("Back");
    await expect.poll(() => document.querySelector("#title")).not.toBeNull();
    setInputValue("#title", "Project Verdant F2024");
    setInputValue("#clientName", "GreenStem Nurseries Inc.");
    await clickText("Start Questionnaire");

    await expect.poll(() => document.querySelector("textarea")).not.toBeNull();
    const answer = document.querySelector<HTMLTextAreaElement>("textarea")!;
    answer.value = "A 50-person horticulture company in BC.";
    answer.dispatchEvent(new Event("input", { bubbles: true }));

    await advanceToReview();
    await clickText("Generate Report");

    await expect
      .poll(() => __mutationCalls("projects:createProject").length)
      .toBe(1);
    const created = __mutationCalls("projects:createProject")[0] as {
      title: string;
      clientName: string;
      transcripts: Array<{ content: string; label: string }>;
    };
    expect(created.title).toBe("Project Verdant F2024");
    expect(created.clientName).toBe("GreenStem Nurseries Inc.");
    expect(created.transcripts).toHaveLength(1);
    expect(created.transcripts[0].label).toBe("Questionnaire answers");
    expect(created.transcripts[0].content).toContain(
      "## Company Background\nQ: Describe your company"
    );
    expect(created.transcripts[0].content).toContain(
      "A: A 50-person horticulture company in BC."
    );
    expect(created.transcripts[0].content).toContain("[No response provided]");

    await expect
      .poll(() => __mutationCalls("generations:requestGeneration").length)
      .toBe(1);
    expect(__mutationCalls("generations:requestGeneration")[0]).toEqual({
      projectId: "project-q",
    });
  });
});
