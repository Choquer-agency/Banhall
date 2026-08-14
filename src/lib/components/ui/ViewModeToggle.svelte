<script module lang="ts">
  export type ViewMode = "board" | "list";

  export type ViewModeToggleProps = {
    value: ViewMode;
    onChange: (value: ViewMode) => void;
    label?: string;
  };
</script>

<script lang="ts">
  import { KanbanIcon, ListBulletsIcon } from "phosphor-svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";

  let props: ViewModeToggleProps = $props();
  let groupElement: HTMLDivElement | null = $state(null);

  const modes: { id: ViewMode; label: string }[] = [
    { id: "list", label: "List view" },
    { id: "board", label: "Board view" },
  ];

  function changeMode(next: ViewMode) {
    props.onChange(next);
  }

  function focusMode(next: ViewMode) {
    changeMode(next);
    queueMicrotask(() => {
      groupElement
        ?.querySelector<HTMLButtonElement>(`[data-view-mode="${next}"]`)
        ?.focus();
    });
  }

  function handleKeydown(event: KeyboardEvent, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % modes.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + modes.length) % modes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = modes.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    focusMode(modes[nextIndex].id);
  }
</script>

<!-- List/Board segmented control on the theme-aware chrome surface. List is
     the canonical default presentation (owner direction 2026-08-13/14);
     the workflow-stage Board remains one click away.
     A11y (P0, 2026-08-08 audit): this is a role=group of aria-pressed
     toggle buttons, not a radiogroup/tablist — EVERY control is in the tab
     sequence (the earlier roving tabindex skipped the unselected List
     control entirely); arrow keys remain a convenience layer. -->
<div
  bind:this={groupElement}
  class="inline-flex items-center gap-0.5 rounded-xl bg-chrome p-0.5"
  role="group"
  aria-label={props.label ?? "Choose a view"}
>
  {#each modes as mode, index (mode.id)}
    <Tooltip text={mode.label}>
      {#snippet children({ props: tooltipProps })}
        <button
          {...tooltipProps}
          data-view-mode={mode.id}
          data-selected={props.value === mode.id ? "true" : undefined}
          type="button"
          aria-label={mode.label}
          aria-pressed={props.value === mode.id}
          onclick={() => changeMode(mode.id)}
          onkeydown={(event) => handleKeydown(event, index)}
          class={`flex min-h-11 min-w-11 items-center justify-center rounded-[0.625rem] border border-transparent px-2 transition-[background-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:min-h-8 sm:min-w-8 sm:px-1.5 ${
            props.value === mode.id
              ? "bg-surface text-ink shadow-sm ring-1 ring-line"
              : "bg-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {#if mode.id === "list"}
            <ListBulletsIcon size={16} weight="regular" aria-hidden="true" />
          {:else}
            <KanbanIcon size={16} weight="regular" aria-hidden="true" />
          {/if}
        </button>
      {/snippet}
    </Tooltip>
  {/each}
</div>
