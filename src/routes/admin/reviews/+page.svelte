<script lang="ts">
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import { resolve } from "$app/paths";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { goto } from "$app/navigation";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
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
  const selectDigest = useMutation(api.learning.selectDigest);

  let showCalibrationHistory = $state(false);
  let showStyleHistory = $state(false);
  let changingDigest = $state<string | null>(null);
  let digestError = $state<string | null>(null);

  function digestDate(ms: number) {
    return new Date(ms).toLocaleString("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto(resolve("/login"), { replaceState: true });
    }
  });

  const data = $derived(dataQ.data);
  const calibration = $derived(calibrationQ.data);
  const activeDigest = $derived(
    calibration?.digests.find((digest) => digest._id === calibration.publishedDigestId) ?? null
  );
  const digestHistory = $derived(calibration?.digests ?? []);
  const style = $derived(styleQ.data);
  const activeStyle = $derived(
    style?.digests.find((digest) => digest._id === style.publishedDigestId) ?? null
  );
  const styleHistory = $derived(style?.digests ?? []);

  async function changePublishedDigest(
    kind: "qa_calibration" | "draft_style",
    digestId: Id<"learningDigests"> | null,
    expectedSelectionId: Id<"learningDigestSelections"> | null,
    reason: string
  ) {
    if (changingDigest) return;
    changingDigest = `${kind}:${digestId ?? "disabled"}`;
    digestError = null;
    try {
      await selectDigest({ kind, digestId, expectedSelectionId, reason });
    } catch (error) {
      digestError = error instanceof Error ? error.message : "Learning guidance could not be updated.";
    } finally {
      changingDigest = null;
    }
  }
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <AdminWorkspacePage
    title="Consultant QA reviews"
    description="Human quality scores alongside AI QA scores, for administrator review only."
  >

      {#if data === undefined}
        <div class="flex min-h-[55vh] items-center justify-center">
          <Spinner />
        </div>
      {:else if data === null}
        <p class="mt-8 text-sm text-gray-400">Sign in to view consultant reviews.</p>
      {:else if data.rows.length === 0 && data.itemRows.length === 0 && calibration !== undefined && style !== undefined && calibration.digests.length === 0 && style.digests.length === 0}
        <p class="mt-8 text-sm text-gray-400">No consultant reviews, QA feedback, or learning candidates yet.</p>
      {:else}
        <!-- Summary -->
        <div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="card p-4">
            <p class="text-label">Reviews</p>
            <p class="mt-1 text-2xl font-bold text-navy">{data.total}</p>
          </div>
          <div class="card p-4">
            <p class="text-label">Avg consultant score</p>
            <p class="mt-1 text-2xl font-bold text-navy">{data.avgHuman ?? "—"}</p>
          </div>
          <div class="card p-4">
            <p class="text-label">Avg gap (consultant − AI)</p>
            <p class={`mt-1 text-2xl font-bold ${data.avgGap != null && data.avgGap < 0 ? "text-red-700" : "text-navy"}`}>
              {data.avgGap == null ? "—" : `${data.avgGap > 0 ? "+" : ""}${data.avgGap}`}
            </p>
          </div>
        </div>

        {#if data.rows.length > 0}
        <!-- Report review table -->
        <div class="card mt-6 overflow-hidden">
          <div class="overflow-x-auto">
          <table class="w-full min-w-[46rem] text-sm">
            <thead>
              <tr class="text-label border-b border-gray-100 text-left">
                <th class="px-4 py-2.5 font-medium">Project</th>
                <th class="px-4 py-2.5 font-medium">Consultant</th>
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
        </div>
        {/if}

        <!-- Learning loop: what the QA reviewer currently applies -->
        <div class="mt-10">
          <h2 class="text-xl font-semibold text-navy">Learned QA calibration</h2>
          <p class="mt-1 text-sm text-gray-500">
            Automatic distillation creates candidates only. An administrator must explicitly
            publish a version before it can affect QA; CRA structural checks and scoring rules
            are never changed.
          </p>

          {#if digestError}
            <div class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              {digestError}
            </div>
          {/if}

          {#if calibration === undefined}
            <div class="card mt-4 flex items-center justify-center p-8"><Spinner /></div>
          {:else}
            <div class="card mt-4 p-5">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p class="text-label">Published calibration</p>
                  {#if activeDigest}
                    <p class="mt-1 text-data text-gray-500">
                      {digestDate(activeDigest.createdAt)} · {activeDigest.sourceCount} feedback event(s)
                    </p>
                  {:else}
                    <p class="mt-1 text-sm text-gray-500">
                      {calibration.explicitlyDisabled ? "Disabled by an administrator." : "No version has been published yet."}
                    </p>
                  {/if}
                </div>
                {#if activeDigest}
                  <button
                    onclick={() => changePublishedDigest("qa_calibration", null, calibration.selectionId, "Disabled from the administrator review page")}
                    disabled={changingDigest !== null}
                    class="min-h-11 rounded-lg border border-line px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >Disable guidance</button>
                {/if}
              </div>
              {#if activeDigest}
                <pre class="mt-4 text-sm whitespace-pre-wrap text-gray-700">{activeDigest.content}</pre>
              {/if}
            </div>

            {#if digestHistory.length > 0}
              <button
                onclick={() => (showCalibrationHistory = !showCalibrationHistory)}
                aria-expanded={showCalibrationHistory}
                class="mt-3 min-h-11 rounded-lg px-2 text-xs text-primary hover:bg-primary-wash hover:underline"
              >
                {showCalibrationHistory ? "Hide" : "Show"} previous versions ({digestHistory.length})
              </button>
              {#if showCalibrationHistory}
                <div class="mt-3 space-y-3">
                  {#each digestHistory as digest (digest._id)}
                    <div class={`card p-5 ${digest._id === calibration.publishedDigestId ? "border-primary" : ""}`}>
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p class="text-data text-gray-500">
                            {digestDate(digest.createdAt)} · {digest.sourceCount} feedback event(s)
                          </p>
                          <p class="mt-1 text-xs font-medium text-gray-500">
                            {digest._id === calibration.publishedDigestId ? "Published" : "Candidate"}
                          </p>
                        </div>
                        {#if digest._id !== calibration.publishedDigestId && !digest.isPersonal}
                          <button
                            onclick={() => changePublishedDigest("qa_calibration", digest._id, calibration.selectionId, "Published after administrator review")}
                            disabled={changingDigest !== null}
                            class="min-h-11 rounded-lg bg-primary-selected px-3 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                          >Publish this version</button>
                        {/if}
                      </div>
                      <pre class="mt-3 text-sm whitespace-pre-wrap text-gray-600">{digest.content}</pre>
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
            Recurring critiques become review candidates. Only an administrator-published
            version reaches drafting agents; CRA structure, required phrasing, and terminology
            rules always take precedence.
          </p>

          {#if digestError}
            <div class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              {digestError}
            </div>
          {/if}

          {#if style === undefined}
            <div class="card mt-4 flex items-center justify-center p-8"><Spinner /></div>
          {:else}
            <div class="card mt-4 p-5">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p class="text-label">Published style guidance</p>
                  {#if activeStyle}
                    <p class="mt-1 text-data text-gray-500">
                      {digestDate(activeStyle.createdAt)} · {activeStyle.sourceCount} consultant critique(s)
                    </p>
                  {:else}
                    <p class="mt-1 text-sm text-gray-500">
                      {style.explicitlyDisabled ? "Disabled by an administrator." : "No version has been published yet."}
                    </p>
                  {/if}
                </div>
                {#if activeStyle}
                  <button
                    onclick={() => changePublishedDigest("draft_style", null, style.selectionId, "Disabled from the administrator review page")}
                    disabled={changingDigest !== null}
                    class="min-h-11 rounded-lg border border-line px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >Disable guidance</button>
                {/if}
              </div>
              {#if activeStyle}
                <pre class="mt-4 text-sm whitespace-pre-wrap text-gray-700">{activeStyle.content}</pre>
              {/if}
            </div>

            {#if styleHistory.length > 0}
              <button
                onclick={() => (showStyleHistory = !showStyleHistory)}
                aria-expanded={showStyleHistory}
                class="mt-3 min-h-11 rounded-lg px-2 text-xs text-primary hover:bg-primary-wash hover:underline"
              >
                {showStyleHistory ? "Hide" : "Show"} previous versions ({styleHistory.length})
              </button>
              {#if showStyleHistory}
                <div class="mt-3 space-y-3">
                  {#each styleHistory as digest (digest._id)}
                    <div class={`card p-5 ${digest._id === style.publishedDigestId ? "border-primary" : ""}`}>
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p class="text-data text-gray-500">
                            {digestDate(digest.createdAt)} · {digest.sourceCount} consultant critique(s)
                          </p>
                          <p class="mt-1 text-xs font-medium text-gray-500">
                            {digest._id === style.publishedDigestId ? "Published" : "Candidate"}
                          </p>
                        </div>
                        {#if digest._id !== style.publishedDigestId && !digest.isPersonal}
                          <button
                            onclick={() => changePublishedDigest("draft_style", digest._id, style.selectionId, "Published after administrator review")}
                            disabled={changingDigest !== null}
                            class="min-h-11 rounded-lg bg-primary-selected px-3 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                          >Publish this version</button>
                        {/if}
                      </div>
                      <pre class="mt-3 text-sm whitespace-pre-wrap text-gray-600">{digest.content}</pre>
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
            <p class="mt-1 text-sm text-gray-500">Consultant votes and category corrections for individual QA observations.</p>
          </div>
          <span class="text-data text-gray-500">{data.itemRows.length} items</span>
        </div>
        {#if data.itemRows.length === 0}
          <div class="card mt-4 p-5 text-sm text-gray-400">No QA items have been rated yet.</div>
        {:else}
          <div class="card mt-4 overflow-hidden">
            <div class="overflow-x-auto">
            <table class="w-full min-w-[60rem] text-sm">
              <thead>
                <tr class="text-label border-b border-gray-100 text-left">
                  <th class="px-4 py-2.5 font-medium">Project</th>
                  <th class="px-4 py-2.5 font-medium">Consultant</th>
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
          </div>
        {/if}
      {/if}
  </AdminWorkspacePage>
{/if}
