<!--
  A company page's tabs (2026-11-04, Paper "Profile / Overview"): Overview,
  Files (with its count), People (with its count), Activity and Details,
  underlined rather than filled (docs/design-system.md, the 2026-11-04
  amendment). A tablist: the active tab is the one tab stop, arrow keys move
  between tabs (wrapping), Home and End go to the first and last.
-->
<script lang="ts" generics="T extends string">
  let {
    tabs,
    active,
    label,
    onSelect,
  }: {
    tabs: readonly { id: T; label: string; count?: number | null }[];
    active: T;
    /** The tablist's name ("Cedarline Systems"). */
    label: string;
    /** `focus`: the tab was reached by the keyboard, so focus follows it. */
    onSelect: (id: T, focus: boolean) => void;
  } = $props();

  function onKeydown(event: KeyboardEvent, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onSelect(tabs[next]!.id, true);
  }
</script>

<div role="tablist" aria-label={label} data-company-tabs class="-mb-px flex h-10 shrink-0 gap-5">
  {#each tabs as tab, index (tab.id)}
    {@const selected = tab.id === active}
    <button
      type="button"
      role="tab"
      id={`company-tab-${tab.id}`}
      aria-selected={selected}
      aria-controls={`company-panel-${tab.id}`}
      tabindex={selected ? 0 : -1}
      data-company-tab={tab.id}
      onclick={() => onSelect(tab.id, false)}
      onkeydown={(event) => onKeydown(event, index)}
      class={`relative flex shrink-0 items-center gap-1.5 rounded-sm text-xs leading-[calc(4/3)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11 ${
        selected ? "font-medium text-ink" : "text-ink-secondary hover:text-ink"
      }`}
    >
      {tab.label}
      {#if tab.count !== undefined && tab.count !== null}
        <span
          data-company-tab-count
          class="flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-gray-50 px-1 text-[0.625rem] font-normal leading-[1.2] text-ink-muted"
        >{tab.count}</span>
      {/if}
      {#if selected}
        <span aria-hidden="true" data-company-tab-underline class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary-selected"></span>
      {/if}
    </button>
  {/each}
</div>
