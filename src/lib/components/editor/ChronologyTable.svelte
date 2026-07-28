<!--
  Port of src/components/editor/ChronologyTable.tsx (the `ChronologyPanel`
  component): collapsible panel rendering the generation pipeline's chronology
  table (experimental vs supporting activities) parsed from `agentOutputs`.
  Renders nothing when there is no chronology.
-->
<script lang="ts">
  interface ChronologyEntry {
    phase: string;
    description: string;
    uncertaintyAddressed: string;
    activityType: "experimental" | "supporting";
    estimatedHours?: string;
  }

  interface ChronologyTableData {
    entries: ChronologyEntry[];
  }

  let { agentOutputs }: { agentOutputs?: string | null } = $props();

  let isOpen = $state(false);

  /**
   * The chronology agent returns tool output that is trusted as-is, so a model
   * can hand back an off-spec shape — one report has `entries` as a JSON
   * *string* wrapping another `{entries:[...]}`. Unwrap that, and treat
   * anything that still isn't an array of objects as absent: an advisory panel
   * must never take the report page down with it.
   */
  function readEntries(value: unknown, depth = 0): ChronologyEntry[] | null {
    if (typeof value === "string" && depth < 3) {
      try {
        return readEntries(JSON.parse(value), depth + 1);
      } catch {
        return null;
      }
    }
    if (Array.isArray(value)) {
      const entries = value.filter(
        (entry): entry is ChronologyEntry => !!entry && typeof entry === "object"
      );
      return entries.length ? entries : null;
    }
    if (value && typeof value === "object" && "entries" in value) {
      return readEntries((value as { entries: unknown }).entries, depth + 1);
    }
    return null;
  }

  const chronology = $derived.by((): ChronologyTableData | null => {
    if (!agentOutputs) return null;
    try {
      const entries = readEntries(JSON.parse(agentOutputs).chronology);
      return entries ? { entries } : null;
    } catch {
      return null;
    }
  });

  const experimental = $derived(
    chronology?.entries.filter((e) => e.activityType === "experimental") ?? []
  );
  const supporting = $derived(
    chronology?.entries.filter((e) => e.activityType === "supporting") ?? []
  );

</script>

{#if chronology && chronology.entries.length > 0}
  <div class="card">
    <button
      type="button"
      onclick={() => (isOpen = !isOpen)}
      class="flex w-full items-center justify-between rounded-xl px-5 py-3 text-left transition-colors hover:bg-primary-wash"
    >
      <div class="flex items-center gap-3">
        <div class="flex h-8 w-8 items-center justify-center rounded-full bg-navy/10 text-navy">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <div>
          <span class="text-sm font-medium text-gray-900">Chronology Table</span>
          <span class="ml-2 text-xs text-gray-400">
            {experimental.length} experimental, {supporting.length} supporting
          </span>
        </div>
      </div>
      <svg
        class={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    {#if isOpen}
      <div class="border-t border-gray-100 px-5 py-4">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200">
                <th class="text-label pb-2 pr-4 text-left">Phase</th>
                <th class="text-label pb-2 pr-4 text-left">Description</th>
                <th class="text-label pb-2 pr-4 text-left">Uncertainty Addressed</th>
                <th class="text-label pb-2 pr-4 text-left">Type</th>
                <th class="text-label pb-2 text-left">Hours</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {#each chronology.entries as entry, i (i)}
                <tr class="group">
                  <td class="whitespace-nowrap py-2.5 pr-4 align-top font-medium text-gray-900">
                    {entry.phase}
                  </td>
                  <td class="py-2.5 pr-4 align-top text-gray-600">
                    {entry.description}
                  </td>
                  <td class="py-2.5 pr-4 align-top text-xs text-gray-500">
                    {entry.uncertaintyAddressed}
                  </td>
                  <td class="whitespace-nowrap py-2.5 pr-4 align-top">
                    <span
                      class={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        entry.activityType === "experimental"
                          ? "bg-primary/10 text-navy"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {entry.activityType === "experimental" ? "Experimental" : "Supporting"}
                    </span>
                  </td>
                  <td class="py-2.5 align-top text-xs text-gray-400">
                    {entry.estimatedHours ?? "—"}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
{/if}
