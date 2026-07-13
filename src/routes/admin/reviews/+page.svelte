<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../convex/_generated/api";
  import BuildStamp from "$lib/components/BuildStamp.svelte";

  function scoreColor(n: number) {
    if (n >= 80) return "text-green-700";
    if (n >= 60) return "text-amber-700";
    return "text-red-700";
  }

  const auth = useAuth();

  const dataQ = useQuery(api.reviews.listWriterReviews, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const calibrationQ = useQuery(api.learning.getDigestHistory, () =>
    auth.isAuthenticated ? { kind: "qa_calibration" as const } : "skip"
  );
  const styleQ = useQuery(api.learning.getDigestHistory, () =>
    auth.isAuthenticated ? { kind: "draft_style" as const } : "skip"
  );

  let showCalibrationHistory = $state(false);
  let showStyleHistory = $state(false);

  function digestDate(ms: number) {
    return new Date(ms).toLocaleString("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const data = $derived(dataQ.data);
  const calibration = $derived(calibrationQ.data);
  const activeDigest = $derived(calibration?.[0] ?? null);
  const digestHistory = $derived(calibration?.slice(1) ?? []);
  const style = $derived(styleQ.data);
  const activeStyle = $derived(style?.[0] ?? null);
  const styleHistory = $derived(style?.slice(1) ?? []);
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "Writer QA reviews" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] px-6 pt-12 pb-10">
      <h1 class="text-display">Writer QA reviews</h1>
      <p class="mt-1 text-sm text-gray-500">
        Human quality scores writers gave generated reports, alongside the AI QA
        score. For your review only — never auto-applied to the brain.
      </p>

      {#if data === undefined}
        <div class="flex min-h-[55vh] items-center justify-center">
          <Spinner />
        </div>
      {:else if data === null}
        <p class="mt-8 text-sm text-gray-400">Sign in to view writer reviews.</p>
      {:else if data.rows.length === 0 && data.itemRows.length === 0}
        <p class="mt-8 text-sm text-gray-400">No writer reviews or QA item feedback yet.</p>
      {:else}
        <!-- Summary -->
        <div class="mt-6 grid grid-cols-3 gap-3">
          <div class="card p-4">
            <p class="text-label">Reviews</p>
            <p class="mt-1 text-2xl font-bold text-navy">{data.total}</p>
          </div>
          <div class="card p-4">
            <p class="text-label">Avg writer score</p>
            <p class="mt-1 text-2xl font-bold text-navy">{data.avgHuman ?? "—"}</p>
          </div>
          <div class="card p-4">
            <p class="text-label">Avg gap (writer − AI)</p>
            <p class={`mt-1 text-2xl font-bold ${data.avgGap != null && data.avgGap < 0 ? "text-red-700" : "text-navy"}`}>
              {data.avgGap == null ? "—" : `${data.avgGap > 0 ? "+" : ""}${data.avgGap}`}
            </p>
          </div>
        </div>

        {#if data.rows.length > 0}
        <!-- Report review table -->
        <div class="card mt-6 overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-label border-b border-gray-100 text-left">
                <th class="px-4 py-2.5 font-medium">Project</th>
                <th class="px-4 py-2.5 font-medium">Writer</th>
                <th class="px-4 py-2.5 text-center font-medium">Score</th>
                <th class="px-4 py-2.5 text-center font-medium">AI</th>
                <th class="px-4 py-2.5 font-medium">Comment</th>
              </tr>
            </thead>
            <tbody>
              {#each data.rows as r (r._id)}
                <tr class="border-b border-gray-50 align-top last:border-0">
                  <td class="px-4 py-2.5">
                    <p class="font-medium text-gray-800">{r.projectTitle}</p>
                    <p class="text-xs text-gray-400">
                      {r.clientName}{r.reportVersion != null ? ` · v${r.reportVersion}` : ""}
                    </p>
                  </td>
                  <td class="px-4 py-2.5 text-gray-600">{r.writerName}</td>
                  <td class={`px-4 py-2.5 text-center font-bold ${scoreColor(r.score)}`}>
                    {r.score}
                  </td>
                  <td class={`px-4 py-2.5 text-center font-semibold ${r.aiScore != null ? scoreColor(r.aiScore) : "text-gray-300"}`}>
                    {r.aiScore ?? "—"}
                  </td>
                  <td class="px-4 py-2.5 text-gray-600">
                    {#if r.comment}
                      <span>{r.comment}</span>
                    {:else}
                      <span class="text-gray-300">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {/if}

        <!-- Learning loop: what the QA reviewer currently applies -->
        <div class="mt-10">
          <h2 class="text-xl font-semibold text-navy">Learned QA calibration</h2>
          <p class="mt-1 text-sm text-gray-500">
            Rules distilled from the feedback below and applied to the AI QA reviewer on
            every new generation. Calibration only tunes what gets flagged and its severity;
            CRA structural checks and scoring rules are never changed.
          </p>

          {#if calibration === undefined}
            <div class="card mt-4 flex items-center justify-center p-8"><Spinner /></div>
          {:else if !activeDigest}
            <div class="card mt-4 p-5 text-sm text-gray-400">
              Nothing learned yet. Calibration starts once writers have rated enough QA
              observations (votes or severity changes).
            </div>
          {:else}
            <div class="card mt-4 p-5">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="text-sm font-medium text-gray-800">Active calibration</p>
                <p class="text-xs text-gray-400">
                  {digestDate(activeDigest.createdAt)} · from {activeDigest.sourceCount}
                  feedback event(s)
                </p>
              </div>
              <pre class="mt-3 text-sm whitespace-pre-wrap text-gray-700">{activeDigest.content}</pre>
            </div>

            {#if digestHistory.length > 0}
              <button
                onclick={() => (showCalibrationHistory = !showCalibrationHistory)}
                class="mt-3 text-xs text-primary hover:underline"
              >
                {showCalibrationHistory ? "Hide" : "Show"} previous versions ({digestHistory.length})
              </button>
              {#if showCalibrationHistory}
                <div class="mt-3 space-y-3">
                  {#each digestHistory as digest (digest._id)}
                    <div class="card p-5 opacity-70">
                      <p class="text-xs text-gray-400">
                        {digestDate(digest.createdAt)} · from {digest.sourceCount} feedback event(s)
                      </p>
                      <pre class="mt-2 text-sm whitespace-pre-wrap text-gray-600">{digest.content}</pre>
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          {/if}
        </div>

        <!-- Learning loop: drafting style learned from candidate scoring -->
        <div class="mt-10">
          <h2 class="text-xl font-semibold text-navy">Learned drafting style</h2>
          <p class="mt-1 text-sm text-gray-500">
            Recurring critiques distilled from writers' blind option scores and comments,
            applied to the section drafting agents on every new generation. CRA structure,
            required phrasing, and banned-word rules always take precedence.
          </p>

          {#if style === undefined}
            <div class="card mt-4 flex items-center justify-center p-8"><Spinner /></div>
          {:else if !activeStyle}
            <div class="card mt-4 p-5 text-sm text-gray-400">
              Nothing learned yet. Style guidance starts once writers have left enough
              comments on candidate drafts.
            </div>
          {:else}
            <div class="card mt-4 p-5">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="text-sm font-medium text-gray-800">Active style guidance</p>
                <p class="text-xs text-gray-400">
                  {digestDate(activeStyle.createdAt)} · from {activeStyle.sourceCount}
                  writer critique(s)
                </p>
              </div>
              <pre class="mt-3 text-sm whitespace-pre-wrap text-gray-700">{activeStyle.content}</pre>
            </div>

            {#if styleHistory.length > 0}
              <button
                onclick={() => (showStyleHistory = !showStyleHistory)}
                class="mt-3 text-xs text-primary hover:underline"
              >
                {showStyleHistory ? "Hide" : "Show"} previous versions ({styleHistory.length})
              </button>
              {#if showStyleHistory}
                <div class="mt-3 space-y-3">
                  {#each styleHistory as digest (digest._id)}
                    <div class="card p-5 opacity-70">
                      <p class="text-xs text-gray-400">
                        {digestDate(digest.createdAt)} · from {digest.sourceCount} writer critique(s)
                      </p>
                      <pre class="mt-2 text-sm whitespace-pre-wrap text-gray-600">{digest.content}</pre>
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          {/if}
        </div>

        <!-- Per-item QA feedback for prompt tuning -->
        <div class="mt-10 flex items-end justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold text-navy">QA item feedback</h2>
            <p class="mt-1 text-sm text-gray-500">Writer votes and category corrections for individual QA observations.</p>
          </div>
          <span class="text-data text-gray-500">{data.itemRows.length} items</span>
        </div>
        {#if data.itemRows.length === 0}
          <div class="card mt-4 p-5 text-sm text-gray-400">No QA items have been rated yet.</div>
        {:else}
          <div class="card mt-4 overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-label border-b border-gray-100 text-left">
                  <th class="px-4 py-2.5 font-medium">Project</th>
                  <th class="px-4 py-2.5 font-medium">Writer</th>
                  <th class="px-4 py-2.5 font-medium">Line</th>
                  <th class="px-4 py-2.5 font-medium">QA observation</th>
                  <th class="px-4 py-2.5 font-medium">Category</th>
                  <th class="px-4 py-2.5 text-center font-medium">Vote</th>
                </tr>
              </thead>
              <tbody>
                {#each data.itemRows as item (item._id)}
                  <tr class="border-b border-gray-50 align-top last:border-0">
                    <td class="px-4 py-2.5 font-medium text-gray-800">{item.projectTitle}</td>
                    <td class="px-4 py-2.5 text-gray-600">{item.writerName}</td>
                    <td class="text-data px-4 py-2.5 text-gray-500">{item.section}</td>
                    <td class="max-w-xl px-4 py-2.5 text-gray-700">{item.itemText}</td>
                    <td class="px-4 py-2.5">
                      {#if item.itemKind === "strength"}
                        <span class="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Strength</span>
                      {:else}
                        <span class={`rounded-full px-2 py-0.5 text-xs font-medium ${(item.overrideSeverity ?? item.originalSeverity) === "warning" ? "bg-amber-100 text-amber-700" : "bg-red-50 text-red-700"}`}>
                          {(item.overrideSeverity ?? item.originalSeverity) === "warning" ? "Warning" : "Deduction"}
                        </span>
                        {#if item.overrideSeverity && item.overrideSeverity !== item.originalSeverity}
                          <span class="ml-1 text-xs text-gray-400">changed</span>
                        {/if}
                      {/if}
                    </td>
                    <td class={`px-4 py-2.5 text-center text-lg font-semibold ${item.vote === 1 ? "text-green-700" : item.vote === -1 ? "text-red-700" : "text-gray-300"}`}>
                      {item.vote === 1 ? "↑" : item.vote === -1 ? "↓" : "—"}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/if}
    </main>
  </div>
{/if}
