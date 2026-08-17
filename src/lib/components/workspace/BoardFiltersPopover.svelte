<!--
  Board "Filters" control (2026-08-10, Obvious filter anatomy): a ghost chip
  with an active-count badge opening a bits-ui Popover — search field on top,
  a small "Filter by" label, then the filterable FIELDS. Choosing a field
  hands off to the parent (onFieldPick), which renders the filter-condition
  chip with a "Select…" placeholder — the value list is NOT auto-opened;
  clicking the chip's value segment opens this popover in VALUES mode
  anchored to that segment (bits customAnchor). Stage values render with
  their status colors (StageBadge). Fields stay honest to the indexed server
  args the repository queries already accept: Stage and Owner.

  Motion (2026-08-10, owner direction): shadcn-style pop — fade + zoom from
  95% + slight slide, origin at the corner nearest the anchor (panelMotion.ts
  popIn/popOut). Box-shadow (shadow-md) scales with the panel so it appears
  immediately. Reduced motion falls back to a fade.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { WORKFLOW_STAGES, type WorkflowStage } from "../../../../shared/workflowStages";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { popIn, popOut } from "$lib/motion/panelMotion";
  import { PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectType } from "../../../../shared/projectTypes";

  let {
    stage,
    onStageChange,
    ownerId,
    onOwnerChange,
    currentAssigneeId,
    onCurrentAssigneeChange,
    projectType,
    onProjectTypeChange,
    stageItems,
    onFieldPick,
    open = $bindable(false),
  }: {
    stage: string;
    onStageChange: (value: string) => void;
    ownerId: string | null;
    onOwnerChange: (value: string, label: string) => void;
    currentAssigneeId: string | null;
    onCurrentAssigneeChange: (value: string, label: string) => void;
    projectType: ProjectType | null;
    onProjectTypeChange: (value: ProjectType, label: string) => void;
    stageItems: readonly { value: string; label: string }[];
    /** Field chosen from the list — parent renders the pending condition
     *  chip; its value segment opens this popover anchored to it. */
    onFieldPick: (field: FieldId) => void;
    open?: boolean;
  } = $props();

  const auth = useAuth();
  // Team roster only while the popover is open — no standing subscription.
  const teamQ = useQuery(api.users.listTeam, () =>
    auth.isAuthenticated && open ? {} : "skip"
  );

  const activeCount = $derived(
    (stage !== "all" ? 1 : 0) +
      (ownerId ? 1 : 0) +
      (currentAssigneeId ? 1 : 0) +
      (projectType ? 1 : 0)
  );

  type FieldId = "stage" | "owner" | "current_assignee" | "project_type";
  const FIELDS: { id: FieldId; label: string }[] = [
    { id: "stage", label: "Stage" },
    { id: "owner", label: "Owner" },
    { id: "current_assignee", label: "Current assignee" },
    { id: "project_type", label: "Project type" },
  ];

  let activeField = $state<FieldId | null>(null);
  let query = $state("");
  let searchEl: HTMLInputElement | null = $state(null);
  let anchorEl = $state<HTMLElement | null>(null);
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const visibleFields = $derived(
    FIELDS.filter((field) => field.label.toLowerCase().includes(query.trim().toLowerCase()))
  );
  const stageValues = $derived(
    stageItems
      .filter((item) => item.value !== "all")
      .filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
  );
  const ownerValues = $derived(
    (teamQ.data ?? [])
      .map((member) => ({ value: member.id as string, label: member.name }))
      .filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
  );
  const projectTypeValues = $derived(
    PROJECT_TYPES.map((value) => ({ value, label: PROJECT_TYPE_LABELS[value] })).filter(
      (item) => item.label.toLowerCase().includes(query.trim().toLowerCase())
    )
  );
  const visibleValues = $derived.by(() => {
    if (activeField === "stage") return stageValues;
    if (activeField === "project_type") return projectTypeValues;
    return ownerValues;
  });
  const activeFieldLabel = $derived(
    FIELDS.find((field) => field.id === activeField)?.label ?? null
  );

  function stageOf(value: string): WorkflowStage | null {
    return (WORKFLOW_STAGES as readonly string[]).includes(value)
      ? (value as WorkflowStage)
      : null;
  }
  const countOf = (label: string) => label.match(/\((\d+\+?)\)\s*$/)?.[1] ?? null;
  const plainLabel = (label: string) => label.replace(/ \(\d+\+?\)$/, "");

  // Reset after the close morph finishes — resetting immediately would flash
  // the fields list inside the closing panel.
  function scheduleReset() {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      activeField = null;
      query = "";
      anchorEl = null;
      resetTimer = null;
    }, 240);
  }

  /** Open the FIELDS list, anchored to a given element (the + button)
   *  when provided (falls back to the Filters trigger). */
  export function openFields(anchor: HTMLElement | null = null) {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = null;
    activeField = null;
    query = "";
    anchorEl = anchor;
    open = true;
  }

  /** Open straight at a field's values, anchored to the condition chip's
   *  value segment when provided (falls back to the Filters trigger). */
  export function openTo(field: FieldId, anchor: HTMLElement | null = null) {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = null;
    activeField = field;
    query = "";
    anchorEl = anchor;
    open = true;
  }

  function pickField(id: FieldId) {
    // Close; the parent renders the pending chip (no auto-open of values).
    open = false;
    onFieldPick(id);
  }

  function pickValue(value: string, label: string) {
    if (activeField === "stage") onStageChange(value);
    else if (activeField === "owner") onOwnerChange(value, label);
    else if (activeField === "current_assignee") onCurrentAssigneeChange(value, label);
    else if (activeField === "project_type" && PROJECT_TYPES.includes(value as ProjectType)) {
      onProjectTypeChange(value as ProjectType, label);
    }
    open = false;
    scheduleReset();
  }
</script>

<Popover.Root bind:open onOpenChange={(next) => { if (!next) scheduleReset(); }}>
  <Popover.Trigger
    data-board-filters-trigger
    aria-label={activeCount ? `Filters — ${activeCount} active` : "Filters"}
    class="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-ink-secondary transition-colors select-none hover:bg-chrome/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:h-7"
  >
    <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" d="M1.833 3.167h12.334M5.833 12.833h4.334M3.833 8h8.334" /></svg>
    Filters
    {#if activeCount}
      <span data-board-filters-count class="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-selected px-1 text-[10px] font-medium leading-none text-white">{activeCount}</span>
    {/if}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content forceMount side="bottom" align="start" sideOffset={6} customAnchor={anchorEl}>
      {#snippet child({ props, wrapperProps, open: contentOpen })}
        <div {...wrapperProps}>
          {#if contentOpen}
            <div
              {...props}
              in:popIn
              out:popOut
              class="z-[100] w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-md outline-none"
            >
              <div class="mb-1.5 border-b border-line-soft p-1">
                <input
                  bind:this={searchEl}
                  bind:value={query}
                  aria-label={activeField ? "Search values" : "Search filters"}
                  placeholder="Search..."
                  class="input-chromeless block h-7 w-full border-0 bg-transparent px-2 py-0 text-[13px] text-ink outline-none placeholder:text-[13px] placeholder:text-ink-faint"
                />
              </div>
              <p class="px-3 pb-0.5 pt-1 text-[11px] font-medium text-ink-faint">
                {activeField ? `Filter by ${activeFieldLabel}` : "Filter by"}
              </p>
              <div class="max-h-64 overflow-y-auto px-1.5 pb-1.5" role="listbox" aria-label={activeField ? `${activeField} values` : "Filter fields"}>
                {#if activeField === null}
                  {#each visibleFields as field (field.id)}
                    {@const active =
                      (field.id === "stage" && stage !== "all") ||
                      (field.id === "owner" && Boolean(ownerId)) ||
                      (field.id === "current_assignee" && Boolean(currentAssigneeId)) ||
                      (field.id === "project_type" && Boolean(projectType))}
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-filter-field={field.id}
                      class={`w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors motion-reduce:transition-none pointer-coarse:min-h-11 ${active ? "bg-chrome text-ink" : "text-ink-secondary hover:bg-chrome/60 hover:text-ink"}`}
                      onclick={() => pickField(field.id)}
                    >
                      <span class="font-medium">{field.label}</span>
                    </button>
                  {:else}
                    <p class="px-2.5 py-1.5 text-xs text-ink-muted">No matching filters.</p>
                  {/each}
                {:else}
                  {#each visibleValues as item (item.value)}
                    {@const active = activeField === "stage"
                      ? item.value === stage
                      : activeField === "owner"
                        ? item.value === ownerId
                        : activeField === "current_assignee"
                          ? item.value === currentAssigneeId
                          : item.value === projectType}
                    {@const badgeStage = activeField === "stage" ? stageOf(item.value) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-filter-value={item.value}
                      class={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors motion-reduce:transition-none pointer-coarse:min-h-11 ${active ? "bg-chrome text-ink" : "text-ink-secondary hover:bg-chrome/60 hover:text-ink"}`}
                      onclick={() => pickValue(item.value, plainLabel(item.label))}
                    >
                      {#if badgeStage}
                        <StageBadge stage={badgeStage} shape="square" />
                      {:else}
                        <span class="truncate">{plainLabel(item.label)}</span>
                      {/if}
                      {#if activeField === "stage" && countOf(item.label)}
                        <span class="shrink-0 text-[11px] text-ink-faint">{countOf(item.label)}</span>
                      {/if}
                    </button>
                  {:else}
                    <p class="px-2.5 py-1.5 text-xs text-ink-muted">
                      {(activeField === "owner" || activeField === "current_assignee") && teamQ.data === undefined ? "Loading team…" : "No matching values."}
                    </p>
                  {/each}
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/snippet}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
