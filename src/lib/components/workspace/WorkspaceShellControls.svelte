<script lang="ts">
  // Shared workspace top-bar controls. The hamburger owns navigation below
  // 1280px. On desktop, the rail owns its collapse/expand button in both
  // states (matching Obvious's placement — the collapsed 64px mini rail
  // keeps it visible, 2026-08-11); this component additionally renders an
  // expand affordance while the rail is collapsed so the action stays
  // reachable from the content plane.
  let {
    tone = "light",
    onOpenNavigation,
    railHidden = false,
    onToggleRail = null,
  }: {
    /** Focus outline pairing for the hosting plane. */
    tone?: "light" | "dark";
    onOpenNavigation: () => void;
    /** Desktop rail collapse state (collapsed = icon-only mini rail). */
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
  <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h16M4 17h16" /></svg>
</button>

{#if onToggleRail && railHidden}
  <button
    type="button"
    data-rail-toggle
    aria-label="Expand navigation rail"
    aria-expanded="false"
    aria-controls="workspace-rail"
    onclick={onToggleRail}
    class={`-ml-1.5 hidden ${buttonBase} xl:flex`}
  >
    <svg class="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.25" stroke-linejoin="round" />
      <path stroke-linecap="round" d="M9.25 5v14" />
    </svg>
  </button>
{/if}
