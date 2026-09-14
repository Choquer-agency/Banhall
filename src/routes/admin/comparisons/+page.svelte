<script lang="ts">
  /**
   * AD-29 (story 6, CAP-16): the Paired Comparison recorder and the SM-1/SM-2
   * readout.
   *
   * Every judgement on this page is typed in by a human. Both drafts are
   * pasted in — the ChatGPT baseline is never generated here (SPEC Non-goals),
   * and the pinned revision's canonical text is never returned to this page, so
   * a match cannot be manufactured by pasting it back.
   *
   * The form is a *judgement*, not a live view. Three things are captured at
   * the moment the human commits to them and never move underneath the form
   * afterwards: the revision pin (so a report edited mid-judgement fails
   * `STALE_REVISION` instead of silently re-pinning to prose nobody read), the
   * comparison the administrator agreed to void, and the identity of the form
   * a pending request belongs to.
   */
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import { resolve } from "$app/paths";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  const auth = useAuth();

  // The picker is paged: a project older than the first page is still
  // reachable, and each page reads a bounded number of comparison rows.
  let pickerCursor = $state<string | null>(null);
  let pickerHistory = $state<Array<string | null>>([]);

  const targetsQ = useQuery(api.comparisons.listRecordTargets, () =>
    auth.isAuthenticated ? { cursor: pickerCursor } : "skip"
  );
  const teamQ = useQuery(api.users.listTeam, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const metricsQ = useQuery(api.comparisons.successMetrics, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  let projectId = $state("");
  const contextQ = useQuery(api.comparisons.getRecordContext, () =>
    auth.isAuthenticated && projectId
      ? { projectId: projectId as Id<"projects"> }
      : "skip"
  );
  const recordsQ = useQuery(api.comparisons.listForProject, () =>
    auth.isAuthenticated && projectId
      ? { projectId: projectId as Id<"projects"> }
      : "skip"
  );

  const record = useMutation(api.comparisons.record);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto(resolve("/login"), { replaceState: true });
    }
  });

  const targetPage = $derived(targetsQ.data ?? null);
  const targets = $derived(targetPage?.targets ?? []);
  const team = $derived(teamQ.data ?? []);
  const liveContext = $derived(contextQ.data ?? null);
  const records = $derived(recordsQ.data?.records ?? []);
  const hasOlderRecords = $derived(recordsQ.data?.hasMore ?? false);
  const metrics = $derived(metricsQ.data ?? null);

  // The selected project keeps its label when the picker pages away from it.
  let selectedLabel = $state("");
  const projectItems = $derived([
    ...(projectId && !targets.some((t) => String(t.projectId) === projectId)
      ? [{ value: projectId, label: `${selectedLabel} (selected)` }]
      : []),
    ...targets.map((target) => ({
      value: String(target.projectId),
      label:
        target.hasLiveComparison === null
          ? target.label
          : target.hasLiveComparison
            ? `${target.label} (live record)`
            : target.label,
    })),
  ]);
  const judgeItems = $derived([
    ...team.map((member) => ({ value: String(member.id), label: member.name })),
  ]);
  // No default preference: the preference IS the judgement, so it is chosen,
  // never inherited from a form default.
  const preferenceItems = [
    { value: "banhall", label: "Banhall draft preferred" },
    { value: "baseline", label: "Baseline draft preferred" },
    { value: "tie", label: "Tie — no preference" },
  ];

  // Judgement fields: human-entered, never derived from project data.
  let judgeUserId = $state("");
  let preference = $state("");
  let deviationsBanhall = $state<string | number>("");
  let deviationsBaseline = $state<string | number>("");
  let correctionsBanhall = $state<string | number>("");
  let correctionsBaseline = $state<string | number>("");
  let countingMethod = $state<string | number>("");
  let banhallModel = $state<string | number>("");
  let baselineProduct = $state<string | number>("");
  let baselineModel = $state<string | number>("");
  let modelCaveat = $state<string | number>("");
  let usedInDevelopment = $state(false);
  let banhallDraftText = $state("");
  let baselineDraftText = $state("");

  /** The comparison the administrator agreed to replace, captured at consent. */
  let correctionTargetId = $state<Id<"comparisons"> | null>(null);
  let recordAsCorrection = $state(false);

  /**
   * The pin as it stood when this judgement began. A live query may show the
   * report moving on; the submitted pin does not follow it, so the mutation
   * refuses a judgement of prose nobody read.
   */
  let pinned = $state<{
    reportId: Id<"reports">;
    revisionNumber: number;
    contentHash: string | null;
    generationId: Id<"generations"> | null;
    suggestedBanhallModel: string | null;
  } | null>(null);

  let submitting = $state(false);
  let formError = $state<string | null>(null);
  let justRecorded = $state(false);

  /** Identity of the form a pending request belongs to; bumped on every reset. */
  let formToken = $state(0);

  const liveRecord = $derived(records.find((row) => !row.voided) ?? null);
  const hasLiveRecord = $derived(
    Boolean(liveContext?.liveComparisonId ?? liveRecord)
  );
  // The pin names a specific report at a specific revision. A project whose
  // latest report is REPLACED lands on a different report that may carry the
  // same revision number, so identity is compared as well as revision.
  const reportMovedOn = $derived(
    Boolean(
      pinned &&
        liveContext &&
        (liveContext.revisionNumber !== pinned.revisionNumber ||
          String(liveContext.reportId) !== String(pinned.reportId))
    )
  );

  /**
   * Clear the judgement and let the pin re-freeze from the current context.
   *
   * Selecting the project that is already selected is a no-op, so without an
   * explicit restart a stale pin could only be refreshed by reloading the
   * page — a dead end the STALE_REVISION message itself walks the
   * administrator into. Every entered judgement field is discarded, which is
   * the point: the judgement was made against prose that has moved.
   */
  function resetJudgement() {
    formToken += 1;
    pinned = null;
    judgeUserId = "";
    preference = "";
    deviationsBanhall = "";
    deviationsBaseline = "";
    correctionsBanhall = "";
    correctionsBaseline = "";
    countingMethod = "";
    banhallModel = "";
    baselineProduct = "";
    baselineModel = "";
    modelCaveat = "";
    usedInDevelopment = false;
    banhallDraftText = "";
    baselineDraftText = "";
    recordAsCorrection = false;
    correctionTargetId = null;
    formError = null;
    justRecorded = false;
    // The in-flight request belongs to the form that is being replaced; its
    // response is discarded by the token guard and must not leave this form
    // stuck in a submitting state.
    submitting = false;
  }

  // A project change resets the judgement, so nothing carries across records —
  // including the baseline product, which is provenance, not a constant.
  let lastProjectId = $state("");
  $effect(() => {
    if (projectId === lastProjectId) return;
    lastProjectId = projectId;
    resetJudgement();
  });

  // Freeze the pin the first time this project's context arrives. Later
  // updates of the live query are shown as a warning, never folded in.
  $effect(() => {
    const context = contextQ.data;
    if (!context || pinned) return;
    pinned = {
      reportId: context.reportId,
      revisionNumber: context.revisionNumber,
      contentHash: context.contentHash,
      generationId: context.generationId,
      suggestedBanhallModel: context.suggestedBanhallModel,
    };
    // The suggestion is provenance about the PINNED revision's generation, so
    // it is captured with the pin and never taken from a later context: a
    // later value would describe a different generation than the one judged.
    // It is a default, not a value — the judge can overwrite it.
    if (context.suggestedBanhallModel && !banhallModel) {
      banhallModel = context.suggestedBanhallModel;
    }
  });

  function consentToCorrection(next: boolean) {
    recordAsCorrection = next;
    correctionTargetId = next
      ? ((liveContext?.liveComparisonId ?? liveRecord?._id ?? null) as
          | Id<"comparisons">
          | null)
      : null;
  }

  function text(value: string | number): string {
    return String(value ?? "").trim();
  }

  function raw(value: string | number): string {
    return String(value ?? "");
  }

  function stamp(ms: number) {
    return new Date(ms).toLocaleString("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function preferenceLabel(value: "banhall" | "baseline" | "tie") {
    return value === "banhall"
      ? "Banhall"
      : value === "baseline"
        ? "Baseline"
        : "Tie";
  }

  const counts = $derived([
    { label: "Banhall Deviations", raw: deviationsBanhall },
    { label: "Baseline Deviations", raw: deviationsBaseline },
    { label: "Banhall Corrections-to-acceptable", raw: correctionsBanhall },
    { label: "Baseline Corrections-to-acceptable", raw: correctionsBaseline },
  ]);
  const countProblem = $derived(
    counts.find(({ raw: entered }) => {
      const value = Number(text(entered));
      // Validate decimal text before conversion: Number can round a fractional
      // entry into an apparently safe integer. Text inputs retain that evidence.
      return !/^[0-9]+$/.test(raw(entered)) || !Number.isSafeInteger(value);
    })?.label ?? null
  );

  const canSubmit = $derived(
    Boolean(
      pinned &&
        projectId &&
        judgeUserId &&
        preference &&
        !countProblem &&
        banhallDraftText.trim() &&
        baselineDraftText.trim() &&
        text(countingMethod) &&
        text(banhallModel) &&
        text(baselineProduct) &&
        text(baselineModel) &&
        text(modelCaveat) &&
        (!hasLiveRecord || correctionTargetId !== null) &&
        !submitting
    )
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const pin = pinned;
    if (!pin || !canSubmit) return;
    // Everything this request answers for is captured before the await.
    const token = formToken;
    const target = correctionTargetId;
    submitting = true;
    formError = null;
    justRecorded = false;
    try {
      await record({
        reportId: pin.reportId,
        expectedRevisionNumber: pin.revisionNumber,
        // Provenance and judgement strings go up exactly as they were typed.
        banhallModel: raw(banhallModel),
        baselineProduct: raw(baselineProduct),
        baselineModel: raw(baselineModel),
        modelCaveat: raw(modelCaveat),
        judgeUserId: judgeUserId as Id<"users">,
        preference: preference as "banhall" | "baseline" | "tie",
        deviationsBanhall: Number(text(deviationsBanhall)),
        deviationsBaseline: Number(text(deviationsBaseline)),
        countingMethod: raw(countingMethod),
        correctionsBanhall: Number(text(correctionsBanhall)),
        correctionsBaseline: Number(text(correctionsBaseline)),
        usedInDevelopment,
        banhallDraftText,
        baselineDraftText,
        ...(target ? { voidsComparisonId: target } : {}),
      });
      // A response only ever speaks for the form that sent it.
      if (token !== formToken) return;
      // draftTextMatches is server-computed and read back off the record list;
      // the page never claims a match it did not observe.
      justRecorded = true;
      banhallDraftText = "";
      baselineDraftText = "";
      recordAsCorrection = false;
      correctionTargetId = null;
    } catch (error) {
      if (token !== formToken) return;
      formError = userErrorMessage(
        error,
        "The Paired Comparison could not be recorded."
      );
    } finally {
      if (token === formToken) submitting = false;
    }
  }

  function showOlderProjects() {
    if (!targetPage || targetPage.isDone) return;
    pickerHistory = [...pickerHistory, pickerCursor];
    pickerCursor = targetPage.cursor;
  }

  function showNewerProjects() {
    if (pickerHistory.length === 0) return;
    const previous = pickerHistory[pickerHistory.length - 1] ?? null;
    pickerHistory = pickerHistory.slice(0, -1);
    pickerCursor = previous;
  }
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <AdminWorkspacePage
    title="Paired Comparisons"
    description="One human-judged record per project, pinned to the revision the judge read. Deviation and Corrections counts are the judge's own manual counts — never read from the tool."
  >
    <div class="flex flex-col gap-8">
      <!-- ── Record a Paired Comparison ───────────────────────────────── -->
      <section class="card p-5" aria-label="Record a Paired Comparison">
        <h2 class="text-title">Record a Paired Comparison</h2>
        <p class="mt-1 text-body">
          Both drafts are pasted in by the third person who blinded them. The
          baseline draft is produced outside Banhall.
        </p>

        <form class="mt-5 flex flex-col gap-5" onsubmit={submit}>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1.5">
              <span class="text-label" id="comparison-project-label">Project</span>
              <SelectInput
                bind:value={projectId}
                items={projectItems}
                ariaLabel="Project"
                placeholder="Select a project…"
                onValueChange={(next) => {
                  selectedLabel =
                    targets.find((t) => String(t.projectId) === next)?.label ??
                    selectedLabel;
                }}
              />
              <div class="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={pickerHistory.length === 0}
                  onclick={showNewerProjects}
                >
                  Newer projects
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={!targetPage || targetPage.isDone}
                  onclick={showOlderProjects}
                >
                  Older projects
                </Button>
                <span class="text-body text-ink-muted">
                  Page {pickerHistory.length + 1}
                </span>
              </div>
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="text-label">Judge</span>
              <SelectInput
                bind:value={judgeUserId}
                items={judgeItems}
                ariaLabel="Judge"
                placeholder="Select the judge…"
              />
            </div>
          </div>

          {#if projectId && contextQ.isLoading}
            <div class="flex items-center gap-2 text-body">
              <Spinner />
              <span>Loading the project's pinned revision…</span>
            </div>
          {:else if projectId && !pinned}
            <p class="text-body text-red-700">
              This project has no report yet, so there is no revision to pin a
              comparison to.
            </p>
          {:else if pinned}
            <div class="rounded-lg bg-chrome p-4">
              <p class="text-label">Pinned revision</p>
              <p class="mt-1.5 text-data text-ink">
                Revision {pinned.revisionNumber} · report {pinned.reportId}
              </p>
              <p class="mt-1 text-data text-ink-muted">
                Content hash {pinned.contentHash ?? "not yet hashed"}
              </p>
              <p class="mt-1 text-data text-ink-muted">
                Generation {pinned.generationId ?? "none (hand-written report)"}
              </p>
              <p class="mt-2 text-body">
                The revision's own text is deliberately not shown here. Paste the
                blinded strip the judge read; the server compares them and stores
                the result as evidence.
              </p>
            </div>

            {#if reportMovedOn}
              <div class="rounded-lg border border-line p-4">
                <p class="text-body text-red-700" role="alert">
                  {String(liveContext?.reportId) !== String(pinned.reportId)
                    ? `This project's latest report is no longer the one being judged (now report ${liveContext?.reportId}, at revision ${liveContext?.revisionNumber}).`
                    : `This report moved to revision ${liveContext?.revisionNumber} after the judgement began.`}
                  The pin stays on report {pinned.reportId} at revision
                  {pinned.revisionNumber}.
                  {String(liveContext?.reportId) !== String(pinned.reportId)
                    ? "Recording remains valid if that original report revision is unchanged."
                    : "Recording will be refused because that report revision changed."}
                </p>
                <div class="mt-3">
                  <Button variant="secondary" size="sm" type="button" onclick={resetJudgement}>
                    Start a new judgement on the current revision
                  </Button>
                </div>
                <p class="mt-2 text-body text-ink-muted">
                  Starting over discards every field entered here and starts a
                  judgement on the latest report revision.
                </p>
              </div>
            {/if}

            {#if hasLiveRecord}
              <div class="rounded-lg bg-primary-wash p-4">
                <p class="text-body text-ink">
                  This project already has a live Paired Comparison. A record is
                  never edited — record a correction that voids the live one.
                </p>
                <div class="mt-3">
                  <Checkbox
                    bind:checked={recordAsCorrection}
                    onCheckedChange={(next: boolean) => consentToCorrection(next)}
                    labelText="Record this as a correction that voids the live record"
                  />
                </div>
              </div>
            {/if}

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <span class="text-label">Preference</span>
                <SelectInput
                  bind:value={preference}
                  items={preferenceItems}
                  ariaLabel="Preference"
                  placeholder="Select the preference…"
                />
              </div>
              <Input
                id="counting-method"
                label="Counting method"
                bind:value={countingMethod}
                placeholder="The same manual method applied to both drafts"
              />
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                id="deviations-banhall"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                label="Banhall Deviations"
                bind:value={deviationsBanhall}
              />
              <Input
                id="deviations-baseline"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                label="Baseline Deviations"
                bind:value={deviationsBaseline}
              />
              <Input
                id="corrections-banhall"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                label="Banhall Corrections-to-acceptable"
                bind:value={correctionsBanhall}
              />
              <Input
                id="corrections-baseline"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                label="Baseline Corrections-to-acceptable"
                bind:value={correctionsBaseline}
              />
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                id="banhall-model"
                label="Banhall model"
                bind:value={banhallModel}
                placeholder="Sonnet 5"
              />
              <Input
                id="baseline-product"
                label="Baseline product"
                bind:value={baselineProduct}
                placeholder="ChatGPT"
              />
              <Input
                id="baseline-model"
                label="Baseline model"
                bind:value={baselineModel}
                placeholder="GPT-5.6 Sol"
              />
            </div>

            <Input
              id="model-caveat"
              label="Model-equivalence caveat"
              bind:value={modelCaveat}
              placeholder="Whether the OpenRouter model matches the same model inside the baseline product"
            />

            <Checkbox
              bind:checked={usedInDevelopment}
              labelText="This project was used during development (excluded from SM-1 and SM-2)"
            />

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <label class="text-label" for="banhall-draft">
                  Banhall draft — blinded plain text
                </label>
                <textarea
                  id="banhall-draft"
                  bind:value={banhallDraftText}
                  rows="12"
                  placeholder="Paste the stripped Banhall draft the judge read"
                  class="field-control block min-h-48 w-full resize-y rounded-lg px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint"
                ></textarea>
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-label" for="baseline-draft">
                  Baseline draft — blinded plain text
                </label>
                <textarea
                  id="baseline-draft"
                  bind:value={baselineDraftText}
                  rows="12"
                  placeholder="Paste the stripped baseline draft the judge read"
                  class="field-control block min-h-48 w-full resize-y rounded-lg px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint"
                ></textarea>
              </div>
            </div>

            {#if countProblem}
              <p class="text-body text-ink-muted">
                {countProblem} must contain only decimal digits, from 0 to
                {Number.MAX_SAFE_INTEGER}.
              </p>
            {/if}
            {#if formError}
              <p class="text-body text-red-700" role="alert">{formError}</p>
            {/if}
            {#if justRecorded}
              <p class="text-body text-ink">
                Recorded. The draft-match result is shown on the record below.
              </p>
            {/if}

            <div class="flex items-center gap-3">
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? "Recording…" : "Record comparison"}
              </Button>
              <span class="text-body text-ink-muted">
                A recorded comparison is never edited or deleted.
              </span>
            </div>
          {/if}
        </form>
      </section>

      <!-- ── This project's records ───────────────────────────────────── -->
      {#if projectId}
        <section class="card p-5" aria-label="Records on this project">
          <h2 class="text-title">Records on this project</h2>
          {#if recordsQ.isLoading}
            <div class="mt-4"><Spinner /></div>
          {:else if records.length === 0}
            <p class="mt-2 text-body">No Paired Comparison recorded yet.</p>
          {:else}
            <ul class="mt-4 flex flex-col gap-3">
              {#each records as row (row._id)}
                <li class="rounded-lg border border-line p-4">
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <p class="text-data text-ink">
                      {stamp(row.recordedAt)} · revision {row.revisionNumber} ·
                      {preferenceLabel(row.preference)}
                    </p>
                    <p class="text-label">
                      {row.voided ? "Voided" : "Live"}
                    </p>
                  </div>
                  <p class="mt-2 text-body">Judge: {row.judgeLabel}</p>
                  <p class="mt-1 text-data text-ink-muted">
                    Deviations {row.deviationsBanhall} / {row.deviationsBaseline}
                    · Corrections {row.correctionsBanhall} /
                    {row.correctionsBaseline}
                  </p>
                  <p class="mt-1 text-body">
                    {row.banhallModel} vs {row.baselineProduct} {row.baselineModel}
                  </p>
                  <p class="mt-1 text-body text-ink-muted">
                    Counting method: {row.countingMethod}
                  </p>
                  <p class="mt-1 text-body text-ink-muted">
                    Caveat: {row.modelCaveat}
                  </p>
                  <p class={`mt-2 text-body ${row.draftTextMatches ? "text-ink-muted" : "text-red-700"}`}>
                    {row.draftTextMatches
                      ? "The pasted Banhall draft matches the pinned revision."
                      : "The pasted Banhall draft does NOT match the pinned revision — the judge may have rated a different draft."}
                  </p>
                  {#if row.usedInDevelopment}
                    <p class="mt-1 text-body text-ink-muted">
                      Development project — excluded from SM-1 and SM-2.
                    </p>
                  {/if}
                  {#if row.voidsComparisonId}
                    <p class="mt-1 text-data text-ink-muted">
                      Voids {row.voidsComparisonId}
                    </p>
                  {/if}
                  {#if !row.voided}
                    <div class="mt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onclick={() => {
                          recordAsCorrection = true;
                          correctionTargetId = row._id;
                        }}
                      >
                        Void and re-enter
                      </Button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if hasOlderRecords}
              <p class="mt-3 text-body text-ink-muted">
                Older records on this project are not shown.
              </p>
            {/if}
          {/if}
        </section>
      {/if}

      <!-- ── SM-1 / SM-2 ──────────────────────────────────────────────── -->
      <section class="card p-5" aria-label="Success metrics">
        <h2 class="text-title">SM-1 and SM-2</h2>
        {#if metricsQ.isLoading}
          <div class="mt-4"><Spinner /></div>
        {:else if !metrics}
          <p class="mt-2 text-body">Sign in as an administrator to view metrics.</p>
        {:else}
          {#if !metrics.corpusComplete}
            <p class="mt-2 text-body text-red-700" role="alert">
              The record history is larger than one pass can read, so this
              readout covers only the {metrics.scannedRows} most recent records.
              SM-1 and SM-2 are withheld until the whole corpus can be counted.
            </p>
          {/if}
          <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div class="rounded-lg border border-line p-4">
              <p class="text-label">SM-1 · Paired Comparison win</p>
              <p class="mt-1.5 text-data text-ink">
                {metrics.sm1.satisfyingProjects} of {metrics.sm1.eligibleProjects}
                eligible project(s) satisfy the countable clauses ·
                {metrics.sm1.preferredProjects} preferred Banhall
              </p>
              <p class="mt-1 text-body">
                Countable clauses {metrics.corpusComplete
                  ? (metrics.sm1.computedMet ? "met" : "not met")
                  : "unavailable until the whole corpus is counted"}
                (needs 4 eligible projects and 3 satisfying).
              </p>
              <p class="mt-2 text-label">Still to confirm by hand</p>
              <ul class="mt-1 flex flex-col gap-1">
                {#each metrics.sm1.manualConditions as condition (condition)}
                  <li class="text-body">{condition}</li>
                {/each}
              </ul>
            </div>
            <div class="rounded-lg border border-line p-4">
              <p class="text-label">SM-2 · Corrections-to-acceptable</p>
              <p class="mt-1.5 text-data text-ink">
                {metrics.sm2.satisfyingProjects} of {metrics.sm2.eligibleProjects}
                eligible project(s) at one correction or fewer
              </p>
              <p class="mt-1 text-body">
                Countable clauses {metrics.corpusComplete
                  ? (metrics.sm2.computedMet ? "met" : "not met")
                  : "unavailable until the whole corpus is counted"}
                (needs 4 eligible projects and 3 satisfying).
              </p>
              <p class="mt-2 text-label">Still to confirm by hand</p>
              <ul class="mt-1 flex flex-col gap-1">
                {#each metrics.sm2.manualConditions as condition (condition)}
                  <li class="text-body">{condition}</li>
                {/each}
              </ul>
            </div>
          </div>

          <h3 class="mt-6 text-label">
            Eligible projects ({metrics.projectCount})
          </h3>
          {#if metrics.projectsTruncated}
            <p class="mt-2 text-body text-red-700" role="alert">
              Showing {metrics.projects.length} of {metrics.projectCount} eligible
              projects; the rest are counted but not listed.
            </p>
          {/if}
          {#if metrics.projects.length === 0}
            <p class="mt-2 text-body">
              {metrics.corpusComplete
                ? "No live, non-development Paired Comparison has been recorded yet."
                : "No eligible projects were found in the scanned window."}
            </p>
          {:else}
            <ul class="mt-2 flex flex-col gap-2">
              {#each metrics.projects as project (project.comparisonId)}
                <li class="rounded-lg border border-line p-4">
                  <p class="text-body text-ink">{project.label}</p>
                  <p class="mt-1 text-data text-ink-muted">
                    {preferenceLabel(project.preference)} · Deviations
                    {project.deviationsBanhall} / {project.deviationsBaseline} ·
                    Corrections {project.correctionsBanhall} /
                    {project.correctionsBaseline}
                  </p>
                  <p class="mt-1 text-data text-ink-muted">
                    SM-1 {project.sm1Satisfied ? "satisfied" : "not satisfied"} ·
                    SM-2 {project.sm2Satisfied ? "satisfied" : "not satisfied"}
                  </p>
                  <p class="mt-1 text-data text-ink-muted">
                    {project.financials
                      ? `${project.financials.totalHours} total hours · ${project.financials.sredHours} SR&ED hours`
                      : "No financial summary uploaded — claim hours unknown"}
                  </p>
                  {#if !project.draftTextMatches}
                    <p class="mt-1 text-body text-red-700">
                      The recorded Banhall draft did not match its pinned revision.
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}

          <h3 class="mt-6 text-label">Excluded</h3>
          <p class="mt-2 text-body">
            {metrics.excluded.voided} voided record(s) ·
            {metrics.excluded.developmentCount} development project(s)
          </p>
          {#if metrics.excluded.developmentTruncated}
            <p class="mt-1 text-body text-red-700" role="alert">
              Showing {metrics.excluded.development.length} of
              {metrics.excluded.developmentCount} excluded development projects;
              the rest are counted but not listed.
            </p>
          {/if}
          {#each metrics.excluded.development as excluded (excluded.comparisonId)}
            <p class="mt-1 text-data text-ink-muted">
              {excluded.label} — reported separately, never counted
            </p>
          {/each}
          <p class="mt-3 text-body text-ink-muted">
            Read from {metrics.scannedRows} record(s) ·
            {metrics.corpusComplete
              ? "the whole record history"
              : "a partial window"}.
          </p>
        {/if}
      </section>
    </div>
  </AdminWorkspacePage>
{/if}
