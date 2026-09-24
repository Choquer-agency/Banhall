<!--
  Report panel toolbar (ui-design-final.md section 2): view tabs on the left
  (active tab: ink text with a 2px primary-selected underline) and the panel
  toggles on the right in this order: Full width (report only), divider,
  Details (i), Assistant (Aurora mark), QA (shield and score chip). An active
  toggle is a 26px tile with the selected wash and a fir icon.
-->
<script lang="ts" module>
  export type PanelTab = {
    id: "plan" | "summary" | "report" | "sources";
    label: string;
    /** Small check once the step is done (Plan and Summary). */
    done?: boolean;
    /** Quiet status after the label ("Ready" when sign-off is possible). */
    status?: string | null;
    /** Count badge (Sources). */
    count?: number | null;
    disabled?: boolean;
    /** DOM id for focus-return contracts (the signed-off Summary trigger). */
    triggerId?: string;
    /** Accessible name when it must say more than the label. */
    ariaLabel?: string;
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { ArrowsHorizontalIcon, CheckIcon, InfoIcon } from "phosphor-svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";

  let {
    tabs,
    activeTab,
    onSelectTab,
    showFullWidth = false,
    fullWidth = false,
    onToggleFullWidth,
    showDetails = true,
    detailsActive = false,
    onToggleDetails,
    detailsButton = $bindable(null),
    detailsPeek,
    showAssistant = false,
    assistantActive = false,
    onToggleAssistant,
    qa,
  }: {
    tabs: PanelTab[];
    activeTab: PanelTab["id"] | null;
    onSelectTab: (id: PanelTab["id"]) => void;
    showFullWidth?: boolean;
    fullWidth?: boolean;
    onToggleFullWidth?: () => void;
    showDetails?: boolean;
    detailsActive?: boolean;
    onToggleDetails?: () => void;
    /** The i button, for the Details peek anchor. */
    detailsButton?: HTMLButtonElement | null;
    /** Rendered after the i button (the Details peek popover). */
    detailsPeek?: Snippet;
    showAssistant?: boolean;
    assistantActive?: boolean;
    onToggleAssistant?: () => void;
    /** The QA toggle slot. */
    qa?: Snippet;
  } = $props();

  const toggleBase =
    "flex size-[26px] shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir pointer-coarse:size-11";
  const toggleClass = (active: boolean) =>
    `${toggleBase} ${active ? "bg-workspace-rail-selected text-fir" : "text-ink-muted hover:bg-primary-wash hover:text-ink"}`;
</script>

<div
  data-panel-toolbar
  class="flex h-10 shrink-0 items-stretch gap-3 border-b border-line-soft px-5"
>
  <nav aria-label="Project views" class="flex min-w-0 items-stretch gap-5 overflow-x-auto">
    {#each tabs as tab (tab.id)}
      {@const active = tab.id === activeTab}
      <button
        type="button"
        id={tab.triggerId}
        data-panel-tab={tab.id}
        aria-current={active ? "page" : undefined}
        aria-label={tab.ariaLabel}
        disabled={tab.disabled}
        onclick={() => onSelectTab(tab.id)}
        class={`relative flex shrink-0 items-center gap-1.5 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir disabled:cursor-default disabled:opacity-50 pointer-coarse:min-h-11 ${active ? "text-ink" : "text-ink-muted hover:text-ink"}`}
      >
        {tab.label}
        {#if tab.done}
          <CheckIcon size={12} weight="bold" aria-hidden="true" class="text-primary-selected" />
          <span class="sr-only">, done</span>
        {/if}
        {#if tab.status}
          <span class="rounded bg-primary-wash px-1.5 text-[11px] leading-4 text-primary-selected">{tab.status}</span>
        {/if}
        {#if tab.count != null}
          <span class="rounded bg-gray-50 px-1.5 text-[11px] leading-4 text-ink-muted tabular-nums">{tab.count}</span>
        {/if}
        {#if active}
          <span aria-hidden="true" class="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary-selected"></span>
        {/if}
      </button>
    {/each}
  </nav>

  <div data-panel-toggles class="ml-auto flex shrink-0 items-center gap-1.5">
    {#if showFullWidth}
      <Tooltip text={fullWidth ? "Reading width" : "Full width"} side="bottom" delayDuration={300}>
        {#snippet children({ props })}
          <button
            {...props}
            type="button"
            data-panel-toggle="full-width"
            aria-pressed={fullWidth}
            aria-label="Full width"
            onclick={onToggleFullWidth}
            class={`${toggleClass(fullWidth)} max-lg:hidden`}
          >
            <ArrowsHorizontalIcon size={16} aria-hidden="true" />
          </button>
        {/snippet}
      </Tooltip>
      <span aria-hidden="true" data-panel-toggle-divider class="mx-1 h-4 w-px bg-line max-lg:hidden"></span>
    {/if}
    {#if showDetails}
      <button
        bind:this={detailsButton}
        type="button"
        data-panel-toggle="details"
        aria-pressed={detailsActive}
        aria-label="Details"
        onclick={onToggleDetails}
        class={toggleClass(detailsActive)}
      >
        <InfoIcon size={16} aria-hidden="true" />
      </button>
      {@render detailsPeek?.()}
    {/if}
    {#if showAssistant}
      <Tooltip text="Assistant" side="bottom" delayDuration={300}>
        {#snippet children({ props })}
          <button
            {...props}
            type="button"
            data-panel-toggle="assistant"
            aria-pressed={assistantActive}
            aria-label="Assistant"
            onclick={onToggleAssistant}
            class={toggleClass(assistantActive)}
          >
            <AuroraMark size={16} />
          </button>
        {/snippet}
      </Tooltip>
    {/if}
    {@render qa?.()}
  </div>
</div>
