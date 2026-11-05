<!--
  One file's page in the preview (2026-11-04): its original, read in the
  browser by kind (previewRenderers.ts), or the text the AI reads (the
  stored text: Word files formatted from their Markdown, the rest as plain
  text). Only the file in the middle loads; its neighbours show a quiet
  page outline.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../../convex/_generated/api";
  import LazyModule from "$lib/components/ui/LazyModule.svelte";
  import { normalizeExtractedText } from "$lib/parseDocument";
  import { quotableFileText } from "../../../../../shared/wordMarkdown";
  import type { ListedCompanyFile } from "./fileMeta";
  import {
    firstSheetTable,
    previewKind,
    readEmail,
    renderPdfPages,
    SHEET_PREVIEW_MAX_BYTES,
    wordToSafeHtml,
    type EmailPreview,
    type SheetPreview,
  } from "./previewRenderers";

  let {
    file,
    mode,
    current,
  }: {
    file: ListedCompanyFile;
    /** The original, or the text the AI reads. */
    mode: "original" | "text";
    /** The file in the middle: the only one that loads. */
    current: boolean;
  } = $props();

  /** Longer Markdown is shown as plain text (as in the files panel). */
  const MARKDOWN_PREVIEW_MAX_CHARS = 200_000;

  const kind = $derived(previewKind(file));
  const showText = $derived(mode === "text" || !file.url);
  const textQ = useQuery(api.companyFiles.getCompanyFileContent, () =>
    current && (showText || kind === "text") ? { companyFileId: file._id } : "skip"
  );

  type Loaded =
    | { state: "idle" }
    | { state: "loading" }
    | { state: "failed" }
    | { state: "pdf"; pageCount: number; drawn: number }
    | { state: "word"; html: string }
    | { state: "sheet"; sheet: SheetPreview }
    | { state: "email"; email: EmailPreview }
    | { state: "too_large" };
  let loaded = $state<Loaded>({ state: "idle" });
  let pdfHost: HTMLDivElement | null = $state(null);

  $effect(() => {
    const url = file.url;
    const wanted = current && !showText && url && kind !== "image" && kind !== "text";
    if (!wanted) {
      loaded = { state: "idle" };
      return;
    }
    // Moving to another file or closing the viewer stops the download and
    // anything not yet read from it.
    const controller = new AbortController();
    const { signal } = controller;
    loaded = { state: "loading" };
    void (async () => {
      try {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error("The original could not be loaded.");
        if (kind === "sheet" && Number(response.headers.get("content-length") ?? 0) > SHEET_PREVIEW_MAX_BYTES) {
          controller.abort();
          loaded = { state: "too_large" };
          return;
        }
        const blob = await response.blob();
        if (signal.aborted) return;
        if (kind === "sheet" && blob.size > SHEET_PREVIEW_MAX_BYTES) {
          loaded = { state: "too_large" };
          return;
        }
        const data = await blob.arrayBuffer();
        if (signal.aborted) return;
        if (kind === "pdf") {
          loaded = { state: "pdf", pageCount: 0, drawn: 0 };
          // The host renders once the state above shows it.
          await tick();
          const host = pdfHost;
          if (!host || signal.aborted) return;
          host.replaceChildren();
          const result = await renderPdfPages(data, host, () => !signal.aborted);
          if (!signal.aborted) loaded = { state: "pdf", ...result };
        } else if (kind === "word") {
          const html = await wordToSafeHtml(data);
          if (!signal.aborted) loaded = { state: "word", html };
        } else if (kind === "sheet") {
          const sheet = await firstSheetTable(data);
          if (!signal.aborted) loaded = { state: "sheet", sheet };
        } else if (kind === "email") {
          const email = await readEmail(data, file.fileName);
          if (!signal.aborted) loaded = { state: "email", email };
        }
      } catch (error) {
        if (signal.aborted) return;
        console.error("Preview could not read the original", error);
        loaded = { state: "failed" };
      }
    })();
    return () => controller.abort();
  });

  const bodyText = "px-10 py-10 text-[0.8125rem] leading-[calc(22/13)] text-ink";
</script>

<div class="h-full w-full overflow-y-auto bg-surface text-ink" data-preview-page={file._id} data-preview-kind={showText ? "text" : kind}>
  {#if !current}
    <div class="flex flex-col gap-3 px-10 py-12" aria-hidden="true">
      <div class="h-3 w-1/4 rounded-sm bg-gray-300"></div>
      <div class="h-2 w-3/4 rounded-sm bg-line"></div>
      <div class="mt-4 h-2 w-full rounded-sm bg-line"></div>
      <div class="h-2 w-5/6 rounded-sm bg-line"></div>
      <div class="h-2 w-2/3 rounded-sm bg-line"></div>
      <div class="h-2 w-3/4 rounded-sm bg-line"></div>
    </div>
  {:else if showText || kind === "text"}
    {#if textQ.error}
      <p role="alert" class={bodyText} data-company-file-preview-failed>This file's text could not be loaded.</p>
    {:else if textQ.data === undefined}
      <p role="status" class={`${bodyText} text-ink-muted`}>Loading...</p>
    {:else if textQ.data?.textFormat === "markdown" && textQ.data.content.trim() && textQ.data.content.length <= MARKDOWN_PREVIEW_MAX_CHARS}
      {@const markdownText = textQ.data.content}
      <div class="px-10 py-10" data-testid="company-file-preview-markdown">
        <LazyModule load={() => import("$lib/components/chat/primitives/MessageContent.svelte")} label="markdown preview">
          {#snippet children(MessageContent)}
            <MessageContent markdown complete role="assistant" text={markdownText} />
          {/snippet}
        </LazyModule>
      </div>
    {:else}
      <pre class={`whitespace-pre-wrap font-sans ${bodyText}`} data-testid="company-file-preview-text">{textQ.data?.content
          ? normalizeExtractedText(quotableFileText(textQ.data.content, textQ.data.textFormat))
          : "No text could be read from this file."}</pre>
    {/if}
  {:else if kind === "image" && file.url}
    <img src={file.url} alt={file.fileName} class="mx-auto block max-h-full max-w-full object-contain" />
  {:else if loaded.state === "failed"}
    <p role="alert" class={bodyText} data-company-file-preview-failed>The original could not be shown. Try Text the AI reads, or download it.</p>
  {:else if loaded.state === "too_large"}
    <p class={bodyText}>This spreadsheet is too large to show here. Download it, or switch to Text the AI reads.</p>
  {:else if loaded.state === "pdf"}
    <div bind:this={pdfHost} class="flex flex-col gap-px bg-line" data-testid="company-file-preview-pdf"></div>
    {#if loaded.drawn > 0 && loaded.pageCount > loaded.drawn}
      <p class="px-10 py-4 text-xs leading-[calc(4/3)] text-ink-muted">Showing the first {loaded.drawn} of {loaded.pageCount} pages. Download it to see the rest.</p>
    {/if}
  {:else if loaded.state === "word"}
    <div class={`company-file-word ${bodyText}`} data-testid="company-file-preview-word">
      {@html loaded.html}
    </div>
  {:else if loaded.state === "sheet"}
    <div class="p-4" data-testid="company-file-preview-sheet">
      {#if loaded.sheet.rows.length === 0}
        <p class="p-6 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">The first sheet is empty.</p>
      {:else}
        <p class="px-1 pb-2 text-xs leading-[calc(4/3)] text-ink-muted">{loaded.sheet.sheetName}</p>
        <table class="w-full border-collapse text-xs leading-[calc(4/3)]">
          <tbody>
            {#each loaded.sheet.rows as row, rowIndex (rowIndex)}
              <tr class={rowIndex === 0 ? "bg-gray-50 font-medium text-ink" : "text-ink-secondary"}>
                {#each row as cell, cellIndex (cellIndex)}
                  <td class="max-w-[12rem] truncate border border-line-soft px-2 py-1.5">{cell}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
        {#if loaded.sheet.moreRows || loaded.sheet.moreColumns}
          <p class="px-1 pt-2 text-xs leading-[calc(4/3)] text-ink-muted">Showing the first rows and columns. Download it to see the rest.</p>
        {/if}
      {/if}
    </div>
  {:else if loaded.state === "email"}
    <div data-testid="company-file-preview-email">
      <div class="flex flex-col gap-3 border-b border-line-soft px-10 pt-10 pb-6">
        <p class="text-lg leading-[calc(4/3)] font-medium text-ink">{loaded.email.subject || "(No subject)"}</p>
        <dl class="grid grid-cols-[3.375rem_1fr] gap-x-2 gap-y-1 text-[0.8125rem] leading-[calc(18/13)]">
          {#if loaded.email.from}<dt class="text-ink-faint">From</dt><dd class="text-ink">{loaded.email.from}</dd>{/if}
          {#if loaded.email.to}<dt class="text-ink-faint">To</dt><dd class="text-ink">{loaded.email.to}</dd>{/if}
          {#if loaded.email.date}<dt class="text-ink-faint">Date</dt><dd class="text-ink">{loaded.email.date}</dd>{/if}
        </dl>
      </div>
      <pre class={`whitespace-pre-wrap font-sans ${bodyText}`}>{loaded.email.body || "This email has no text."}</pre>
    </div>
  {:else}
    <p role="status" class={`${bodyText} text-ink-muted`}>Loading...</p>
  {/if}
</div>

<style>
  .company-file-word :global(h1) { font-size: 1.25rem; line-height: 1.3; font-weight: 500; margin: 0 0 0.75rem; }
  .company-file-word :global(h2) { font-size: 1.0625rem; line-height: 1.35; font-weight: 500; margin: 1.25rem 0 0.5rem; }
  .company-file-word :global(h3),
  .company-file-word :global(h4) { font-size: 0.875rem; line-height: 1.4; font-weight: 500; margin: 1rem 0 0.5rem; }
  .company-file-word :global(p) { margin: 0 0 0.75rem; }
  .company-file-word :global(ul) { list-style: disc; padding-left: 1.25rem; margin: 0 0 0.75rem; }
  .company-file-word :global(ol) { list-style: decimal; padding-left: 1.25rem; margin: 0 0 0.75rem; }
  .company-file-word :global(strong),
  .company-file-word :global(b) { font-weight: 500; }
  .company-file-word :global(table) { border-collapse: collapse; margin: 0 0 0.75rem; width: 100%; }
  .company-file-word :global(td),
  .company-file-word :global(th) { border: 1px solid var(--color-line); padding: 0.25rem 0.5rem; vertical-align: top; }
  .company-file-word :global(a) { color: var(--color-primary-selected); text-decoration: underline; }
</style>
