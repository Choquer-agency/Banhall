<!--
  Change stage menu (board 5.1y B1): all eleven stages grouped In progress,
  Done and Paused, the current stage checked, a muted hint where a move asks
  for something, and unavailable stages disabled with their reason.
-->
<script lang="ts">
  import { CheckIcon } from "phosphor-svelte";
  import StageChip from "./StageChip.svelte";
  import type { StageMenuGroup, StageMenuOption } from "./stageMenu";

  let {
    groups,
    onPick,
  }: {
    groups: StageMenuGroup[];
    onPick: (option: StageMenuOption) => void;
  } = $props();

  let root = $state<HTMLDivElement | null>(null);

  function focusable(): HTMLButtonElement[] {
    return Array.from(root?.querySelectorAll<HTMLButtonElement>("[data-stage-menu-option]:not([disabled])") ?? []);
  }

  function onKeydown(event: KeyboardEvent) {
    const items = focusable();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  }

  $effect(() => {
    if (!root) return;
    const current = root.querySelector<HTMLButtonElement>("[data-stage-menu-option][aria-checked='true']");
    (current ?? focusable()[0])?.focus();
  });
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  bind:this={root}
  role="menu"
  aria-label="Change stage"
  tabindex="-1"
  onkeydown={onKeydown}
  data-stage-menu
  class="flex flex-col"
>
  {#each groups as group (group.label)}
    <div role="group" aria-label={group.label}>
      <p aria-hidden="true" class="px-2 pb-1 pt-2 text-[11px] font-medium uppercase leading-[18px] tracking-[0.04em] text-ink-muted">{group.label}</p>
      {#each group.options as option (option.stage)}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={option.current}
          data-stage-menu-option={option.stage}
          disabled={Boolean(option.disabledReason) || option.current}
          aria-disabled={option.disabledReason ? "true" : undefined}
          onclick={() => onPick(option)}
          class={`flex min-h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-none transition-colors focus-visible:bg-primary-wash pointer-coarse:min-h-11 ${option.current ? "bg-gray-50" : "hover:bg-primary-wash"} ${option.disabledReason ? "cursor-default" : ""}`}
        >
          <!-- A fixed chip column so the hints line up (board 5.1y B1). -->
          <span class={`w-[132px] shrink-0 ${option.disabledReason ? "opacity-50" : ""}`}><StageChip stage={option.stage} size="sm" /></span>
          {#if option.hint}
            <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">{option.hint}</span>
          {:else}
            <span class="flex-1"></span>
          {/if}
          {#if option.current}
            <CheckIcon size={14} aria-hidden="true" class="shrink-0 text-primary-selected" />
          {/if}
        </button>
      {/each}
    </div>
  {/each}
</div>
