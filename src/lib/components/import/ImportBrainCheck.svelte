<!--
  The Brain check tab on the Import page (2026-11-17, Approve on Import):
  an approved final PD's scrubbed Brain copy, one PD at a time, so a person
  reads it before any Brain copy is made (the 2026-11-17 Brain copy
  amendment's condition). Since 2026-11-18 (second, owner) the PDs come in
  two parts (brainCheckFiles, 25 at a time): the last three fiscal years
  first, newest first, then the rest, highest writer weight first. The
  rest is read once the recent part is all loaded; "2 of 12" with Previous
  and Next runs over both.

  For the PD shown: its company, PD number, title, fiscal year, writer and
  science code; the copy as the Brain would hold it (previewBrainCopy), with
  each hidden word marked, its first 30,000 characters then Show more; at
  the side the warnings in amber, the "Also remove" box (words, product
  names or places to hide too; "Check again" reads the copy with them), the
  note of what the check does not cover, and "Add to the Brain" (the copy
  the person read, `seen`, offered once the whole copy has been shown) or "Keep out of the Brain", which is remembered.
  When Add is refused because the copy changed since it was read, "Check
  again" is offered to read the copy as it is now, and Add waits until it
  is read again from the top.
  A copy that cannot be made says why, and only Keep out is offered. Either
  way the PD stays on its company's page.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { useAction, useMutation, usePaginatedQuery } from "convex-svelte";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import StatusCallout from "$lib/components/ui/StatusCallout.svelte";
  import { IconClose } from "$lib/components/icons";
  import { userErrorMessage } from "$lib/errors";
  import { IMPORT_TOAST } from "./importActions";
  import {
    alsoRemoveWords,
    READ_WHOLE_COPY,
    BRAIN_COPY_VIEW_CHARS,
    brainCheckPosition,
    NOTHING_FOR_BRAIN_CHECK,
    redactionParts,
    shownOfText,
  } from "./importApprove";
  import { fileDisplayName, versionText } from "./importFormat";
  import { AMBER, SHEET_SMALL, SHOW_MORE } from "./sheetLayout";

  let { total = null }: { /** PDs waiting, from the Approved totals. */ total?: number | null } = $props();

  type Row = FunctionReturnType<typeof api.ingestion.brainCheckFiles>["page"][number];
  type Preview = FunctionReturnType<typeof api.ingestion.previewBrainCopy>;

  // The last three fiscal years: this year in UTC and the two before. The
  // server stores which part each PD is in; the year is still sent, as
  // pages before review 48 did, and the server does not need it.
  const recentFromYear = new Date().getUTCFullYear() - 2;
  const recentQ = usePaginatedQuery(
    api.ingestion.brainCheckFiles,
    () => ({ part: "recent" as const, recentFromYear }),
    () => ({ initialNumItems: 25 })
  );
  const recentDone = $derived(recentQ.status === "Exhausted");
  const restQ = usePaginatedQuery(
    api.ingestion.brainCheckFiles,
    () => (recentDone ? { part: "rest" as const, recentFromYear } : "skip"),
    () => ({ initialNumItems: 25 })
  );
  // Each PD once: one whose weight changed between two reads may show in both parts.
  const rows = $derived.by(() => {
    const seen = new Set<string>();
    return [...(recentQ.results as Row[]), ...(recentDone ? (restQ.results as Row[]) : [])].filter((row) =>
      seen.has(row._id) ? false : (seen.add(row._id), true)
    );
  });
  const loadingFirst = $derived(
    recentQ.status === "LoadingFirstPage" || (recentDone && rows.length === 0 && restQ.status === "LoadingFirstPage")
  );
  /** More PDs wait past the ones loaded. */
  const canLoadMore = $derived(recentQ.status === "CanLoadMore" || (recentDone && restQ.status === "CanLoadMore"));

  function loadMore() {
    if (recentQ.status === "CanLoadMore") recentQ.loadMore(25);
    else if (recentDone && restQ.status === "CanLoadMore") restQ.loadMore(25);
  }
  let index = $state(0);
  // The list moves under it when a PD is added or kept out: stay in range.
  const at = $derived(rows.length === 0 ? 0 : Math.min(index, rows.length - 1));
  const current = $derived(rows[at] ?? null);
  const waiting = $derived(Math.max(total ?? 0, rows.length));

  // Past the loaded rows (Next at the end, or nothing loaded yet) while more
  // wait: read the next page, until a PD comes or none is left.
  $effect(() => {
    if (!loadingFirst && index >= rows.length && canLoadMore) untrack(loadMore);
  });

  const preview = useAction(api.ingestion.previewBrainCopy);
  const add = useAction(api.ingestion.addToBrain);
  const keepOut = useMutation(api.ingestion.keepOutOfBrain);

  let words = $state<string[]>([]);
  let typed = $state("");
  /** The words the copy on screen was read with. */
  let checkedWords = $state<string[]>([]);
  let copy = $state<Preview | null>(null);
  let copyError = $state<string | null>(null);
  let reading = $state(false);
  let busy = $state(false);
  let shownChars = $state(BRAIN_COPY_VIEW_CHARS);
  /** Add was refused because the copy changed since it was read: read it again first. */
  let copyChanged = $state(false);

  async function read(itemId: Row["_id"], remove: string[]) {
    reading = true;
    copyError = null;
    try {
      const result = await preview({ itemId, alsoRemove: remove });
      if (current?._id !== itemId) return;
      // A copy that changed is read again from the top, so all of it is shown before Add.
      if (copyChanged) shownChars = BRAIN_COPY_VIEW_CHARS;
      copy = result;
      checkedWords = remove;
      copyChanged = false;
    } catch (error) {
      if (current?._id === itemId) copyError = userErrorMessage(error, "The Brain copy could not be read.");
    } finally {
      if (current?._id === itemId) reading = false;
    }
  }

  // Another PD: its own words, its copy read from the top.
  $effect(() => {
    const id = current?._id ?? null;
    untrack(() => {
      words = [];
      typed = "";
      checkedWords = [];
      copy = null;
      copyError = null;
      copyChanged = false;
      shownChars = BRAIN_COPY_VIEW_CHARS;
      if (id) void read(id, []);
    });
  });

  const wordsChanged = $derived(words.join("\n") !== checkedWords.join("\n"));
  /** The copy on screen is not the one Add would make: Check again first. */
  const needsCheckAgain = $derived(wordsChanged || copyChanged);
  /** The whole copy has been on screen (every "Show more"), so it can be added. */
  const readWhole = $derived(Boolean(copy?.ok && shownChars >= copy.content.length));
  const parts = $derived(copy?.ok ? redactionParts(copy.content.slice(0, shownChars)) : []);
  const name = $derived(current ? fileDisplayName(current) : null);
  const details = $derived(
    current
      ? [
          current.fiscalYear !== undefined ? `FY${current.fiscalYear}` : null,
          versionText(current.versionCode, current.versionNumber),
          current.writerName ?? null,
          current.scienceCode ?? null,
        ].filter((part): part is string => Boolean(part))
      : []
  );

  function addWords() {
    words = alsoRemoveWords(typed, words);
    typed = "";
  }

  async function addToBrain() {
    if (!current || !copy?.ok || busy || needsCheckAgain || !readWhole) return;
    busy = true;
    const itemId = current._id;
    try {
      const result = await add({ itemId, alsoRemove: checkedWords, seen: copy.seen });
      if (result.ok) {
        toast(result.outcome === "matched" ? "Added: it matched a Brain source that was already there" : "Added to the Brain", IMPORT_TOAST);
      } else {
        if (result.changed && current?._id === itemId) copyChanged = true;
        toast.error(result.reason, IMPORT_TOAST);
      }
    } catch (error) {
      toast.error(userErrorMessage(error, "It could not be added to the Brain."), IMPORT_TOAST);
    } finally {
      busy = false;
    }
  }

  async function keep() {
    if (!current || busy) return;
    busy = true;
    try {
      await keepOut({ itemId: current._id });
      toast("Kept out of the Brain", IMPORT_TOAST);
    } catch (error) {
      toast.error(userErrorMessage(error, "It could not be kept out."), IMPORT_TOAST);
    } finally {
      busy = false;
    }
  }
</script>

<section data-import-brain-check aria-label="Brain check" class="flex flex-col gap-4">
  <p class="max-w-[46rem] text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
    Approved final PDs wait here before any copy goes into the Brain. Read each copy with the company's names hidden, then add it or keep it out.
    The PD stays on its company's page either way. The last three fiscal years come first, then the writers with the highest weight.
  </p>

  {#if loadingFirst || (!current && canLoadMore)}
    <div role="status" aria-label="Loading the Brain check" class="flex flex-col gap-2">
      {#each [0, 1, 2] as row (row)}<span class="h-4 w-2/3 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>{/each}
    </div>
  {:else if !current}
    <p data-import-brain-empty class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{NOTHING_FOR_BRAIN_CHECK}</p>
  {:else}
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft pb-3">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <p data-import-brain-company class={`${SHEET_SMALL} text-ink-muted`}>{current.companyName}</p>
        <h2 data-import-brain-title class="flex min-w-0 items-baseline gap-2.5 text-[0.9375rem] leading-[calc(4/3)] font-medium text-ink">
          {#if name?.prefix}<span class="shrink-0 text-ink-muted">{name.prefix}</span>{/if}
          <span class="min-w-0 truncate" title={current.name}>{name?.title}</span>
        </h2>
        {#if details.length > 0}
          <p data-import-brain-details class={`${SHEET_SMALL} text-ink-muted`}>{details.join(" · ")}</p>
        {/if}
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span data-import-brain-position class={`${SHEET_SMALL} tabular-nums text-ink-muted`}>{brainCheckPosition(at, waiting)}</span>
        <Button variant="secondary" size="xs" disabled={at === 0} data-import-brain-previous onclick={() => (index = at - 1)}>Previous</Button>
        <Button
          variant="secondary"
          size="xs"
          disabled={at >= rows.length - 1 && !canLoadMore}
          data-import-brain-next
          onclick={() => {
            index = at + 1;
          }}
        >Next</Button>
      </div>
    </div>

    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div class="flex min-w-0 flex-col gap-2">
        <h3 class={`${SHEET_SMALL} tracking-[0.04em] text-ink-muted uppercase`}>Brain copy{copy?.ok ? `: ${copy.title}` : ""}</h3>
        {#if copyError}
          <StatusCallout tone="danger" role="alert">{copyError}</StatusCallout>
        {:else if !copy}
          <div role="status" aria-label="Reading the Brain copy" class="flex flex-col gap-2 rounded-lg border border-line-soft p-4">
            {#each [0, 1, 2, 3, 4] as row (row)}<span class="h-3 w-full animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>{/each}
          </div>
        {:else if !copy.ok}
          <StatusCallout tone="warning" title="No Brain copy can be made" role="status">
            <span data-import-brain-refusal>{copy.reason}</span>
          </StatusCallout>
        {:else}
          <div
            data-import-brain-copy
            aria-busy={reading}
            class={`max-h-[min(36rem,60dvh)] overflow-y-auto rounded-lg border border-line-soft bg-gray-50 px-4 py-3 text-[0.8125rem] leading-[calc(20/13)] whitespace-pre-wrap break-words text-ink-secondary ${reading ? "opacity-60" : ""}`}
          >{#each parts as part, partIndex (partIndex)}{#if part.mark}<mark data-import-brain-redacted class="rounded-[0.1875rem] bg-primary-wash text-fir">{part.text}</mark>{:else}{part.text}{/if}{/each}</div>
          {#if copy.content.length > shownChars}
            <div class="flex items-center gap-3">
              <p class={`${SHEET_SMALL} text-ink-muted`}>{shownOfText(shownChars, copy.content.length)}</p>
              <button type="button" data-import-brain-more onclick={() => (shownChars += BRAIN_COPY_VIEW_CHARS)} class={SHOW_MORE}>Show more</button>
            </div>
          {/if}
        {/if}
      </div>

      <aside class="flex min-w-0 flex-col gap-4" aria-label="Before you add it">
        {#if copy?.ok && copy.warnings.length > 0}
          <div data-import-brain-warnings class="rounded-lg bg-warning-surface px-3 py-2.5">
            <p class={`text-[0.8125rem] leading-[calc(18/13)] font-medium ${AMBER}`}>Check these</p>
            <ul class={`mt-1 flex flex-col gap-1 ${SHEET_SMALL} ${AMBER}`}>
              {#each copy.warnings as warning (warning)}<li>{warning}</li>{/each}
            </ul>
          </div>
        {/if}

        <div class="flex flex-col gap-2">
          <Input
            id="import-brain-also-remove"
            label="Also remove"
            bind:value={typed}
            data-import-brain-also-remove
            autocomplete="off"
            spellcheck="false"
            aria-describedby="import-brain-also-remove-help"
            placeholder="KelpTrack, Mill Road site"
            onkeydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addWords();
              }
            }}
          />
          <div class="flex items-start gap-2">
            <p id="import-brain-also-remove-help" class={`min-w-0 flex-1 ${SHEET_SMALL} text-ink-muted`}>
              Words to hide too, such as product names, nicknames or places. Separate them with commas.
            </p>
            <Button variant="secondary" size="xs" disabled={!typed?.trim()} data-import-brain-add-word onclick={addWords}>Add</Button>
          </div>
          {#if words.length > 0}
            <ul data-import-brain-words class="flex flex-wrap gap-1.5">
              {#each words as word (word)}
                <li class="inline-flex h-6 items-center gap-1 rounded-full bg-chrome pr-1 pl-2.5 text-xs leading-[calc(4/3)] text-ink-secondary">
                  {word}
                  <button
                    type="button"
                    aria-label={`Do not remove ${word}`}
                    onclick={() => (words = words.filter((have) => have !== word))}
                    class="flex size-4 items-center justify-center rounded-full text-ink-muted hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-fir pointer-coarse:size-11"
                  ><IconClose size={10} strokeWidth={2} /></button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if needsCheckAgain}
            <Button variant="primary-outline" size="xs" class="self-start" disabled={reading} data-import-brain-check-again onclick={() => current && void read(current._id, words)}>
              {reading ? "Reading..." : "Check again"}
            </Button>
          {/if}
        </div>

        {#if copy}
          <p data-import-brain-not-covered class={`${SHEET_SMALL} text-ink-muted`}>{copy.notCovered}</p>
        {/if}

        <div class="flex flex-wrap gap-2 border-t border-line-soft pt-4">
          {#if copy?.ok}
            <Button size="sm" disabled={busy || reading || needsCheckAgain || !readWhole} data-import-brain-add onclick={() => void addToBrain()}>Add to the Brain</Button>
          {/if}
          <Button variant="secondary" size="sm" disabled={busy || !copy} data-import-brain-keep-out onclick={() => void keep()}>Keep out of the Brain</Button>
        </div>
        {#if copy?.ok && copyChanged}
          <p data-import-brain-changed class={`${SHEET_SMALL} text-ink-muted`}>The Brain copy changed since you read it. Check again to read it as it is now.</p>
        {:else if copy?.ok && wordsChanged}
          <p class={`${SHEET_SMALL} text-ink-muted`}>Check again before you add it, so you read the copy with these words hidden.</p>
        {:else if copy?.ok && !readWhole}
          <p data-import-brain-read-whole class={`${SHEET_SMALL} text-ink-muted`}>{READ_WHOLE_COPY}</p>
        {/if}
      </aside>
    </div>
  {/if}
</section>
