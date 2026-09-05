<script lang="ts">
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import { resolve } from "$app/paths";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import { goto } from "$app/navigation";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import type { FunctionReturnType } from "convex/server";

  type DigestHistory = FunctionReturnType<typeof api.learning.getDigestHistory>;
  type Admission = DigestHistory["digests"][number]["admission"];
  type LatestAttempt = DigestHistory["latestAttempt"];

  function streamLabel(stream: string) {
    switch (stream) {
      case "qaItemFeedback": return "QA feedback";
      case "candidateScores": return "Draft comments";
      case "sectionEditEvents": return "Section edits";
      case "proposalWordingEditEvents": return "Proposal wording edits";
      case "brainFeedbackQueue": return "Approved writer feedback";
      default: return stream;
    }
  }

  function attemptOutcome(outcome: NonNullable<LatestAttempt>["outcome"]) {
    switch (outcome) {
      case "insufficient_inputs": return "Skipped: fewer than five admitted signals.";
      case "unchanged_inputs": return "Skipped: no admitted feedback is newer than the last candidate cutoff.";
      case "unsupported_rules": return "No candidate: no supported rules were produced.";
      case "failed": return "Generation failed. No candidate was saved; published guidance is unchanged.";
      case "saved": return "Candidate saved for administrator review.";
      case "deduplicated": return "No new candidate: this input cutoff was already saved.";
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

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
  // CAP-1: publishing a digest firm-wide needs an explicit human confirmation
  // that it carries no client identifier. Per digest kind; never gates
  // "Disable guidance", which must always stay reachable.
  let privacyReviewed = $state<{ qa_calibration: boolean; draft_style: boolean }>({
    qa_calibration: false,
    draft_style: false,
  });

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
      await selectDigest({
        kind,
        digestId,
        expectedSelectionId,
        reason,
        ...(digestId ? { privacyReviewed: privacyReviewed[kind] } : {}),
      });
      // Confirmation is per publish, never sticky across versions.
      if (digestId) privacyReviewed[kind] = false;
    } catch (error) {
      digestError = error instanceof Error ? error.message : "Learning guidance could not be updated.";
    } finally {
      changingDigest = null;
    }
  }
</script>


{#snippet admissionDetails(admission: Admission)}
  <div class="mt-4 border-t border-line pt-4 text-sm text-ink-muted">
    <p class="text-label">Signal provenance and admission</p>
    {#if admission}
      <p class="mt-2 text-data">{admission.admittedCount} admitted · {admission.excludedCount} excluded</p>
      <p class="mt-1 text-data">Admitted feedback cutoff: {admission.feedbackCutoff === null ? "None" : digestDate(admission.feedbackCutoff)}</p>
      <p class="mt-2">Counts cover recent windows of up to 500 records per stream, with meaningful-signal filters applied before admission. They do not cover all feedback history.</p>
      {#if admission.producers.length > 0}
        <details class="group mt-3">
          <summary class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-primary hover:bg-primary-wash [&::-webkit-details-marker]:hidden">
            <span>Admitted producer contributions ({admission.producers.length})</span>
            <span aria-hidden="true" class="group-open:rotate-180">⌄</span>
          </summary>
          <ul class="mt-1 space-y-1">
            {#each admission.producers as producer (producer.producerId)}
              <li class="break-all text-data">{producer.producerId}: {producer.count} signal(s)</li>
            {/each}
          </ul>
        </details>
      {:else}
        <p class="mt-1">No admitted producers.</p>
      {/if}
      <p class="mt-3">Each stream needs at least two producers and two projects. Missing-attribution reasons can overlap; excluded totals count each record once.</p>
      <div class="mt-3 space-y-4">
        {#each admission.streams as stream (stream.stream)}
          <div class="border-t border-line pt-3">
            <p class="break-all font-medium text-ink">{streamLabel(stream.stream)}</p>
            <p class="mt-1 text-data">{stream.admittedCount} admitted · {stream.excludedCount} excluded · {stream.writerCount} attributed producer(s) · {stream.projectCount} attributed project(s)</p>
            <p class="mt-1 text-data">Missing writer: {stream.missingWriterCount} · Missing project: {stream.missingProjectCount} · Insufficient stream diversity: {stream.insufficientDiversityCount}</p>
            {#if stream.signalIds.length > 0}
              <details class="group mt-2">
                <summary class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-primary hover:bg-primary-wash [&::-webkit-details-marker]:hidden">
                  <span>Admitted signal IDs ({stream.signalIds.length})</span>
                  <span aria-hidden="true" class="group-open:rotate-180">⌄</span>
                </summary>
                <ul class="mt-1 space-y-1">
                  {#each stream.signalIds as signalId (signalId)}
                    <li class="break-all text-data">{signalId}</li>
                  {/each}
                </ul>
              </details>
            {:else}
              <p class="mt-1">No admitted signals in this stream.</p>
            {/if}
            {#if stream.producers.length > 0}
              <details class="group mt-2">
                <summary class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-primary hover:bg-primary-wash [&::-webkit-details-marker]:hidden">
                  <span>Stream producer contributions ({stream.producers.length})</span>
                  <span aria-hidden="true" class="group-open:rotate-180">⌄</span>
                </summary>
                <ul class="mt-1 space-y-1">
                  {#each stream.producers as producer (producer.producerId)}
                    <li class="break-all text-data">{producer.producerId}: {producer.count} signal(s)</li>
                  {/each}
                </ul>
              </details>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <p class="mt-2">Signal provenance and exclusion details are unavailable for this historical version.</p>
    {/if}
  </div>
{/snippet}

{#snippet latestAttemptDetails(attempt: LatestAttempt)}
  {#if attempt}
    <section class="card mt-4 p-5" aria-label="Latest generation attempt">
      <h3 class="text-label">Latest generation attempt</h3>
      <p class="mt-1 text-data text-ink-muted">{digestDate(attempt.attemptedAt)}</p>
      <p class="mt-2 text-sm text-ink">{attemptOutcome(attempt.outcome)}</p>
      {@render admissionDetails(attempt.admission)}
    </section>
  {/if}
{/snippet}

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
      {:else if data.rows.length === 0 && data.itemRows.length === 0 && calibration !== undefined && style !== undefined && calibration.digests.length === 0 && style.digests.length === 0 && !calibration.latestAttempt && !style.latestAttempt}
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
        <section class="mt-10" aria-label="Learned QA calibration">
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

            {@render latestAttemptDetails(calibration.latestAttempt)}

            {#if digestHistory.length > 0}
              <button
                onclick={() => (showCalibrationHistory = !showCalibrationHistory)}
                aria-expanded={showCalibrationHistory}
                class="mt-3 min-h-11 rounded-lg px-2 text-xs text-primary hover:bg-primary-wash hover:underline"
              >
                {showCalibrationHistory ? "Hide" : "Show"} previous versions ({digestHistory.length})
              </button>
              {#if showCalibrationHistory}
                <div class="mt-3 rounded-xl border border-line bg-surface p-4">
                  <Checkbox
                    bind:checked={privacyReviewed.qa_calibration}
                    labelText="I reviewed this version and it contains no client names, project titles, emails, or phone numbers."
                  />
                </div>
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
                            disabled={changingDigest !== null || !privacyReviewed.qa_calibration}
                            title={privacyReviewed.qa_calibration ? undefined : "Confirm the privacy review above first"}
                            class="min-h-11 rounded-lg bg-primary-selected px-3 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                          >Publish this version</button>
                        {/if}
                      </div>
                      <pre class="mt-3 text-sm whitespace-pre-wrap text-gray-600">{digest.content}</pre>
                      {@render admissionDetails(digest.admission)}
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          {/if}
        </section>

        <!-- Learning loop: drafting style learned from candidate scoring -->
        <section class="mt-10" aria-label="Learned drafting style">
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

            {@render latestAttemptDetails(style.latestAttempt)}

            {#if styleHistory.length > 0}
              <button
                onclick={() => (showStyleHistory = !showStyleHistory)}
                aria-expanded={showStyleHistory}
                class="mt-3 min-h-11 rounded-lg px-2 text-xs text-primary hover:bg-primary-wash hover:underline"
              >
                {showStyleHistory ? "Hide" : "Show"} previous versions ({styleHistory.length})
              </button>
              {#if showStyleHistory}
                <div class="mt-3 rounded-xl border border-line bg-surface p-4">
                  <Checkbox
                    bind:checked={privacyReviewed.draft_style}
                    labelText="I reviewed this version and it contains no client names, project titles, emails, or phone numbers."
                  />
                </div>
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
                            disabled={changingDigest !== null || !privacyReviewed.draft_style}
                            title={privacyReviewed.draft_style ? undefined : "Confirm the privacy review above first"}
                            class="min-h-11 rounded-lg bg-primary-selected px-3 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                          >Publish this version</button>
                        {/if}
                      </div>
                      <pre class="mt-3 text-sm whitespace-pre-wrap text-gray-600">{digest.content}</pre>
                      {@render admissionDetails(digest.admission)}
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          {/if}
        </section>

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
