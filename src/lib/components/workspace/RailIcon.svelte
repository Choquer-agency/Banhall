<script lang="ts" module>
  export type RailIconName =
    | "home"
    | "projects"
    | "companies"
    | "team"
    | "settings"
    | "search"
    | "collapse"
    | "expand";
</script>

<script lang="ts">
  /**
   * Rail v3 icons (Paper board Z11a, node "Rail v3", 2026-10-19): the
   * geometry, 16px size and 1.7 stroke come from the board. Search is 15px
   * at stroke 2 and the sidebar toggle 16px at 1.8, as drawn. The expand
   * glyph mirrors the collapse arrow so it points the way the rail moves.
   */
  let {
    name,
    size = undefined,
    class: className = "",
  }: { name: RailIconName; size?: number; class?: string } = $props();

  const stroke = $derived(name === "search" ? 2 : name === "collapse" || name === "expand" ? 1.8 : 1.7);
  const width = $derived(size ?? (name === "search" ? 15 : 16));
</script>

<svg
  width={width}
  height={width}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  data-rail-icon={name}
  class={`shrink-0 ${className}`}
>
  {#if name === "home"}
    <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
  {:else if name === "projects"}
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  {:else if name === "companies"}
    <path d="M4 20V6l7-3v17M11 9h8v11M7 9h1M7 13h1M15 13h1M15 16h1" />
  {:else if name === "team"}
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5M16 11a3 3 0 1 0 0-6M17.5 14.5c1.7.5 2.9 2 3.5 4.5" />
  {:else if name === "settings"}
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  {:else if name === "search"}
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  {:else if name === "collapse"}
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16M15 10l-2 2 2 2" />
  {:else}
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16M13 10l2 2-2 2" />
  {/if}
</svg>
