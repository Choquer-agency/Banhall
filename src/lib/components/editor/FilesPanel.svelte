<!--
  Port of src/components/editor/FilesPanel.tsx.
  Collapsible panel of the project's supporting files: pinned interview
  transcript, per-file preview/download/archive/restore/delete, and an optional
  "revise the report" chat handoff when removing a file (BNH-24).
-->
<script module lang="ts">
  import type { FunctionReturnType } from "convex/server";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import type { api as convexApi } from "../../../../convex/_generated/api";

  /**
   * Derived from the query itself rather than hand-written. The previous copy
   * silently dropped fields the projection had gained — including this
   * ticket's processing status — because the cast below it hid the mismatch.
   */
  export type DocRow = FunctionReturnType<
    typeof convexApi.documents.listDocuments
  >[number];

  function craftRevisionMessage(
    fileName: string,
    action: "archive" | "delete",
    content: string
  ): string {
    const trimmed = content.trim().slice(0, 8000);
    const note = content.trim().length > 8000 ? "\n…(truncated)" : "";
    return `I've ${action === "archive" ? "archived" : "deleted"} the supporting file "${fileName}", so it should no longer inform this report.

Here is what that file contained:
"""
${trimmed}${note}
"""

Please revise the report to remove or rewrite ONLY the statements that specifically relied on this file. Suggest targeted edits to the affected paragraph(s) — do not regenerate the report or change unrelated content. If nothing in the report depended on it, just tell me that.`;
  }

  /** Icon tile colors per file type (default: `other`). */
  const FILE_TYPE_COLORS: Record<string, string> = {
    pdf: "bg-red-50 text-red-500",
    docx: "bg-blue-50 text-blue-500",
    msg: "bg-amber-50 text-amber-500",
    eml: "bg-amber-50 text-amber-500",
    xlsx: "bg-green-50 text-green-600",
    image: "bg-purple-50 text-purple-500",
    txt: "bg-gray-100 text-gray-500",
    md: "bg-gray-100 text-gray-500",
    other: "bg-gray-100 text-gray-500",
  };

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function triggerDownload(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<script lang="ts">
  import { useQuery, useMutation, useConvexClient } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import { categoryMeta } from "$lib/contextCategories";
  import { userErrorMessage } from "$lib/errors";
  import { parseFileToText, SUPPORTED_ACCEPT, normalizeExtractedText } from "$lib/parseDocument";
  import { withUploadTimeout } from "$lib/uploads/outboxFlush";
  import Button from "$lib/components/ui/Button.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import ProcessingStatusBadge from "$lib/components/upload/ProcessingStatusBadge.svelte";
  import UploadReceiptRow from "$lib/components/upload/UploadReceiptRow.svelte";
  import {
    buildReceiptRows,
    countReceiptFailures,
    summarizeReceipt,
    type ReceiptRow,
  } from "$lib/uploads/receiptRows";
  import {
    DENIED_COPY,
    REPLACE_UNCHANGED_COPY,
    statusAction,
    statusExplanation,
  } from "$lib/uploads/processingStatus";

  let {
    projectId,
    reportId,
    initiallyOpen = false,
  }: {
    projectId: Id<"projects">;
    reportId?: Id<"reports">;
    /** Opened on surfaces that exist because something went wrong. */
    initiallyOpen?: boolean;
  } = $props();

  // Unique per instance so aria-controls stays valid when the panel renders
  // more than once (e.g. generation-failure card and workbench together).
  const uid = $props.id();
  const panelBodyId = `${uid}-files-body`;

  // Deliberately a seed, not a binding: capturing the initial value is the
  // point, so a later re-render can't reopen a panel the user just closed.
  // svelte-ignore state_referenced_locally
  let isOpen = $state(initiallyOpen);
  let preview = $state<DocRow | null>(null);
  let showTranscript = $state(false);
  let removal = $state<{ doc: DocRow; action: "archive" | "delete" } | null>(null);
  let removalBusy = $state<"revise" | "just" | null>(null);

  const documentsQ = useQuery(api.documents.listDocuments, () => ({ projectId }));
  const transcriptQ = useQuery(api.transcripts.getTranscript, () => ({ projectId }));
  const client = useConvexClient();
  const setArchived = useMutation(api.documents.setDocumentArchived);
  const deleteDoc = useMutation(api.documents.deleteDocument);
  // Agent chat pipeline (legacy chat.ts panel retired Jul 22).
  const sendMessage = useMutation(api.chatV2.sendMessage);

  const attemptsQ = useQuery(api.uploadAttempts.listUploadAttempts, () => ({ projectId }));
  const dismissAttempt = useMutation(api.uploadAttempts.dismissUploadAttempt);
  const uploadDoc = useMutation(api.documents.uploadDocument);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const recordUploadAttempts = useMutation(api.uploadAttempts.recordUploadAttempts);
  const failUploadAttempt = useMutation(api.uploadAttempts.failUploadAttempt);

  const documents = $derived(documentsQ.data);
  const transcript = $derived(transcriptQ.data);
  const count = $derived(documents?.length ?? 0);

  // null means the server refused to say, which is not the same as "none".
  let busyAttemptKey = $state<string | null>(null);
  let replaceBusyDocId = $state<Id<"projectDocuments"> | null>(null);
  let replaceTarget = $state<DocRow | null>(null);
  let pendingReplace = $state<{ doc: DocRow; file: File } | null>(null);
  let replaceInputEl: HTMLInputElement | null = $state(null);

  const attemptsDenied = $derived(attemptsQ.data === null);
  const attempts = $derived(attemptsQ.data ?? []);
  // Documents keep their own rendering below (preview, download, archive,
  // delete); only the failed attempts have no row of their own, so those are
  // the ones drawn with the receipt component.
  const receiptRows = $derived(buildReceiptRows(documents ?? [], attempts, []));
  const attemptRows = $derived(receiptRows.filter((row) => row.attemptKey));
  const failureCount = $derived(countReceiptFailures(receiptRows));
  const summary = $derived(summarizeReceipt(receiptRows));
  const docCanReplace = $derived(
    new Map(
      receiptRows
        .filter(
          (row): row is ReceiptRow & { documentId: Id<"projectDocuments"> } =>
            row.documentId !== undefined
        )
        .map((row) => [row.documentId, row.canReplace])
    )
  );

  /**
   * What a document row says under its badge. `null` for anything that needs
   * no explanation: a ready file, or an archived one already labelled as
   * excluded from AI.
   */
  function documentStatusCopy(doc: DocRow): string | null {
    if (doc.archived || doc.processingStatus === "ready") return null;
    const explanation = statusExplanation(doc.processingStatus);
    const action = statusAction(doc.processingStatus, {
      canRetry: false,
      canReplace: docCanReplace.get(doc._id) ?? false,
    });
    return action ? `${explanation} ${action}` : explanation;
  }

  async function removeAttempt(row: ReceiptRow) {
    if (!row.attemptKey || busyAttemptKey) return;
    busyAttemptKey = row.attemptKey;
    try {
      await dismissAttempt({ projectId, attemptKey: row.attemptKey });
    } catch (error) {
      console.error("Could not dismiss upload attempt", error);
      // Without this the row simply stays put and the user is left guessing
      // whether the click registered.
      toast.error(userErrorMessage(error, "Couldn't remove that row. Please try again."));
    } finally {
      busyAttemptKey = null;
    }
  }

  /** Store a replacement file and return the new (or deduped) document id. */
  async function storeReplacement(opts: {
    attemptKey: string;
    file: File;
    origin: "chat_upload" | "context_input" | "review_pd";
    source: string;
    category?: DocRow["category"];
  }) {
    const { attemptKey, file } = opts;
    try {
      await withUploadTimeout(
        recordUploadAttempts({
          projectId,
          attempts: [
            {
              attemptKey,
              fileName: file.name,
              fileSizeBytes: file.size,
              origin: opts.origin,
            },
          ],
        })
      );
    } catch (error) {
      console.error("Failed to open replacement attempt", error);
    }

    let storageId: Id<"_storage"> | undefined;
    try {
      const url = await withUploadTimeout(generateUploadUrl({}));
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      storageId = ((await response.json()) as { storageId: Id<"_storage"> }).storageId;
    } catch (error) {
      console.error("Replacement file storage upload failed", error);
    }

    let parsed;
    let extractionFailed = false;
    try {
      parsed = await parseFileToText(file);
    } catch (error) {
      console.error("Replacement parse failed", error);
      extractionFailed = true;
      parsed = { fileName: file.name, fileType: "other" as const, content: "" };
    }

    try {
      return await withUploadTimeout(
        uploadDoc({
          projectId,
          fileName: file.name,
          fileType: parsed.fileType,
          content: parsed.content,
          source: opts.source,
          ...(opts.category ? { category: opts.category } : {}),
          extractionOutcome: extractionFailed ? "failed" : "ok",
          attemptKey,
          ...(storageId ? { storageId } : {}),
          ...(file.type ? { mimeType: file.type } : {}),
        })
      );
    } catch (error) {
      void withUploadTimeout(
        failUploadAttempt({ projectId, attemptKey, failureCode: "upload_failed" })
      ).catch(() => {});
      throw error;
    }
  }

  async function replaceAttempt(row: ReceiptRow, file: File) {
    if (!row.attemptKey || busyAttemptKey) return;
    const origin =
      attempts.find((attempt) => attempt.attemptKey === row.attemptKey)?.origin ??
      "chat_upload";
    busyAttemptKey = row.attemptKey;
    try {
      await storeReplacement({
        attemptKey: row.attemptKey,
        file,
        origin,
        source: origin,
      });
    } catch (error) {
      toast.error(
        userErrorMessage(error, "Couldn't upload the replacement. Please try again.")
      );
    } finally {
      busyAttemptKey = null;
    }
  }

  async function runDocumentReplace() {
    if (!pendingReplace || replaceBusyDocId) return;
    const { doc, file } = pendingReplace;
    replaceBusyDocId = doc._id;
    try {
      const origin =
        doc.source === "context_input" || doc.source === "review_pd"
          ? doc.source
          : ("chat_upload" as const);
      const newId = await storeReplacement({
        attemptKey: crypto.randomUUID(),
        file,
        origin,
        source: doc.source,
        category: doc.category ?? undefined,
      });
      // Mandatory id guard: a non-empty dedupe can return the old row itself;
      // deleting unconditionally would destroy the row just returned.
      if (newId !== doc._id) {
        try {
          await deleteDoc({ documentId: doc._id });
        } catch (deleteError) {
          // The replacement is already safely in the project. Do not claim the
          // original was unchanged — the honest state is two rows and one clear
          // recovery action.
          console.error("Replacement saved but old file could not be removed", deleteError);
          toast.error(
            "Replacement added, but the old file couldn't be removed. Delete it manually."
          );
          pendingReplace = null;
          return;
        }
      } else {
        toast.info(REPLACE_UNCHANGED_COPY);
      }
      pendingReplace = null;
    } catch (error) {
      toast.error(
        userErrorMessage(
          error,
          "Couldn't upload the replacement. The original file was not changed."
        )
      );
    } finally {
      replaceBusyDocId = null;
    }
  }

  // Preview modal: PDFs and images render from the stored file; everything
  // else loads the extracted text (replaces React's nested FilePreview query).
  const previewIsPdf = $derived(preview != null && preview.fileType === "pdf" && !!preview.url);
  const previewIsImage = $derived(
    preview != null && (preview.mimeType?.startsWith("image/") ?? false) && !!preview.url
  );
  const previewContentQ = useQuery(api.documents.getDocumentContent, () =>
    preview && !previewIsPdf && !previewIsImage ? { documentId: preview._id } : "skip"
  );

  async function restore(doc: DocRow) {
    await setArchived({ documentId: doc._id, archived: false });
  }

  async function performRemoval(doc: DocRow, action: "archive" | "delete", revise: boolean) {
    let content = "";
    if (revise && reportId) {
      const data = await client.query(api.documents.getDocumentContent, {
        documentId: doc._id,
      });
      content = data?.content ?? "";
    }
    if (action === "archive") {
      await setArchived({ documentId: doc._id, archived: true });
    } else {
      await deleteDoc({ documentId: doc._id });
    }
    if (revise && reportId) {
      await sendMessage({
        reportId,
        content: craftRevisionMessage(doc.fileName, action, content),
      });
    }
    removal = null;
  }

  async function runRemoval(revise: boolean) {
    if (!removal) return;
    removalBusy = revise ? "revise" : "just";
    try {
      await performRemoval(removal.doc, removal.action, revise);
    } finally {
      removalBusy = null;
    }
  }

  async function download(doc: DocRow) {
    if (doc.url) {
      const res = await fetch(doc.url);
      const blob = await res.blob();
      triggerDownload(blob, doc.fileName);
      return;
    }
    // Text-only fallback (legacy docs with no stored bytes).
    const data = await client.query(api.documents.getDocumentContent, {
      documentId: doc._id,
    });
    const text = data?.content ?? "";
    triggerDownload(
      new Blob([text], { type: "text/plain" }),
      doc.fileName.replace(/\.[^.]+$/, "") + ".txt"
    );
  }
</script>

{#snippet fileTypeIcon(type: DocRow["fileType"])}
  <div
    class={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${FILE_TYPE_COLORS[type] ?? FILE_TYPE_COLORS.other}`}
  >
    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
      />
    </svg>
  </div>
{/snippet}

{#snippet categoryPill(category: string | null, source: string)}
  {@const meta = categoryMeta(category)}
  {#if meta}
    <span class={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.pill}`}>
      {meta.label}
    </span>
  {:else if source === "chat_upload"}
    <span
      class="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500"
    >
      Chat
    </span>
  {/if}
{/snippet}

<div class="card">
  <!-- Disclosure semantics (a11y P0, 2026-08-08): the trigger states its
       expanded state and names the region it controls; the body animates
       through the shared Disclosure primitive (design-system rule 8). -->
  <button
    type="button"
    onclick={() => (isOpen = !isOpen)}
    aria-expanded={isOpen}
    aria-controls={panelBodyId}
    class="flex w-full items-center justify-between rounded-xl px-5 py-3 text-left transition-colors hover:bg-primary-wash"
  >
    <div class="flex items-center gap-3">
      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-navy/10 text-navy">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      </div>
      <div>
        <span class="text-sm font-medium text-gray-900">Files</span>
        <span class="ml-2 text-xs text-gray-400">
          {count} file{count !== 1 ? "s" : ""}
        </span>
        {#if failureCount > 0}
          <!-- Surfaced on the collapsed header: a failure hidden behind a shut
               panel is the thing this receipt exists to prevent. -->
          <span class="ml-2 text-xs font-medium text-red-600">
            · {failureCount} failed
          </span>
        {/if}
      </div>
    </div>
    <DisclosureChevron open={isOpen} />
  </button>

  <Disclosure id={panelBodyId} open={isOpen}>
    <div class="border-t border-gray-100 px-5 py-3">
      <!-- Pinned source: the interview transcript (so writers can re-read it) -->
      {#if transcript}
        <div class="flex items-center gap-3 border-b border-gray-100 py-2.5">
          <div
            class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-navy/10 text-navy"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium text-gray-800">Interview transcript</p>
              <span
                class="flex-shrink-0 rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-medium text-navy"
              >
                Source
              </span>
            </div>
            <p class="text-xs text-gray-400">
              {transcript.content.split(/\s+/).filter(Boolean).length.toLocaleString()} words
            </p>
          </div>
          <button
            type="button"
            onclick={() => (showTranscript = true)}
            title="Preview transcript"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
          </button>
          <button
            type="button"
            onclick={() =>
              transcript &&
              triggerDownload(
                new Blob([transcript.content], { type: "text/plain" }),
                "interview-transcript.txt"
              )}
            title="Download transcript"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>
        </div>
      {/if}

      {#if attemptsDenied}
        <!-- Replaces the whole body: showing "no files yet" underneath a denial
             would tell the user something we do not actually know. -->
        <p class="py-3 text-sm text-gray-400">{DENIED_COPY.explanation}</p>
      {:else}
        {#if summary}
          <p class="text-data pt-2 pb-1 text-ink-muted">{summary}</p>
        {/if}

        {#if attemptRows.length > 0}
          <!-- Uploads that never produced a file. They have no document row of
               their own, so they are drawn with the shared receipt row. -->
          <ul class="divide-y divide-line-soft border-b border-gray-100">
            {#each attemptRows as row (row.key)}
              <UploadReceiptRow
                {row}
                busy={busyAttemptKey === row.attemptKey}
                onRemove={removeAttempt}
                onReplace={replaceAttempt}
              />
            {/each}
          </ul>
        {/if}

        {#if count === 0 && attemptRows.length === 0}
          <p class="py-3 text-sm text-gray-400">
            No supporting files yet. Documents attached in the chat appear here.
          </p>
        {:else if count > 0}
        <ul class="divide-y divide-gray-100">
          {#each documents ?? [] as doc (doc._id)}
            <li class={`flex items-center gap-3 py-2.5 ${doc.archived ? "opacity-60" : ""}`}>
              {@render fileTypeIcon(doc.fileType)}
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm text-gray-800">{doc.fileName}</p>
                  {@render categoryPill(doc.category, doc.source)}
                  {#if doc.archived}
                    <span
                      class="flex-shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500"
                    >
                      Archived
                    </span>
                  {/if}
                </div>
                {#if !doc.archived}
                  {@const copy = documentStatusCopy(doc)}
                  <div class="mt-1">
                    <ProcessingStatusBadge status={doc.processingStatus} />
                  </div>
                  {#if copy}
                    <p class="mt-1 text-xs text-ink-muted">{copy}</p>
                  {/if}
                {/if}
                <p class="text-xs text-gray-400">
                  {formatDate(doc.createdAt)}{doc.archived ? " · excluded from AI" : ""}
                </p>
              </div>
              {#if !doc.archived && docCanReplace.get(doc._id)}
                <Button
                  variant="ghost"
                  size="sm"
                  class="min-h-11 flex-shrink-0"
                  disabled={replaceBusyDocId !== null}
                  aria-busy={replaceBusyDocId === doc._id}
                  aria-label="Replace file… — {doc.fileName}"
                  onclick={() => {
                    replaceTarget = doc;
                    replaceInputEl?.click();
                  }}
                >
                  Replace file…
                </Button>
              {/if}
              <button
                type="button"
                onclick={() => (preview = doc)}
                title="Preview"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              </button>
              <button
                type="button"
                onclick={() => download(doc)}
                title="Download"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>
              {#if doc.archived}
                <button
                  type="button"
                  onclick={() => restore(doc)}
                  title="Restore (re-include in AI context)"
                  class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => (removal = { doc, action: "archive" })}
                  title="Archive (exclude from AI context)"
                  class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                    />
                  </svg>
                </button>
              {/if}
              <button
                type="button"
                onclick={() => (removal = { doc, action: "delete" })}
                title="Delete"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-primary-wash hover:text-red-600"
              >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </li>
          {/each}
        </ul>
        {/if}
      {/if}
      <input
        bind:this={replaceInputEl}
        type="file"
        class="hidden"
        tabindex={-1}
        aria-hidden="true"
        accept={SUPPORTED_ACCEPT}
        onchange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (file && replaceTarget) pendingReplace = { doc: replaceTarget, file };
          replaceTarget = null;
          input.value = "";
        }}
      />
    </div>
  </Disclosure>

  <!-- Confirm document replacement (upload first, delete second). -->
  {#if pendingReplace}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-6"
      onclick={() => !replaceBusyDocId && (pendingReplace = null)}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="card w-full max-w-md p-6"
        role="dialog"
        tabindex={-1}
        aria-modal="true"
        aria-labelledby="replace-file-title"
        onclick={(event) => event.stopPropagation()}
      >
        <h2 id="replace-file-title" class="text-title">
          Replace “{pendingReplace.doc.fileName}”?
        </h2>
        <p class="mt-2 text-sm text-ink-muted">
          The current file will be permanently removed from the project and replaced by
          “{pendingReplace.file.name}”.
        </p>
        <div class="mt-6 flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={replaceBusyDocId !== null}
            onclick={() => (pendingReplace = null)}
          >
            Cancel
          </Button>
          <Button disabled={replaceBusyDocId !== null} onclick={runDocumentReplace}>
            {replaceBusyDocId ? "Replacing…" : "Replace file"}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  <!-- File preview modal -->
  {#if preview}
    {@const url = preview.url}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      onclick={() => (preview = null)}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <span class="truncate text-sm font-medium text-gray-800">
            {preview.fileName}
          </span>
          <div class="flex items-center gap-2">
            {#if url}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                class="h-8 rounded-lg bg-gray-100 px-3 text-xs font-medium leading-8 text-gray-700 transition-colors hover:bg-gray-200"
              >
                Open in tab
              </a>
            {/if}
            <button
              type="button"
              onclick={() => (preview = null)}
              title="Close preview"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-primary-wash hover:text-gray-600"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-auto bg-canvas">
          {#if previewIsPdf && url}
            <iframe src={url} class="h-full w-full" title={preview.fileName}></iframe>
          {:else if previewIsImage && url}
            <img src={url} alt={preview.fileName} class="mx-auto max-h-full" />
          {:else if previewContentQ.data === undefined}
            <p class="px-6 py-6 text-sm text-gray-400">Loading…</p>
          {:else}
            <pre class="whitespace-pre-wrap px-6 py-6 font-sans text-sm leading-relaxed text-gray-700">{previewContentQ.data?.content
                ? normalizeExtractedText(previewContentQ.data.content)
                : "No text content."}</pre>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Transcript preview modal -->
  {#if showTranscript && transcript}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6"
      onclick={() => (showTranscript = false)}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <span class="text-sm font-medium text-gray-800">Interview transcript</span>
          <button
            type="button"
            onclick={() => (showTranscript = false)}
            title="Close transcript"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-primary-wash hover:text-gray-600"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="flex-1 overflow-auto bg-canvas">
          <pre class="whitespace-pre-wrap px-6 py-6 font-serif text-sm leading-relaxed text-gray-700">{normalizeExtractedText(transcript.content)}</pre>
        </div>
      </div>
    </div>
  {/if}

  <!-- Archive/delete confirmation -->
  {#if removal}
    {@const verb = removal.action === "archive" ? "Archive" : "Delete"}
    {@const canRevise = !!reportId}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
      onclick={() => (removal = null)}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onclick={(e) => e.stopPropagation()}
      >
        <h3 class="text-base font-semibold text-gray-900">
          {verb} “{removal.doc.fileName}”?
        </h3>
        <p class="mt-1.5 text-sm text-gray-500">
          {removal.action === "archive"
            ? "It stays visible to reviewers but is excluded from the AI's context."
            : "This permanently removes the file from the project."}
          {canRevise
            ? " Do you also want the assistant to revise the report to remove information that came from it?"
            : ""}
        </p>
        <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onclick={() => (removal = null)}
            disabled={removalBusy !== null}
            class="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-primary-wash disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={() => runRemoval(false)}
            disabled={removalBusy !== null}
            class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-navy transition-colors hover:bg-primary-wash disabled:opacity-50"
          >
            {removalBusy === "just" ? "Working…" : `Just ${verb.toLowerCase()}`}
          </button>
          {#if canRevise}
            <button
              type="button"
              onclick={() => runRemoval(true)}
              disabled={removalBusy !== null}
              class="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {removalBusy === "revise" ? "Working…" : `${verb} & revise report`}
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
