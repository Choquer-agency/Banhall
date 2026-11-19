<!--
  One approval on the line under the Import toolbar (2026-11-17, Approve on
  Import; ImportApprovalLine lists them).
  While it runs, "Approving files of Halden Foods: 40 of 300 done." with a
  thin bar; once done, "Approved 296 files of Halden Foods. 4 were left on
  To review." with "Show why", which lists each file left and its reason
  (approvalRefusals), and a close button that puts the line away. An
  approval whose chain stopped says so, and that approving again goes on:
  a running one whose chain has not moved for five minutes is told on this
  page's own timer, from when the chain last moved (lastProgressAt), since
  the query does not run again as time passes.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import { useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconClose } from "$lib/components/icons";
  import { APPROVAL_STALE_MS, approvalStopped } from "../../../../shared/importSheetRules";
  import { progressText, refusalSummary, refusalText, type ApprovalProgress } from "./importApprove";
  import { POPOVER_CARD, SHEET_SMALL } from "./sheetLayout";

  let { progress }: { progress: ApprovalProgress } = $props();

  /** The page's clock, moved on when a running approval would turn stopped. */
  let now = $state(Date.now());
  $effect(() => {
    if (!progress || progress.status !== "running") return;
    const due = progress.lastProgressAt + APPROVAL_STALE_MS - Date.now();
    if (due <= 0) {
      now = Date.now();
      return;
    }
    const timer = setTimeout(() => (now = Date.now()), due);
    return () => clearTimeout(timer);
  });
  const stopped = $derived(Boolean(progress) && approvalStopped(progress, now));
  const running = $derived(progress?.status === "running" && !stopped);
  const percent = $derived(progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0);

  let whyOpen = $state(false);
  const refusalsQ = useQuery(api.ingestion.approvalRefusals, () =>
    whyOpen && progress ? { approvalId: progress.approvalId } : "skip"
  );
  const refusals = $derived(refusalsQ.data?.files ?? []);

  const dismiss = useMutation(api.ingestion.dismissApproval);
</script>

{#if progress}
  <div data-import-approval={progress.approvalId} class="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1">
    <p role="status" data-import-approval-text class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{progressText(progress, now)}</p>
    {#if running}
      <span
        role="progressbar"
        aria-label="Files approved"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        data-import-approval-bar
        class="h-1 w-40 shrink-0 overflow-hidden rounded-full bg-gray-100"
      >
        <span class="block h-full rounded-full bg-primary-selected transition-[width] duration-300 motion-reduce:transition-none" style={`width: ${percent}%`}></span>
      </span>
    {/if}
    {#if progress.refused > 0}
      <Popover.Root bind:open={whyOpen}>
        <Popover.Trigger
          data-import-approval-why
          class="rounded-sm text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected transition-colors hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
        >Show why</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Files left on To review"
            data-import-approval-refusals
            class={`${POPOVER_CARD} w-[24rem] max-w-[calc(100vw-1.5rem)] p-3`}
          >
            {#if refusalsQ.data}
              <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink">{refusalSummary(refusals)}</p>
              <ul class="mt-2 flex max-h-[18rem] flex-col gap-1.5 overflow-y-auto">
                {#each refusals as file (file.itemId)}
                  <li class="flex flex-col">
                    <span class="truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" title={file.name}>{file.name}</span>
                    <span class={`${SHEET_SMALL} text-ink-muted`}>{refusalText(file)}</span>
                  </li>
                {/each}
              </ul>
              {#if refusalsQ.data.more}
                <p class={`mt-2 ${SHEET_SMALL} text-ink-muted`}>The first 100 are listed. The rest are still on To review.</p>
              {/if}
            {:else}
              <p role="status" class={`${SHEET_SMALL} text-ink-muted`}>Loading...</p>
            {/if}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    {/if}
    {#if !running && progress.mine}
      <button
        type="button"
        aria-label="Close this line"
        data-import-approval-dismiss
        onclick={() => progress && void dismiss({ approvalId: progress.approvalId })}
        class="flex size-6 items-center justify-center rounded-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
      >
        <IconClose size={12} strokeWidth={1.8} />
      </button>
    {/if}
  </div>
{/if}
