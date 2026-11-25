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
  <!-- Framed hairline strip: desktop pairs count+note on left with bar+link on right; phone puts bar on row 1, count + link on row 2, note on row 3. -->
  <button
    bind:this={trigger}
    type="button"
    data-import-progress
    aria-haspopup="dialog"
    onclick={() => (open = true)}
    class="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border border-line-soft bg-gray-50/70 px-3.5 py-2 text-left transition-[background-color,border-color] duration-150 ease-out hover:border-line hover:bg-primary-wash/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-4 sm:gap-y-0.5 pointer-coarse:min-h-11"
  >
    {#if progress.staged > 0}
      <span
        aria-hidden="true"
        data-import-progress-bar
        class="col-span-2 row-start-1 mb-0.5 h-1.5 w-full overflow-hidden rounded-full bg-primary-line-soft sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mb-0 sm:w-36 sm:self-center"
      >
        <span
          data-import-progress-fill
          class="block h-full rounded-full bg-primary-selected transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={`width: ${filledShare({ key: "all", ...progress }) * 100}%`}
        ></span>
      </span>
    {/if}
    <span
      data-import-progress-text
      class="col-start-1 row-start-2 min-w-0 justify-self-start text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink tabular-nums sm:row-start-1"
    >{progressText(progress)}</span>
    <span
      data-import-progress-open
      class="col-start-2 row-start-2 inline-flex shrink-0 items-center gap-1 justify-self-end text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected transition-colors duration-150 ease-out group-hover:text-primary-dark motion-reduce:transition-none sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:self-center"
    >
      By year and writer
      <IconChevronRight size={13} strokeWidth={1.8} class="transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </span>
    {#if progress.staged > 0}
      <span
        data-import-progress-note
        class="col-span-2 row-start-3 text-xs leading-[calc(4/3)] text-ink-muted sm:col-span-1 sm:col-start-1 sm:row-start-2"
      >{PROGRESS_NOTE}</span>
    {/if}
  </button>
  <ImportProgressDialog bind:open returnFocus={() => trigger} />
{/if}
