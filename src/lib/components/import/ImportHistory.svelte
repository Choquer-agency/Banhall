<!--
  The History tab of the Import page (2026-11-12; not drawn in detail, so as
  plain as the sheet): one row per batch of files that arrived together,
  newest first, with when, who, how it came, how many were added, how many
  were already here and how many could not be read. OneDrive sync runs from
  before batches are rows too (the old page's sync log), with what they did
  not count said so. 25 rows, then "Show 25 more". The header row and the
  column lines are the sheet's.

  Rows are plain, not links: listing one batch's files on To review would
  need per-batch counts the sheet does not keep. A batch's files show on To
  review, where the New filter lists what arrived in the last 24 hours.
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { formatCount } from "./importFormat";
  import { HISTORY_PAGE, historyCount, historyWhen, historyWho, HOW_IT_CAME, type HistoryRow } from "./importIntake";
  import { FIXED_CELL, SHEET_SMALL, SHEET_TEXT, SHOW_MORE } from "./sheetLayout";

  const auth = useAuth();
  let limit = $state(HISTORY_PAGE);
  const historyQ = useQuery(api.ingestion.importHistory, () => (auth.isAuthenticated ? { limit } : "skip"), () => ({
    keepPreviousData: true,
  }));
  const rows = $derived((historyQ.data?.rows ?? []) as HistoryRow[]);
  const loading = $derived(historyQ.data === undefined && !historyQ.error);

  const GRID =
    "grid grid-cols-[minmax(9rem,1.1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_minmax(5.5rem,0.6fr)_minmax(6.5rem,0.6fr)_minmax(8rem,0.7fr)]";
  const COLUMNS = ["Who", "How it came", "Added", "Already here", "Could not be read"] as const;

  function addedText(row: HistoryRow): string {
    const added = formatCount(row.added);
    return row.notSent > 0 ? `${added}, ${formatCount(row.notSent)} not sent` : added;
  }
</script>

<div data-import-history class="overflow-x-auto">
  <div class="min-w-[46rem]">
    <div role="table" aria-label="Import history">
      <div role="rowgroup">
        <div role="row" data-import-history-header class={`${GRID} h-9 rounded-lg bg-gray-50 ${SHEET_SMALL} text-ink-muted`}>
          <div role="columnheader" class="flex min-w-0 items-center pl-4">When</div>
          {#each COLUMNS as column (column)}
            <div role="columnheader" class={FIXED_CELL}>{column}</div>
          {/each}
        </div>
      </div>
      <div role="rowgroup">
        {#each rows as row (row.key)}
          <div role="row" data-import-history-row={row.source} class={`${GRID} h-11 border-t border-line-soft ${SHEET_TEXT} text-ink-secondary`}>
            <div role="cell" class="flex min-w-0 items-center pl-4 text-ink"><span class="truncate">{historyWhen(row.startedAt)}</span></div>
            <div role="cell" class={FIXED_CELL}><span class={`truncate ${row.who ? "" : "text-ink-muted"}`}>{historyWho(row)}</span></div>
            <div role="cell" class={FIXED_CELL}><span class="truncate">{HOW_IT_CAME[row.source]}</span></div>
            <div role="cell" class={`${FIXED_CELL} tabular-nums`}><span class="truncate">{addedText(row)}</span></div>
            <div role="cell" class={`${FIXED_CELL} tabular-nums ${row.alreadyHere === null ? "text-ink-muted" : ""}`}><span class="truncate">{historyCount(row.alreadyHere)}</span></div>
            <div role="cell" class={`${FIXED_CELL} tabular-nums ${row.couldNotRead === null ? "text-ink-muted" : ""}`}><span class="truncate">{historyCount(row.couldNotRead)}</span></div>
          </div>
        {/each}
      </div>
    </div>

    {#if historyQ.error && rows.length === 0}
      <p role="alert" class={`py-8 pl-4 ${SHEET_TEXT} text-ink-secondary`}>The history could not be loaded.</p>
    {:else if loading}
      <div role="status" aria-label="Loading the history">
        {#each [0, 1, 2] as index (index)}
          <div class="flex h-11 items-center border-t border-line-soft pl-4">
            <span class="h-3 w-48 animate-pulse rounded-sm bg-gray-50 motion-reduce:animate-none"></span>
          </div>
        {/each}
      </div>
    {:else if rows.length === 0}
      <p data-import-history-empty class={`border-t border-line-soft py-8 pl-4 ${SHEET_TEXT} text-ink-secondary`}>Nothing has been added yet.</p>
    {:else if historyQ.data?.more}
      <div class="flex h-10 items-center border-t border-line-soft pl-4">
        <button type="button" data-import-history-more class={SHOW_MORE} onclick={() => (limit += HISTORY_PAGE)}>Show {HISTORY_PAGE} more</button>
      </div>
    {:else}
      <div class="border-t border-line-soft" aria-hidden="true"></div>
    {/if}
  </div>
</div>
