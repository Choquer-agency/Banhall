<!--
  The final PD progress line on the Import page (2026-11-17, asked for in a
  client meeting; docs/product-domain.md): one thin bar and "312 of 1,040
  final PDs approved", with the note that the total is only the final PDs
  added so far and grows as more files are added. It is never a share of
  every PD the firm has, and it shows no percentage. Counts come from
  finalPdProgress (one stored row); final PDs only, To review and
  Approved, never Deleted.

  The whole line is one button that opens the breakdown by fiscal year and
  by writer (ImportProgressDialog). The bar is drawn for the eye only: the
  button's words carry the numbers. It sits above the tabs' own content on
  every tab, since it counts the whole Import, not one tab.
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconChevronRight } from "$lib/components/icons";
  import ImportProgressDialog from "./ImportProgressDialog.svelte";
  import { filledShare, PROGRESS_NOTE, progressText, type FinalPdProgress } from "./importProgress";

  const auth = useAuth();
  const progressQ = useQuery(api.ingestion.finalPdProgress, () => (auth.isAuthenticated ? {} : "skip"));
  const progress = $derived((progressQ.data ?? null) as FinalPdProgress | null);

  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
</script>

{#if progress}
  <!-- Row one: the bar, the count and "By year and writer"; row two: the note, under the count. On a phone the bar takes its own row first, so the count keeps room. -->
  <button
    bind:this={trigger}
    type="button"
    data-import-progress
    aria-haspopup="dialog"
    onclick={() => (open = true)}
    class="group -mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-center sm:grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
  >
    {#if progress.staged > 0}
      <span aria-hidden="true" data-import-progress-bar class="col-span-2 h-1.5 w-full shrink-0 sm:col-span-1 sm:w-40 overflow-hidden rounded-full bg-primary-line-soft">
        <span
          data-import-progress-fill
          class="block h-full rounded-full bg-primary-selected"
          style={`width: ${filledShare({ key: "all", ...progress }) * 100}%`}
        ></span>
      </span>
    {/if}
    <span
      data-import-progress-text
      class={`${progress.staged > 0 ? "" : "sm:col-span-2"} min-w-0 text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink tabular-nums`}
    >{progressText(progress)}</span>
    <span
      data-import-progress-open
      class="inline-flex shrink-0 items-center gap-1 text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected group-hover:text-primary-dark"
    >
      By year and writer
      <IconChevronRight size={13} strokeWidth={1.8} />
    </span>
    {#if progress.staged > 0}
      <span data-import-progress-note class="col-span-2 text-xs sm:col-span-1 sm:col-start-2 sm:col-end-4 leading-[calc(4/3)] text-ink-muted">{PROGRESS_NOTE}</span>
    {/if}
  </button>
  <ImportProgressDialog bind:open returnFocus={() => trigger} />
{/if}
