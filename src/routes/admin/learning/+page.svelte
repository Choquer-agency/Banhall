<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useQuery } from "convex-svelte";
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { api } from "../../../../convex/_generated/api";

  const DAY = 86_400_000;
  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => auth.isAuthenticated ? {} : "skip");
  const allowed = $derived(!auth.isLoading && auth.isAuthenticated && !userQ.error && !userQ.isStale && userQ.data?.role === "admin" && userQ.data.isAnonymous !== true);
  let days = $state<30 | 90>(30);
  let end = $state(Date.now());
  const start = $derived(end - days * DAY);
  const healthQ = useQuery(api.learningHealth.getHealth, () => allowed ? { start, end } : "skip");
  // Never display a cached response under a newly selected window label.
  const health = $derived(
    allowed && !healthQ.error && !healthQ.isStale && healthQ.data?.window.start === start && healthQ.data.window.end === end
      ? healthQ.data : undefined
  );
  function refresh() { end = Math.max(Date.now(), end + 1); }
  function selectRange(value: 30 | 90) { days = value; refresh(); }
  const date = (value: number) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const timestamp = (value: number) => `${new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC`;
  const percent = (value: number | null) => value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
  const score = (value: number | null, scale: number) => value === null ? "Unavailable" : `${value.toFixed(1)} / ${scale}`;
  const loadedRange = (selection: { firstLoadedAt: number | null; lastLoadedAt: number | null }) =>
    selection.firstLoadedAt === null || selection.lastLoadedAt === null
      ? "No records loaded."
      : `Loaded timestamps: ${timestamp(selection.firstLoadedAt)} to ${timestamp(selection.lastLoadedAt)}.`;
  const x = (day: number) => 8 + ((Math.max(day, start) - start) / (end - start)) * 584;
  const y = (value: number) => 128 - value * 116;

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) void goto(resolve("/login"), { replaceState: true });
  });
</script>

<svelte:head><title>Learning health · Banhall</title></svelte:head>

{#if auth.isLoading || (auth.isAuthenticated && !userQ.error && (userQ.data === undefined || userQ.isStale))}
  <div class="p-6 text-body" role="status">Checking administrator access…</div>
{:else if userQ.error}
  <div class="space-y-3 p-6">
    <p class="text-body" role="alert">Administrator access could not be checked.</p>
    <Button class="min-h-11" variant="secondary" onclick={() => window.location.reload()}>Try again</Button>
  </div>
{:else if !allowed}
  <div class="space-y-3 p-6">
    <p class="text-body">Learning health is available to administrators only.</p>
    <Button class="min-h-11" variant="secondary" href={resolve("/dashboard")}>Back to dashboard</Button>
  </div>
{:else}
  <AdminWorkspacePage title="Learning health" description="Recorded editing effort, Brain source use, and retrieval reliability.">
    <div class="space-y-8" data-learning-health>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-1 rounded-lg bg-chrome p-1" role="group" aria-label="Learning health time range">
          {#each [30, 90] as range}
            <Button class="min-h-11" variant={days === range ? "primary" : "ghost"} aria-pressed={days === range} onclick={() => selectRange(range === 30 ? 30 : 90)}>{range} days</Button>
          {/each}
        </div>
        <Button class="min-h-11" variant="secondary" onclick={refresh}>Refresh</Button>
      </div>
      <p class="text-body" data-window>Window: {timestamp(start)} to {timestamp(end)}. Refresh updates the end time.</p>

      {#if healthQ.error}
        <div class="card space-y-3 p-6" role="alert">
          <p class="text-title font-medium">Learning health could not be loaded.</p>
          <p class="text-body">Refresh to try the selected window again.</p>
        </div>
      {:else if !health}
        <div class="card p-6 text-body" role="status">Loading learning health for {days} days…</div>
      {:else}
        {#if health.coverage.partial}
          <div class="rounded-lg border border-line bg-chrome p-4 text-body" role="status">
            Partial results: one or more query limits were reached. Counts and averages describe only the loaded evidence.
            <details class="mt-2"><summary class="font-medium">Query limits and affected evidence</summary>
              <p class="mt-2 break-words">{health.coverage.truncated.join(", ")}</p>
              <p class="mt-2">Limits: {health.coverage.limits.ped} PED readings, {health.coverage.limits.generations} generations, {health.coverage.limits.outcomes} outcomes, {health.coverage.limits.join} records per join, {health.coverage.limits.joinBudget} records per joined evidence type overall, and {health.coverage.limits.passages} passages.</p>
              <p class="mt-2">Conservative read budget: {health.coverage.byteBudget.estimatedBytesRead.toLocaleString()} estimated budget consumed of {health.coverage.byteBudget.limit.toLocaleString()} bytes, including the authorization allowance; {health.coverage.byteBudget.reservedDocumentBytes.toLocaleString()} bytes reserved before each document read.{health.coverage.byteBudget.exhausted ? " The budget was reached." : ""}</p>
            </details>
          </div>
        {/if}

        <div class="grid items-start gap-6 xl:grid-cols-2">
          <section class="card min-w-0 p-5" aria-labelledby="ped-title">
            <h2 id="ped-title" class="text-title font-medium">Post-edit distance</h2>
            <p class="mt-2 text-body">Change from the generated draft at recorded milestones. Lower means fewer word changes, not necessarily better quality.</p>
            <p class="mt-5 text-display font-medium" data-ped-mean>{percent(health.ped.mean)}</p>
            <p class="mt-1 text-body">Mean of {health.ped.samples} readings across {health.ped.reports} reports.</p>
            <p class="mt-3 text-body" data-ped-selection>Readings load oldest first. {loadedRange(health.ped.selection)}{!health.ped.selection.complete ? " Only the loaded portion is shown; later evidence may be omitted." : ""}</p>
            {#if health.ped.daily.length}
              <div class="relative mt-5 pl-10">
                <div class="absolute inset-y-0 left-0 flex flex-col justify-between py-2 text-data text-primary-dark" data-ped-scale aria-hidden="true"><span>100%</span><span>0%</span></div>
              <svg class="h-36 w-full text-primary-dark" viewBox="0 0 600 140" preserveAspectRatio="none" role="img" aria-labelledby="ped-chart-title ped-chart-desc">
                <title id="ped-chart-title">Daily mean post-edit distance</title>
                <desc id="ped-chart-desc">Zero percent at the bottom, 100 percent at the top. Days without loaded readings have no points or connecting lines. {health.ped.partial ? "This chart is partial; omitted readings and days beyond the loaded range are unknown." : "Unmeasured days remain empty."} Exact readings are in the daily means table below.</desc>
                <line x1="8" x2="592" y1="12" y2="12" class="stroke-line" />
                <line x1="8" x2="592" y1="128" y2="128" class="stroke-line" />
                {#each health.ped.daily as point, index (point.day)}
                  {@const previous = health.ped.daily[index - 1]}
                  {#if previous && point.day - previous.day === DAY}
                    <line x1={x(previous.day)} y1={y(previous.mean)} x2={x(point.day)} y2={y(point.mean)} stroke="currentColor" stroke-width="2" />
                  {/if}
                  <circle cx={x(point.day)} cy={y(point.mean)} r="3" fill="currentColor"><title>{date(point.day)}: {percent(point.mean)}, {point.samples} readings</title></circle>
                {/each}
              </svg>
              </div>
              <div class="flex justify-between gap-3 text-data text-ink-muted"><span>{date(start)}</span><span>{date(end)}</span></div>
              <details class="mt-4 text-body"><summary class="font-medium">Daily means and sample counts</summary>
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <div class="mt-3 max-h-64 overflow-auto" role="region" aria-label="Daily PED readings" tabindex="0"><table class="w-full text-left">
                  <caption class="sr-only">Recorded daily PED means in UTC</caption>
                  <thead><tr class="border-b border-line"><th class="py-2 font-medium">Day (UTC)</th><th class="py-2 font-medium">Mean PED</th><th class="py-2 font-medium">Readings</th></tr></thead>
                  <tbody>{#each health.ped.daily as point (point.day)}<tr class="border-b border-line-soft text-data"><td class="py-2">{date(point.day)}</td><td>{percent(point.mean)}</td><td>{point.samples}</td></tr>{/each}</tbody>
                </table></div>
              </details>
            {:else}
              <p class="mt-5 text-body">{health.ped.partial ? "No PED readings loaded. Readings may exist beyond the query limits." : "No PED readings recorded in this window. Historical reports without readings are unavailable."}</p>
            {/if}
            <p class="mt-4 text-body">Daily means use loaded samples only. {health.ped.partial ? "Partial PED evidence: omitted readings and days beyond the loaded range are unknown, not confirmed unmeasured days." : "Unmeasured days remain empty."} {health.ped.missingWriterSamples} readings have no recorded accountable writer.</p>
          </section>

          <section class="card min-w-0 p-5" aria-labelledby="rerank-title">
            <h2 id="rerank-title" class="text-title font-medium">Rerank fallback rate</h2>
            <p class="mt-2 text-body">Failed rerank attempts that returned vector-order results, divided by completed measured attempts.</p>
            <p class="mt-5 text-display font-medium" data-rerank-rate>{percent(health.rerank.rate)}</p>
            <p class="mt-1 text-body">{health.rerank.fallbacks} fallbacks / {health.rerank.attempts} measured attempts.</p>
            <dl class="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-body">
              <dt>Successful attempts</dt><dd class="text-data">{health.rerank.successes}</dd>
              <dt>Deliberate skips</dt><dd class="text-data">{health.rerank.skips}</dd>
              <dt>Search failures</dt><dd class="text-data">{health.rerank.searchErrors}</dd>
              <dt>Recorded outcomes</dt><dd class="text-data">{health.rerank.observations}</dd>
            </dl>
            <p class="mt-4 text-body">Skips and search failures are excluded. Each attempt is counted once after existing retries. Billing metadata does not determine these outcomes.</p>
            <p class="mt-4 text-body" data-rerank-selection>Outcomes load oldest first. {loadedRange(health.rerank.selection)}{!health.rerank.selection.complete ? " Only the loaded portion is shown; later evidence may be omitted." : ""}</p>
            {#if health.rerank.observations === 0}
              <p class="mt-4 text-body">{health.rerank.partial ? "No outcomes loaded. Outcomes may exist beyond the query limits." : "No recorded outcomes in this window. The rate is unavailable without measured attempts."}</p>
            {/if}
            <p class="mt-4 text-body">{health.rerank.earliestRecordedAtIncomplete ? "Earliest observation not loaded because the read budget was reached." : health.rerank.earliestRecordedAt === null ? "No prospective observations recorded yet." : `Earliest recorded observation: ${timestamp(health.rerank.earliestRecordedAt)}.`} Pre-instrumentation history is unavailable.</p>
            <p class="mt-2 text-body">Recording is best-effort and can have gaps. Observation dates do not establish continuous coverage or the deployment date; unknown and in-progress outcomes are not completed samples.</p>
          </section>
        </div>

        <section class="card min-w-0 overflow-hidden" aria-labelledby="sources-title">
          <div class="p-5">
            <h2 id="sources-title" class="text-title font-medium">Brain source use and writer judgments</h2>
            <p class="mt-2 text-body">{health.sources.generations} generations started in this window. Each source counts once per generation; passages count every recorded appearance.</p>
            <p class="mt-2 text-body" data-source-selection>Generations load oldest first. {loadedRange(health.sources.selection)}{!health.sources.selection.complete ? " Only the loaded portion is shown; later evidence may be omitted." : ""}</p>
            <p class="mt-2 text-body">Judgments are the currently available scores for associated generations and reports, regardless of when the judgments were made. Later reviews or edits can change these values for the same window. They do not measure a source's causal effect. Candidate scores retain their 1–10 scale; report reviews retain their 0–100 scale.</p>
            <p class="mt-2 text-body">Candidate scores and linked reports load oldest-created first within each generation; reviews load oldest-created first within each report. The per-join and shared query limits can omit later-created judgments.</p>
          </div>
          {#if health.sources.rows.length}
            <!-- Keyboard focus lets users scroll the wide data table without moving the document. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="overflow-x-auto" role="region" aria-label="Brain source usage table" tabindex="0">
              <table class="w-full min-w-[42rem] text-left">
                <caption class="sr-only">Brain sources associated with generation and report judgments</caption>
                <thead class="border-y border-line bg-chrome text-label"><tr><th class="px-5 py-3 font-medium">Source</th><th class="px-4 py-3 font-medium">Loaded generations</th><th class="px-4 py-3 font-medium">Loaded passages</th><th class="px-4 py-3 font-medium">Candidate score</th><th class="px-4 py-3 font-medium">Report review</th></tr></thead>
                <tbody>{#each health.sources.rows as source (source.identity)}
                  <tr class="border-b border-line-soft">
                    <th scope="row" class="max-w-xs px-5 py-4 font-normal"><span class="break-all text-body font-medium">{source.title}</span><span class="mt-1 block break-all text-data text-ink-muted">{source.identity}</span>{#if !source.sourceAvailable}<span class="mt-1 block text-xs text-ink-muted">{source.sourceMetadataIncomplete ? "Source details not loaded" : source.identityKind === "source" ? "Source record unavailable" : source.identityKind === "entry" ? "Source ID unrecorded; historical entry identity available" : "No source or entry identity recorded"}</span>{/if}{#if source.identityKind === "unattributed"}<span class="mt-1 block text-xs text-ink-muted">Scores are generation-associated evidence with no identified source.</span>{/if}</th>
                    <td class="px-4 py-4 text-data">{source.generations}</td><td class="px-4 py-4 text-data">{source.passages}</td>
                    <td class="px-4 py-4"><span class="whitespace-nowrap text-data">{source.candidateIncomplete && source.candidateSamples === 0 ? "Not loaded" : score(source.candidateMean, 10)}</span><span class="mt-1 block text-xs text-ink-muted">{source.candidateSamples} loaded scores{source.candidateIncomplete ? " · Incomplete evidence" : ""}</span></td>
                    <td class="px-4 py-4"><span class="whitespace-nowrap text-data">{source.reviewIncomplete && source.reviewSamples === 0 ? "Not loaded" : score(source.reviewMean, 100)}</span><span class="mt-1 block text-xs text-ink-muted">{source.reviewSamples} loaded reviews{source.reviewIncomplete ? " · Incomplete evidence" : ""}</span></td>
                  </tr>
                {/each}</tbody>
              </table>
            </div>
          {:else}
            <p class="px-5 pb-5 text-body">{health.sources.partial ? "No attributable source use loaded. Source use may exist beyond the query limits." : "No attributable source use recorded in this window. Missing provenance does not establish that the Brain was unused."}</p>
          {/if}
          <div class="space-y-2 p-5 text-body">
            <p>{health.sources.missingProvenanceGenerations} generations lack provenance; {health.sources.emptyProvenanceGenerations} have an explicitly empty provenance list. {health.sources.missingSourceIdPassages} passages lack a source ID, including {health.sources.unattributedPassages} without a usable entry identity.</p>
            <p>{health.sources.missingReportGenerations} generations with loaded source passages have no linked report. {health.sources.excludedVersionReviews} reviews were excluded for report-version mismatch; {health.sources.legacyVersionReviews} linked reviews lack a version. Historical version linkage may be incomplete.</p>
            <p>Missing judgments are unavailable, never zero. Repeated titles do not merge different source identities.</p>
          </div>
        </section>
      {/if}
    </div>
  </AdminWorkspacePage>
{/if}
