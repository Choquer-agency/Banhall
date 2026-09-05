<script lang="ts">
  import { setContext } from "svelte";
  import type { FunctionReference } from "convex/server";
  import type { Id } from "../../../convex/_generated/dataModel";
  import AgentChatPanel from "$lib/components/chat/AgentChatPanel.svelte";

  let { reportId, projectId, events }: {
    reportId: Id<"reports">;
    projectId: Id<"projects">;
    events: Array<"subscribe" | "unsubscribe">;
  } = $props();

  // Only the external client transport is controlled. The opt-in query runs
  // the installed convex-svelte hook, including its real Svelte effects.
  setContext("$$_convexClient", {
    disabled: false,
    closed: false,
    client: { localQueryResult: () => [] },
    onUpdate(_query: FunctionReference<"query">, _args: object) {
      events.push("subscribe");
      return () => { events.push("unsubscribe"); };
    },
  });
</script>

<AgentChatPanel {reportId} {projectId} />
