<script lang="ts">
  import type { ComponentProps } from "svelte";
  import type AgentChatPanel from "$lib/components/chat/AgentChatPanel.svelte";
  import LazyModule from "$lib/components/ui/LazyModule.svelte";
  let { load, active = true, ...assistantProps }: ComponentProps<typeof AgentChatPanel> & {
    load: () => Promise<typeof import("$lib/components/chat/AgentChatPanel.svelte")>;
    active?: boolean;
  } = $props();
</script>
<LazyModule {load} {active} label="assistant">
  {#snippet children(Assistant)}
    <Assistant {...assistantProps} />
  {/snippet}
</LazyModule>
