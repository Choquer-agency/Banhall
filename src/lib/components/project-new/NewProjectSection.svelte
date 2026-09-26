<script lang="ts">
  /**
   * One numbered section of New project (board E1): a mono number, the
   * title, a helper line and an optional status or action at the right, then
   * the section's content. Sections are split by a hairline. `compact` is
   * the phone spacing (H2): 18px under the section instead of 22px.
   */
  import type { Snippet } from "svelte";

  let {
    id,
    number,
    title,
    helper,
    status,
    statusInline = false,
    action,
    last = false,
    compact = false,
    gap = "14px",
    children,
  }: {
    id: string;
    number: string;
    title: string;
    helper?: string;
    status?: Snippet;
    /** Render the status right after the title, in the helper's place (H1, H2). */
    statusInline?: boolean;
    action?: Snippet;
    last?: boolean;
    compact?: boolean;
    gap?: string;
    children: Snippet;
  } = $props();
</script>

<section
  {id}
  data-new-project-section={id}
  aria-labelledby={`${id}-title`}
  class={`flex scroll-mt-4 flex-col ${last ? "" : `border-b border-line-soft ${compact ? "pb-[18px]" : "pb-[22px]"}`}`}
  style={`gap:${gap}`}
>
  <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
    <span class="font-mono text-xs leading-[22px] text-ink-faint" aria-hidden="true">{number}</span>
    <h2 id={`${id}-title`} class="text-[15px] leading-[22px] font-medium text-ink">{title}</h2>
    {#if helper}<p class="text-[13px] leading-[19px] text-ink-muted">{helper}</p>{/if}
    {#if status && statusInline}{@render status()}{/if}
    <span class="grow"></span>
    {#if status && !statusInline}{@render status()}{/if}
    {#if action}<span class="self-center">{@render action()}</span>{/if}
  </div>
  {@render children()}
</section>
