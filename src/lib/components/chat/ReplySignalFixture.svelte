<script lang="ts">
  // Test fixture (Phase B, W2): the page-level reply signal driving the
  // Assistant toggle, as the report page wires it.
  import type { Id } from "../../../../convex/_generated/dataModel";
  import PanelToolbar from "$lib/components/project/shell/PanelToolbar.svelte";
  import { useReplySignal } from "$lib/chat/replySignal.svelte";

  let { reportId, panelOpen = false }: { reportId: Id<"reports">; panelOpen?: boolean } = $props();

  const reply = useReplySignal(() => ({ reportId, panelOpen }));
</script>

<PanelToolbar tabs={[]} activeTab={null} onSelectTab={() => {}} showAssistant assistantSignal={reply.signal} />
