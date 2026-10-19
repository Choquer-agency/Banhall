<script lang="ts">
  // Shared workspace top-bar control, at the left edge before the page
  // title: below 1024px the hamburger opens the navigation drawer. From
  // 1024px up the rail is on screen and draws its own collapse and expand
  // control (Rail v3, owner 2026-10-19, replacing the 2026-09-28 direction
  // that put it here). `railHidden` and `onToggleRail` stay in the props so
  // existing hosts keep compiling; they no longer draw anything.
  import { IconMenu } from "$lib/components/icons";

  let {
    tone = "light",
    onOpenNavigation,
  }: {
    /** Focus outline pairing for the hosting plane. */
    tone?: "light" | "dark";
    onOpenNavigation: () => void;
    /** @deprecated The rail draws its own control (2026-10-19). */
    railHidden?: boolean;
    /** @deprecated The rail draws its own control (2026-10-19). */
    onToggleRail?: (() => void) | null;
  } = $props();

  const focusOutline = $derived(
    tone === "dark" ? "focus-visible:outline-primary-light" : "focus-visible:outline-navy"
  );
</script>

<button
  type="button"
  aria-label="Open workspace navigation"
  onclick={onOpenNavigation}
  class={`-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${focusOutline} motion-reduce:transition-none lg:hidden`}
>
  <IconMenu size={20} strokeWidth={1.5} />
</button>
