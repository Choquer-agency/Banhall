<script lang="ts" module>
  /** The sidebar's one outlined action under its header ("New project", "Invite people"). */
  export type SectionSidebarAction = {
    label: string;
    /** A link when set; otherwise a button that calls `onclick`. */
    href?: string;
    onclick?: () => void;
  };
</script>

<script lang="ts">
  /**
   * The inner section sidebar (the page frame, owner 2026-10-28; Paper S9 and
   * S11): 228px at the left of the white card with a soft line on its right,
   * 10px sides and 12px at the foot. A 64px header holds the section title
   * (16/20 500) and the collapse button (30px, the sidebar glyph). Under it
   * an optional full-width outlined action, then the section's rows
   * (`SectionSidebarLink`, `SectionSidebarGroup`).
   *
   * One collapse choice serves every section (`sectionSidebar`, kept in this
   * browser); Mod \ toggles it too. The width eases to nothing with the
   * layout motion and the content leaves the tab order. It shows from 768px;
   * below that a page either hides it (`phone="hidden"`) or lets it fill the
   * card (`phone="full"`, the Projects company list on a phone).
   */
  import type { Snippet } from "svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { detectPlatform, shortcutHint } from "$lib/shell/shortcuts";
  import { registerSectionSidebar, sectionSidebar, toggleSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";
  import FrameIcon from "./FrameIcon.svelte";

  let {
    section,
    title,
    action = null,
    phone = "hidden",
    children,
    footer = undefined,
  }: {
    /** Test and style hook: "projects", "team", "admin", "settings". */
    section: string;
    title: string;
    action?: SectionSidebarAction | null;
    phone?: "hidden" | "full";
    children: Snippet;
    /** Pinned under the rows (the Projects page's New company and Merge companies). */
    footer?: Snippet;
  } = $props();

  $effect(() => registerSectionSidebar());

  const collapsed = $derived(sectionSidebar.collapsed);
  const hint = shortcutHint("collapseSidebar", detectPlatform());
  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir";
  const actionClass = `flex h-8 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-surface text-[0.8125rem] font-medium leading-[calc(18/13)] text-ink transition-colors hover:bg-primary-wash ${focusRing} motion-reduce:transition-none pointer-coarse:h-11`;
</script>

<div
  data-section-sidebar-slot={section}
  data-collapsed={collapsed ? "" : undefined}
  class={`section-sidebar-slot relative flex min-h-0 shrink-0 overflow-hidden ${phone === "full" ? "max-md:flex-1" : "max-md:hidden"} ${
    collapsed ? "md:invisible md:w-0" : "md:w-[14.25rem] md:border-r md:border-line-soft"
  }`}
>
  <aside
    data-section-sidebar={section}
    aria-label={title}
    class="flex min-h-0 w-full shrink-0 flex-col px-2.5 pb-3 md:w-[14.1875rem]"
  >
    <div data-section-sidebar-header class="flex h-16 shrink-0 items-center gap-2 pl-2 pr-0.5">
      <p data-section-sidebar-title class="min-w-0 flex-1 truncate text-base font-medium leading-[1.25] text-ink">{title}</p>
      <Tooltip text="Collapse the sidebar" {hint} side="bottom" delayDuration={300}>
        {#snippet children({ props })}
          <button
            {...props}
            type="button"
            data-section-sidebar-toggle
            aria-label="Collapse the sidebar"
            aria-expanded="true"
            onclick={() => toggleSectionSidebar()}
            class={`flex size-[1.875rem] shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-gray-50 hover:text-ink ${focusRing} motion-reduce:transition-none max-md:hidden`}
          >
            <FrameIcon name="sidebar-collapse" />
          </button>
        {/snippet}
      </Tooltip>
    </div>
    {#if action}
      {#if action.href}
        <a href={action.href} data-section-sidebar-action class={actionClass}>
          <FrameIcon name="plus" />
          {action.label}
        </a>
      {:else}
        <button type="button" data-section-sidebar-action onclick={() => action?.onclick?.()} class={actionClass}>
          <FrameIcon name="plus" />
          {action.label}
        </button>
      {/if}
    {/if}
    <div data-section-sidebar-scroll class="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1 scrollbar-hidden">
      {@render children()}
    </div>
    {@render footer?.()}
  </aside>
</div>

<style>
  /* The layout ease on the width. Opening shows the rows at once (so focus
     can land in them); collapsing hides them only once the width is gone. */
  .section-sidebar-slot {
    transition:
      width var(--duration-layout) var(--ease-layout),
      visibility 0s;
  }
  .section-sidebar-slot[data-collapsed] {
    transition:
      width var(--duration-layout) var(--ease-layout),
      visibility 0s linear var(--duration-layout);
  }
  @media (prefers-reduced-motion: reduce) {
    .section-sidebar-slot,
    .section-sidebar-slot[data-collapsed] {
      transition: none;
    }
  }
</style>
