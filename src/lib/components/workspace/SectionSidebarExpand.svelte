<script lang="ts">
  /**
   * Brings a collapsed section sidebar back (the page frame, owner
   * 2026-10-28). It sits at the start of the page top bar, only while the
   * sidebar is collapsed and only where a sidebar can show (768px and up).
   * Mod \ does the same.
   */
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { detectPlatform, shortcutHint } from "$lib/shell/shortcuts";
  import { sectionSidebar, toggleSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";
  import FrameIcon from "./FrameIcon.svelte";

  const hint = shortcutHint("collapseSidebar", detectPlatform());
</script>

{#if sectionSidebar.collapsed && sectionSidebar.mounted > 0}
  <Tooltip text="Show the sidebar" {hint} side="bottom" delayDuration={300}>
    {#snippet children({ props })}
      <button
        {...props}
        type="button"
        data-section-sidebar-expand
        aria-label="Show the sidebar"
        aria-expanded="false"
        onclick={() => toggleSectionSidebar()}
        class="-ml-1 flex size-[1.875rem] shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none max-md:hidden"
      >
        <FrameIcon name="sidebar-expand" />
      </button>
    {/snippet}
  </Tooltip>
{/if}
