import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import { fillBasics, startButton } from "./newProjectTestSupport";

/**
 * Board E5: a file that is not a transcript replaces the drop zone with a red
 * box; a transcript with no text shows as its own red row with Replace file.
 * The Interview status and "Before you start" say how many can be read.
 */
const transcriptInput = () => document.querySelector<HTMLInputElement>("[data-transcript-input]")!;
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

function selectTranscripts(files: File[]) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  transcriptInput().files = transfer.files;
  transcriptInput().dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
});

describe("E5 file problems", () => {
  it("says a video is a video, in the danger box, with the real transcript formats", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-transcript-drop]")).not.toBeNull();
    selectTranscripts([new File(["x"], "FrostLine demo.mp4", { type: "video/mp4" })]);

    await expect.poll(() => document.querySelector("[data-transcript-wrong-file]")).not.toBeNull();
    const box = document.querySelector<HTMLElement>("[data-transcript-wrong-file]")!;
    expect(text(box)).toBe("FrostLine demo.mp4 is a video. Add transcripts as Word, VTT, SRT or text.");
    expect(document.querySelector("[data-transcript-drop]")).toBeNull();
    // E5: a dashed danger line on the white drop zone, the icon in #B91C1C
    // (16px, stroke 1.7), the title in danger ink and the line at 80%.
    expect(getComputedStyle(box).borderTopStyle).toBe("dashed");
    expect(box.className).toContain("border-[1.5px]");
    expect(getComputedStyle(box).borderTopColor).toBe("rgb(252, 165, 165)");
    expect(getComputedStyle(box).backgroundColor).toBe("rgb(255, 255, 255)");
    const icon = box.querySelector("svg")!;
    expect(getComputedStyle(icon).color).toBe("rgb(185, 28, 28)");
    expect([icon.getAttribute("width"), icon.getAttribute("stroke-width")]).toEqual(["16", "1.7"]);
    const [title, line] = [...box.querySelectorAll<HTMLElement>("span")];
    expect(getComputedStyle(title).color).toBe("rgb(153, 27, 27)");
    expect(getComputedStyle(line).color).toBe("rgba(185, 28, 28, 0.8)");
    expect(text(box)).not.toMatch(/PDF/);
  });

  it("names any other wrong file as not a transcript file", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-transcript-drop]")).not.toBeNull();
    selectTranscripts([new File(["x"], "budget.xlsx")]);
    await expect
      .poll(() => text(document.querySelector("[data-transcript-wrong-file]")))
      .toBe("budget.xlsx is not a transcript file. Add transcripts as Word, VTT, SRT or text.");
  });

  it("shows a transcript with no text as its own row with Replace file, and counts what can be read", async () => {
    await render(NewProjectPage, {});
    await fillBasics();
    selectTranscripts([
      new File(["Interviewer: What was uncertain?\n\nEngineer: The seal."], "Priya interview.txt"),
      new File(["   "], "Follow-up call.txt"),
    ]);

    await expect.poll(() => document.querySelector("[data-transcript-problem]")).not.toBeNull();
    const problem = document.querySelector<HTMLElement>("[data-transcript-problem]")!;
    expect(text(problem)).toContain("Follow-up call.txt");
    expect(text(problem)).toContain("We could not find any text in this file.");
    expect(problem.querySelector("[data-file-icon]")).not.toBeNull();
    const replace = [...problem.querySelectorAll("button")].find((button) => text(button) === "Replace file");
    expect(replace).not.toBeUndefined();

    await expect
      .poll(() => text(document.querySelector('[data-interview-status="problem"]')))
      .toBe("1 of 2 can be read");
    // E5: the status icon is the 13px, stroke 2 alert in #DC2626; the row
    // sits 4px off its neighbours in the red box.
    const statusIcon = document.querySelector<SVGElement>('[data-interview-status="problem"] svg')!;
    expect(getComputedStyle(statusIcon).color).toBe("rgb(220, 38, 38)");
    expect([statusIcon.getAttribute("width"), statusIcon.getAttribute("stroke-width")]).toEqual(["13", "2"]);
    expect(getComputedStyle(problem).marginTop).toBe("4px");
    const callout = problem.querySelector<HTMLElement>("[data-status-callout]")!;
    expect(getComputedStyle(callout).backgroundColor).toBe("rgb(254, 242, 242)");
    expect(getComputedStyle(callout).minHeight).toBe("52px");
    const row = document.querySelector<HTMLElement>('[data-checklist-row="unreadable"]')!;
    expect(row.dataset.state).toBe("danger");
    expect(text(row)).toContain("1 transcript could not be read");
    expect(text(row.querySelector("[data-checklist-action]"))).toBe("Fix");
    // Not blocking: the readable transcript can start.
    expect(startButton()?.disabled).toBe(false);
  });

  it("replaces the unreadable file in place and dismisses the row", async () => {
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-transcript-drop]")).not.toBeNull();
    selectTranscripts([new File([""], "Empty.txt")]);
    await expect.poll(() => document.querySelector("[data-transcript-problem]")).not.toBeNull();

    const replace = [...document.querySelectorAll<HTMLButtonElement>("[data-transcript-problem] button")].find(
      (button) => text(button) === "Replace file"
    )!;
    replace.click();
    selectTranscripts([new File(["Dana: Real words this time."], "Replacement.txt")]);
    await expect.poll(() => document.querySelector("[data-transcript-problem]")).toBeNull();
    await expect
      .poll(() => [...document.querySelectorAll("[data-transcript-item]")].map((row) => text(row)))
      .toEqual([expect.stringContaining("Replacement.txt")]);

    selectTranscripts([new File([""], "Empty again.txt")]);
    await expect.poll(() => document.querySelector("[data-transcript-problem]")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-transcript-problem] button[aria-label="Dismiss"]')!.click();
    await expect.poll(() => document.querySelector("[data-transcript-problem]")).toBeNull();
    expect(document.querySelector('[data-checklist-row="unreadable"]')).toBeNull();
  });
});
