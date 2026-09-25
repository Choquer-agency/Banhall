<script lang="ts">
  /**
   * One exact quote inside a Seed bullet (ui-design-final.md sections 3 and
   * 11, decision 17): a solid teal underline whose hover card shows the
   * quoted line, the speaker and line when the transcript gives them, the
   * source label with the state of its read, and "Open in transcript" when
   * the host can open the source. The card sits right after the phrase in the
   * DOM, so Tab moves from the phrase into it; focus or hover opens it, a
   * click or Enter keeps it open, and Escape closes it. Focus returns to the
   * phrase only when it was inside the quote.
   */
  import { onDestroy, tick } from "svelte";
  import { describeSource, type SeedSourceAttribution } from "./attribution";
  import { citationSpeakerLine, type QuoteCitation } from "./citations";

  let {
    text,
    citation,
    sourceAttribution,
    onOpenSource,
  }: {
    text: string;
    citation: QuoteCitation;
    sourceAttribution: SeedSourceAttribution;
    onOpenSource?: (citation: QuoteCitation) => void;
  } = $props();

  const uid = $props.id();
  const CARD_WIDTH = 304;
  const OPEN_DELAY_MS = 120;
  const CLOSE_DELAY_MS = 160;

  let open = $state(false);
  let pinned = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let wrapper = $state<HTMLSpanElement | null>(null);
  let card = $state<HTMLElement | null>(null);
  let position = $state({ top: 0, left: 0 });
  let timer: ReturnType<typeof setTimeout> | null = null;

  const source = $derived(describeSource(sourceAttribution, String(citation.sourceId)));
  const speakerLine = $derived(citationSpeakerLine(citation));

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function place() {
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = card?.offsetHeight ?? 120;
    const width = Math.min(CARD_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - 8 && rect.top - height - 6 > 8
      ? rect.top - height - 6
      : below;
    position = { top, left };
  }

  async function show() {
    clearTimer();
    if (open) return;
    open = true;
    place();
    await tick();
    place();
  }

  // Focus handed back to the phrase by Escape must not reopen the card.
  let refocusing = false;

  function hide() {
    clearTimer();
    open = false;
    pinned = false;
  }

  function scheduleShow() {
    clearTimer();
    timer = setTimeout(() => void show(), OPEN_DELAY_MS);
  }

  function scheduleHide() {
    if (pinned) return;
    clearTimer();
    timer = setTimeout(hide, CLOSE_DELAY_MS);
  }

  // A card opened by hover leaves keyboard focus where it was, so Escape
  // never reaches the wrapper's own handler. While the card is open, Escape
  // anywhere closes it; focus moves back to the phrase only when it was
  // inside this quote (the wrapper's handler below), never from elsewhere.
  // The event is left to other handlers (for example an edit field's own
  // Escape) when focus is outside the quote.
  $effect(() => {
    if (!open) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (wrapper && active instanceof Node && wrapper.contains(active)) return;
      hide();
    };
    document.addEventListener("keydown", onKeydown, true);
    return () => document.removeEventListener("keydown", onKeydown, true);
  });

  $effect(() => {
    if (!open) return;
    const reposition = () => place();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  });

  onDestroy(clearTimer);
</script>

<span
  bind:this={wrapper}
  class="inline"
  data-seed-quote
  role="presentation"
  onfocusout={(event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    hide();
  }}
  onkeydown={(event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    hide();
    refocusing = true;
    trigger?.focus();
    refocusing = false;
  }}
><button
    bind:this={trigger}
    type="button"
    aria-expanded={open}
    aria-controls={`seed-quote-card-${uid}`}
    data-exact-quote
    class={`inline cursor-default rounded-[2px] p-0 text-left align-baseline [color:inherit] underline decoration-primary decoration-[1.5px] underline-offset-[3px] [font:inherit] transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${open ? "bg-primary-wash" : "bg-transparent"}`}
    onpointerenter={(event) => {
      if (event.pointerType !== "touch") scheduleShow();
    }}
    onpointerleave={(event) => {
      if (event.pointerType !== "touch") scheduleHide();
    }}
    onfocus={() => {
      if (!refocusing) void show();
    }}
    onclick={() => {
      if (open && pinned) {
        hide();
        return;
      }
      pinned = true;
      void show();
    }}
  >{text}</button>{#if open}<span
      bind:this={card}
      id={`seed-quote-card-${uid}`}
      role="group"
      aria-label="Quoted line"
      data-quote-card
      class="fixed z-[90] flex flex-col gap-1.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-left shadow-lg"
      style={`top:${position.top}px;left:${position.left}px;width:min(${CARD_WIDTH}px, calc(100vw - 16px))`}
      onpointerenter={clearTimer}
      onpointerleave={scheduleHide}
    ><span class="block font-serif text-[13px] leading-[18px] text-ink" data-quote-text>“{citation.exactExcerpt}”</span><span
        class="flex items-end gap-3 text-[11px] leading-[14px]"
      ><span class="min-w-0 flex-1 text-ink-faint">{#if speakerLine && source.attributed}<span
              data-quote-speaker>{speakerLine}</span> in <span
              data-quote-source
              data-attributed={source.attributed}>{source.label}</span>{:else}{#if speakerLine}<span
                class="block"
                data-quote-speaker>{speakerLine}</span>{/if}<span
              class={source.attributed ? "block" : "block italic"}
              data-quote-source
              data-attributed={source.attributed}>{source.label}</span>{/if}</span>{#if onOpenSource}<button
            type="button"
            class="shrink-0 rounded text-[11px] leading-[14px] text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onclick={() => {
              hide();
              onOpenSource(citation);
            }}>Open in transcript</button>{/if}</span></span>{/if}</span>
