<script lang="ts" module>
  export type FrameRailIconName = "projects" | "companies" | "team" | "changelog" | "admin" | "settings";
  export type FrameIconName =
    | FrameRailIconName
    | "bell"
    | "sidebar-collapse"
    | "sidebar-expand"
    | "plus"
    | "home"
    | "all-projects"
    | "all-companies"
    | "arrow-up-right"
    | "people"
    | "mail"
    | "search"
    | "chevron-down"
    | "back"
    | "download"
    | "more"
    | "keyboard";

  /** Board size of each icon (px at a 16px root). */
  const SIZES: Record<FrameIconName, number> = {
    projects: 20,
    companies: 20,
    team: 20,
    changelog: 20,
    admin: 20,
    settings: 20,
    bell: 17,
    "sidebar-collapse": 16,
    "sidebar-expand": 16,
    plus: 14,
    home: 16,
    "all-projects": 16,
    "all-companies": 16,
    "arrow-up-right": 16,
    people: 16,
    mail: 16,
    search: 14,
    "chevron-down": 12,
    back: 15,
    download: 14,
    more: 15,
    keyboard: 16,
  };

  export const RAIL_ICON_NAMES: readonly FrameRailIconName[] = ["projects", "companies", "team", "changelog", "admin", "settings"];
</script>

<script lang="ts">
  /**
   * The page frame's icons, drawn from the Paper boards S9, S11 and A1
   * (owner, 2026-10-28). The rail icons are 20px duotone: at rest the dark
   * part is secondary ink and the light part faint ink; on the active item
   * the dark part is ink and the light part the primary teal, as the boards
   * draw Projects and Team. The other icons are outline glyphs in
   * currentColor. Sizes are board pixels and scale with the root
   * (`svg[data-board-icon]` in layout.css). The keyboard glyph (Settings,
   * Shortcuts) has no board drawing; it follows the same outline rules.
   */
  let {
    name,
    active = false,
    size = undefined,
    class: className = "",
  }: { name: FrameIconName; active?: boolean; size?: number; class?: string } = $props();

  const px = $derived(size ?? SIZES[name]);
  const dark = $derived(active ? "fill-ink" : "fill-ink-secondary");
  const light = $derived(active ? "fill-primary" : "fill-ink-faint");
  const outlineStroke = $derived(
    name === "bell" ||
      name === "home" ||
      name === "all-projects" ||
      name === "all-companies" ||
      name === "people" ||
      name === "mail" ||
      name === "keyboard"
      ? 1.7
      : name === "sidebar-collapse" || name === "sidebar-expand" || name === "download"
        ? 1.8
        : name === "back"
          ? 1.9
          : name === "search" || name === "arrow-up-right"
            ? 2
            : 2.2
  );
</script>

<svg
  width={px}
  height={px}
  data-board-icon
  data-frame-icon={name}
  data-frame-icon-active={active ? "" : undefined}
  style:--icon-size={px}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={outlineStroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  class={`shrink-0 ${className}`}
>
  {#if name === "projects"}
    <path stroke="none" class={dark} d="M8 2h7l5 5v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z" />
    <path stroke="none" class={light} d="M15 2v3a2 2 0 0 0 2 2h3z" />
    <rect stroke="none" class="fill-white" x="8.5" y="11" width="7" height="1.8" rx="0.9" />
    <rect stroke="none" class="fill-white" x="8.5" y="14.8" width="4.5" height="1.8" rx="0.9" />
  {:else if name === "companies"}
    <path stroke="none" class={dark} d="M4 5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16H4z" />
    <path stroke="none" class={light} d="M15 9h3a2 2 0 0 1 2 2v10h-5z" />
    <rect stroke="none" class="fill-white" x="7" y="6.5" width="2" height="2" rx="0.5" />
    <rect stroke="none" class="fill-white" x="10" y="6.5" width="2" height="2" rx="0.5" />
    <rect stroke="none" class="fill-white" x="7" y="10.5" width="2" height="2" rx="0.5" />
    <rect stroke="none" class="fill-white" x="10" y="10.5" width="2" height="2" rx="0.5" />
    <rect stroke="none" class="fill-white" x="8" y="16" width="3" height="5" rx="0.5" />
  {:else if name === "team"}
    <path stroke="none" class={light} d="M16.5 4.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM15.2 12.6a5.6 5.6 0 0 1 6.8 5.4v1.5a1 1 0 0 1-1 1h-3.4a8 8 0 0 0-2.4-7.9z" />
    <path stroke="none" class={dark} d="M9 4a3.8 3.8 0 1 1 0 7.6A3.8 3.8 0 0 1 9 4zM2 19.4a7 6.4 0 0 1 14 0v.6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
  {:else if name === "changelog"}
    <!-- What's new (2026-11-02): a megaphone in the rail's duotone, the
         body dark and the handle and sound light. No board drawing; it
         follows the rail icons' rules. -->
    <path stroke="none" class={dark} d="M3 10a2 2 0 0 1 2-2h3.2l7.6-4.3A1.2 1.2 0 0 1 17.6 4.7v14.6a1.2 1.2 0 0 1-1.8 1L8.2 16H5a2 2 0 0 1-2-2z" />
    <path stroke="none" class={light} d="M7.4 16h3.2l1.1 3.9a1.2 1.2 0 0 1-1.15 1.5H9.3a1.2 1.2 0 0 1-1.15-.87z" />
    <path stroke="none" class={light} d="M19.4 9.2a2.9 2.9 0 0 1 0 5.6z" />
  {:else if name === "admin"}
    <path stroke="none" class={dark} d="M12 2.3l7.6 3v5.6c0 4.9-3.2 8.9-7.6 10.7-4.4-1.8-7.6-5.8-7.6-10.7V5.3z" />
    <path stroke="none" class={light} d="M12 2.3v19.3c4.4-1.8 7.6-5.8 7.6-10.7V5.3z" />
    <path class="stroke-white" stroke-width="2" d="M8.6 11.8l2.3 2.3 4.5-4.5" />
  {:else if name === "settings"}
    <path
      stroke="none"
      class={dark}
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"
    />
    <circle stroke="none" class={light} cx="12" cy="12" r="2" />
  {:else if name === "bell"}
    <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  {:else if name === "sidebar-collapse"}
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16M15 10l-2 2 2 2" />
  {:else if name === "sidebar-expand"}
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16M13 10l2 2-2 2" />
  {:else if name === "plus"}
    <path d="M12 5v14M5 12h14" />
  {:else if name === "home"}
    <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
  {:else if name === "all-projects"}
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  {:else if name === "all-companies"}
    <!-- The Companies sidebar's All companies row (2026-10-28), the outline
         building of the earlier rail. -->
    <path d="M4 20V6l7-3v17M11 9h8v11M7 9h1M7 13h1M15 13h1M15 16h1" />
  {:else if name === "arrow-up-right"}
    <!-- Paper S9: the arrow beside a company's name that opens its page. -->
    <path d="M7 17L17 7M9 7h8v8" />
  {:else if name === "people"}
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.4 3.4-5.2 6.5-5.2s5.7 1.8 6.5 5.2" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.9c1.9.6 3.1 2.3 3.5 5.1" />
  {:else if name === "mail"}
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  {:else if name === "search"}
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  {:else if name === "chevron-down"}
    <path d="M6 9l6 6 6-6" />
  {:else if name === "back"}
    <path d="M19 12H5M11 6l-6 6 6 6" />
  {:else if name === "download"}
    <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
  {:else if name === "more"}
    <circle stroke="none" fill="currentColor" cx="5" cy="12" r="1.6" />
    <circle stroke="none" fill="currentColor" cx="12" cy="12" r="1.6" />
    <circle stroke="none" fill="currentColor" cx="19" cy="12" r="1.6" />
  {:else}
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  {/if}
</svg>
