<!--
  Port of src/components/editor/FilesPanel.tsx.
  Collapsible panel of the project's supporting files: pinned interview
  transcript, per-file preview/download/archive/restore/delete, and an optional
  "revise the report" chat handoff when removing a file (BNH-24).
-->
<script module lang="ts">
  import type { Id } from "../../../../convex/_generated/dataModel";

  export type DocRow = {
    _id: Id<"projectDocuments">;
    fileName: string;
    fileType: "txt" | "md" | "pdf" | "docx" | "msg" | "eml" | "xlsx" | "image" | "other";
    source: string;
    category: string | null;
    createdAt: number;
    sizeChars: number;
    hasFile: boolean;
    mimeType: string | null;
    url: string | null;
    archived: boolean;
  };

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
  import { api } from "../../../../convex/_generated/api";
  import { categoryMeta } from "$lib/contextCategories";

  let {
    projectId,
    reportId,
  }: {
    projectId: Id<"projects">;
    reportId?: Id<"reports">;
  } = $props();

  let isOpen = $state(false);
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

  const documents = $derived(documentsQ.data as DocRow[] | undefined);
  const transcript = $derived(transcriptQ.data);
  const count = $derived(documents?.length ?? 0);

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
  <button
    type="button"
    onclick={() => (isOpen = !isOpen)}
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
      </div>
    </div>
    <svg
      class={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if isOpen}
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

      {#if count === 0}
        <p class="py-3 text-sm text-gray-400">
          No supporting files yet. Documents attached in the chat appear here.
        </p>
      {:else}
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
                <p class="text-xs text-gray-400">
                  {formatDate(doc.createdAt)}{doc.archived ? " · excluded from AI" : ""}
                </p>
              </div>
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
            <pre class="whitespace-pre-wrap px-6 py-6 font-sans text-sm leading-relaxed text-gray-700">{previewContentQ
                .data?.content || "No text content."}</pre>
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
          <pre class="whitespace-pre-wrap px-6 py-6 font-serif text-sm leading-relaxed text-gray-700">{transcript.content}</pre>
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
