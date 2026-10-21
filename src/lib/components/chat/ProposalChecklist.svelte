<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";

  /**
   * A coordinated revision's Completion Report: every finding the model
   * recorded with the proposal (`chatProposalItems`), with its kind, Line and
   * paragraph, status and reason. DW-135's "Nothing to apply" card lists it inline; since Phase A
   * (2026-10-19, CAP-13) a bulk suggestion card shows it too, behind a
   * disclosure, so the reply no longer retypes the checklist.
   */
  interface Props {
    proposalId: Id<"chatProposals">;
    /** "inline" lists the findings; "disclosure" folds them under a count. */
    variant?: "inline" | "disclosure";
  }

  let { proposalId, variant = "inline" }: Props = $props();

  const itemsQ = useQuery(api.chatV2.listProposalItems, () => ({ proposalId }));
  const items = $derived((itemsQ.data ?? []) as Doc<"chatProposalItems">[]);

  const STATUS_LABEL: Record<Doc<"chatProposalItems">["status"], string> = {
    resolved: "Resolved",
    blocked: "Blocked",
    conflicting: "Conflicting",
  };

  /**
   * Owner direction 2026-10-21: item ids (r-244-4-2) are internal and never
   * shown; a line says only where the item is ("Line 244, paragraph 4"). The
   * id stays only on `data-checklist-item` for tests.
   */
  /**
   * Where the item is: the stored Line and paragraph, or, for an older row
   * that kept only its id, the Line and paragraph the id names
   * (`r-244-4-2` is Line 244, paragraph 4). Paragraph 0 means unanchored.
   */
  function place(item: Doc<"chatProposalItems">): string | null {
    const fromId = /^[a-z]-(242|244|246)-(\d+)-\d+$/.exec(item.itemId);
    const section = item.section ?? fromId?.[1];
    const paragraph = item.paragraphNumber ?? (fromId && Number(fromId[2]) > 0 ? Number(fromId[2]) : undefined);
    if (section && paragraph) return `Line ${section}, paragraph ${paragraph}`;
    return section ? `Line ${section}` : null;
  }

  const counts = $derived.by(() => {
    const tally = { resolved: 0, blocked: 0, conflicting: 0 };
    for (const item of items) tally[item.status] += 1;
    return (["resolved", "blocked", "conflicting"] as const)
      .filter((status) => tally[status] > 0)
      .map((status) => `${tally[status]} ${STATUS_LABEL[status].toLowerCase()}`)
      .join(", ");
  });
</script>

{#snippet findings()}
  {#if itemsQ.error}
    <p role="alert" class="mt-2 text-xs text-red-600">Couldn't load the findings. Try reloading the page.</p>
  {:else if itemsQ.isLoading}
    <p class="mt-2 text-xs text-ink-muted">Loading findings…</p>
  {:else if items.length === 0}
    <p class="mt-2 text-xs text-ink-muted">No findings were recorded.</p>
  {:else}
    <ul class="mt-2.5 flex flex-col gap-2.5" aria-label="Findings">
      {#each items as item (item._id)}
        {@const where = place(item)}
        <li class="border-l-2 border-line pl-2.5" data-checklist-item={item.itemId}>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {#if where}
              <span class="text-xs font-medium text-ink">{where}</span>
            {/if}
            <span class="rounded-full bg-chrome px-1.5 py-0.5 text-xs font-medium text-ink-secondary">
              {STATUS_LABEL[item.status]}
            </span>
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
{/snippet}

{#if variant === "inline"}
  {@render findings()}
{:else if itemsQ.isLoading || itemsQ.error || items.length > 0}
  <!-- A bulk card with no recorded findings (older rows) shows no report. -->
  <details class="group/report mt-2 rounded-[0.625rem] border border-line bg-white" data-completion-report>
    <summary class="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-[0.625rem] px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-primary-wash focus-visible:bg-primary-wash focus-visible:outline-none motion-reduce:transition-none pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
      <span>Completion Report</span>
      {#if counts}
        <span class="font-normal text-ink-muted">{counts}</span>
      {/if}
      <svg class="ml-auto h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-open/report:rotate-180 motion-reduce:transition-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </summary>
    <div class="max-h-72 overflow-y-auto px-3 pb-2.5">
      {@render findings()}
    </div>
  </details>
{/if}
