<script lang="ts">
  import { api } from "../../../convex/_generated/api";
  import { createUIMessages } from "$lib/chat/uiMessages.svelte";
  let { threadId }: { threadId: string | null } = $props();
  const messages = createUIMessages(api.chatV2.listMessages, () => threadId ? { threadId } : "skip", { initialNumItems: 20 });
</script>
<output data-testid="projection">{JSON.stringify(messages.results)}</output>
<output data-testid="ack">{messages.hasPersistedMessage({ threadId: threadId ?? "", messageId: "persisted-user" })}</output>
