<script lang="ts">
  // Test fixture: one reply's suggestion cards with the panel's shared card
  // state and, when `review` is on, the report's review session and bar.
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { AssistantCards, ReviewSession, provideAssistantCards } from "$lib/chat/assistantCards.svelte";
  import AssistantTurn from "./AssistantTurn.svelte";
  import ReviewBar from "./ReviewBar.svelte";

  interface Props {
    proposals: Array<Doc<"chatProposals"> & { undoable?: boolean }>;
    review?: boolean;
    onReady?: (state: { cards: AssistantCards; session: ReviewSession }) => void;
  }

  let { proposals, review = true, onReady }: Props = $props();
  // svelte-ignore state_referenced_locally
  const session = new ReviewSession();
  // svelte-ignore state_referenced_locally
  const cards = new AssistantCards(review ? session : null);
  provideAssistantCards(cards);
  // svelte-ignore state_referenced_locally
  onReady?.({ cards, session });
</script>

<div class="flex gap-6 bg-white p-6">
  <div class="w-[22rem] shrink-0">
    <AssistantTurn {proposals} onRefine={() => {}} />
    {#if cards.notice}
      <p class="mt-3 text-[0.8125rem]" data-fixture-notice>{cards.notice.message}</p>
    {/if}
  </div>
  {#if review}
    <div class="flex min-w-0 flex-1 items-end justify-center">
      <ReviewBar review={session} />
    </div>
  {/if}
</div>
