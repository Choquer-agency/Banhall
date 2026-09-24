<script lang="ts">
  /**
   * An exact interview quote inside a Seed bullet (ui-design-final.md
   * section 11, decision 17): a solid teal underline, and on hover or focus a
   * card with the quote, its source label and "Open in transcript".
   */
  let {
    text,
    quote,
    sourceLabel,
    onOpenTranscript,
  }: {
    /** The bullet words that match the excerpt word for word. */
    text: string;
    /** The cited excerpt, shown in full on the card. */
    quote: string;
    /** "Priya, line 18" when known; never a made-up attribution. */
    sourceLabel: string;
    /** Omitted when the host cannot open the transcript yet. */
    onOpenTranscript?: () => void;
  } = $props();

  const cardId = $props.id();
</script>

<span class="group/quote relative">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <span
    tabindex="0"
    data-exact-quote
    aria-describedby={cardId}
    class="rounded-[2px] border-b-[1.5px] border-primary transition-colors group-hover/quote:bg-primary-wash focus-visible:bg-primary-wash focus-visible:outline-none motion-reduce:transition-none"
  >{text}</span>
  <span
    id={cardId}
    data-quote-card
    class="pointer-events-none invisible absolute top-full left-0 z-30 block w-[304px] max-w-[80vw] pt-1 opacity-0 transition-opacity duration-150 group-focus-within/quote:pointer-events-auto group-focus-within/quote:visible group-focus-within/quote:opacity-100 group-hover/quote:pointer-events-auto group-hover/quote:visible group-hover/quote:opacity-100 motion-reduce:transition-none"
  >
    <span class="flex flex-col gap-1.5 rounded-md border border-line bg-surface px-3 py-2.5 shadow-lg">
      <span class="font-serif text-[13px] leading-[18px] text-ink">“{quote}”</span>
      <span class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-[11px] leading-[14px] text-ink-faint">{sourceLabel}</span>
        {#if onOpenTranscript}
          <button
            type="button"
            class="shrink-0 rounded text-[11px] leading-[14px] text-primary-selected hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onclick={onOpenTranscript}
          >Open in transcript</button>
        {/if}
      </span>
    </span>
  </span>
</span>
