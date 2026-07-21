<script lang="ts">
  import { cn } from "$lib/utils";
  import { getSourceContext } from "./sourceContext";

  interface Props {
    label?: string | number;
    showFavicon?: boolean;
    class?: string;
  }

  let {
    label,
    showFavicon = false,
    class: className,
  }: Props = $props();

  const { href, domain, faviconUrl } = getSourceContext();
  const labelToShow = $derived(label ?? domain.replace(/^www\./, ""));
</script>

<a
  {href}
  target="_blank"
  rel="noopener noreferrer"
  class={cn(
    "inline-flex h-5 max-w-36 items-center gap-1 overflow-hidden rounded-full bg-chrome py-0 text-xs font-normal text-ink-muted no-underline transition-colors hover:bg-primary-wash hover:text-primary-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
    showFavicon ? "pl-1 pr-2" : "px-1.5",
    className
  )}
>
  {#if showFavicon}
    <img src={faviconUrl} alt="" width="14" height="14" class="h-3.5 w-3.5 shrink-0 rounded-full" />
  {/if}
  <span class="truncate text-center tabular-nums">{labelToShow}</span>
</a>
