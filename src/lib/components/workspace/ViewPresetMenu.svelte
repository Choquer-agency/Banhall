<!--
  Named view presets chip (2026-08-13, Attio-research P1). A GhostPopover-
  grammar chip (the selected view name, or bare "View"
  otherwise) opening the presets panel: apply a saved view, delete one, or
  save the current view under a name. Browser-local only (viewPresets.ts,
  fail-closed) — never a server feature, never URL state of its own; applying
  a preset writes the same preferences/filters the view already persists.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import { popIn, popOut } from "$lib/motion/panelMotion";
  import {
    MAX_PRESET_NAME_LENGTH,
    type ProjectsViewPreset,
  } from "$lib/dashboard/viewPresets";

  let {
    presets,
    activeName,
    defaultActive = false,
    onApply,
    onApplyDefault,
    onSaveCurrent,
    onDelete,
  }: {
    presets: ProjectsViewPreset[];
    /** Name of the preset matching the live view, null when none does. */
    activeName: string | null;
    /** True when the live view equals the unnamed "All projects" baseline. */
    defaultActive?: boolean;
    onApply: (preset: ProjectsViewPreset) => void;
    onApplyDefault: () => void;
    onSaveCurrent: (name: string) => void;
    onDelete: (name: string) => void;
  } = $props();

  let open = $state(false);
  let draftName = $state("");

  function save() {
    const name = draftName.trim();
    if (!name) return;
    onSaveCurrent(name);
    draftName = "";
    open = false;
  }

  const rowClass =
    "group/preset flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors motion-reduce:transition-none pointer-coarse:min-h-11";
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    data-view-preset-chip
    aria-label="Saved views"
    class="group inline-flex h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-lg bg-transparent px-2 text-xs font-medium text-ink-secondary transition-colors select-none hover:bg-workspace-rail-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:h-7"
  >
    {#if activeName}
      <span class="truncate text-ink">{activeName}</span>
    {:else if defaultActive}
      <span class="truncate text-ink">All projects</span>
    {:else}
      <span class="truncate text-ink">All projects</span>
    {/if}
    <svg
      class="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group-data-[state=open]:rotate-180 motion-reduce:transition-none"
      fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"
    ><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content forceMount side="bottom" align="start" sideOffset={6}>
      {#snippet child({ props, wrapperProps, open: contentOpen })}
        <div {...wrapperProps}>
          {#if contentOpen}
            <div
              {...props}
              in:popIn
              out:popOut
              class="z-[100] w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-md outline-none"
            >
              <p class="px-3 pb-0.5 pt-2 text-[11px] font-medium text-ink-faint">Views</p>
              <div class="max-h-72 overflow-y-auto px-1.5 pb-1.5">
                <button
                  type="button"
                  data-view-preset-default
                  class={`${rowClass} ${defaultActive ? "bg-chrome text-ink" : "text-ink-secondary hover:bg-chrome/60 hover:text-ink"}`}
                  onclick={() => {
                    onApplyDefault();
                    open = false;
                  }}
                >
                  <span class="min-w-0 flex-1 truncate">All projects</span>
                </button>
                {#each presets as preset (preset.name)}
                  {@const active = activeName === preset.name}
                  <div class={`${rowClass} ${active ? "bg-chrome text-ink" : "text-ink-secondary hover:bg-chrome/60 hover:text-ink"} p-0`}>
                    <button
                      type="button"
                      data-view-preset-apply={preset.name}
                      class="min-w-0 flex-1 cursor-pointer truncate px-0 py-0 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                      onclick={() => {
                        onApply(preset);
                        open = false;
                      }}
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete view ${preset.name}`}
                      class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-faint opacity-0 transition-opacity hover:bg-chrome hover:text-ink focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy group-hover/preset:opacity-100 motion-reduce:transition-none"
                      onclick={() => onDelete(preset.name)}
                    >
                      <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M8 8l8 8m0-8l-8 8" /></svg>
                    </button>
                  </div>
                {/each}
              </div>
              <form
                class="flex items-center gap-1.5 border-t border-line-soft px-2.5 py-2"
                onsubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <input
                  bind:value={draftName}
                  maxlength={MAX_PRESET_NAME_LENGTH}
                  placeholder="Save current view as…"
                  aria-label="New view name"
                class="field-control h-8 min-w-0 flex-1 rounded-lg px-2.5 text-[13px] text-ink placeholder:text-ink-faint"
                />
                <button
                  type="submit"
                  disabled={!draftName.trim()}
                  class="h-8 shrink-0 cursor-pointer rounded-lg bg-primary-selected px-2.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
                >
                  Save
                </button>
              </form>
            </div>
          {/if}
        </div>
      {/snippet}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
