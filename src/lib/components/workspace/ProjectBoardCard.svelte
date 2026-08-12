<script lang="ts">
  // Shared board card — Obvious light board anatomy (full-markup evidence
  // 2026-08-10): a column-TINTED outer shell (`bg-category-*-bg` analog via
  // the stage card theme) wrapping a neutral white inset panel; no status
  // chip on the card (the tint + column chip carry stage identity).
  // Banhall deliberately keeps the card navigational (pointer
  // cursor, stretched link) rather than copying Obvious's draggable task
  // semantics, because workflow transitions remain governed actions.
  // Metadata stays truthful to the bounded project row: client, canonical
  // Owner/qualified legacy writer, the server-projected open blocking
  // current handoff ("With"), generation activity, and available
  // created/updated stamps. No priority is invented. Paused stages keep the
  // dashed-border cue (text label lives on the column chip).
  import { resolve } from "$app/paths";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { generationActivityLabel } from "$lib/dashboard/generationActivity";
  import {
    STAGE_CARD_THEMES,
    isPausedStage,
    stageCardTheme,
  } from "$lib/workflow/stagePresentation";
  import type { ProjectsTableRow } from "./ProjectsTable.svelte";

  let {
    row,
    showClient = true,
    showStage = false,
  }: {
    row: ProjectsTableRow;
    /**
     * Render the client supporting line. Client-scoped surfaces (client
     * lanes) pass false because the section header already carries the
     * client name — repeating it on every card is noise, not context (live
     * QA 2026-08-07). The flat stage-first board keeps the default: there
     * the card is the only client signal.
     */
    showClient?: boolean;
    /**
     * Render the labelled stage badge on the card. Stage-column boards keep
     * the default (the column chip is the labelled stage carrier); a
     * column-less surface must pass true so stage identity is never
     * color-only. No current consumer — kept for that contract.
     */
    showStage?: boolean;
  } = $props();

  const paused = $derived(
    row.workflowStage ? isPausedStage(row.workflowStage) : false
  );
  // Column-tinted shell (Obvious light board, full-markup evidence
  // 2026-08-10: cards carry bg-category-*-bg matching their column) around a
  // neutral white inset panel; On hold inherits the violet "held" tone.
  const theme = $derived(
    row.workflowStage ? stageCardTheme(row.workflowStage) : STAGE_CARD_THEMES.neutral
  );
  const activityLabel = $derived(generationActivityLabel(row.generationActivity));

  const ownerLabel = $derived.by(() => {
    if (row.owner.kind === "canonical" || row.owner.kind === "legacy_writer") {
      return row.owner.label;
    }
    return row.owner.kind === "canonical_unresolved" ? "Owner unavailable" : "No owner recorded";
  });
</script>

<article
  data-project-board-card
  class={`group relative flex max-w-full cursor-pointer flex-col overflow-hidden rounded-xl border shadow-sm transition-colors motion-reduce:transition-none ${theme.footerBg} ${paused ? "border-dashed border-violet-300" : "border-transparent"} ${theme.hoverBorder} ${theme.focusWithinBorder}`}
>
  <header data-card-header class="flex min-w-0 items-center gap-2 rounded-t-xl px-2.5 py-1.5">
    {#if row.projectNumber}
      <!-- Per-company project number / draft letter (2026-08-11 amendment):
           faint mono data chip; identity only, never a status signal. -->
      <span
        data-card-project-number
        class="text-data shrink-0 rounded bg-surface/70 px-1 py-px font-medium text-ink-muted"
      >#{row.projectNumber}</span>
    {/if}
    <a
      href={resolve("/project/[id]", { id: row.id })}
      data-recent-title={row.title}
      data-recent-stage={row.workflowStage ?? undefined}
      data-recent-client={row.clientName || undefined}
      class="block min-w-0 flex-1 truncate rounded-md text-[0.8125rem] font-medium leading-5 text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    >{row.title}</a>
  </header>

  <div data-card-content class="p-0">
    <div class="m-0.5 space-y-1 overflow-hidden rounded-[10px] bg-surface p-2.5 text-xs leading-[1.15rem] text-ink-secondary shadow-[0_0_1px_0_rgba(0,0,0,0.05)]">
      {#if showStage && row.workflowStage}
        <!-- Labelled stage carrier for column-less surfaces (text always
             accompanies the tint; legacy rows keep their qualifier row). -->
        <div data-card-field="stage" class="flex min-w-0 items-center overflow-hidden">
          <StageBadge stage={row.workflowStage} shape="square" />
        </div>
      {/if}
      {#if showClient}
        <div data-card-field="client" class="flex min-w-0 items-start gap-2 overflow-hidden">
          <svg class="mt-0.5 h-3 w-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg>
          <span class="sr-only">Client</span>
          <span class="block min-w-0 flex-1 truncate">{row.clientName || "No client name"}</span>
        </div>
      {/if}

      <div data-card-field="owner" class="flex min-w-0 items-start gap-2 overflow-hidden">
        <svg class="mt-0.5 h-3 w-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
        <span class="sr-only">Owner</span>
        <span class="block min-w-0 flex-1 truncate">
          {#if row.owner.kind === "legacy_writer"}
            {row.owner.label} <span data-owner-legacy-qualifier class="text-ink-muted">Writer · legacy</span>
          {:else if row.owner.kind === "canonical_unresolved"}
            <span data-owner-unavailable>{ownerLabel}</span>
          {:else if row.owner.kind === "none"}
            <span aria-hidden="true">—</span><span data-owner-none class="sr-only">none recorded</span>
          {:else}
            {ownerLabel}
          {/if}
        </span>
      </div>

      {#if row.handoff}
        <!-- "With" answers "who has the next blocking action" (product thesis
             #2). Canonical vocabulary: the current-handoff assignee, never
             the Owner. -->
        <div data-card-field="handoff" class="flex min-w-0 items-start gap-2 overflow-hidden">
          <svg class="mt-0.5 h-3 w-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.36 7.36 0 0 1 7.5-7.25 7.36 7.36 0 0 1 4.06 1.19M15 18h6m0 0-2.5-2.5M21 18l-2.5 2.5" /></svg>
          <span class="sr-only">With</span>
          <span class="block min-w-0 flex-1 truncate">
            {row.handoff.assigneeLabel}
            <span class="text-ink-muted">· {row.handoff.kindLabel}{row.handoff.dueDate ? ` · due ${row.handoff.dueDate}` : ""}</span>
          </span>
        </div>
      {/if}

      {#if row.createdDate}
        <div data-card-field="created" class="flex min-w-0 items-start gap-2 overflow-hidden">
          <svg class="mt-0.5 h-3 w-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8 2v3m8-3v3M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z" /></svg>
          <span data-created-date class="block min-w-0 flex-1 truncate">Created {row.createdDate}</span>
        </div>
      {/if}

      <div data-card-field="updated" class="flex min-w-0 items-start gap-2 overflow-hidden">
        <svg class="mt-0.5 h-3 w-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2m5-2a9 9 0 1 1-3-6.7M21 3v6h-6" /></svg>
        <span data-updated-date class="block min-w-0 flex-1 truncate">Updated {row.updatedDate}</span>
      </div>

      {#if activityLabel}
        <div data-card-field="activity" class="flex min-w-0 items-start gap-2 overflow-hidden">
          <svg class="mt-0.5 h-3 w-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" /></svg>
          <span class="sr-only">Generation activity</span>
          <span data-generation-activity={row.generationActivity} class="block min-w-0 flex-1 truncate">{activityLabel}</span>
        </div>
      {/if}

      {#if !row.workflowStage}
        <div data-card-field="legacy" class="flex min-w-0 items-start gap-2 overflow-hidden">
          <svg class="mt-0.5 h-3 w-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h10" /></svg>
          <span data-legacy-status-qualifier class="block min-w-0 flex-1 truncate">Legacy status · {row.legacyStatus}</span>
        </div>
      {/if}
    </div>
  </div>
</article>
