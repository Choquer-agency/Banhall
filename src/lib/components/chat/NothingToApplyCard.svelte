<script lang="ts">
  import type { Id } from "../../../../convex/_generated/dataModel";
  import ProposalChecklist from "./ProposalChecklist.svelte";

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

    <ProposalChecklist {proposalId} />
  </div>
</section>
