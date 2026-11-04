<script lang="ts">
  /**
   * One row of a section sidebar (Paper S9, S11). `nav` rows are 32px with a
   * 16px outline icon, the label at 13/18 and a 13px muted count; `group`
   * rows (a company under Companies) are 30px with no icon and a 12/16
   * count. Radius 8, 10px sides, 10px between icon and label. The active row
   * takes the primary wash and a primary-selected 500 label; others hover to
   * the wash. A link, so it opens in a new tab; `onnavigate` turns a plain
   * click into the host's own soft navigation.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes } from "svelte/elements";

  let {
    href,
    label,
    kind = "nav",
    active = false,
    count = null,
    icon = undefined,
    disabled = false,
    onnavigate = undefined,
    trailing = undefined,
    ...rest
  }: Omit<HTMLAnchorAttributes, "href" | "children"> & {
    href: string;
    label: string;
    kind?: "nav" | "group";
    active?: boolean;
    count?: string | number | null;
    icon?: Snippet;
    /** Shown but not followed (Home while it is switched off). */
    disabled?: boolean;
    /** A plain left click; modified clicks keep the link's own behaviour. */
    onnavigate?: () => void;
    /** After the count: an attention dot or a badge. */
    trailing?: Snippet;
  } = $props();

  function onclick(event: MouseEvent) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (!onnavigate) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onnavigate();
  }
</script>

<a
  {...rest}
  {href}
  data-section-sidebar-link={kind}
  aria-current={active ? "page" : undefined}
  aria-disabled={disabled ? "true" : undefined}
  {onclick}
  class={`flex w-full min-w-0 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11 ${
    kind === "nav" ? "h-8" : "h-[1.875rem]"
  } ${active ? "bg-primary-wash text-primary-selected" : "text-ink-secondary hover:bg-primary-wash hover:text-ink"} ${
    disabled ? "opacity-60" : ""
  }`}
>
  {@render icon?.()}
  <span
    data-section-sidebar-label
    class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-[calc(18/13)] ${active ? "font-medium" : ""}`}
  >{label}</span>
  {#if count !== null && count !== undefined && count !== ""}
    <span
      data-section-sidebar-count
      class={`shrink-0 text-right text-ink-muted ${kind === "nav" ? "text-[0.8125rem] leading-[calc(16/13)]" : "text-xs leading-[calc(4/3)]"}`}
    >{count}</span>
  {/if}
  {@render trailing?.()}
</a>
