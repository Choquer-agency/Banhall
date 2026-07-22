<script lang="ts">
  import { cn } from "$lib/utils";
  import { getSourceContext } from "./sourceContext";

  interface Props {
    title: string;
    description: string;
    class?: string;
  }

  let { title, description, class: className }: Props = $props();
  const { href, domain, faviconUrl } = getSourceContext();
</script>

<span
  role="tooltip"
  class={cn(
    "source-content pointer-events-none invisible absolute bottom-full left-0 z-[110] mb-2 w-80 translate-y-1 rounded-lg border border-line bg-white p-0 opacity-0 shadow-md transition-[opacity,transform,visibility] delay-150 duration-300",
    "motion-reduce:transition-none",
    className
  )}
>
  <a
    {href}
    target="_blank"
    rel="noopener noreferrer"
    class="flex flex-col gap-2 p-3 text-left no-underline"
  >
    <span class="flex items-center gap-1.5">
      <img src={faviconUrl} alt="" width="16" height="16" class="h-4 w-4 rounded-full" />
      <span class="truncate text-xs font-medium text-primary-selected">{domain}</span>
    </span>
    <span class="line-clamp-2 text-xs font-semibold leading-snug text-ink">{title}</span>
    <span class="line-clamp-3 text-[11px] leading-relaxed text-ink-muted">{description}</span>
  </a>
</span>
