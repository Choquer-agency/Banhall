import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProject from "./+page.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setQueryData, __setMutationResult, __mutationCalls } from "$lib/test/convex-svelte-stub.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation, __navigationCalls } from "$lib/test/app-navigation-stub";
import { stashProjectStart } from "$lib/workspace/projectIntentHandoff";
afterEach(() => vi.restoreAllMocks());
it.each([
  { outcome: "resolve", source: "paste" },
  { outcome: "reject", source: "paste" },
  { outcome: "reject", source: "attachment" },
])("does not generate, navigate or record failure when final $source mutation $outcome follows unmount", async ({ outcome, source }) => {
  __resetAuthState(); __resetConvexStub(); __resetNavigation(); __resetPage();
  __setPageUrl("/project/new?client=Test%20client");
  stashProjectStart({ title: "Cancellation boundary" });
  __setQueryData("users:getCurrentUser", { _id: "writer", firstName: "Test", lastName: "Writer", role: "writer" });
  __setQueryData("tags:listTags", []);
  __setMutationResult("projects:createProject", { projectId: "created-project", transcriptIds: [] });
  let finish: (value: string) => void = () => {};
  let fail: (error: Error) => void = () => {};
  __setMutationResult("documents:uploadDocument", new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/original");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ storageId: "original-bytes" }));
  const view = await render(NewProject);
  await page.getByRole("button", { name: /^Writer's notes/ }).click();
  if (source === "attachment") {
    const input = document.querySelector('[aria-label="Writer\'s notes files"] input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Writer notes upload input missing");
    const files = new DataTransfer();
    files.items.add(new File(["Attached technical observations."], "supporting-notes.txt"));
    input.files = files.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const paste = [...document.querySelectorAll("button")].find(button => button.textContent?.includes("Paste text instead"));
    if (!paste) throw new Error("Context paste control missing");
    paste.click();
    await page.getByPlaceholder("Paste text, notes, or links").fill("Supporting technical observations.");
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Generate Report", exact: true }).click();
  await expect.poll(() => __mutationCalls("documents:uploadDocument").length).toBe(1);
  if (source === "attachment") {
    expect(__mutationCalls("documents:uploadDocument")).toEqual([expect.objectContaining({ fileName: "supporting-notes.txt", content: "Attached technical observations.", storageId: "original-bytes" })]);
  }
  await view.unmount();
  if (outcome === "resolve") finish("document"); else fail(new Error("late mutation failure"));
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
  expect(__mutationCalls("pdReviews:startPdReview")).toEqual([]);
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
  expect(__navigationCalls).toEqual([]);
});
