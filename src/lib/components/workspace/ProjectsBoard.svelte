<script lang="ts">
  // Workflow-stage kanban on the light workspace plane (2026-08-06
  // redesign). Columns are the canonical WORKFLOW_STAGE_PIPELINE_ORDER plus
  // the explicitly qualified Legacy status column (product-domain amendment
  // 2026-08-05) — never a generic project grid. Geometry keeps the recorded
  // Obvious ARTIFACT-board anatomy: a hidden-scrollbar horizontal scroll
  // plane (px-2 pb-4, snap-x) over a w-max flex track (8px gaps, pr-4);
  // quiet borderless full-height SAME-TONE columns (column fill = canvas
  // token — white on the light plane, Notion co-evidence) at the governed
  // fixed 320px from `md` up; below `md` the visible stage takes the full
  // board usable width (100cqw) so adjacent card bodies are masked and the
  // right-edge fade cue carries the horizontal continuation (2026-08-07
  // correction — the earlier next-lane card-body peek read as broken
  // clipping in live QA);
  // compact px-2 py-2 badge+count headers; independently scrolling column
  // bodies (p-2 pt-0, 12px card spacing, hidden scrollbar). Task cards are
  // single white surfaces (ProjectBoardCard): the canonical stage tone
  // appears only in the labelled header badge/dot — text labels always
  // accompany color; paused stages stay muted and dashed. Obvious's column
  // and card drag/rename remain deliberately excluded: cards are not
  // draggable and a visual move never changes stage or ownership. Its quiet
  // `+ Add new` footer is translated into navigation to Banhall's existing
  // wizard on every stage; creation still enters canonical Intake.
  //
  // The whole card is the navigation target: the title anchor carries a
  // stretched ::after over the `relative` article (44px+ touch target,
  // product-domain.md) while the visible link stays the title row. Any
  // future nested interactive element inside a card MUST be `relative z-10`
  // to sit above the stretched link layer.
  //
  // 2026-08-06 second amendment updates:
  // - Same-tone columns: the column fill equals the canvas token (no
  //   bg-white tint, structural rounded-xl retained) — live Obvious
  //   measurement: column fill exactly equals the artifact canvas.
  // - Empty columns render the header plus a quiet `+ Add new` navigation
  //   footer. The bounded-scan truth lives in the header (`0`, `N+`, "none
  //   loaded yet"); no empty-state body box.
  // - Every creation footer opens the existing wizard. It does not preselect
  //   or mutate the displayed stage; new projects still begin in Intake.
  // - Optional hide-empty: collapses stages whose provided `stageCounts`
  //   value is 0 AND no row is loaded — never loaded-rows-zero alone. Hidden
  //   stages stay disclosed by a focusable "N empty stages hidden — Show"
  //   caption at the track end.
  import { resolve } from "$app/paths";
  import ProjectBoardCard from "$lib/components/workspace/ProjectBoardCard.svelte";
  import BoardColumnHeader from "$lib/components/workspace/BoardColumnHeader.svelte";
  import { isPausedStage } from "$lib/workflow/stagePresentation";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import {
    WORKFLOW_STAGE_PIPELINE_ORDER,
    type WorkflowStage,
  } from "../../../../shared/workflowStages";
  import type { ProjectsTableRow } from "./ProjectsTable.svelte";

  let {
    rows,
    stageCounts,
    countsApproximate = false,
    hideEmpty = false,
    hiddenQualifier = null,
    onShowEmpty,
    newProjectClientName = null,
    showCardClient = true,
    onlyStage = null,
    regionLabel = "Projects board. Scroll horizontally to review every workflow stage.",
  }: {
    rows: ProjectsTableRow[];
    stageCounts?: Record<string, number>;
    countsApproximate?: boolean;
    /**
     * Collapse zero-count stages. Honest criterion only: a stage hides when
     * `stageCounts` (bounded facets globally; exact per-client counts on a
     * focused board) reports 0 AND no row is loaded. Without stageCounts the
     * option is inert — nothing hides (fail honest).
     */
    hideEmpty?: boolean;
    /** Bound qualifier for the disclosure label (e.g. facet truncation). */
    hiddenQualifier?: string | null;
    /** Reveals hidden stages (turns the display option off). */
    onShowEmpty?: () => void;
    /** Recorded client name prefill carried by the intake creation footer. */
    newProjectClientName?: string | null;
    /**
     * Card client line toggle: the focused client board passes false because
     * its own header already names the client (ProjectBoardCard.showClient).
     */
    showCardClient?: boolean;
    /**
     * Active stage filter (Obvious filter anatomy, 2026-08-10): renders ONLY
     * the matching column instead of nine provably-empty neighbours. The
     * chip row above the board names the filter, so the missing columns are
     * explained, not silent.
     */
    onlyStage?: WorkflowStage | "legacy" | null;
    regionLabel?: string;
  } = $props();

  const newProjectHref = $derived(
    newProjectClientName
      ? `${resolve("/project/new")}?client=${encodeURIComponent(newProjectClientName)}`
      : resolve("/project/new")
  );

  // Every canonical stage renders in pipeline order by default — zero-count
  // columns included, full width. The persisted hide-empty display option
  // may collapse provably-empty stages (count source 0 and nothing loaded).
  // Only the Legacy compatibility column is conditional either way: an
  // always-empty artifact column would advertise legacy state forever.
  const allColumns = $derived.by(() => {
    const grouped = new Map<WorkflowStage | "legacy", ProjectsTableRow[]>();
    for (const stage of WORKFLOW_STAGE_PIPELINE_ORDER) grouped.set(stage, []);
    grouped.set("legacy", []);
    for (const row of rows) grouped.get(row.workflowStage ?? "legacy")?.push(row);
    const legacyRows = grouped.get("legacy") ?? [];
    const legacyCount = Math.max(stageCounts?.legacy ?? 0, legacyRows.length);
    return [
      ...WORKFLOW_STAGE_PIPELINE_ORDER.map((id) => ({
        id,
        label: WORKFLOW_STAGE_LABELS[id],
        rows: grouped.get(id) ?? [],
        count: Math.max(stageCounts?.[id] ?? 0, grouped.get(id)?.length ?? 0),
      })),
      ...(legacyRows.length > 0 || legacyCount > 0
        ? [{ id: "legacy" as const, label: "Legacy status", rows: legacyRows, count: legacyCount }]
        : []),
    ];
  });
  const columns = $derived(
    onlyStage
      ? allColumns.filter((column) => column.id === onlyStage)
      : hideEmpty && stageCounts !== undefined
        ? allColumns.filter(
            (column) => column.id === "legacy" || column.count > 0 || column.rows.length > 0
          )
        : allColumns
  );
  // The filter's single-column view is named by the chip row, not the
  // hidden-stages disclosure.
  const hiddenStageCount = $derived(onlyStage ? 0 : allColumns.length - columns.length);
</script>

<!-- Shell wraps the scroll region so the right-edge continuation cue can sit
     over the scrollport (an overlay inside the scroller would scroll away).
     `timeline-scope` lets the cue read the region's named scroll timeline. -->
<div class="board-shell relative flex min-h-0 min-w-0 flex-1 flex-col">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    role="region"
    aria-label={regionLabel}
    tabindex="0"
    class="board-scroller scrollbar-hidden @container min-h-0 flex-1 snap-x snap-proximity overflow-x-auto overflow-y-hidden scroll-pl-2 bg-canvas px-2 pb-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy"
  >
  <div class="flex h-full w-max items-stretch gap-2 pr-4">
    {#each columns as column (column.id)}
      {@const paused = column.id !== "legacy" && isPausedStage(column.id)}
      <!-- Same-tone full-height column container: fill equals the canvas
           token (no tint, no well, no shadow); structural radius retained.
           Below `md` the visible stage takes the full board usable width
           (100cqw = the scrollport content box) so adjacent card BODIES are
           masked instead of rendering as clipped shards down the right edge
           (live QA 2026-08-07); continuation is signalled by the deliberate
           edge cue below, and on the focused board by the explicit
           "Stage N of M" selector. From `md` up columns stay the governed
           fixed 320px. -->
      <section
        data-board-column={column.id}
        class={`flex h-full w-[100cqw] shrink-0 snap-start flex-col overflow-hidden rounded-xl border-none bg-canvas shadow-none md:w-[320px] ${paused ? "opacity-90" : ""}`}
        aria-labelledby={`project-board-${column.id}`}
      >
        <BoardColumnHeader
          id={`project-board-${column.id}`}
          label={column.label}
          stage={column.id === "legacy" ? null : column.id}
          count={column.count}
          countSuffix={countsApproximate && column.count > 0 ? "+" : ""}
          noneLoaded={column.count > 0 && column.rows.length === 0}
          unverified={countsApproximate}
        />

        <!-- Column body owns its own hidden vertical scroll. Empty columns
             render nothing here — the header carries the bounded-scan truth
             and only intake closes with the creation footer. -->
        <div class="scrollbar-hidden min-h-0 flex-1 space-y-3 overflow-y-auto p-2 pt-0">
          {#if column.rows.length > 0}
            {#each column.rows as row (row.id)}
              <ProjectBoardCard {row} showClient={showCardClient} />
            {/each}
          {/if}
          <!-- Obvious-parity footer on every column. This is navigation, not
               an in-column mutation: the wizard retains Banhall's canonical
               rule that new projects begin in Intake. -->
          <a
            data-add-new-project={column.id}
            data-intake-new-project={column.id === "intake" ? "" : undefined}
            href={newProjectHref}
            aria-label={`Add new project${newProjectClientName ? ` for ${newProjectClientName}` : ""}. New projects begin in Intake.`}
            class="flex min-h-11 items-center gap-1.5 px-2 text-xs font-normal text-ink-muted opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
          >
            <span aria-hidden="true" class="text-sm leading-none">+</span>
            Add new
          </a>
        </div>
      </section>
    {/each}
  </div>
  </div>
  <!-- Deliberate right-edge continuation cue (live QA 2026-08-07): a subtle
       canvas fade says "more stages this way" instead of clipped card
       fragments. Decorative only (aria-hidden, pointer-events-none) — the
       region's accessible label already states the horizontal-scroll truth.
       Where scroll-driven animations are supported the cue fades out as the
       board reaches its end (and never shows on a board with no horizontal
       overflow — an inactive scroll timeline leaves the base opacity 0); the
       no-support fallback keeps a static fade rather than clipped shards. -->
  <div data-board-edge-cue aria-hidden="true" class="board-edge-cue pointer-events-none absolute inset-y-0 right-0 w-10"></div>
</div>

<style>
  .board-shell {
    timeline-scope: --projects-board-x;
  }
  .board-scroller {
    scroll-timeline: --projects-board-x x;
  }
  .board-edge-cue {
    background: linear-gradient(to left, var(--color-canvas) 0%, transparent 100%);
    opacity: 0;
  }
  @supports not (animation-timeline: scroll()) {
    .board-edge-cue {
      opacity: 1;
    }
  }
  @supports (animation-timeline: scroll()) {
    .board-edge-cue {
      animation: board-edge-cue-fade linear both;
      animation-timeline: --projects-board-x;
    }
    @keyframes board-edge-cue-fade {
      0%,
      85% {
        opacity: 1;
      }
      100% {
        opacity: 0;
      }
    }
  }
</style>
