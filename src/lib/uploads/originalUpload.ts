import type { Id } from "../../../convex/_generated/dataModel";
import { UploadTimeoutError, withUploadTimeout } from "./outboxFlush";

const POST_TIMEOUT_MS = 120_000;

type OriginalUploadDependencies = {
  generateUploadUrl: () => Promise<string>;
  fetch: typeof fetch;
};

/** Transport only. Exhaustion preserves the caller's extracted-text fallback. */
export async function uploadOriginal({
  file,
  generateUploadUrl,
  fetch: uploadFetch,
}: OriginalUploadDependencies & { file: File }): Promise<Id<"_storage"> | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Await the bounded wrapper: a late URL must never launch a late POST.
      const url = await withUploadTimeout(generateUploadUrl());
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new UploadTimeoutError());
            controller.abort();
          }, POST_TIMEOUT_MS);
        });
        const transfer = async () => {
          const response = await uploadFetch(url, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Original upload HTTP failure");
          const body: unknown = await response.json();
          if (
            typeof body !== "object" || body === null || Array.isArray(body) ||
            !("storageId" in body) || typeof body.storageId !== "string" ||
            body.storageId.trim().length === 0
          ) {
            throw new Error("Invalid original upload response");
          }
          // Validate the wire shape here; Convex validates actual ID validity.
          return body.storageId as Id<"_storage">;
        };
        return await Promise.race([transfer(), deadline]);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    } catch (error) {
      if (attempt === 1) console.error("storage upload failed", error);
      // Each retry acquires a fresh URL. Never delete possibly orphaned bytes.
    }
  }
  return undefined;
}
