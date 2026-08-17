<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { SlidersHorizontalIcon } from "phosphor-svelte";
  import { popIn, popOut } from "$lib/motion/panelMotion";
  import type {
    ProjectColumnId,
    ProjectsTablePreferences,
  } from "$lib/dashboard/projectsTablePreferences";

  let {
    preferences,
    sortBy,
    sortOptions,
    columnOptions,
    showSort,
    showBoardOptions,
    showClientOptions,
    clientCountsAvailable,
    boardCountsLimited,
    onSortChange,
    onToggleColumn,
    onDensityChange,
    onHideEmptyBoardChange,
    onHideEmptyClientGroupsChange,
  }: {
    preferences: ProjectsTablePreferences;
    sortBy: string;
    sortOptions: readonly { value: string; label: string }[];
    columnOptions: readonly { id: ProjectColumnId; label: string }[];
    showSort: boolean;
    showBoardOptions: boolean;
    showClientOptions: boolean;
    clientCountsAvailable: boolean;
    boardCountsLimited: boolean;
    onSortChange: (value: string) => void;
    onToggleColumn: (id: ProjectColumnId) => void;
    onDensityChange: (value: ProjectsTablePreferences["density"]) => void;
    onHideEmptyBoardChange: (value: boolean) => void;
    onHideEmptyClientGroupsChange: (value: boolean) => void;
  } = $props();

  const selectedSortLabel = $derived(
    sortOptions.find((option) => option.value === sortBy)?.label ?? "Recently edited"
  );
  const visibleColumnCount = $derived(
    columnOptions.filter((option) => preferences.columns[option.id]).length
  );
  const displaySummary = $derived.by(() => {
    if (showBoardOptions && preferences.hideEmptyBoard) return "Empty stages hidden";
    if (showClientOptions && clientCountsAvailable && preferences.hideEmptyClientGroups) {
      return "Empty stages hidden";
    }
    if (preferences.layout === "list" && visibleColumnCount !== columnOptions.length) {
      return `${visibleColumnCount} fields`;
    }
    if (preferences.layout === "list" && preferences.density === "compact") return "Compact";
    if (showSort) return selectedSortLabel;
    return null;
  });
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    aria-label={displaySummary ? `Project display options: ${displaySummary}` : "Project display options"}
    data-projects-display-trigger
    class="inline-flex h-11 min-w-0 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-chrome/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:h-7"
  >
    <SlidersHorizontalIcon size={16} weight="regular" aria-hidden="true" class="shrink-0" />
    <span class="truncate">Display</span>
  </DropdownMenu.Trigger>

  <DropdownMenu.Portal>
    <!-- Pop motion (2026-08-10): shadcn-style fade + zoom from the corner
         nearest the trigger (panelMotion.ts); box-shadow scales with the
         panel so it appears immediately. -->
    <DropdownMenu.Content forceMount side="bottom" align="end" sideOffset={6}>
      {#snippet child({ props, wrapperProps, open })}
        <div {...wrapperProps}>
          {#if open}
            <div
              {...props}
              in:popIn
              out:popOut
              class="z-[100] w-64 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-md"
            >
              {@render menuBody()}
            </div>
          {/if}
        </div>
      {/snippet}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

{#snippet menuBody()}
      {#if showSort}
        <p class="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-muted">Order</p>
        <DropdownMenu.RadioGroup
          value={sortBy}
          onValueChange={(value) =>
            onSortChange(
              sortOptions.some((option) => option.value === value) ? value : sortOptions[0]?.value ?? "updated"
            )}
        >
          {#each sortOptions as option (option.value)}
            <DropdownMenu.RadioItem
              value={option.value}
              class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-ink-secondary outline-none transition-colors data-highlighted:bg-primary-wash data-highlighted:text-ink motion-reduce:transition-none"
            >
              <span class="flex h-4 w-4 items-center justify-center rounded-full border border-line" aria-hidden="true">
                {#if sortBy === option.value}<span class="h-2 w-2 rounded-full bg-primary"></span>{/if}
              </span>
              {option.label}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      {/if}

      {#if showBoardOptions || showClientOptions}
        {#if showSort}<DropdownMenu.Separator class="my-1 h-px bg-line-soft" />{/if}
        <p class="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-muted">Board</p>
        {#if showBoardOptions}
          <DropdownMenu.CheckboxItem
            checked={preferences.hideEmptyBoard}
            closeOnSelect={false}
            onCheckedChange={(checked) => onHideEmptyBoardChange(checked)}
            data-hide-empty-switch="board"
            aria-describedby={boardCountsLimited ? "hide-empty-board-note" : undefined}
            class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-ink-secondary outline-none transition-colors data-highlighted:bg-primary-wash data-highlighted:text-ink motion-reduce:transition-none"
          >
            <span class="flex h-4 w-4 items-center justify-center rounded border border-line text-primary-selected">
              {#if preferences.hideEmptyBoard}
                <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4 4L19 7" /></svg>
              {/if}
            </span>
            <span>Hide empty stages</span>
          </DropdownMenu.CheckboxItem>
          {#if boardCountsLimited}
            <p id="hide-empty-board-note" class="px-2.5 pb-2 text-[0.6875rem] leading-snug text-ink-secondary">
              Counts are limited to the most recent 1,000 projects.
            </p>
          {/if}
        {:else}
          <DropdownMenu.CheckboxItem
            checked={preferences.hideEmptyClientGroups}
            closeOnSelect={false}
            disabled={!clientCountsAvailable}
            onCheckedChange={(checked) => onHideEmptyClientGroupsChange(checked)}
            data-hide-empty-switch="client"
            data-hide-empty-switch-disabled={!clientCountsAvailable ? "true" : undefined}
            aria-describedby={!clientCountsAvailable ? "hide-empty-client-note" : undefined}
            class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-ink-secondary outline-none transition-colors data-disabled:cursor-not-allowed data-disabled:text-ink-faint data-highlighted:bg-primary-wash data-highlighted:text-ink motion-reduce:transition-none"
          >
            <span class="flex h-4 w-4 items-center justify-center rounded border border-line text-primary-selected">
              {#if preferences.hideEmptyClientGroups}
                <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4 4L19 7" /></svg>
              {/if}
            </span>
            <span>Hide empty stages</span>
          </DropdownMenu.CheckboxItem>
          {#if !clientCountsAvailable}
            <p id="hide-empty-client-note" class="px-2.5 pb-2 text-[0.6875rem] leading-snug text-ink-secondary">
              Available after client counts finish backfilling.
            </p>
          {/if}
        {/if}
      {/if}

      {#if preferences.layout === "list" && !showClientOptions}
        {#if showSort}<DropdownMenu.Separator class="my-1 h-px bg-line-soft" />{/if}
        <p class="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-muted">Fields</p>
        {#each columnOptions as option (option.id)}
          <DropdownMenu.CheckboxItem
            checked={preferences.columns[option.id]}
            closeOnSelect={false}
            onCheckedChange={() => onToggleColumn(option.id)}
            class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-ink-secondary outline-none transition-colors data-highlighted:bg-primary-wash data-highlighted:text-ink motion-reduce:transition-none"
          >
            <span class="flex h-4 w-4 items-center justify-center rounded border border-line text-primary-selected">
              {#if preferences.columns[option.id]}
                <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4 4L19 7" /></svg>
              {/if}
            </span>
            {option.label}
          </DropdownMenu.CheckboxItem>
        {/each}
        <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
        <p class="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-muted">Density</p>
        <DropdownMenu.RadioGroup
          value={preferences.density}
          onValueChange={(value) => onDensityChange(value === "compact" ? "compact" : "comfortable")}
        >
          <DropdownMenu.RadioItem value="comfortable" closeOnSelect={false} class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-ink-secondary outline-none transition-colors data-highlighted:bg-primary-wash data-highlighted:text-ink motion-reduce:transition-none">
            <span class="flex h-4 w-4 items-center justify-center rounded-full border border-line" aria-hidden="true">
              {#if preferences.density === "comfortable"}<span class="h-2 w-2 rounded-full bg-primary"></span>{/if}
            </span>
            Comfortable
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="compact" closeOnSelect={false} class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-ink-secondary outline-none transition-colors data-highlighted:bg-primary-wash data-highlighted:text-ink motion-reduce:transition-none">
            <span class="flex h-4 w-4 items-center justify-center rounded-full border border-line" aria-hidden="true">
              {#if preferences.density === "compact"}<span class="h-2 w-2 rounded-full bg-primary"></span>{/if}
            </span>
            Compact
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      {/if}
{/snippet}
