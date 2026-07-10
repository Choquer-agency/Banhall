<!--
  BNH-16: ranked horizontal spend bars (model / feature breakdowns).
  One measure → one brand hue; every bar direct-labeled with exact CAD value,
  so no legend and no color-decoding required. Tooltip carries the token detail.
-->
<script lang="ts">
  import { cad } from "$lib/currency";

  type Row = {
    key: string;
    label: string;
    costUsd: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  };

  let {
    title,
    rows,
    max = 6,
  }: {
    title: string;
    rows: Row[];
    /** Rows beyond this fold into "Other". */
    max?: number;
  } = $props();

  const shown = $derived.by(() => {
    if (rows.length <= max) return rows;
    const head = rows.slice(0, max - 1);
    const rest = rows.slice(max - 1);
    return [
      ...head,
      rest.reduce(
        (acc, r) => ({
          ...acc,
          costUsd: acc.costUsd + r.costUsd,
          calls: acc.calls + r.calls,
          inputTokens: acc.inputTokens + r.inputTokens,
          outputTokens: acc.outputTokens + r.outputTokens,
        }),
        { key: "other", label: `Other (${rest.length})`, costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 }
      ),
    ];
  });
  const maxCost = $derived(Math.max(...shown.map((r) => r.costUsd), 0.000001));
</script>

<div class="card p-5">
  <h2 class="text-sm font-medium text-gray-900">{title}</h2>
  {#if shown.length === 0}
    <p class="mt-3 text-sm text-gray-400">No usage in this range.</p>
  {:else}
    <ul class="mt-4 flex flex-col gap-3">
      {#each shown as r (r.key)}
        <li
          title={`${r.label}: ${cad(r.costUsd)} · ${r.calls.toLocaleString()} calls · ${r.inputTokens.toLocaleString()} in / ${r.outputTokens.toLocaleString()} out`}
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="min-w-0 truncate text-sm text-gray-700">{r.label}</span>
            <span class="text-data flex-none font-semibold text-navy">{cad(r.costUsd)}</span>
          </div>
          <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-chrome">
            <div
              class="h-full rounded-full bg-primary-dark transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={`width: ${Math.max((r.costUsd / maxCost) * 100, 1)}%`}
            ></div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
