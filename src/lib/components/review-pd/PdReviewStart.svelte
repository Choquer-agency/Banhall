<!--
  Recovery surface for a stranded review-mode project (2026-08-07 flag): the
  project exists but no PD review row does — the wizard's review start failed
  or (pre-fix) a duplicated review project silently skipped it. If the written
  PD is already stored, one button starts the review; if the PD itself never
  made it, the writer can upload it here and start in one step. New-UI type
  rules apply: max font-weight 500.
-->
<script lang="ts">
  import { useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { toast } from "svelte-sonner";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { parseFileToText, isSupportedFile, SUPPORTED_LABEL } from "$lib/parseDocument";
  import { guessFileType } from "$lib/components/project-new/shared";

  let { projectId }: { projectId: Id<"projects"> } = $props();

  const sourceDocQ = useQuery(api.pdReviews.getReviewSourceDocument, () => ({ projectId }));
  const startReview = useMutation(api.pdReviews.startPdReview);
  const uploadDocument = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);

  let busy = $state(false);
  let fileInput: HTMLInputElement | null = $state(null);
  let inlineError = $state("");

  const sourceDoc = $derived(sourceDocQ.data);

  async function start(documentId: Id<"projectDocuments">) {
    await startReview({ projectId, documentId });
    toast.success("PD review started.");
    // Reactive getLatestPdReview swaps this card for the running report.
  }

  async function startFromStored() {
    if (busy || !sourceDoc) return;
    busy = true;
    inlineError = "";
    try {
      await start(sourceDoc._id);
    } catch (e) {
      inlineError = userErrorMessage(e, "Couldn't start the review.");
    } finally {
      busy = false;
    }
  }

  async function handleFile(file: File) {
    if (busy) return;
    if (!isSupportedFile(file.name)) {
      inlineError = `Can't read ${file.name} — unsupported type. Supported: ${SUPPORTED_LABEL}.`;
      return;
    }
    busy = true;
    inlineError = "";
    try {
      const parsed = await parseFileToText(file);
      if (!parsed.content.trim()) {
        inlineError = `Couldn't extract any text from ${file.name}. Try another file.`;
        return;
      }
      // Keep the original bytes when storage accepts them; the review only
      // needs the extracted text, so a failed byte upload is non-fatal.
      let storageId: Id<"_storage"> | undefined;
      try {
        const url = await generateUploadUrl({});
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        storageId = ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
      } catch {
        storageId = undefined;
      }
      const documentId = await uploadDocument({
        projectId,
        fileName: file.name,
        fileType: guessFileType(file.name),
        content: parsed.content,
        source: "review_pd",
        ...(storageId ? { storageId } : {}),
        ...(file.type ? { mimeType: file.type } : {}),
      });
      await start(documentId);
    } catch (e) {
      inlineError = userErrorMessage(e, "Couldn't upload the PD.");
    } finally {
      busy = false;
      if (fileInput) fileInput.value = "";
    }
  }
</script>

{#if sourceDoc !== undefined}
  <section
    data-pd-review-start
    class="rounded-xl border border-line bg-surface p-4"
    aria-label="Start PD review"
  >
    <h2 class="text-sm font-medium text-ink">The AI review hasn't run yet</h2>
    {#if sourceDoc && sourceDoc.hasText}
      <p class="mt-1 text-sm text-ink-secondary">
        The written PD <span class="font-medium">{sourceDoc.fileName}</span> is uploaded,
        but no feedback report was generated for it.
      </p>
      <button
        type="button"
        data-start-pd-review
        onclick={startFromStored}
        disabled={busy}
        class="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-primary-selected px-3.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
      >
        {#if busy}<Spinner size="sm" />{/if}
        Start PD review
      </button>
    {:else}
      <p class="mt-1 text-sm text-ink-secondary">
        {sourceDoc
          ? `The stored copy of ${sourceDoc.fileName} has no readable text. Upload the written PD again to run the review.`
          : "The written PD never finished uploading, so there is nothing to review yet. Upload it to run the review."}
      </p>
      <input
        bind:this={fileInput}
        type="file"
        class="hidden"
        aria-label="Upload written PD"
        onchange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        data-upload-pd-review
        onclick={() => fileInput?.click()}
        disabled={busy}
        class="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-primary-selected px-3.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
      >
        {#if busy}<Spinner size="sm" />{/if}
        Upload PD &amp; start review
      </button>
    {/if}
    {#if inlineError}
      <p class="mt-2 text-sm text-red-700" role="alert">{inlineError}</p>
    {/if}
  </section>
{/if}
