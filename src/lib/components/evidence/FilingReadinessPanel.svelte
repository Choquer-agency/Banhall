<script lang="ts">
  import { useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { userErrorMessage } from "$lib/errors";

  type UserRole = "writer" | "manager" | "admin";
  type Relationship = "claimant" | "employee" | "contractor" | "other";
  type EvidenceKind =
    | "corporate_registry"
    | "contract"
    | "invoice"
    | "payroll"
    | "project_document"
    | "other";

  let {
    projectId,
    reportId,
    clientName,
    userRole,
  }: {
    projectId: Id<"projects">;
    reportId: Id<"reports">;
    clientName: string;
    userRole?: UserRole;
  } = $props();

  const evidenceQ = useQuery(api.projectEvidence.listEvidence, () => ({ projectId }));
  const readinessQ = useQuery(api.projectEvidence.getReadiness, () => ({ projectId, reportId }));
  const provenanceQ = useQuery(api.reports.getProvenance, () => ({ reportId }));
  const documentsQ = useQuery(api.documents.listDocuments, () => ({ projectId }));

  const attachEvidence = useMutation(api.projectEvidence.attachEvidence);
  const verifyEvidence = useMutation(api.projectEvidence.verifyEvidence);
  const rejectEvidence = useMutation(api.projectEvidence.rejectEvidence);
  const reviewClaim = useMutation(api.reports.reviewClaimCitation);
  const setAttestation = useMutation(api.projectEvidence.setFilingAttestation);

  const evidence = $derived(evidenceQ.data ?? []);
  const readiness = $derived(readinessQ.data);
  const provenance = $derived(provenanceQ.data);
  const documents = $derived((documentsQ.data ?? []).filter((document) => !document.archived));
  const canReview = $derived(userRole === "manager" || userRole === "admin");
  const canAttest = $derived(
    canReview &&
      readiness != null &&
      readiness.blockers.every(
        (blocker) => blocker.code === "ATTESTATION_REQUIRED" || blocker.code === "ATTESTATION_STALE"
      )
  );

  let open = $state(false);
  let showEvidenceForm = $state(false);
  let subjectName = $state("");
  let initializedSubject = false;
  let relationship = $state<Relationship>("claimant");
  let evidenceKind = $state<EvidenceKind>("project_document");
  let projectDocumentId = $state("");
  let sourceDescription = $state("");
  let reviewNote = $state("");
  let busy = $state(false);
  let error = $state("");
  $effect(() => {
    if (!initializedSubject) {
      subjectName = clientName;
      initializedSubject = true;
    }
  });

  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await action();
    } catch (actionError) {
      error = userErrorMessage(actionError, "The review action failed.");
    } finally {
      busy = false;
    }
  }

  async function submitEvidence(event: SubmitEvent) {
    event.preventDefault();
    await perform(async () => {
      await attachEvidence({
        projectId,
        subjectName,
        relationship,
        evidenceKind,
        ...(projectDocumentId
          ? { projectDocumentId: projectDocumentId as Id<"projectDocuments"> }
          : {}),
        sourceDescription,
      });
      sourceDescription = "";
      projectDocumentId = "";
      showEvidenceForm = false;
    });
  }

  async function decideEvidence(
    evidenceId: Id<"projectIdentityEvidence">,
    decision: "verified" | "rejected"
  ) {
    await perform(async () => {
      if (decision === "verified") {
        await verifyEvidence({ evidenceId });
      } else {
        await rejectEvidence({ evidenceId, reason: reviewNote });
        reviewNote = "";
      }
    });
  }

  async function decideClaim(claimId: string, state: "approved" | "unsupported") {
    if (!provenance || provenance.status === "unavailable_legacy" || !("id" in provenance)) return;
    await perform(() =>
      reviewClaim({
        reportId,
        provenanceId: provenance.id,
        claimId,
        state,
      })
    );
  }

  async function attest(status: "approved" | "blocked") {
    await perform(async () => {
      await setAttestation({
        projectId,
        reportId,
        status,
        ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}),
      });
      reviewNote = "";
    });
  }
</script>

<section class="rounded-xl border border-line-soft bg-white" aria-labelledby="filing-readiness-title">
  <button
    type="button"
    class="flex w-full items-center justify-between gap-4 rounded-xl px-5 py-4 text-left hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    aria-expanded={open}
    aria-controls="filing-readiness-details"
    onclick={() => (open = !open)}
  >
    <div>
      <h3 id="filing-readiness-title" class="text-sm font-semibold text-gray-900">Filing readiness</h3>
      <p class="mt-0.5 text-xs text-gray-500">
        Identity evidence, claim sources, and human approval for this exact report revision.
      </p>
    </div>
    {#if readiness}
      <span
        class={`flex-none rounded-full px-2.5 py-1 text-xs font-semibold ${
          readiness.ready
            ? "bg-green-50 text-green-700"
            : "bg-amber-50 text-amber-800"
        }`}
      >
        {readiness.ready ? "Ready" : `${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? "" : "s"}`}
      </span>
    {/if}
  </button>

  {#if open}
    <div id="filing-readiness-details" class="border-t border-line-soft px-5 py-5">
      {#if error}
        <p class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      {/if}

      {#if readiness && readiness.blockers.length > 0}
        <div class="rounded-lg bg-amber-50 px-4 py-3">
          <p class="text-label text-amber-900">Required before export or finalization</p>
          <ul class="mt-2 space-y-1.5">
            {#each readiness.blockers as blocker (`${blocker.code}:${blocker.claimId ?? ""}`)}
              <li class="text-sm text-amber-900">{blocker.message}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="mt-5 grid gap-5 xl:grid-cols-2">
        <div>
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-sm font-semibold text-gray-900">Legal identity evidence</h4>
              <p class="mt-0.5 text-xs text-gray-500">Names and AI output are not evidence.</p>
            </div>
            <button
              type="button"
              class="rounded-lg border border-line-soft px-3 py-1.5 text-xs font-semibold text-navy hover:bg-primary-wash"
              onclick={() => (showEvidenceForm = !showEvidenceForm)}
            >
              {showEvidenceForm ? "Cancel" : "Add evidence"}
            </button>
          </div>

          {#if showEvidenceForm}
            <form class="mt-3 space-y-3 rounded-lg bg-canvas p-3" onsubmit={submitEvidence}>
              <label class="block text-xs font-medium text-gray-700">
                Subject legal name
                <input
                  class="mt-1 w-full rounded-lg border border-line-soft bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                  bind:value={subjectName}
                  maxlength="200"
                  required
                />
              </label>
              <div class="grid grid-cols-2 gap-3">
                <label class="block text-xs font-medium text-gray-700">
                  Relationship
                  <select class="mt-1 w-full rounded-lg border border-line-soft bg-white px-3 py-2 text-sm" bind:value={relationship}>
                    <option value="claimant">Claimant</option>
                    <option value="employee">Employee</option>
                    <option value="contractor">Contractor</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label class="block text-xs font-medium text-gray-700">
                  Evidence type
                  <select class="mt-1 w-full rounded-lg border border-line-soft bg-white px-3 py-2 text-sm" bind:value={evidenceKind}>
                    <option value="project_document">Project document</option>
                    <option value="corporate_registry">Corporate registry</option>
                    <option value="contract">Contract</option>
                    <option value="invoice">Invoice</option>
                    <option value="payroll">Payroll</option>
                    <option value="other">Other</option>
                  </select>
                </label>
              </div>
              {#if evidenceKind === "project_document"}
                <label class="block text-xs font-medium text-gray-700">
                  Supporting file
                  <select
                    class="mt-1 w-full rounded-lg border border-line-soft bg-white px-3 py-2 text-sm"
                    bind:value={projectDocumentId}
                    required
                  >
                    <option value="">Select a project file</option>
                    {#each documents as document (document._id)}
                      <option value={document._id}>{document.fileName}</option>
                    {/each}
                  </select>
                </label>
              {/if}
              <label class="block text-xs font-medium text-gray-700">
                Source description
                <textarea
                  class="mt-1 w-full resize-y rounded-lg border border-line-soft bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                  bind:value={sourceDescription}
                  rows="2"
                  maxlength="2000"
                  required
                ></textarea>
              </label>
              <button
                type="submit"
                disabled={busy}
                class="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {busy ? "Saving..." : "Submit for verification"}
              </button>
            </form>
          {/if}

          <div class="mt-3 space-y-2">
            {#if evidence.length === 0}
              <p class="rounded-lg bg-canvas px-3 py-3 text-sm text-gray-500">No identity evidence recorded.</p>
            {:else}
              {#each evidence as row (row.id)}
                <article class="rounded-lg border border-line-soft px-3 py-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="text-sm font-medium text-gray-900">{row.subjectName}</p>
                      <p class="mt-0.5 text-xs text-gray-500">{row.relationship} · {row.evidenceKind.replaceAll("_", " ")}</p>
                    </div>
                    <span
                      class={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        row.status === "verified"
                          ? "bg-green-50 text-green-700"
                          : row.status === "rejected"
                            ? "bg-red-50 text-red-700"
                            : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p class="mt-2 text-xs leading-relaxed text-gray-600">{row.sourceDescription}</p>
                  {#if row.rejectionReason}
                    <p class="mt-2 text-xs text-red-700">Rejected: {row.rejectionReason}</p>
                  {/if}
                  {#if canReview && row.status !== "verified"}
                    <div class="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        class="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        onclick={() => decideEvidence(row.id, "verified")}
                      >Verify</button>
                      <button
                        type="button"
                        disabled={busy || !reviewNote.trim()}
                        class="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                        onclick={() => decideEvidence(row.id, "rejected")}
                      >Reject</button>
                    </div>
                  {/if}
                </article>
              {/each}
            {/if}
          </div>
        </div>

        <div>
          <h4 class="text-sm font-semibold text-gray-900">Claim source review</h4>
          <p class="mt-0.5 text-xs text-gray-500">Approve each material claim against its frozen source excerpt.</p>
          <div class="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
            {#if !provenance || provenance.status === "unavailable_legacy"}
              <p class="rounded-lg bg-canvas px-3 py-3 text-sm text-gray-500">
                This report revision has no claim-level provenance record.
              </p>
            {:else if provenance.claims.length === 0}
              <p class="rounded-lg bg-canvas px-3 py-3 text-sm text-gray-500">No material claims were recorded.</p>
            {:else}
              {#each provenance.claims as claim (claim.claimId)}
                <article class="rounded-lg border border-line-soft px-3 py-3">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-label">Line {claim.section}</span>
                    <span class={`text-xs font-semibold ${claim.state === "approved" ? "text-green-700" : claim.state === "unsupported" ? "text-red-700" : "text-amber-800"}`}>
                      {claim.state.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p class="mt-2 text-sm text-gray-800">{claim.claimText}</p>
                  {#each claim.sources as source (source.generationSourceId)}
                    <blockquote class="mt-2 border-l-2 border-primary/40 pl-3 text-xs leading-relaxed text-gray-600">
                      “{source.exactExcerpt}”
                      {#if source.speaker}<span class="mt-1 block text-gray-400">— {source.speaker}</span>{/if}
                    </blockquote>
                  {/each}
                  {#if canReview && claim.material}
                    <div class="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        class="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        onclick={() => decideClaim(claim.claimId, "approved")}
                      >Approve source</button>
                      <button
                        type="button"
                        disabled={busy}
                        class="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                        onclick={() => decideClaim(claim.claimId, "unsupported")}
                      >Mark unsupported</button>
                    </div>
                  {/if}
                </article>
              {/each}
            {/if}
          </div>
        </div>
      </div>

      {#if canReview}
        <div class="mt-5 rounded-lg border border-line-soft bg-canvas p-4">
          <label class="block text-xs font-medium text-gray-700">
            Reviewer note {canAttest ? "(optional)" : "(required to block or reject evidence)"}
            <textarea
              class="mt-1 w-full resize-y rounded-lg border border-line-soft bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              bind:value={reviewNote}
              rows="2"
              maxlength="4000"
            ></textarea>
          </label>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !canAttest}
              class="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
              onclick={() => attest("approved")}
            >Approve exact revision for filing</button>
            <button
              type="button"
              disabled={busy || !reviewNote.trim()}
              class="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
              onclick={() => attest("blocked")}
            >Block filing</button>
          </div>
        </div>
      {:else}
        <p class="mt-5 rounded-lg bg-canvas px-4 py-3 text-xs text-gray-500">
          A manager or administrator must verify evidence, review material claim sources, and approve this exact revision.
        </p>
      {/if}
    </div>
  {/if}
</section>
