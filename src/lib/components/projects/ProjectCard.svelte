<!--
  A project card on the Projects page (Paper Z11a, picked 2026-10-19): a
  stage band on top (dot, stage, project number, the "..." menu), the
  company above the title when the card is outside its company, the title,
  labelled Owner, Created and Updated rows, and a footer line only when
  something is happening (AI work, or who has the next blocking step). White
  with a line border; hover and selected take a 1px border in the stage's
  dot color.

  Selection (Paper Z7n): the checkbox sits over the stage dot, so nothing
  moves. It shows on hover, on keyboard focus and on touch screens. Once
  anything on the page is ticked (`selectionActive`), every card shows it
  and a click anywhere on the card toggles it.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { resolve } from "$app/paths";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import { WORKFLOW_STAGE_TONES, isPausedStage, type StageTone } from "$lib/workflow/stagePresentation";
  import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";
  import { cardStatusLine, longDate } from "$lib/projects/projectCard";

  let {
    row,
    createdAt = undefined,
    updatedAt,
    showCompany = false,
    showFiscalYear = false,
    actions = undefined,
    selectable = false,
    selected = false,
    selectionActive = false,
    onToggleSelect = undefined,
  }: {
    row: ProjectsTableRow;
    /** Created and updated stamps, shown as full dates. */
    createdAt?: number;
    updatedAt: number;
    /** The company line above the title, for cards outside their company. */
    showCompany?: boolean;
    /** A Year row, for cards outside their fiscal year section (search, recent). */
    showFiscalYear?: boolean;
    /** The "..." menu in the stage band. */
    actions?: Snippet;
    selectable?: boolean;
    selected?: boolean;
    selectionActive?: boolean;
    onToggleSelect?: () => void;
  } = $props();

  // One color per stage tone: the band, its dot and label, and the 1px
  // hover and selected border in the dot color.
  const TONES: Record<StageTone, { band: string; dot: string; label: string; border: string; hover: string }> = {
    neutral: { band: "bg-gray-50", dot: "bg-gray-400", label: "text-ink-secondary", border: "border-gray-400", hover: "hover:border-gray-400 focus-within:border-gray-400" },
    active: { band: "bg-blue-50", dot: "bg-blue-500", label: "text-blue-700", border: "border-blue-500", hover: "hover:border-blue-500 focus-within:border-blue-500" },
    review: { band: "bg-amber-50", dot: "bg-amber-500", label: "text-amber-700", border: "border-amber-500", hover: "hover:border-amber-500 focus-within:border-amber-500" },
    client: { band: "bg-purple-50", dot: "bg-purple-500", label: "text-purple-700", border: "border-purple-500", hover: "hover:border-purple-500 focus-within:border-purple-500" },
    delivery: { band: "bg-green-50", dot: "bg-green-500", label: "text-green-700", border: "border-green-500", hover: "hover:border-green-500 focus-within:border-green-500" },
    held: { band: "bg-violet-50", dot: "bg-violet-500", label: "text-violet-700", border: "border-violet-500", hover: "hover:border-violet-500 focus-within:border-violet-500" },
    paused: { band: "bg-gray-50", dot: "bg-gray-400", label: "text-ink-secondary", border: "border-gray-400", hover: "hover:border-gray-400 focus-within:border-gray-400" },
  };

  const tone = $derived(TONES[row.workflowStage ? WORKFLOW_STAGE_TONES[row.workflowStage] : "neutral"]);
  const paused = $derived(row.workflowStage ? isPausedStage(row.workflowStage) : false);
  const stageLabel = $derived(row.workflowStage ? WORKFLOW_STAGE_LABELS[row.workflowStage] : `Legacy: ${row.legacyStatus}`);
  const status = $derived(cardStatusLine(row));
  const ownerLabel = $derived.by(() => {
    if (row.owner.kind === "canonical" || row.owner.kind === "legacy_writer") return row.owner.label;
    return row.owner.kind === "canonical_unresolved" ? "Owner unavailable" : "None recorded";
  });
  const showBox = $derived(selectable && (selectionActive || selected));
</script>

{#snippet checkmark()}
  <span
    class={`flex size-3.5 items-center justify-center rounded-[0.1875rem] border ${selected ? "border-primary-selected bg-primary-selected text-white" : "border-gray-300 bg-surface"}`}
  >
    {#if selected}
      <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
    {/if}
  </span>
{/snippet}

{#snippet field(label: string, value: string, attr: string)}
  <div class="flex min-w-0 gap-2" data-card-field={attr}>
    <span class="w-[3.125rem] shrink-0 text-[0.6875rem] leading-[calc(16/11)] text-ink-muted">{label}</span>
    <span class="min-w-0 flex-1 truncate text-xs leading-[calc(4/3)] text-ink">{value}</span>
  </div>
{/snippet}

<article
  data-project-board-card
  data-project-card={row.id}
  data-selected={selectable ? String(selected) : undefined}
  class={`group/project relative flex h-full min-w-0 flex-col overflow-hidden rounded-[0.625rem] border bg-surface transition-colors motion-reduce:transition-none ${paused ? "border-dashed" : ""} ${selectable && selected ? tone.border : `border-line ${tone.hover}`}`}
>
  <div data-card-band class={`flex h-[2.125rem] shrink-0 items-center gap-[0.4375rem] pl-3.5 pr-1.5 ${tone.band}`}>
    <!-- The stage dot, with the checkbox laid over it (Paper Z7n). -->
    <span class="relative flex size-[0.4375rem] shrink-0 items-center justify-center">
      <span
        aria-hidden="true"
        data-card-dot
        class={`size-[0.4375rem] rounded-full transition-opacity motion-reduce:transition-none ${tone.dot} ${showBox ? "opacity-0" : selectable ? "group-hover/project:opacity-0 pointer-coarse:opacity-0" : ""}`}
      ></span>
      {#if selectable && selectionActive}
        <span data-card-checkbox aria-hidden="true" class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">{@render checkmark()}</span>
      {:else if selectable}
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${row.title}`}
          data-card-checkbox
          data-card-select-box={row.id}
          onclick={() => onToggleSelect?.()}
          class="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-[0.1875rem] opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy group-hover/project:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 before:absolute before:-inset-1.5 before:content-[''] pointer-coarse:before:-inset-4"
        >{@render checkmark()}</button>
      {/if}
    </span>
    <span class={`min-w-0 truncate text-[0.8125rem] leading-[calc(16/13)] font-medium ${tone.label}`} data-card-stage>{stageLabel}</span>
    <span class="flex-1"></span>
    {#if row.projectNumber}
      <span data-card-project-number class="shrink-0 font-mono text-xs leading-[calc(4/3)] text-ink-muted"><span class="sr-only">Project number </span>#{row.projectNumber}</span>
    {/if}
    {#if actions && !selectionActive}
      {@render actions()}
    {:else}
      <span class="size-6 shrink-0" aria-hidden="true"></span>
    {/if}
  </div>

  <div class="px-3.5 py-3">
    {#if showCompany}
      <p data-card-field="client" class="truncate pb-0.5 text-xs leading-[calc(4/3)] text-ink-secondary">{row.clientName || "No company name"}</p>
    {/if}
    {#if selectable && selectionActive}
      <!-- Something is ticked: the stretched title is a checkbox for the whole card. -->
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        data-card-select={row.id}
        onclick={() => onToggleSelect?.()}
        class="block w-full rounded-md text-left text-sm leading-[calc(9/7)] font-medium text-ink line-clamp-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >{row.title}</button>
    {:else}
      <a
        href={resolve("/project/[id]", { id: row.id })}
        data-recent-title={row.title}
        data-recent-stage={row.workflowStage ?? undefined}
        data-recent-client={row.clientName || undefined}
        class="block rounded-md text-sm leading-[calc(9/7)] font-medium text-ink line-clamp-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
      >{row.title}</a>
    {/if}
  </div>

  <div class="flex flex-1 flex-col gap-0.5 border-t border-line-soft px-3.5 py-2.5">
    {@render field("Owner", ownerLabel, "owner")}
    {#if showFiscalYear}{@render field("Year", row.fiscalYear ? `FY ${row.fiscalYear}` : "Not set", "fiscal-year")}{/if}
    {#if createdAt !== undefined}{@render field("Created", longDate(createdAt), "created")}{/if}
    {@render field("Updated", longDate(updatedAt), "updated")}
  </div>

  {#if status}
    <div data-card-status class="flex min-w-0 items-center gap-2 border-t border-line-soft bg-canvas px-3.5 py-2.5">
      {#if status.ai}
        <AuroraMark size={12} />
      {:else}
        <span aria-hidden="true" class="size-[0.4375rem] shrink-0 rounded-full bg-gray-300"></span>
      {/if}
      <span class="min-w-0 flex-1 truncate text-[0.8125rem] leading-[calc(18/13)] text-ink" data-generation-activity={row.generationActivity ?? undefined}>{status.text}</span>
    </div>
  {/if}
</article>
