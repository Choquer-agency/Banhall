<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import DailySpendChart from "$lib/components/admin/DailySpendChart.svelte";
  import SpendBars from "$lib/components/admin/SpendBars.svelte";
  import DateRangePicker from "$lib/components/ui/DateRangePicker.svelte";
  import { cad, USD_TO_CAD } from "$lib/currency";
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useStableQuery } from "$lib/stableQuery.svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../convex/_generated/api";

  // BNH-16: admin-only AI token & cost usage report.

  const auth = useAuth();
  const accessQ = useQuery(api.aiUsage.usageReportAccess, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  // Date-range filter (yyyy-mm-dd strings; null bound = open). Defaults to
  // all time.
  const iso = (d: Date) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  let startDate = $state<string | null>(null);
  let endDate = $state<string | null>(null);

  const PRESETS: { label: string; days: number | null }[] = [
    { label: "All time", days: null },
    { label: "7d", days: 6 },
    { label: "30d", days: 29 },
    { label: "90d", days: 89 },
  ];
  function applyPreset(days: number | null) {
    if (days === null) {
      startDate = null;
      endDate = null;
    } else {
      startDate = iso(daysAgo(days));
      endDate = iso(new Date());
    }
  }
  const activePreset = $derived(
    PRESETS.find((p) =>
      p.days === null
        ? startDate === null && endDate === null
        : startDate === iso(daysAgo(p.days)) && endDate === iso(new Date())
    )?.label ?? null
  );

  const dataQ = useStableQuery(api.aiUsage.usageReport, () =>
    auth.isAuthenticated && accessQ.data === true
      ? {
          ...(startDate
            ? { start: new Date(`${startDate}T00:00:00`).getTime() }
            : {}),
          ...(endDate
            ? { end: new Date(`${endDate}T23:59:59.999`).getTime() }
            : {}),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }
      : "skip"
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    } else if (accessQ.data === false) {
      goto("/dashboard", { replaceState: true });
    }
  });

  const data = $derived(dataQ.data);
  const refreshing = $derived(dataQ.isRefreshing);
  const num = (n: number) => n.toLocaleString();
  const compactNum = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

  // Cache hit rate: share of all input-side tokens served from cache.
  const cacheHitRate = $derived.by(() => {
    if (!data) return null;
    const { inputTokens, cacheCreationInputTokens, cacheReadInputTokens } = data.totals;
    const inputSide = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
    return inputSide > 0 ? cacheReadInputTokens / inputSide : null;
  });
  const totalTokens = $derived(
    data
      ? data.totals.inputTokens +
          data.totals.cacheCreationInputTokens +
          data.totals.cacheReadInputTokens +
          data.totals.outputTokens
      : 0
  );

  const TABLES: { key: "byProject" | "byWriter"; title: string; col: string }[] = [
    { key: "byProject", title: "Spend by project", col: "Project" },
    { key: "byWriter", title: "Spend by writer", col: "Writer" },
  ];
</script>

{#if auth.isLoading || !auth.isAuthenticated || accessQ.data !== true || data === undefined || data === null}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "AI usage & cost" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] px-6 pt-12 pb-10">
      <div>
        <h1 class="text-display">AI usage &amp; cost</h1>
        <p class="mt-1 text-sm text-gray-500">
          Token consumption and estimated spend across all AI calls.
          Amounts in CAD, converted from USD billing at {USD_TO_CAD.toFixed(2)}.
        </p>
      </div>

      <!-- Filter row: preset tabs left, custom range picker right -->
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-1 rounded-lg bg-chrome p-0.5" role="radiogroup" aria-label="Date range preset">
          {#each PRESETS as p (p.label)}
            <button
              type="button"
              role="radio"
              aria-checked={activePreset === p.label}
              onclick={() => applyPreset(p.days)}
              class={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                activePreset === p.label
                  ? "bg-primary-selected font-semibold text-white"
                  : "text-gray-500 hover:bg-primary-wash hover:text-navy"
              }`}
            >
              {p.label}
            </button>
          {/each}
        </div>
        <DateRangePicker bind:start={startDate} bind:end={endDate} placeholder="Custom range" />
      </div>

      <!-- Previous range stays visible, softly dimmed, while the new one loads -->
      <div class={`transition-opacity duration-200 motion-reduce:transition-none ${refreshing ? "opacity-60" : ""}`}>
      <!-- Totals -->
      <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="card p-4">
          <p class="text-label">Estimated spend</p>
          <p class="mt-1 text-2xl font-bold tabular-nums text-navy">{cad(data.totals.costUsd)}</p>
          <p class="mt-0.5 text-xs text-gray-400">CAD · {num(data.totals.calls)} calls</p>
        </div>
        <div class="card p-4">
          <p class="text-label">Tokens processed</p>
          <p class="mt-1 text-2xl font-bold tabular-nums text-navy">{compactNum(totalTokens)}</p>
          <p class="mt-0.5 text-xs text-gray-400">
            {compactNum(data.totals.inputTokens)} in · {compactNum(data.totals.outputTokens)} out
          </p>
        </div>
        <div class="card p-4">
          <p class="text-label">Cache hit rate</p>
          <p class="mt-1 text-2xl font-bold tabular-nums text-navy">
            {cacheHitRate === null ? "—" : `${Math.round(cacheHitRate * 100)}%`}
          </p>
          <p class="mt-0.5 text-xs text-gray-400">
            {compactNum(data.totals.cacheReadInputTokens)} read · {compactNum(data.totals.cacheCreationInputTokens)} written
          </p>
        </div>
        <div class="card p-4">
          <p class="text-label">Avg cost / call</p>
          <p class="mt-1 text-2xl font-bold tabular-nums text-navy">
            {data.totals.calls > 0 ? cad(data.totals.costUsd / data.totals.calls) : "—"}
          </p>
          <p class="mt-0.5 text-xs text-gray-400">across {num(data.totals.calls)} calls</p>
        </div>
      </div>

      {#if data.totals.calls === 0}
        <div class="card mt-6 flex flex-col items-center gap-1 py-14 text-center">
          <p class="text-sm font-medium text-gray-600">No AI usage recorded in this range.</p>
          <p class="text-xs text-gray-400">Widen the date range or run a generation.</p>
        </div>
      {:else}
        <!-- Spend over time -->
        <div class="card mt-6 p-5">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="text-sm font-medium text-gray-900">Daily spend</h2>
            <span class="text-xs text-gray-400">CAD, by day</span>
          </div>
          <div class="mt-4">
            <DailySpendChart
              rows={data.byDay}
              startDate={startDate ?? data.byDay[0]?.day ?? iso(new Date())}
              endDate={endDate ?? data.byDay[data.byDay.length - 1]?.day ?? iso(new Date())}
            />
          </div>
        </div>

        <!-- Breakdowns -->
        <div class="mt-4 grid items-start gap-4 md:grid-cols-2">
          <SpendBars title="Spend by model" rows={data.byModel} />
          <SpendBars title="Spend by feature" rows={data.byCallSite} />
        </div>

        <!-- Detail tables -->
        {#each TABLES as t (t.key)}
          {@const rows = data[t.key]}
          {#if rows.length > 0}
            <h2 class="text-title mt-8">{t.title}</h2>
            <div class="card mt-3 overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-label border-b border-gray-100 text-left">
                      <th class="px-4 py-2.5 font-medium">{t.col}</th>
                      <th class="px-4 py-2.5 text-right font-medium">Calls</th>
                      <th class="px-4 py-2.5 text-right font-medium">Input</th>
                      <th class="px-4 py-2.5 text-right font-medium">Cache write</th>
                      <th class="px-4 py-2.5 text-right font-medium">Cache read</th>
                      <th class="px-4 py-2.5 text-right font-medium">Output</th>
                      <th class="px-4 py-2.5 text-right font-medium">Est. cost (CAD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each rows as r (r.key)}
                      <tr class="border-b border-gray-50 last:border-0">
                        <td class="max-w-[18rem] truncate px-4 py-2.5 text-gray-800">{r.label}</td>
                        <td class="px-4 py-2.5 text-right text-data text-gray-500">{num(r.calls)}</td>
                        <td class="px-4 py-2.5 text-right text-data text-gray-500">{num(r.inputTokens)}</td>
                        <td class="px-4 py-2.5 text-right text-data text-gray-500">{num(r.cacheCreationInputTokens)}</td>
                        <td class="px-4 py-2.5 text-right text-data text-gray-500">{num(r.cacheReadInputTokens)}</td>
                        <td class="px-4 py-2.5 text-right text-data text-gray-500">{num(r.outputTokens)}</td>
                        <td class="px-4 py-2.5 text-right text-data font-semibold text-navy">{cad(r.costUsd)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        {/each}
      {/if}
      </div>
    </main>
  </div>
{/if}
