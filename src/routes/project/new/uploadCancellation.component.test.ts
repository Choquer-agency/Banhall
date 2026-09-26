import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProject from "./+page.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setQueryData, __setMutationResult, __mutationCalls } from "$lib/test/convex-svelte-stub.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation, __navigationCalls } from "$lib/test/app-navigation-stub";
import { stashProjectStart } from "$lib/workspace/projectIntentHandoff";
import { addSupportingFiles, pasteSupportingText, startFromPage } from "./newProjectTestSupport";
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
  await expect.poll(() => document.querySelector("#title")).not.toBeNull();
  if (source === "attachment") {
    addSupportingFiles([new File(["Attached technical observations."], "supporting-notes.txt")]);
    await expect.poll(() => document.querySelector('[data-supporting-card][data-status="ready"]')).not.toBeNull();
  } else {
    await pasteSupportingText("Supporting technical observations.");
  }
  await startFromPage();
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
