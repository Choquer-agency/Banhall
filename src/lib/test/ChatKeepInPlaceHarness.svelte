<script lang="ts">
  // A chat viewport with one Assistant turn among filler rows, for checking
  // that opening the thought block never moves it (owner, 2026-10-21).
  import type { UIMessage } from "@convex-dev/agent";
  import ChatContainer from "$lib/components/chat/primitives/ChatContainer.svelte";
  import AssistantTurn from "$lib/components/chat/AssistantTurn.svelte";
  import type { TurnTiming } from "$lib/chat/turnParts";

  let { message, timing, before = 30, after = 0 }: {
    message: UIMessage;
    timing: TurnTiming;
    before?: number;
    after?: number;
  } = $props();
</script>

<div style="height: 26.25rem; width: 26.25rem; display: flex; flex-direction: column;">
  <ChatContainer class="min-h-0 flex-1" contentClass="space-y-3">
    {#each Array.from({ length: before }, (_, i) => i) as i (i)}
      <p>Earlier line {i}</p>
    {/each}
    <AssistantTurn {message} {timing} onRefine={() => {}} />
    {#each Array.from({ length: after }, (_, i) => i) as i (i)}
      <p>Later line {i}</p>
    {/each}
  </ChatContainer>
</div>
