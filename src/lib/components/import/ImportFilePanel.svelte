<!--
  The file view (2026-11-17, Approve on Import): a side panel at the page's
  right, 480px, that shows one file read only, so nobody approves blind.
  It opens from a file's name on the sheet or Open in its row's menu
  (importFileView.ts). At the top the file (PD number muted, then its title)
  and its file name, then its labels as the sheet has them (sheetFile), what
  it still needs on To review in amber, and its text, read on the server a
  page of 20,000 characters at a time (sheetFileText) with "Show more" up to
  200,000, and a note when only part of it shows. A bits-ui dialog keeps
  focus inside; Esc or the close button closes it and focus goes back to
  where it opened from.

  Edit after approval and Send back (2026-11-17): an approved file shows
  its details an Admin can change (ImportApprovedDetails: writer, reviewer,
  science code, PD title, "Reviewed by CRA") above its text, in place of
  its writer and science code in the labels, and "Send back to review"
  with its confirm; once the file is sent back the view closes. A final PD
  marked reviewed by CRA says so in its labels on every tab.
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import { untrack } from "svelte";
  import { useAction, useQuery } from "convex-svelte";
  import { resolve } from "$app/paths";
  import { api } from "../../../../convex/_generated/api";
  import { IconClose } from "$lib/components/icons";
  import { companiesPath } from "$lib/companies/companies";
  import { userErrorMessage } from "$lib/errors";
  import { BRAIN_STATE_TEXT, NOT_ON_COMPANY_PAGE } from "./importApprove";
  import { CRA_REVIEWED } from "./importApproved";
  import ImportApprovedDetails from "./ImportApprovedDetails.svelte";
  import { CATEGORY_NAMES, checkLines, fileStateText, FILE_VIEW_MAX_CHARS, textNote } from "./importFileView";
  import { fileCells, fiscalYearTooltip, yearEndDate, type SheetFileRow } from "./importFormat";
  import { AMBER, SHEET_SMALL, SHOW_MORE } from "./sheetLayout";

  let {
    id = null,
    onClose,
  }: {
    /** The file shown; null closes the panel. */
    id?: SheetFileRow["_id"] | null;
    onClose: () => void;
  } = $props();

  const fileQ = useQuery(api.ingestion.sheetFile, () => (id ? { id } : "skip"));
  const file = $derived(id && fileQ.data ? fileQ.data : null);
  const cells = $derived(file ? fileCells(file) : null);
  const readText = useAction(api.ingestion.sheetFileText);

  type Loaded = { text: string; total: number; source: "full" | "preview" | "none"; cutAtImport: boolean };
  let loaded = $state<Loaded | null>(null);
  let loading = $state(false);
  let textError = $state<string | null>(null);

  // Each open of the panel, or of another file, is a new generation
  // (Greptile, 2026-11-19): a page asked for before a close and reopen of
  // the same file is dropped, and a page is added only where the loaded text
  // ends, so no page is ever skipped.
  let generation = 0;

  async function loadFrom(target: SheetFileRow["_id"], start: number) {
    const asked = generation;
    const current = () => asked === generation && target === id;
    loading = true;
    textError = null;
    try {
      const page = await readText({ id: target, start });
      if (!current()) return;
      if (!page) {
        loaded = { text: "", total: 0, source: "none", cutAtImport: false };
        return;
      }
      if (start > 0 && start !== loaded?.text.length) return;
      const before = start === 0 ? "" : (loaded?.text ?? "");
      loaded = { text: before + page.text, total: page.total, source: page.source, cutAtImport: page.cutAtImport };
    } catch (error) {
      if (current()) textError = userErrorMessage(error, "The text could not be loaded.");
    } finally {
      if (current()) loading = false;
    }
  }

  // A new file, or the same file opened again, starts its text from the top.
  $effect(() => {
    const target = id;
    untrack(() => {
      generation += 1;
      loaded = null;
      loading = false;
      textError = null;
      if (target) void loadFrom(target, 0);
    });
  });

  const shown = $derived(loaded?.text.length ?? 0);
  const canShowMore = $derived(Boolean(loaded && shown < loaded.total && shown < FILE_VIEW_MAX_CHARS));
  const note = $derived(loaded ? textNote({ shown, total: loaded.total, source: loaded.source, cutAtImport: loaded.cutAtImport }) : null);
  const checks = $derived(file && file.sheetTab === "review" ? checkLines(file.checkReasons) : []);

  const labels = $derived.by(() => {
    if (!file || !cells) return [];
    const rows: { label: string; value: string; href?: string }[] = [];
    rows.push({ label: "Company", value: file.clientName?.trim() || "No company yet" });
    rows.push({ label: "Kind", value: CATEGORY_NAMES[file.category] });
    rows.push({ label: "Where", value: fileStateText(file) });
    if (file.fiscalYearEnd !== undefined) {
      rows.push({
        label: "Fiscal year",
        value: `${cells.fiscalYear?.text ?? ""}, ${fiscalYearTooltip(file.fiscalYearEnd, file.fiscalYearEndAssumed) ?? yearEndDate(file.fiscalYearEnd)}`,
      });
    }
    if (file.pdNumber) rows.push({ label: "PD number", value: file.pdNumber });
    if (cells.version) rows.push({ label: "Version", value: cells.version });
    // An approved file's writer and science code are in its Details, where they can be changed.
    const approved = file.status === "approved";
    if (cells.writer && !approved) rows.push({ label: "Writer", value: cells.writer.tone === "amber" ? "No writer yet" : cells.writer.text });
    if (file.reviewerName && !approved) rows.push({ label: "Reviewer", value: file.reviewerName });
    if (file.reviewerInitials) rows.push({ label: "Reviewer initials", value: file.reviewerInitials });
    if (cells.scienceCode?.kind === "code" && !approved) {
      rows.push({ label: "Science code", value: [cells.scienceCode.code, cells.scienceCode.title].filter(Boolean).join(" ") });
    }
    if (file.craReviewed && file.category === "final_pd" && !approved) rows.push({ label: "CRA", value: CRA_REVIEWED });
    if (file.status === "approved") {
      rows.push(
        file.companyPage
          ? { label: "Company page", value: file.companyPage.name, href: companiesPath(resolve("/"), file.companyPage.key) }
          : { label: "Company page", value: NOT_ON_COMPANY_PAGE }
      );
      if (file.brain) rows.push({ label: "Brain", value: BRAIN_STATE_TEXT[file.brain] });
    }
    rows.push({ label: "Path", value: file.path });
    rows.push({
      label: "Added",
      value: `${new Date(file.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${
        file.addedVia === "folder_upload" ? "by the uploader or on this page" : "by OneDrive sync"
      }`,
    });
    return rows;
  });
</script>

<Dialog.Root
  open={id !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[105] bg-form-dialog-scrim" data-import-file-panel-scrim />
    <Dialog.Content
      data-import-file-panel
      class="fixed inset-y-0 right-0 z-[106] flex w-full max-w-[30rem] flex-col border-l border-line bg-surface shadow-dialog outline-none"
    >
      <header class="flex shrink-0 items-start gap-3 border-b border-line-soft px-6 pt-5 pb-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <Dialog.Title class="flex min-w-0 items-baseline gap-2.5 text-[0.9375rem] leading-[calc(4/3)] font-medium text-ink" data-import-file-panel-title>
            {#if cells?.prefix}<span class="shrink-0 text-ink-muted">{cells.prefix}</span>{/if}
            <span class="min-w-0 break-words">{cells?.title ?? "File"}</span>
          </Dialog.Title>
          <Dialog.Description class={`${SHEET_SMALL} break-all text-ink-muted`}>{file?.name ?? "Loading the file"}</Dialog.Description>
        </div>
        <Dialog.Close
          aria-label="Close the file"
          data-import-file-panel-close
          class="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
        >
          <IconClose size={14} strokeWidth={1.8} />
        </Dialog.Close>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-8" data-import-file-panel-body>
        {#if id && fileQ.data === null}
          <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">This file is no longer in Import.</p>
        {:else if file}
          {#if checks.length > 0}
            <ul data-import-file-panel-checks class={`mb-4 flex flex-col gap-1 rounded-lg bg-warning-surface px-3 py-2.5 text-[0.8125rem] leading-[calc(18/13)] ${AMBER}`}>
              {#each checks as line (line)}<li>{line}</li>{/each}
            </ul>
          {/if}
          <dl data-import-file-panel-labels class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5">
            {#each labels as entry (entry.label)}
              <dt class={`${SHEET_SMALL} pt-px text-ink-muted`}>{entry.label}</dt>
              <dd class="min-w-0 text-[0.8125rem] leading-[calc(18/13)] break-words text-ink-secondary" data-import-file-panel-label={entry.label}>
                {#if entry.href}
                  <a href={entry.href} class="text-primary-selected underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir">{entry.value}</a>
                {:else}
                  {entry.value}
                {/if}
              </dd>
            {/each}
          </dl>

          {#if file.status === "approved"}
            <ImportApprovedDetails {file} onSentBack={onClose} />
          {/if}

          <section class="mt-6" aria-labelledby="import-file-panel-text">
            <h3 id="import-file-panel-text" class={`${SHEET_SMALL} tracking-[0.04em] text-ink-muted uppercase`}>Text</h3>
            {#if textError}
              <p role="alert" class="mt-2 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{textError}</p>
            {:else if !loaded}
              <div role="status" aria-label="Loading the text" class="mt-3 flex flex-col gap-2">
                {#each [0, 1, 2] as index (index)}
                  <span class="h-3 w-full animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
                {/each}
              </div>
            {:else if loaded.source === "none" || loaded.total === 0}
              <p data-import-file-panel-no-text class="mt-2 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">No text could be read from this file.</p>
            {:else}
              <div
                data-import-file-panel-text
                class="mt-2 rounded-lg border border-line-soft bg-gray-50 px-3.5 py-3 text-[0.8125rem] leading-[calc(20/13)] whitespace-pre-wrap break-words text-ink-secondary"
              >{loaded.text}</div>
              {#if note}
                <p data-import-file-panel-text-note class={`mt-2 ${SHEET_SMALL} text-ink-muted`}>{note}</p>
              {/if}
              {#if canShowMore && id}
                <button
                  type="button"
                  data-import-file-panel-more
                  disabled={loading}
                  onclick={() => id && void loadFrom(id, shown)}
                  class={`mt-2 ${SHOW_MORE}`}
                >{loading ? "Loading..." : "Show more"}</button>
              {/if}
            {/if}
          </section>
        {:else}
          <div role="status" aria-label="Loading the file" class="flex flex-col gap-2">
            {#each [0, 1, 2, 3] as index (index)}
              <span class="h-3.5 w-2/3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
            {/each}
          </div>
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
