/**
 * 2026-09-09 alert: "storage upload failed Failed to fetch" right after
 * "Review PD". The recovery card's byte upload now goes through the shared
 * uploadOriginal transport (retry once with a fresh URL, bounded POST), and
 * transport exhaustion still starts a text-only review.
 */
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import PdReviewStart from "./PdReviewStart.svelte";
import { __mutationCalls, __resetConvexStub, __setQueryData, __setMutationResult } from "$lib/test/convex-svelte-stub.svelte";

afterEach(() => { vi.restoreAllMocks(); __resetConvexStub(); });

async function mountAndAttach() {
  __setQueryData("pdReviews:getReviewSourceDocument", null);
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/original");
  __setMutationResult("documents:uploadDocument", "stored-document");
  await render(PdReviewStart, { projectId: "project-1" as Id<"projects"> });
  const input = document.querySelector('input[aria-label="Upload written PD"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing PD upload input");
  const files = new DataTransfer();
  files.items.add(new File(["Written PD body"], "pd.txt", { type: "text/plain" }));
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

it("retries a failed byte POST with a fresh URL and starts the review with the stored original", async () => {
  const upload = vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(async () => {
      __setMutationResult("documents:generateUploadUrl", "https://upload.test/second");
      throw new TypeError("Failed to fetch");
    })
    .mockResolvedValueOnce(Response.json({ storageId: "original-bytes" }));
  await mountAndAttach();
  await expect.poll(() => __mutationCalls("pdReviews:startPdReview")).toEqual([
    { projectId: "project-1", documentId: "stored-document" },
  ]);
  // Each attempt acquires its own upload URL; the first one is never reused.
  expect(upload.mock.calls.map((call) => call[0])).toEqual([
    "https://upload.test/original",
    "https://upload.test/second",
  ]);
  expect(__mutationCalls("documents:generateUploadUrl")).toHaveLength(2);
  expect(__mutationCalls("documents:uploadDocument")).toEqual([
    expect.objectContaining({ projectId: "project-1", fileName: "pd.txt", storageId: "original-bytes", source: "review_pd" }),
  ]);
  expect(document.querySelector('[data-pd-review-start] [role="alert"]')).toBeNull();
});

it("starts a text-only review when both byte uploads fail", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const upload = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
  await mountAndAttach();
  await expect.poll(() => __mutationCalls("pdReviews:startPdReview")).toEqual([
    { projectId: "project-1", documentId: "stored-document" },
  ]);
  expect(upload).toHaveBeenCalledTimes(2);
  const [documentArgs] = __mutationCalls("documents:uploadDocument");
  expect(documentArgs).toEqual(expect.objectContaining({ fileName: "pd.txt", content: "Written PD body" }));
  expect(documentArgs).not.toHaveProperty("storageId");
  expect(error).toHaveBeenCalledWith("storage upload failed", expect.any(TypeError));
  expect(document.querySelector('[data-pd-review-start] [role="alert"]')).toBeNull();
});
