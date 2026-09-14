<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";

  /**
   * DW-135 (AD-28 amendment, 2026-09-14): a Coordinated Revision saved with
   * zero edits because every finding was blocked or conflicting. The card is
   * a record of those findings for the writer's decision. It offers nothing
   * to apply, reject or reword, and never calls a mutation.
   */
  interface Props {
    proposalId: Id<"chatProposals">;
  }

  let { proposalId }: Props = $props();

  const componentId = $props.id();
  const headingId = `${componentId}-heading`;
  const itemsQ = useQuery(api.chatV2.listProposalItems, () => ({ proposalId }));
  const items = $derived((itemsQ.data ?? []) as Doc<"chatProposalItems">[]);

  const STATUS_LABEL: Record<Doc<"chatProposalItems">["status"], string> = {
    resolved: "Resolved",
    blocked: "Blocked",
    conflicting: "Conflicting",
  };
</script>

<section class="mt-2 overflow-hidden rounded-lg border border-line bg-white" aria-labelledby={headingId}>
  <div class="flex items-center gap-2 border-b border-line-soft px-3 py-2">
    <span class="h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden="true"></span>
    <p id={headingId} class="text-xs font-medium text-ink-secondary">Nothing to apply</p>
  </div>

  <div class="max-h-72 overflow-y-auto px-3 py-2.5">
    <p class="text-sm leading-relaxed text-ink-secondary">
      These findings need a writer's decision. No passage was changed, and there is nothing to apply.
    </p>

    {#if itemsQ.error}
      <p role="alert" class="mt-2 text-xs text-red-600">Couldn't load the findings. Try reloading the page.</p>
    {:else if itemsQ.isLoading}
      <p class="mt-2 text-xs text-ink-muted">Loading findings…</p>
    {:else if items.length === 0}
      <p class="mt-2 text-xs text-ink-muted">No findings were recorded.</p>
    {:else}
      <ul class="mt-2.5 flex flex-col gap-2.5" aria-label="Findings">
        {#each items as item (item._id)}
          <li class="border-l-2 border-line pl-2.5">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span class="text-data text-ink">{item.itemId}</span>
              <span class="rounded-full bg-chrome px-1.5 py-0.5 text-xs font-medium text-ink-secondary">
                {STATUS_LABEL[item.status]}
              </span>
              {#if item.section && item.paragraphNumber}
                <span class="text-xs text-ink-muted">Line {item.section}, paragraph {item.paragraphNumber}</span>
              {/if}
            </div>
            <p class="mt-0.5 text-sm leading-relaxed text-ink-secondary">{item.reason}</p>
            {#if item.status === "blocked"}
              <p class="text-xs leading-relaxed text-ink-muted">
                Missing fact: {item.missingFact} Expected from: {item.missingFactSource}
              </p>
            {:else if item.status === "conflicting"}
              <p class="text-xs leading-relaxed text-ink-muted">
                Locked Rule: {item.lockedRule} Alternative: {item.alternative}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
