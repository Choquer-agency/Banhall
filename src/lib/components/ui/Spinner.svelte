<script lang="ts">
  import { cn } from "$lib/utils";

  /**
   * The one loading spinner (design system: docs/design-system.md).
   * `md` (default) is the page/section loader; `sm` is the inline/button
   * size. Pass `class` for contextual overrides (e.g. `border-white
   * border-t-transparent` on a filled button) — merged via cn, so
   * overrides win over the defaults.
   */
  let {
    size = "md",
    class: className,
  }: { size?: "sm" | "md"; class?: string } = $props();
</script>

<div
  class={cn(
    "animate-spin rounded-full border-2 border-primary border-t-transparent",
    size === "sm" ? "h-4 w-4" : "h-6 w-6",
    className
  )}
  role="status"
  aria-label="Loading"
></div>
