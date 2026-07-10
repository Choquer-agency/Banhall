<!--
  BNH-16: daily AI spend column chart (inline SVG, no chart library).
  Single measure → single brand hue; gaps between range days are rendered as
  zero-height days so the time axis is honest. Hover shows an exact-value
  tooltip; the summary is exposed to screen readers via aria-label.
-->
<script lang="ts">
  import { cad, cadCompact } from "$lib/currency";

  type DayRow = { day: string; costUsd: number; calls: number };

  let {
    rows,
    startDate,
    endDate,
  }: {
    rows: DayRow[];
    /** yyyy-mm-dd range bounds so empty days still occupy space. */
    startDate: string;
    endDate: string;
  } = $props();

  const W = 960;
  const H = 220;
  const PAD = { top: 12, right: 8, bottom: 24, left: 44 };

  // Fill the full date range so quiet days read as quiet, not missing.
  const days = $derived.by(() => {
    const map = new Map(rows.map((r) => [r.day, r]));
    const out: DayRow[] = [];
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (!(start <= end)) return rows;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push(map.get(key) ?? { day: key, costUsd: 0, calls: 0 });
    }
    // Guard: a wildly long range still renders — the last 120 days of it.
    return out.length > 120 ? out.slice(-120) : out;
  });

  const maxCost = $derived(Math.max(...days.map((d) => d.costUsd), 0.000001));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = $derived(innerW / Math.max(days.length, 1));
  const barW = $derived(Math.max(Math.min(slot - 2, 28), 2));
  const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
  const y = (c: number) => PAD.top + innerH * (1 - c / maxCost);

  // ~4 recessive gridlines on friendly steps.
  const ticks = $derived.by(() => {
    const raw = maxCost / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    const out: number[] = [];
    for (let t = step; t <= maxCost; t += step) out.push(t);
    return out;
  });

  // Date labels: first day, ~every 7th, last day.
  const labelEvery = $derived(Math.max(1, Math.ceil(days.length / 8)));
  const shortDay = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

  let hover = $state<number | null>(null);
  let svgEl: SVGSVGElement | null = $state(null);

  function onMove(e: MouseEvent) {
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - PAD.left) / slot);
    hover = i >= 0 && i < days.length ? i : null;
  }

  const total = $derived(days.reduce((n, d) => n + d.costUsd, 0));
</script>

<div class="relative">
  <svg
    bind:this={svgEl}
    viewBox={`0 0 ${W} ${H}`}
    class="block w-full"
    role="img"
    aria-label={`Daily AI spend, ${shortDay(days[0]?.day ?? startDate)} to ${shortDay(days[days.length - 1]?.day ?? endDate)}: ${cad(total)} total.`}
    onmousemove={onMove}
    onmouseleave={() => (hover = null)}
  >
    <!-- Recessive gridlines + axis labels -->
    {#each ticks as t (t)}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} class="stroke-gray-100" stroke-width="1" />
      <text
        x={PAD.left - 6}
        y={y(t) + 3}
        text-anchor="end"
        class="fill-gray-400 font-mono"
        font-size="10"
        style="font-variant-numeric: tabular-nums"
      >
        {cadCompact(t)}
      </text>
    {/each}
    <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} class="stroke-gray-200" stroke-width="1" />

    <!-- Columns -->
    {#each days as d, i (d.day)}
      {@const h = Math.max(innerH * (d.costUsd / maxCost), d.costUsd > 0 ? 2 : 0)}
      <!-- Full-height hit target so thin bars stay hoverable -->
      <rect
        x={PAD.left + i * slot}
        y={PAD.top}
        width={slot}
        height={innerH}
        fill="transparent"
      />
      {#if d.costUsd > 0}
        <path
          d={`M ${x(i)} ${PAD.top + innerH}
              L ${x(i)} ${PAD.top + innerH - h + 4}
              Q ${x(i)} ${PAD.top + innerH - h} ${x(i) + 4} ${PAD.top + innerH - h}
              L ${x(i) + barW - 4} ${PAD.top + innerH - h}
              Q ${x(i) + barW} ${PAD.top + innerH - h} ${x(i) + barW} ${PAD.top + innerH - h + 4}
              L ${x(i) + barW} ${PAD.top + innerH} Z`}
          fill={hover === i ? "var(--color-navy)" : "var(--color-primary-dark)"}
        />
      {/if}
      {#if i % labelEvery === 0 || i === days.length - 1}
        <text
          x={PAD.left + i * slot + slot / 2}
          y={H - 8}
          text-anchor="middle"
          class="fill-gray-400"
          font-size="10"
        >
          {shortDay(d.day)}
        </text>
      {/if}
    {/each}

    <!-- Hover crosshair -->
    {#if hover !== null}
      <line
        x1={PAD.left + hover * slot + slot / 2}
        x2={PAD.left + hover * slot + slot / 2}
        y1={PAD.top}
        y2={PAD.top + innerH}
        class="stroke-gray-300"
        stroke-width="1"
        stroke-dasharray="3 3"
      />
    {/if}
  </svg>

  {#if hover !== null}
    {@const d = days[hover]}
    <div
      class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 shadow-md"
      style={`left: ${((PAD.left + hover * slot + slot / 2) / W) * 100}%; top: 0;`}
    >
      <p class="whitespace-nowrap text-xs font-medium text-gray-800">{shortDay(d.day)}</p>
      <p class="whitespace-nowrap font-mono text-xs text-gray-600" style="font-variant-numeric: tabular-nums">
        {cad(d.costUsd)} · {d.calls.toLocaleString()} call{d.calls === 1 ? "" : "s"}
      </p>
    </div>
  {/if}
</div>
