<script lang="ts">
  // Shared workspace top-bar controls, at the left edge before the page
  // title. Below 1024px the hamburger opens the navigation drawer. From
  // 1024px up the rail is on screen and this bar owns its collapse and expand
  // control in both states (owner direction 2026-09-28, replacing the rail
  // toggles of boards A1 to A5). Inside a workspace shell the control reads
  // the shell's rail state (tablet overlay, saved preference); `railHidden`
  // and `onToggleRail` are the fallback for hosts rendered without a shell.
  import { IconMenu } from "$lib/components/icons";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import AnimatedSidebarToggleIcon from "$lib/components/workspace/AnimatedSidebarToggleIcon.svelte";
  import { detectPlatform, shortcutHint } from "$lib/shell/shortcuts";
  import { getRailControl } from "$lib/workspace/railControl";

  let {
    tone = "light",
    onOpenNavigation,
    railHidden = false,
    onToggleRail = null,
  }: {
    /** Focus outline pairing for the hosting plane. */
    tone?: "light" | "dark";
    onOpenNavigation: () => void;
    /** Desktop rail collapse state, used only outside a workspace shell. */
    railHidden?: boolean;
    /** Used only outside a workspace shell; null there hides the rail toggle. */
    onToggleRail?: (() => void) | null;
  } = $props();

  const railControl = getRailControl();
  const collapsed = $derived(railControl ? railControl.collapsed : railHidden);
  const toggleRail = $derived(railControl ? railControl.toggle : onToggleRail);
  const collapseHint = shortcutHint("collapseRail", detectPlatform());

  const focusOutline = $derived(
    tone === "dark" ? "focus-visible:outline-primary-light" : "focus-visible:outline-navy"
  );
  const buttonBase = $derived(
    `h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${focusOutline} motion-reduce:transition-none`
  );
</script>

<button
  type="button"
  aria-label="Open workspace navigation"
  onclick={onOpenNavigation}
  class={`-ml-2 flex ${buttonBase} lg:hidden`}
>
  <IconMenu size={20} strokeWidth={1.5} />
</button>
{#if toggleRail}
  <Tooltip text={collapsed ? "Expand the rail" : "Collapse the rail"} hint={collapseHint} side="bottom" delayDuration={300}>
    {#snippet children({ props })}
      <button
        {...props}
        type="button"
        data-rail-toggle
        data-rail-direction={collapsed ? "expand" : "collapse"}
        aria-controls="workspace-rail"
        aria-label={collapsed ? "Expand navigation rail" : "Collapse navigation rail"}
        aria-expanded={!collapsed}
        onclick={toggleRail}
        class={`group hidden size-9 shrink-0 items-center justify-center rounded-[7px] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ${focusOutline} motion-reduce:transition-none lg:flex pointer-coarse:size-11`}
      >
        <AnimatedSidebarToggleIcon direction={collapsed ? "expand" : "collapse"} size={16} />
      </button>
    {/snippet}
  </Tooltip>
{/if}
