<!--
  The breakdown behind the Import page's progress line (2026-11-17, asked
  for in a client meeting: "are all fiscal 2025 PDs done?" and "how many of
  Tracy's PDs are in"). Two meter lists in the form dialog frame, read from
  finalPdBreakdown only while the dialog is open:

  - By fiscal year: one row per year, newest first, then "No fiscal year".
  - By writer: one row per writer, most final PDs added first, under the
    writer's label as it is now (a past writer with the picker's quiet
    "No login" tag), then "No writer yet" and "Not sorted yet" (names with
    three or four sets of initials, waiting for the client).

  Each row is a name, a thin bar of its own approved share (one lagoon
  fill on a pale lagoon track, bars aligned) and "40 of 52". The bars are
  drawn for the eye only; the figures say the same in words. Only final PDs
  added so far count, so no row is a share of the firm's PDs.
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { CheckIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import FormDialog from "$lib/components/ui/FormDialog.svelte";
  import { formPrimary } from "$lib/components/ui/formDialog";
  import {
    allApproved,
    BREAKDOWN_NOTE,
    filledShare,
    rowFigure,
    yearLabel,
    type FinalPdBreakdown,
    type FinalPdRow,
  } from "./importProgress";

  let {
    open = $bindable(false),
    returnFocus = undefined,
  }: {
    open?: boolean;
    returnFocus?: () => HTMLElement | null | undefined;
  } = $props();

  const auth = useAuth();
  const breakdownQ = useQuery(api.ingestion.finalPdBreakdown, () => (open && auth.isAuthenticated ? {} : "skip"));
  const breakdown = $derived((breakdownQ.data ?? null) as FinalPdBreakdown | null);
  /** The read failed: say so, rather than "Loading..." for ever. */
  const failed = $derived(breakdown === null && breakdownQ.error !== undefined && breakdownQ.error !== null);
  const empty = $derived(breakdown !== null && breakdown.years.length === 0);

  type Line = { key: string; label: string; tag: string | null; row: FinalPdRow; quiet: boolean };
  const yearLines = $derived<Line[]>(
    (breakdown?.years ?? []).map((row) => ({ key: row.key, label: yearLabel(row.key), tag: null, row, quiet: row.key === "none" }))
  );
  const writerLines = $derived<Line[]>([
    ...(breakdown?.writers ?? []).map((row) => ({ key: row.key, label: row.label, tag: row.noLogin ? "No login" : null, row, quiet: false })),
    ...(breakdown?.noWriter ? [{ key: "none", label: "No writer yet", tag: null, row: breakdown.noWriter, quiet: true }] : []),
    ...(breakdown?.unsorted ? [{ key: "unsorted", label: "Not sorted yet", tag: null, row: breakdown.unsorted, quiet: true }] : []),
  ]);
</script>

{#snippet meterList(id: string, heading: string, nameHeading: string, lines: Line[])}
  <section aria-labelledby={`${id}-heading`} data-import-progress-section={id} class="flex flex-col gap-2">
    <h3 id={`${id}-heading`} class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink">{heading}</h3>
    <table class="w-full table-fixed border-collapse" aria-labelledby={`${id}-heading`}>
      <thead class="sr-only">
        <tr>
          <th scope="col">{nameHeading}</th>
          <th scope="col">Approved of those added</th>
        </tr>
      </thead>
      <tbody>
        {#each lines as line (line.key)}
          {@const done = allApproved(line.row)}
          <tr data-import-progress-row={line.key} class="border-t border-line-soft first:border-t-0">
            <th scope="row" class="py-2 pr-3 text-left font-normal">
              <span class="flex min-w-0 items-center gap-2">
                <span
                  data-import-progress-name
                  class={`min-w-0 truncate text-[0.8125rem] leading-[calc(18/13)] ${line.quiet ? "text-ink-muted" : "text-ink-secondary"}`}
                  title={line.label}
                >{line.label}</span>
                {#if line.tag}
                  <span data-import-progress-tag class="shrink-0 text-xs leading-[calc(4/3)] text-ink-muted">{line.tag}</span>
                {/if}
              </span>
            </th>
            <td class="w-[13.75rem] py-2 max-[600px]:w-[11rem]">
              <span class="flex items-center gap-3">
                <span aria-hidden="true" data-import-progress-bar class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-primary-line-soft">
                  <span
                    data-import-progress-fill
                    class="block h-full rounded-full bg-primary-selected"
                    style={`width: ${filledShare(line.row) * 100}%`}
                  ></span>
                </span>
                <span
                  data-import-progress-figure
                  class={`flex w-[7rem] shrink-0 items-center justify-end gap-1 text-right text-xs leading-[calc(4/3)] tabular-nums ${done ? "text-ink" : "text-ink-secondary"}`}
                >
                  {#if done}
                    <CheckIcon size="0.75rem" weight="bold" aria-hidden="true" class="shrink-0 text-primary-selected" />
                  {/if}
                  <span data-import-progress-count>{rowFigure(line.row)}</span>
                  {#if done}<span data-import-progress-all class="sr-only">All approved</span>{/if}
                </span>
              </span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/snippet}

<FormDialog
  bind:open
  title="Final PD progress"
  description={BREAKDOWN_NOTE}
  width={560}
  {returnFocus}
  testId="import-progress-dialog"
>
  {#if failed}
    <p role="alert" data-import-progress-error class="text-sm leading-[calc(10/7)] text-ink-secondary">
      The breakdown could not be loaded. Close this and open it again.
    </p>
  {:else if breakdown === null}
    <p role="status" class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Loading...</p>
  {:else if empty}
    <p data-import-progress-empty class="text-sm leading-[calc(10/7)] text-ink-secondary">
      No final PDs added yet. Once final PDs are added, this shows how many are approved for each fiscal year and each writer.
    </p>
  {:else}
    <div class="flex flex-col gap-6">
      {@render meterList("import-progress-years", "By fiscal year", "Fiscal year", yearLines)}
      {@render meterList("import-progress-writers", "By writer", "Writer", writerLines)}
      <div class="flex flex-col gap-1 text-xs leading-[calc(4/3)] text-ink-muted">
        {#if breakdown.unsorted}
          <p data-import-progress-unsorted-note>
            Not sorted yet: file names with three or four sets of initials. They get a writer once the client confirms what the
            extra initials mean.
          </p>
        {/if}
        <p>Deleted files are not counted.</p>
        {#if !breakdown.complete}
          <p data-import-progress-partial>Only the first 500 writers are shown.</p>
        {/if}
      </div>
    </div>
  {/if}
  {#snippet footer()}
    <button type="button" data-import-progress-done class={formPrimary} onclick={() => (open = false)}>Done</button>
  {/snippet}
</FormDialog>
