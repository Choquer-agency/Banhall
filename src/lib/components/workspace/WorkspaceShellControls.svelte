<script lang="ts">
  // Shared workspace top-bar controls. The hamburger owns navigation below
  // 1024px; from there the icons-only rail is on screen, and the rail owns its
  // collapse and expand buttons in both states (round 2, A4). `railHidden`
  // and `onToggleRail` stay in the contract for hosts that pass them.
  import { ListIcon } from "phosphor-svelte";
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
  class={`-ml-2 flex ${buttonBase} lg:hidden`}
>
  <ListIcon size={20} weight="regular" aria-hidden="true" />
</button>
