<script lang="ts">
  // Shared workspace top-bar controls. The hamburger owns navigation below
  // 1280px. On desktop, the rail owns its collapse/expand button in both
  // states. Attio fully slides the desktop rail away, so this component owns
  // the restore affordance on the content plane.
  import { ListIcon } from "phosphor-svelte";
  import AnimatedSidebarToggleIcon from "$lib/components/workspace/AnimatedSidebarToggleIcon.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  let {
    tone = "light",
    onOpenNavigation,
    railHidden = false,
    onToggleRail = null,
  }: {
    /** Focus outline pairing for the hosting plane. */
    tone?: "light" | "dark";
    onOpenNavigation: () => void;
    /** Desktop rail collapse state (collapsed = fully off-canvas). */
    railHidden?: boolean;
    /** Omitted (null) hides the rail toggle entirely. */
    onToggleRail?: (() => void) | null;
  } = $props();

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
  class={`-ml-2 flex ${buttonBase} xl:hidden`}
>
  <ListIcon size={20} weight="regular" aria-hidden="true" />
</button>

{#if onToggleRail && railHidden}
  <Tooltip text="Expand sidebar" side="bottom" delayDuration={300}>
    {#snippet children({ props })}
      <button
        {...props}
        type="button"
        data-rail-toggle
        data-rail-direction="expand"
        aria-label="Expand navigation rail"
        aria-expanded="false"
        aria-controls="workspace-rail"
        onclick={onToggleRail}
        class={`rail-restore-toggle group -ml-1.5 hidden ${buttonBase} active:scale-95 xl:flex`}
      >
        <AnimatedSidebarToggleIcon direction="expand" />
      </button>
    {/snippet}
  </Tooltip>
{/if}

<style>
  .rail-restore-toggle {
    animation: rail-toggle-reveal 180ms 80ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes rail-toggle-reveal {
    from {
      opacity: 0;
      transform: translateX(-5px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rail-restore-toggle {
      animation: none;
    }
  }
</style>
