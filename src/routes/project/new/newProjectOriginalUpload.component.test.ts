import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { Toaster, toast } from "svelte-sonner";
import { takeOutboxFor } from "$lib/uploads/attemptOutbox";
import JSZip from "jszip";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-state-stub.svelte";
import { __mutationCalls, __resetConvexStub, __setMutationResult, __setMutationError, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

async function docxFile(name: string, words: string[]) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${words.join(
      " "
    )}</w:t></w:r></w:p></w:body></w:document>`
  );
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function click(text: string) {
  const find = () => [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
  await expect.poll(() => find()?.disabled).toBe(false);
  find()?.click();
}
async function submitReview(context = false) {
  await page.viewport(1280, 900);
  await render(Toaster, { richColors: true, position: "top-right" });
  await render(NewProjectPage, {});
  await expect.poll(() => document.querySelector('#title')).not.toBeNull();
  for (const [id, value] of [["title", "Solar tracker"], ["clientName", "Acme Labs"]]) {
    const input = document.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) throw new Error("Missing field");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (!context) {
    const radio = document.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="false"]');
    if (!radio) throw new Error("Missing review mode");
    radio.click();
    await expect.poll(() => document.body.textContent).toContain("Written PD to review");
  } else {
    const category = document.querySelector<HTMLButtonElement>('[role="region"][aria-label$=" files"] button');
    if (!category) throw new Error("Missing context category");
    category.click();
    await expect.poll(() => document.querySelector('[role="region"][aria-label$=" files"] input[type="file"]')).not.toBeNull();
  }
  const input = document.querySelector<HTMLInputElement>(context
    ? '[role="region"][aria-label$=" files"] input[type="file"]'
    : 'input[type="file"]:not([accept=".docx"])');
  if (!input) throw new Error("Missing PD input");
  const file = await docxFile("Review.docx", ["Experimental", "solar", "tracking"]);
  const transfer = new DataTransfer(); transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await expect.poll(() => document.body.textContent).toContain(context ? "Review.docx" : "3 words extracted");
  await click("Next");
  await click(context ? "Generate Report" : "Review PD");
  return file;
}
beforeEach(() => {
  localStorage.clear(); __resetPage(); __resetNavigation(); __resetAuthState(); __resetConvexStub();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("users:getMyUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setMutationResult("projects:createProject", { projectId: "project-new", transcriptIds: [] });
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/first");
  __setMutationResult("documents:uploadDocument", "document-1");
});
afterEach(async () => {
  try {
    // Remove oldest first and let each real exit finish before the next one.
    for (const active of [...toast.getActiveToasts()].reverse()) {
      const count = document.querySelectorAll('[data-sonner-toast]').length;
      toast.dismiss(active.id);
      await expect.poll(() => document.querySelectorAll('[data-sonner-toast]').length).toBe(count - 1);
    }
    await expect.poll(() => document.querySelectorAll('[data-sonner-toast]').length).toBe(0);
  } finally {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("retries the original with a fresh URL and preserves DOCX bytes, MIME and review payload", async () => {
  const warning = vi.spyOn(toast, "warning");
  const transport = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
    __setMutationResult("documents:generateUploadUrl", "https://upload.test/second");
    throw new Error("temporary transport failure");
  }).mockResolvedValueOnce(Response.json({ storageId: "storage-second" }));
  vi.stubGlobal("fetch", transport);
  const file = await submitReview();
  await expect.poll(() => __mutationCalls("pdReviews:startPdReview").length).toBe(1);
  expect(transport.mock.calls.map(call => call[0])).toEqual(["https://upload.test/first", "https://upload.test/second"]);
  expect(transport.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: file, headers: { "Content-Type": file.type } });
  expect(__mutationCalls("documents:uploadDocument")).toEqual([expect.objectContaining({ storageId: "storage-second", source: "review_pd", content: expect.stringContaining("Experimental solar tracking"), mimeType: file.type, attemptKey: expect.any(String) })]);
  expect(__mutationCalls("pdReviews:startPdReview")).toEqual([{ projectId: "project-new", documentId: "document-1" }]);
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
  expect(warning).not.toHaveBeenCalled();
});

it("warns once only after text persists and before starting review", async () => {
  const save = deferred<string>();
  __setMutationResult("documents:uploadDocument", save.promise);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
  const realWarning = toast.warning;
  const warning = vi.spyOn(toast, "warning").mockImplementation((...args) => {
    expect(__mutationCalls("pdReviews:startPdReview")).toEqual([]);
    return realWarning(...args);
  });
  await submitReview();
  await expect.poll(() => __mutationCalls("documents:uploadDocument").length).toBe(1);
  expect(warning).not.toHaveBeenCalled();
  expect(__mutationCalls("pdReviews:startPdReview")).toEqual([]);
  save.resolve("document-text-fallback");
  await expect.poll(() => __mutationCalls("pdReviews:startPdReview").length).toBe(1);
  await new Promise(resolve => setTimeout(resolve, 400));
  await page.screenshot({ path: "../../../../.vitest-attachments/Q7-warning-observed.png" });
  expect(__mutationCalls("pdReviews:startPdReview")).toEqual([{ projectId: "project-new", documentId: "document-text-fallback" }]);
  expect(warning).toHaveBeenCalledExactlyOnceWith("The PD text was saved, but the original file ‘Review.docx’ could not be uploaded.");
  expect(__mutationCalls("documents:uploadDocument")[0]).not.toHaveProperty("storageId");
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
});


it("keeps the saved-text warning truthful when review start rejects", async () => {
  const save = deferred<string>();
  __setMutationResult("documents:uploadDocument", save.promise);
  __setMutationError("pdReviews:startPdReview", new Error("review start failed"));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
  const warning = vi.spyOn(toast, "warning");
  const error = vi.spyOn(toast, "error");
  await submitReview();
  await expect.poll(() => __mutationCalls("documents:uploadDocument").length).toBe(1);
  expect(warning).not.toHaveBeenCalled();
  save.resolve("document-saved-before-rejection");
  await expect.poll(() => error.mock.calls.length).toBe(2);
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(warning).toHaveBeenCalledExactlyOnceWith("The PD text was saved, but the original file ‘Review.docx’ could not be uploaded.");
  expect(__mutationCalls("pdReviews:startPdReview")).toEqual([{ projectId: "project-new", documentId: "document-saved-before-rejection" }]);
  expect(error.mock.calls).toEqual([
    ["review start failed"],
    ["The project was created but the PD review did not start — open it and use Start PD review to retry."],
  ]);
  await expect.poll(() => document.body.textContent).toContain("The project was created but the PD review did not start");
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
});

it.each([false, true])("keeps the failed text-save accounting (outbox=%s) without a saved-text warning or review start", async (offlineAccounting) => {
  if (offlineAccounting) __setMutationError("uploadAttempts:recordUploadAttempts", new Error("offline accounting"));
  const save = deferred<string>();
  __setMutationResult("documents:uploadDocument", save.promise);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
  const warning = vi.spyOn(toast, "warning");
  await submitReview();
  await expect.poll(() => __mutationCalls("documents:uploadDocument").length).toBe(1);
  save.reject(new Error("text save failed"));
  await expect.poll(() => __mutationCalls("uploadAttempts:recordUploadAttempts").length).toBe(1);
  expect(__mutationCalls("pdReviews:startPdReview")).toEqual([]);
  expect(warning).not.toHaveBeenCalled();
  if (offlineAccounting) {
    await expect.poll(() => takeOutboxFor("user-1", "project-new").length).toBe(1);
    expect(takeOutboxFor("user-1", "project-new")[0]).toMatchObject({ origin: "review_pd", failureCode: "upload_failed", fileName: "Review.docx" });
  }
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")[0]).toMatchObject({ attempts: [expect.objectContaining({ origin: "review_pd", failureCode: "upload_failed", attemptKey: expect.any(String) })] });
});

it.each([false, true])("preserves context extracted-text success (original missing=%s)", async (missing) => {
  const warning = vi.spyOn(toast, "warning");
  const transport = vi.fn<typeof fetch>();
  if (missing) transport.mockRejectedValue(new Error("offline"));
  else transport.mockResolvedValue(Response.json({ storageId: "context-storage" }));
  vi.stubGlobal("fetch", transport);
  const file = await submitReview(true);
  await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
  const payload = __mutationCalls("documents:uploadDocument")[0];
  expect(payload).toMatchObject({ source: "context_input", content: expect.stringContaining("Experimental solar tracking"), attemptKey: expect.any(String), mimeType: file.type });
  if (missing) expect(payload).not.toHaveProperty("storageId");
  else expect(payload).toHaveProperty("storageId", "context-storage");
  expect(transport).toHaveBeenCalledTimes(missing ? 2 : 1);
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
  expect(warning).not.toHaveBeenCalled();
});
