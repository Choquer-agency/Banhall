<script lang="ts">
  import { setContext } from "svelte";
  import type { FunctionReference } from "convex/server";
  import type { Id } from "../../../convex/_generated/dataModel";
  import SeedWorkspace from "$lib/components/seeds/SeedWorkspace.svelte";

  let { generationId, projectId, subsection, events }: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    /** The live Subsection read the controlled client holds. */
    subsection: unknown;
    events: Array<"subscribe" | "unsubscribe">;
  } = $props();

  // Only the external client transport is controlled: the opt-in Subsection
  // query runs the installed convex-svelte hook with its real Svelte effects,
  // so a dropped and re-created subscription is observable.
  setContext("$$_convexClient", {
    disabled: false,
    closed: false,
    client: { localQueryResult: () => subsection },
    onUpdate(_query: FunctionReference<"query">, _args: object) {
      events.push("subscribe");
      return () => {
        events.push("unsubscribe");
      };
    },
  });
</script>

<SeedWorkspace {generationId} {projectId} userId="writer-1" onOpenSummary={() => {}} />
