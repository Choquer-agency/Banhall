<!--
  "Continue working" (ui-design-final.md section 9): the project to pick up
  again, with its client, fiscal year and number, the assistant proposals
  still waiting on its latest report, its stage and a Resume report link.
  The company documents card from the board is not shown: no query returns
  documents for a company yet.
-->
<script lang="ts">
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useQuery } from "convex-svelte";
  import { ArrowRightIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import HomeStageChip from "$lib/components/mywork/HomeStageChip.svelte";
  import {
    activityPhrase,
    continueMetaLine,
    proposalsLine,
    type ContinueTarget,
  } from "$lib/mywork/homeRows";

  let {
    target,
    now,
  }: {
    /** undefined while the sources load; null when there is nothing to resume. */
    target: ContinueTarget | null | undefined;
    now: number;
  } = $props();

  const auth = useAuth();
  const summaryQ = useQuery(api.myWork.getContinueWorking, () =>
    auth.isAuthenticated && target ? { projectId: target.projectId } : "skip"
  );
  const summary = $derived(target ? (summaryQ.error ? null : summaryQ.data) : null);
  const eyebrow = $derived.by(() => {
    if (!target) return "";
    if (target.source === "opened") return target.at ? activityPhrase("Opened", target.at, now) : "Opened recently";
    return summary ? activityPhrase("Edited", summary.updatedAt, now) : "";
  });
  const proposals = $derived(
    summary ? proposalsLine(summary.pendingProposals, summary.pendingProposalsTruncated) : null
  );
</script>

<aside data-home-continue aria-labelledby="home-continue-title" class="flex min-w-0 flex-col gap-5">
  <div class="flex h-11 shrink-0 items-center border-b border-line pb-4">
    <h2 id="home-continue-title" class="text-base font-medium leading-6 text-ink">Continue working</h2>
  </div>

  {#if target === undefined || (target && summary === undefined)}
    <div role="status" aria-label="Loading the project to continue" class="flex flex-col gap-2.5 rounded-[9px] border border-line p-5">
      <span class="h-3 w-28 animate-pulse rounded bg-chrome motion-reduce:animate-none"></span>
      <span class="h-4 w-52 max-w-full animate-pulse rounded bg-chrome motion-reduce:animate-none"></span>
      <span class="h-3 w-40 animate-pulse rounded bg-chrome motion-reduce:animate-none"></span>
    </div>
  {:else if target && summary}
    <div data-home-continue-card class="flex flex-col gap-1.5 rounded-[9px] border border-line bg-surface p-5">
      {#if eyebrow}
        <p data-home-continue-when class="text-[11px] leading-4 text-ink-secondary">{eyebrow}</p>
      {/if}
      <p class="text-base font-medium leading-6 text-ink [overflow-wrap:anywhere]">{summary.projectTitle}</p>
      {#if continueMetaLine(summary)}
        <p data-home-continue-meta class="text-xs leading-[18px] text-ink-secondary">{continueMetaLine(summary)}</p>
      {/if}
      {#if proposals}
        <p data-home-continue-proposals class="text-[11px] leading-4 text-ink-secondary">{proposals}</p>
      {/if}
      <div class="flex items-center justify-between gap-3 pt-1.5">
        <HomeStageChip stage={summary.workflowStage} />
        <a
          href={resolve("/project/[id]", { id: summary.projectId })}
          data-home-resume
          data-recent-title={summary.projectTitle}
          data-recent-stage={summary.workflowStage}
          data-recent-client={summary.clientName || undefined}
          class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary-selected px-2.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
        >
          Resume report
          <ArrowRightIcon size={12} aria-hidden="true" />
        </a>
      </div>
    </div>
  {:else}
    <div data-home-continue-empty class="rounded-[9px] border border-line p-5">
      <p class="text-[13px] font-medium leading-[18px] text-ink">Nothing to resume yet</p>
      <p class="mt-1 text-xs leading-[18px] text-ink-muted">Open a project and it shows up here, ready to pick up where you left off.</p>
    </div>
  {/if}
</aside>
