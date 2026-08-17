<script module lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import type { ProjectType } from "../../../../shared/projectTypes";
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
    /** Formal report title, shown only when distinct from the internal title. */
    sredTitle?: string;
    /** Canonical work-product identity (legacy rows are dual-read). */
    projectType?: ProjectType;
    /** Fiscal year derived from the recorded fiscal-year-end timestamp. */
    fiscalYear?: number;
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
  import { LinkPreview } from "bits-ui";
  import { popIn, popOut } from "$lib/motion/panelMotion";
  import Badge from "$lib/components/ui/Badge.svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { generationActivityLabel } from "$lib/dashboard/generationActivity";
  import { stageBadgeClasses } from "$lib/workflow/stagePresentation";
  import { setProjectPagingContext } from "$lib/workspace/projectPagingContext";

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
    contextLabel = "Projects",
    contextBounded = false,
  }: {
    rows: ProjectsTableRow[];
    columns?: ProjectsTableColumns;
    density?: ProjectTableDensity;
    /** Where these rows live, for the project header's "N of M in <label>"
     * paging context (2026-08-13, Attio-research P1). */
    contextLabel?: string;
    /** True when more rows existed beyond this loaded page. */
    contextBounded?: boolean;
  } = $props();

  function stashPagingContext() {
    setProjectPagingContext({
      ids: rows.map((row) => row.id),
      label: contextLabel,
      bounded: contextBounded,
    });
  }

  // Density ladder (2026-08-13, Attio-research P2): compact rows reach the
  // Attio-density ~36px on pointer-fine devices; the ≥44px touch-target
  // contract holds via pointer-coarse floors here and on the title anchor.
  const rowHeight = $derived(
    density === "compact" ? "min-h-9 pointer-coarse:min-h-11" : "min-h-12"
  );
  const rowPadding = $derived(density === "compact" ? "py-0.5" : "py-1.5");
  const anchorHeight = $derived(
    density === "compact" ? "min-h-8 pointer-coarse:min-h-11" : "min-h-11"
  );
  const desktopGrid = $derived.by(() => {
    const tracks = ["minmax(14rem,1.5fr)"];
    if (columns.clientName) tracks.push("minmax(8rem,.8fr)");
    if (columns.stage) tracks.push("minmax(7rem,.7fr)");
    if (columns.generationActivity) tracks.push("minmax(8rem,.75fr)");
    if (columns.owner) tracks.push("minmax(8rem,.75fr)");
    tracks.push("minmax(8rem,.8fr)");
    if (columns.updated) tracks.push("6.75rem");
    return tracks.join(" ");
  });

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
<div role="region" aria-label="Projects list" class="relative min-h-0 flex-1 overflow-auto">
  <div
    role="row"
    aria-label="Project columns"
    style={`--projects-table-columns: ${desktopGrid};`}
    class="sticky top-0 z-10 hidden h-10 min-w-[58rem] grid-cols-[var(--projects-table-columns)] items-center gap-x-3 border-b border-workspace-rail-line bg-workspace-rail px-3 text-[0.6875rem] font-medium text-ink-muted lg:grid"
  >
    <span role="columnheader">Project</span>
    {#if columns.clientName}<span role="columnheader">Client</span>{/if}
    {#if columns.stage}<span role="columnheader">Stage</span>{/if}
    {#if columns.generationActivity}<span role="columnheader">AI activity</span>{/if}
    {#if columns.owner}<span role="columnheader">Owner</span>{/if}
    <span role="columnheader">With</span>
    {#if columns.updated}<span role="columnheader">Updated</span>{/if}
  </div>
  <ul aria-label="Projects" class="w-full lg:min-w-[58rem]">
    {#each rows as row (row.id)}
      <li class="border-b border-workspace-rail-line last:border-b-0">
        <div
          style={`--projects-table-columns: ${desktopGrid};`}
          class={`group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 ${rowHeight} ${rowPadding} transition-colors hover:bg-workspace-rail-hover focus-within:bg-workspace-rail-hover motion-reduce:transition-none lg:grid-cols-[var(--projects-table-columns)]`}
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <span class={`h-2 w-2 shrink-0 rounded-full ${stageDotClass(row)}`} aria-hidden="true"></span>
            <div class="min-w-0">
              <!-- Hover preview (2026-08-13, Attio-research P2): a quiet card
                   of fields ALREADY in this row's projection — no queries.
                   LinkPreview opens on hover after 300ms and on keyboard
                   focus; motion is the sanctioned pop with reduced-motion
                   fade. -->
              <LinkPreview.Root openDelay={300}>
              <LinkPreview.Trigger
                href={resolve("/project/[id]", { id: row.id })}
                data-recent-title={row.title}
                data-recent-stage={row.workflowStage ?? undefined}
                data-recent-client={row.clientName || undefined}
                onclick={stashPagingContext}
                class={`flex ${anchorHeight} min-w-0 flex-col justify-center rounded-md text-sm font-medium text-ink transition-colors hover:text-primary-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none`}
              >
                <span class="truncate">{row.title}</span>
                {#if columns.clientName}
                  <span class="truncate text-xs font-normal text-ink-muted md:hidden">{row.clientName || "No client name"}</span>
                {/if}
              </LinkPreview.Trigger>
              <LinkPreview.Content forceMount side="bottom" align="start" sideOffset={6}>
                {#snippet child({ props, wrapperProps, open: previewOpen })}
                  <div {...wrapperProps}>
                    {#if previewOpen}
                      <div
                        {...props}
                        in:popIn
                        out:popOut
                        class="z-[100] w-72 rounded-xl border border-line bg-surface p-3.5 shadow-md outline-none"
                      >
                        <div class="flex min-w-0 items-start justify-between gap-2">
                          <p class="min-w-0 text-sm font-medium leading-5 text-ink">{row.title}</p>
                          {#if row.projectNumber}
                            <span class="text-data shrink-0 rounded bg-chrome px-1 py-px text-ink-muted">#{row.projectNumber}</span>
                          {/if}
                        </div>
                        <p class="mt-0.5 truncate text-xs text-ink-muted">{row.clientName || "No client name"}</p>
                        <div class="mt-2.5 flex flex-wrap items-center gap-2">
                          {#if row.workflowStage}
                            <StageBadge stage={row.workflowStage} />
                          {:else}
                            <span class="inline-flex items-center gap-1.5">
                              <Badge status={row.legacyStatus} dot />
                              <span class="text-[11px] text-ink-faint">Legacy status</span>
                            </span>
                          {/if}
                        </div>
                        <dl class="mt-2.5 space-y-1 text-xs">
                          <div class="flex items-baseline gap-2">
                            <dt class="w-14 shrink-0 text-ink-faint">Owner</dt>
                            <dd class="min-w-0 truncate text-ink-secondary">{ownerLabel(row)}</dd>
                          </div>
                          {#if row.handoff}
                            <div class="flex items-baseline gap-2">
                              <dt class="w-14 shrink-0 text-ink-faint">With</dt>
                              <dd class="min-w-0 truncate text-ink-secondary">
                                {row.handoff.assigneeLabel} · {row.handoff.kindLabel}{row.handoff.dueDate ? `, due ${row.handoff.dueDate}` : ""}
                              </dd>
                            </div>
                          {/if}
                          <div class="flex items-baseline gap-2">
                            <dt class="w-14 shrink-0 text-ink-faint">Updated</dt>
                            <dd class="text-data min-w-0 text-ink-secondary">{row.updatedDate}</dd>
                          </div>
                        </dl>
                      </div>
                    {/if}
                  </div>
                {/snippet}
              </LinkPreview.Content>
              </LinkPreview.Root>
            </div>
          </div>

          <div class="flex min-w-0 items-center justify-end gap-3 lg:contents">
            {#if columns.clientName}
              <span class="hidden min-w-0 truncate text-xs text-ink-muted lg:block">{row.clientName || "No client name"}</span>
            {/if}
            {#if columns.stage}
              <span class="hidden min-w-0 lg:inline-flex">{@render stageValue(row)}</span>
            {/if}
            {#if columns.generationActivity}
              <span class="hidden min-w-0 lg:inline-flex">{@render activityValue(row)}</span>
            {/if}
            {#if columns.owner}
              <span class="hidden min-w-0 lg:inline-flex">{@render ownerValue(row)}</span>
            {/if}
            <span class="hidden min-w-0 truncate text-xs text-ink-muted lg:block">
              {row.handoff ? row.handoff.assigneeLabel : "—"}
            </span>
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
              {#if row.handoff}<span class="text-xs text-ink-muted">With {row.handoff.assigneeLabel}</span>{/if}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</div>
