<script lang="ts">
  import type { ReviewSession } from "$lib/chat/assistantCards.svelte";

  /**
   * Owner 2026-10-28 (Paper row 34, V3 and V4): the bar that floats over the
   * report while a suggestion is under review: which option is shown, Show
   * changes, Stop review and Accept. The card in the chat offers the same
   * Stop review and Accept; both end the same review.
   */
  interface Props {
    review: ReviewSession;
  }

  let { review }: Props = $props();

  const target = $derived(review.target);
</script>

{#if target}
  <div class="flex h-12 max-w-full items-center gap-2 rounded-xl bg-ink pl-4 pr-1.5 shadow-review-bar" role="toolbar" aria-label="Review suggestion" data-review-bar>
    <div class="flex shrink-0 items-center gap-2 pr-1.5">
      <span class="text-[0.8125rem] font-medium leading-[calc(18/13)] text-white" data-review-bar-option>Option {review.option + 1}</span>
      {#if target.optionCount > 1 && review.option === 0}
        <span class="inline-flex h-[1.125rem] items-center rounded-full bg-primary/22 px-1.5 text-xs font-medium leading-[calc(4/3)] text-on-ink-accent">Recommended</span>
      {/if}
    </div>
    <span class="h-6 w-px shrink-0 bg-white/20" aria-hidden="true"></span>
    <button type="button" role="switch" aria-checked={review.showChanges}
      class="flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/10 pointer-coarse:min-h-11"
      onclick={() => (review.showChanges = !review.showChanges)} data-review-bar-show-changes>
      <span class="flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors {review.showChanges ? 'justify-end bg-primary' : 'justify-start bg-white/30'}" aria-hidden="true">
        <span class="size-3 rounded-[0.375rem] bg-white"></span>
      </span>
      <span class="text-[0.8125rem] leading-[calc(18/13)] text-white">Show changes</span>
    </button>
    <span class="h-6 w-px shrink-0 bg-white/20" aria-hidden="true"></span>
    <button type="button" class="inline-flex h-8 shrink-0 items-center rounded-[0.4375rem] px-3 text-[0.8125rem] font-medium leading-[calc(18/13)] text-on-ink-muted transition-colors hover:bg-white/10 disabled:opacity-50 pointer-coarse:min-h-11"
      onclick={() => review.stop()} disabled={review.accepting} data-review-bar-stop>Stop review</button>
    <button type="button" class="inline-flex h-8 shrink-0 items-center rounded-[0.4375rem] bg-primary-selected px-3.5 text-[0.8125rem] font-medium leading-[calc(18/13)] text-white transition-colors hover:bg-primary-dark disabled:opacity-50 pointer-coarse:min-h-11"
      onclick={() => void review.accept()} disabled={review.accepting} data-review-bar-accept>{review.accepting ? "Accepting…" : "Accept"}</button>
  </div>
{/if}
