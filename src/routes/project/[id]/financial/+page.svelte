<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import { z } from "zod";
  import Button from "$lib/components/ui/Button.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";

  const FILE_TYPES = [
    { value: "slack_export", label: "Slack Export" },
    { value: "whatsapp_chat", label: "WhatsApp Chat" },
    { value: "git_log", label: "Git Log" },
    { value: "timesheet", label: "Timesheet (CSV/Text)" },
    { value: "trial_balance", label: "Trial Balance" },
    { value: "general_ledger", label: "General Ledger" },
    { value: "other", label: "Other" },
  ] as const;

  const auth = useAuth();
  const projectId = $derived(page.params.id as Id<"projects">);

  const projectQ = useQuery(api.projects.getProject, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const uploadsQ = useQuery(api.financial.listUploads, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const entriesQ = useQuery(api.financial.getTimesheetEntries, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const summaryQ = useQuery(api.financial.getFinancialSummary, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const capabilitiesQ = useQuery(api.providerReadiness.getCapabilities, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  const uploadData = useMutation(api.financial.uploadAndScheduleFinancialData);
  const deleteUpload = useMutation(api.financial.deleteUpload);
  const reviewEntry = useMutation(api.financial.reviewTimesheetEntry);

  let fileType = $state<(typeof FILE_TYPES)[number]["value"]>("slack_export");
  let fileName = $state("");
  let content = $state("");
  let uploading = $state(false);
  let uploadError = $state("");
  let deleteError = $state("");
  let deletingId = $state<Id<"financialUploads"> | null>(null);
  let reviewingId = $state<Id<"timesheetEntries"> | null>(null);
  let reviewedHours = $state(0);
  let reviewError = $state("");
  let reviewBusy = $state(false);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  async function handleUpload() {
    if (!content.trim() || !fileName.trim()) return;
    uploading = true;
    uploadError = "";
    try {
      await uploadData({
        projectId,
        fileName: fileName.trim(),
        fileType,
        content: content.trim(),
      });
      content = "";
      fileName = "";
    } catch (error) {
      uploadError = userErrorMessage(
        error,
        "The upload could not be scheduled. Your pasted data was retained."
      );
    } finally {
      uploading = false;
    }
  }

  async function handleDelete(uploadId: Id<"financialUploads">) {
    if (!window.confirm("Remove this source and all timesheet entries derived from it?")) return;
    deletingId = uploadId;
    deleteError = "";
    try {
      await deleteUpload({ uploadId });
    } catch (error) {
      deleteError = userErrorMessage(error, "The financial source could not be removed.");
    } finally {
      deletingId = null;
    }
  }

  function beginReview(entry: { _id: Id<"timesheetEntries">; hours: number }) {
    reviewingId = entry._id;
    reviewedHours = entry.hours;
    reviewError = "";
  }

  async function decideEntry(status: "approved" | "rejected") {
    if (!reviewingId || reviewBusy) return;
    reviewBusy = true;
    reviewError = "";
    try {
      await reviewEntry({
        entryId: reviewingId,
        status,
        ...(status === "approved" ? { hours: reviewedHours } : {}),
      });
      reviewingId = null;
    } catch (error) {
      reviewError = userErrorMessage(error, "The entry review could not be saved.");
    } finally {
      reviewBusy = false;
    }
  }

  const project = $derived(projectQ.data);
  const uploads = $derived(uploadsQ.data);
  const entries = $derived(entriesQ.data);
  const summary = $derived(summaryQ.data);
  const capabilities = $derived(capabilitiesQ.data);
  const providerReady = $derived(capabilities?.financial === "configured");

  const sredEntries = $derived(entries?.filter((e) => e.sredEligible) ?? []);
  const nonSredEntries = $derived(entries?.filter((e) => !e.sredEligible) ?? []);
  const pendingEntries = $derived(
    entries?.filter(
      (entry) => entry.reviewStatus !== "approved" && entry.reviewStatus !== "rejected"
    ) ?? []
  );

  type PersonnelRow = {
    name: string;
    totalHours: number;
    sredHours: number;
    primaryActivities: string[];
  };
  const personnelSchema = z.object({
    personnelBreakdown: z.array(
      z.object({
        name: z.string(),
        totalHours: z.number(),
        sredHours: z.number(),
        primaryActivities: z.array(z.string()),
      })
    ),
  });
  const personnelData = $derived.by((): PersonnelRow[] => {
    if (!summary?.personnelBreakdown) return [];
    try {
      const parsed = personnelSchema.safeParse(JSON.parse(summary.personnelBreakdown));
      return parsed.success ? parsed.data.personnelBreakdown : [];
    } catch {
      return [];
    }
  });
</script>

{#if auth.isLoading || !auth.isAuthenticated || project === undefined}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else if project === null}
  <div class="flex flex-1 items-center justify-center bg-canvas px-6 text-center">
    <div>
      <h2 class="text-title">Project unavailable</h2>
      <p class="mt-2 text-sm text-gray-500">The project does not exist or you do not have access.</p>
    </div>
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav
      breadcrumbs={[
        { label: project.title || "Project", href: `/project/${projectId}` },
        { label: "Financial" },
      ]}
    />
    <PageBar backHref={`/project/${projectId}`} backLabel="Back to report" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] flex-1 px-6 pt-12 pb-8">
      <h2 class="text-display">Financial Analysis</h2>
      <p class="mt-1 text-sm text-gray-500">
        Extract draft timesheet entries from source data, then approve or correct every entry before it contributes to financial totals.
      </p>

      <!-- Upload form -->
      <div class="card mt-6 p-5">
        <h3 class="text-sm font-semibold text-gray-900">Upload Data</h3>
        <div class="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label for="financial-file-name" class="text-xs font-medium text-gray-500">File name</label>
            <input
              id="financial-file-name"
              bind:value={fileName}
              placeholder="e.g., team-slack-export-2024.txt"
              class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label for="financial-file-type" class="text-xs font-medium text-gray-500">Data type</label>
            <select
              id="financial-file-type"
              bind:value={fileType}
              class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {#each FILE_TYPES as ft (ft.value)}
                <option value={ft.value}>{ft.label}</option>
              {/each}
            </select>
          </div>
        </div>
        <div class="mt-3">
          <label for="financial-content" class="text-xs font-medium text-gray-500">Paste data content</label>
          <textarea
            id="financial-content"
            bind:value={content}
            rows="8"
            placeholder="Paste Slack export, WhatsApp chat log, git log output, CSV data, etc."
            class="mt-1 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          ></textarea>
        </div>
        {#if !providerReady}
          <p class="mt-3 text-sm text-amber-800" role="status">
            {capabilities?.anthropicMessage ?? "Checking AI provider configuration..."}
          </p>
        {/if}
        {#if uploadError}
          <p class="mt-3 text-sm text-red-700" role="alert">{uploadError}</p>
        {/if}
        <div class="mt-3 flex justify-end">
          <Button
            onclick={handleUpload}
            disabled={uploading || !providerReady || !content.trim() || !fileName.trim()}
          >
            {uploading ? "Scheduling..." : "Upload & Process"}
          </Button>
        </div>
      </div>

      <!-- Uploads list -->
      {#if uploads && uploads.length > 0}
        <div class="mt-6">
          <h3 class="text-sm font-semibold text-gray-900">Uploaded Data Sources</h3>
          <div class="mt-2 space-y-2">
          {#if deleteError}
            <p class="text-sm text-red-700" role="alert">{deleteError}</p>
          {/if}
            {#each uploads as upload (upload._id)}
              <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5">
                <div class="flex items-center gap-3">
                  <span class="rounded bg-chrome px-2 py-0.5 text-xs font-medium text-gray-600">
                    {FILE_TYPES.find((ft) => ft.value === upload.fileType)?.label ?? upload.fileType}
                  </span>
                  <span class="text-sm text-gray-900">{upload.fileName}</span>
                  <span class="text-xs text-gray-400">
                    {new Date(upload.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span class="text-xs text-gray-500">
                    {upload.processingStatus === "legacy_unknown"
                      ? "Legacy status unknown"
                      : upload.processingStatus}
                  </span>
                  {#if upload.processingError}
                    <span class="text-xs text-red-700" role="alert">{upload.processingError}</span>
                  {/if}
                </div>
                <button
                  type="button"
                  onclick={() => handleDelete(upload._id)}
                  disabled={deletingId === upload._id}
                  class="text-xs text-gray-500 transition-colors hover:text-red-600 disabled:opacity-50"
                >
                  {deletingId === upload._id ? "Removing..." : "Remove"}
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Summary -->
      {#if summary}
        <div class="mt-6 grid gap-4 sm:grid-cols-3">
          <div class="card p-5">
            <p class="text-label">Approved total hours</p>
            <p class="mt-1 text-2xl font-bold text-navy">{summary.totalHours.toFixed(1)}</p>
          </div>
          <div class="card p-5">
            <p class="text-label">Approved SR&amp;ED eligible</p>
            <p class="mt-1 text-2xl font-bold text-primary">{summary.sredHours.toFixed(1)}</p>
            <p class="text-xs text-gray-400">{summary.totalHours > 0 ? Math.round((summary.sredHours / summary.totalHours) * 100) : 0}% of total</p>
          </div>
          <div class="card p-5">
            <p class="text-label">Approved non-eligible</p>
            <p class="mt-1 text-2xl font-bold text-gray-600">{summary.nonSredHours.toFixed(1)}</p>
          </div>
        </div>
      {/if}

      <!-- Personnel breakdown -->
      {#if personnelData.length > 0}
        <div class="card mt-6 p-5">
          <h3 class="mb-3 text-sm font-semibold text-gray-900">Personnel Breakdown</h3>
          <table class="w-full text-sm">
            <caption class="sr-only">Personnel hours and primary activities</caption>
            <thead>
              <tr class="border-b border-gray-200">
                <th class="text-label pb-2 text-left">Person</th>
                <th class="text-label pb-2 text-right">Total Hours</th>
                <th class="text-label pb-2 text-right">SR&amp;ED Hours</th>
                <th class="text-label pb-2 pl-4 text-left">Primary Activities</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {#each personnelData as p, i (i)}
                <tr>
                  <td class="py-2 font-medium text-gray-900">{p.name}</td>
                  <td class="py-2 text-right text-gray-600">{p.totalHours.toFixed(1)}</td>
                  <td class="py-2 text-right font-medium text-primary">{p.sredHours.toFixed(1)}</td>
                  <td class="py-2 pl-4 text-xs text-gray-500">{p.primaryActivities?.join(", ")}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <!-- Timesheet entries -->
      {#if entries && entries.length > 0}
        <div class="card mt-6 p-5">
          <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-semibold text-gray-900">Extracted timesheet entries</h3>
            <span class="text-xs text-gray-500">
              {pendingEntries.length} awaiting review · {sredEntries.length} classified eligible · {nonSredEntries.length} classified non-eligible
            </span>
          </div>
          {#if reviewError}
            <p class="mb-3 text-sm text-red-700" role="alert">{reviewError}</p>
          {/if}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <caption class="sr-only">Extracted financial timesheet entries</caption>
              <thead>
                <tr class="border-b border-gray-200">
                  <th class="text-label pb-2 text-left">Person</th>
                  <th class="text-label pb-2 text-left">Date</th>
                  <th class="text-label pb-2 text-right">Hours / basis</th>
                  <th class="text-label pb-2 text-left">Description</th>
                  <th class="text-label pb-2 text-left">SR&amp;ED</th>
                  <th class="text-label pb-2 text-left">Confidence</th>
                  <th class="text-label pb-2 text-left">Review</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each entries as entry (entry._id)}
                  <tr class={entry.reviewStatus === "rejected" ? "opacity-60" : ""}>
                    <td class="whitespace-nowrap py-2 font-medium text-gray-900">{entry.personName}</td>
                    <td class="whitespace-nowrap py-2 text-gray-600">{entry.date}</td>
                    <td class="py-2 text-right text-gray-600">
                      {#if reviewingId === entry._id}
                        <label class="sr-only" for={`review-hours-${entry._id}`}>Reviewed hours</label>
                        <input
                          id={`review-hours-${entry._id}`}
                          type="number"
                          min="0"
                          max="24"
                          step="0.25"
                          bind:value={reviewedHours}
                          class="w-20 rounded-md border border-line-soft px-2 py-1 text-right text-sm"
                        />
                      {:else}
                        <span>{entry.hours.toFixed(1)}</span>
                      {/if}
                      <span class={`ml-1 text-[10px] ${entry.hoursBasis === "estimated" ? "text-amber-700" : "text-gray-400"}`}>
                        {entry.hoursBasis ?? "legacy"}
                      </span>
                    </td>
                    <td class="max-w-xs py-2 text-xs text-gray-600" title={entry.source}>{entry.description}</td>
                    <td class="py-2">
                      <span class={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        entry.sredEligible ? "bg-primary/10 text-navy" : "bg-gray-100 text-gray-500"
                      }`}>
                        {entry.sredEligible ? "Yes" : "No"}
                      </span>
                    </td>
                    <td class="py-2">
                      <span class={`text-xs ${
                        entry.confidence === "high" ? "text-green-600" :
                        entry.confidence === "medium" ? "text-amber-600" : "text-red-500"
                      }`}>
                        {entry.confidence}
                      </span>
                    </td>
                    <td class="py-2">
                      {#if reviewingId === entry._id}
                        <div class="flex gap-1">
                          <button
                            type="button"
                            disabled={reviewBusy}
                            class="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                            onclick={() => decideEntry("approved")}
                          >Approve</button>
                          <button
                            type="button"
                            disabled={reviewBusy}
                            class="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                            onclick={() => decideEntry("rejected")}
                          >Reject</button>
                          <button
                            type="button"
                            disabled={reviewBusy}
                            class="rounded-md px-2 py-1 text-xs text-gray-500"
                            onclick={() => (reviewingId = null)}
                          >Cancel</button>
                        </div>
                      {:else}
                        <button
                          type="button"
                          class="rounded-md border border-line-soft px-2 py-1 text-xs font-semibold text-navy hover:bg-primary-wash"
                          onclick={() => beginReview(entry)}
                        >
                          {entry.reviewStatus === "approved" ? "Approved · edit" : entry.reviewStatus === "rejected" ? "Rejected · review" : "Review"}
                        </button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </main>
  </div>
{/if}
