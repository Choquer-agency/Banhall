import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { tick } from "svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import PdReviewStart from "./PdReviewStart.svelte";
import { spreadsheetFixture } from "$lib/test/spreadsheetFixtures";
import { __mutationCalls, __resetConvexStub, __setQueryData, __setMutationResult } from "$lib/test/convex-svelte-stub.svelte";

afterEach(() => { vi.restoreAllMocks(); __resetConvexStub(); });

it.each(["project change", "unmount"])("cancels pending extraction on %s without uploading a stale document", async change => {
  __setQueryData("pdReviews:getReviewSourceDocument", null);
  const file = spreadsheetFixture("xlsx", true);
  const bytes = await file.arrayBuffer();
  let releaseRead: (buffer: ArrayBuffer) => void = () => {};
  const read = vi.spyOn(File.prototype, "arrayBuffer").mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }));
  const terminate = vi.spyOn(Worker.prototype, "terminate");
  // These are test registry identities, not server-issued Convex IDs.
  const view = await render(PdReviewStart, { projectId: "project-before" as Id<"projects"> });
  await tick();
  const input = document.querySelector('input[aria-label="Upload written PD"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing PD upload input");
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await expect.poll(() => read.mock.calls.length).toBe(1);
  if (change === "project change") await view.rerender({ projectId: "project-after" as Id<"projects"> });
  else await view.unmount();
  await expect.poll(() => terminate.mock.calls.length).toBe(1);
  // Complete the uncancelable File read after ownership changed. Its late
  // resolution must not restart the worker or continue the upload pipeline.
  releaseRead(bytes);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(__mutationCalls("documents:generateUploadUrl")).toEqual([]);
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
  expect(__mutationCalls("pdReviews:startPdReview")).toEqual([]);
});

it("stops a deferred original upload on owner change and accepts a fresh file for the new owner", async () => {
  __setQueryData("pdReviews:getReviewSourceDocument", null);
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/original");
  __setMutationResult("documents:uploadDocument", "stored-document");
  let uploadSignal: AbortSignal | null | undefined;
  const upload = vi.spyOn(globalThis, "fetch").mockImplementationOnce((_url, init) => {
    uploadSignal = init?.signal;
    return new Promise((_resolve, reject) => uploadSignal?.addEventListener("abort", () => reject(uploadSignal?.reason), { once: true }));
  }).mockResolvedValue(Response.json({ storageId: "original-bytes" }));
  const view = await render(PdReviewStart, { projectId: "project-before" as Id<"projects"> });
  const attach = () => {
    const input = document.querySelector('input[aria-label="Upload written PD"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing PD upload input");
    const files = new DataTransfer(); files.items.add(spreadsheetFixture("xlsx"));
    input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  attach();
  await expect.poll(() => upload.mock.calls.length).toBe(1);
  await view.rerender({ projectId: "project-after" as Id<"projects"> });
  await expect.poll(() => uploadSignal?.aborted).toBe(true);
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
  expect(__mutationCalls("pdReviews:startPdReview")).toEqual([]);
  await tick();
  attach();
  await expect.poll(() => __mutationCalls("pdReviews:startPdReview")).toEqual([{ projectId: "project-after", documentId: "stored-document" }]);
  expect(__mutationCalls("documents:uploadDocument")).toEqual([expect.objectContaining({ projectId: "project-after", fileName: "fixture.xlsx" })]);
});
