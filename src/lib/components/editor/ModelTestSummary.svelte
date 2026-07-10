<!--
  BNH-48: post-selection comparison of the writer's option scores, with the
  models revealed. Renders nothing until at least one option was scored.
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  let { generationId }: { generationId: Id<"generations"> } = $props();

  const summaryQ = useQuery(api.generations.getCandidateScoreSummary, () => ({
    generationId,
  }));
  const summary = $derived(summaryQ.data);
</script>

{#if summary && summary.rows.length > 0}
  <div class="rounded-xl border border-gray-200 bg-white p-5">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-900">Model test — your option scores</h3>
      <span class="text-xs text-gray-400">Models revealed after selection</span>
    </div>
    <div class="mt-3 overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
            <th class="py-1.5 pr-4">Option</th>
            <th class="py-1.5 pr-4">Model</th>
            <th class="py-1.5 pr-4">Your score</th>
            <th class="py-1.5">AI QA score</th>
          </tr>
        </thead>
        <tbody>
          {#each summary.rows as row (row.optionPosition)}
            <tr class="border-b border-gray-50 last:border-0">
              <td class="py-2 pr-4 text-gray-700">
                Option {row.optionPosition}
                {#if row.chosen}
                  <span class="ml-1.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    Chosen
                  </span>
                {/if}
              </td>
              <td class="py-2 pr-4 font-medium text-gray-800">{row.label}</td>
              <td class="py-2 pr-4 font-semibold tabular-nums text-navy">{row.score}/10</td>
              <td class="py-2 tabular-nums text-gray-600">
                {row.qaScore != null ? `${row.qaScore}/100` : "—"}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}
