<script module lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import type { GenerationActivity } from "$lib/dashboard/generationActivity";
  import type { ProjectsTableOwner } from "$lib/dashboard/ownerDisplay";
  import type { ProjectColumnId, ProjectTableDensity } from "$lib/dashboard/projectsTablePreferences";

  export type { ProjectsTableOwner };

  export type ProjectsTableRow = {
    id: string;
    title: string;
    /**
     * Per-company project number "1".."20" or draft letter "A".."Z"
     * (2026-08-11 amendment). Optional; absent until assigned.
     */
    projectNumber?: string;
    /** Compatibility text only; never a Client link/object. */
    clientName: string;
    workflowStage?: WorkflowStage;
    legacyStatus: string;
    owner: ProjectsTableOwner;
    generationActivity?: GenerationActivity | null;
    /**
     * Preformatted absolute created date (2026-08-08 amendment — board-card
     * metadata). Optional: legacy rows without either stamp omit it.
     */
    createdDate?: string;
    /** Preformatted absolute date, e.g. "Jul 29, 2026". */
    updatedDate: string;
    /**
     * "With" — the open blocking current-handoff assignee (2026-08-10
     * amendment; canonical vocabulary: never the Owner). Server-projected;
     * absent when no open blocking handoff exists.
     */
    handoff?: {
      assigneeLabel: string;
      kindLabel: string;
      dueDate?: string;
    };
  };

  export type ProjectsTableColumns = Record<ProjectColumnId, boolean>;
</script>

<script lang="ts">
  // Sparse full-width rows on the light workspace plane (token-driven;
  // hairline separators, lagoon hover hints). Every optional field remains
  // preference-controlled, while stage, Owner, legacy compatibility, and
  // generation activity stay explicitly distinct. Stage is always text plus
  // color — the tone dot never stands alone (a labelled light stage badge
  // accompanies it at every breakpoint).
  import { resolve } from "$app/paths";
  import Badge from "$lib/components/ui/Badge.svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { generationActivityLabel } from "$lib/dashboard/generationActivity";
  import { stageBadgeClasses } from "$lib/workflow/stagePresentation";

  let {
    rows,
    columns = {
      clientName: true,
      stage: true,
      owner: true,
      generationActivity: true,
      updated: true,
    },
    density = "comfortable",
  }: {
    rows: ProjectsTableRow[];
    columns?: ProjectsTableColumns;
    density?: ProjectTableDensity;
  } = $props();

  const rowHeight = $derived(density === "compact" ? "min-h-10" : "min-h-12");
  const rowPadding = $derived(density === "compact" ? "py-1" : "py-1.5");

  function ownerLabel(row: ProjectsTableRow) {
    if (row.owner.kind === "canonical") return row.owner.label;
    if (row.owner.kind === "canonical_unresolved") return "Owner unavailable";
    if (row.owner.kind === "legacy_writer") return row.owner.label;
    return "No owner recorded";
  }

  function ownerInitials(row: ProjectsTableRow) {
    if (row.owner.kind === "canonical_unresolved") return "?";
    if (row.owner.kind === "none") return "-";
    return ownerLabel(row)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("en-CA"))
      .join("") || "?";
  }

  function stageDotClass(row: ProjectsTableRow) {
    if (!row.workflowStage) return "bg-gray-400";
    return stageBadgeClasses(row.workflowStage).dot;
  }
</script>

{#snippet stageValue(row: ProjectsTableRow)}
  {#if row.workflowStage}
    <StageBadge stage={row.workflowStage} dot />
  {:else}
    <span data-legacy-project-status class="inline-flex flex-wrap items-center gap-1.5">
      <Badge status={row.legacyStatus} dot />
      <span data-legacy-status-qualifier class="text-xs text-ink-muted">Legacy status</span>
    </span>
  {/if}
{/snippet}

{#snippet ownerValue(row: ProjectsTableRow)}
  <span class="flex min-w-0 items-center gap-2">
    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fir text-[0.625rem] font-medium text-white" aria-hidden="true">
      {ownerInitials(row)}
    </span>
    <span class="min-w-0">
      <span
        class={`block max-w-40 truncate text-xs ${row.owner.kind === "canonical_unresolved" || row.owner.kind === "none" ? "text-ink-faint" : "text-ink-muted"}`}
        data-owner-unavailable={row.owner.kind === "canonical_unresolved" ? "" : undefined}
        data-owner-none={row.owner.kind === "none" ? "" : undefined}
      >
        {ownerLabel(row)}
      </span>
      {#if row.owner.kind === "legacy_writer"}
        <span data-owner-legacy-qualifier class="block text-[0.625rem] text-ink-muted">Legacy writer</span>
      {/if}
    </span>
  </span>
{/snippet}

{#snippet activityValue(row: ProjectsTableRow)}
  {@const activityLabel = generationActivityLabel(row.generationActivity)}
  {#if activityLabel}
    <span data-generation-activity={row.generationActivity} class="inline-flex max-w-44 rounded-md bg-chrome px-2 py-1 text-xs font-medium text-ink-secondary">
      <span class="truncate">{activityLabel}</span>
    </span>
  {:else}
    <span class="sr-only">No generation activity</span>
  {/if}
{/snippet}

<!-- `relative` makes this scroller the containing block for the rows'
     absolutely-positioned sr-only labels; without a positioned ancestor they
     resolve against the initial containing block, escape every overflow
     ancestor, and grow the document (phantom page scroll under the bounded
     shell). -->
<div role="region" aria-label="Projects list" class="relative min-h-0 flex-1 overflow-y-auto pb-3">
  <ul aria-label="Projects" class="w-full">
    {#each rows as row (row.id)}
      <li class="border-b border-line-soft last:border-b-0">
        <div class={`group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-lg px-2 ${rowHeight} ${rowPadding} transition-colors hover:bg-primary-wash focus-within:bg-primary-wash motion-reduce:transition-none sm:px-2.5 md:grid-cols-[minmax(14rem,1fr)_auto]`}>
          <div class="flex min-w-0 items-center gap-2.5">
            <span class={`h-2 w-2 shrink-0 rounded-full ${stageDotClass(row)}`} aria-hidden="true"></span>
            <div class="min-w-0">
              <a
                href={resolve("/project/[id]", { id: row.id })}
                data-recent-title={row.title}
                data-recent-stage={row.workflowStage ?? undefined}
                data-recent-client={row.clientName || undefined}
                class="flex min-h-11 min-w-0 flex-col justify-center rounded-md text-sm font-medium text-ink transition-colors hover:text-primary-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
              >
                <span class="truncate">{row.title}</span>
                {#if columns.clientName}
                  <span class="truncate text-xs font-normal text-ink-muted md:hidden">{row.clientName || "No client name"}</span>
                {/if}
              </a>
            </div>
          </div>

          <div class="flex min-w-0 items-center justify-end gap-3">
            {#if columns.clientName}
              <span class="hidden max-w-40 truncate text-xs text-ink-muted xl:block">{row.clientName || "No client name"}</span>
            {/if}
            {#if columns.stage}
              <span class="hidden lg:inline-flex">{@render stageValue(row)}</span>
            {/if}
            {#if columns.generationActivity}
              <span class="hidden xl:inline-flex">{@render activityValue(row)}</span>
            {/if}
            {#if columns.owner}
              <span class="hidden sm:inline-flex">{@render ownerValue(row)}</span>
            {/if}
            {#if columns.updated}
              <span class="text-data shrink-0 text-ink-muted">{row.updatedDate}</span>
            {/if}
          </div>

          {#if columns.stage || columns.generationActivity || columns.owner}
            <!-- Labelled stage/activity/owner block shows through `lg` so the
                 tone dot is never the only stage signal at any width. -->
            <div class="col-span-2 flex min-w-0 flex-wrap items-center gap-2 pb-1 lg:hidden">
              {#if columns.stage}{@render stageValue(row)}{/if}
              {#if columns.generationActivity}{@render activityValue(row)}{/if}
              {#if columns.owner}<span class="sm:hidden">{@render ownerValue(row)}</span>{/if}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</div>
