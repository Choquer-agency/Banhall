<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import Button from "$lib/components/ui/Button.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

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

  const uploadData = useMutation(api.financial.uploadFinancialData);
  const deleteUpload = useMutation(api.financial.deleteUpload);

  let fileType = $state<(typeof FILE_TYPES)[number]["value"]>("slack_export");
  let fileName = $state("");
  let content = $state("");
  let uploading = $state(false);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  async function handleUpload() {
    if (!content.trim() || !fileName.trim()) return;
    uploading = true;
    try {
      await uploadData({
        projectId,
        fileName: fileName.trim(),
        fileType,
        content: content.trim(),
      });
      content = "";
      fileName = "";
    } finally {
      uploading = false;
    }
  }

  const project = $derived(projectQ.data);
  const uploads = $derived(uploadsQ.data);
  const entries = $derived(entriesQ.data);
  const summary = $derived(summaryQ.data);

  const sredEntries = $derived(entries?.filter((e) => e.sredEligible) ?? []);
  const nonSredEntries = $derived(entries?.filter((e) => !e.sredEligible) ?? []);

  type PersonnelRow = {
    name: string;
    totalHours: number;
    sredHours: number;
    primaryActivities: string[];
  };
  const personnelData = $derived.by((): PersonnelRow[] => {
    if (!summary?.personnelBreakdown) return [];
    try {
      const parsed = JSON.parse(summary.personnelBreakdown);
      return parsed.personnelBreakdown ?? [];
    } catch {
      return [];
    }
  });
</script>

{#if auth.isLoading || !auth.isAuthenticated || !project}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav
      width="max-w-5xl"
      breadcrumbs={[
        { label: project.title || "Project", href: `/project/${projectId}` },
        { label: "Financial" },
      ]}
    />
    <PageBar width="max-w-5xl" backHref={`/project/${projectId}`} backLabel="Back to report" />

    <main class="mx-auto w-full max-w-5xl flex-1 px-6 pt-12 pb-8">
      <h2 class="text-display">Financial Analysis</h2>
      <p class="mt-1 text-sm text-gray-500">
        Upload communication logs, Git commits, or financial data to reconstruct timesheets and classify SR&amp;ED eligibility.
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
        <div class="mt-3 flex justify-end">
          <Button onclick={handleUpload} disabled={uploading || !content.trim() || !fileName.trim()}>
            {uploading ? "Uploading..." : "Upload & Process"}
          </Button>
        </div>
      </div>

      <!-- Uploads list -->
      {#if uploads && uploads.length > 0}
        <div class="mt-6">
          <h3 class="text-sm font-semibold text-gray-900">Uploaded Data Sources</h3>
          <div class="mt-2 space-y-2">
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
                </div>
                <button
                  onclick={() => deleteUpload({ uploadId: upload._id })}
                  class="text-xs text-gray-400 transition-colors hover:text-red-500"
                >
                  Remove
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
            <p class="text-label">Total Hours</p>
            <p class="mt-1 text-2xl font-bold text-navy">{summary.totalHours.toFixed(1)}</p>
          </div>
          <div class="card p-5">
            <p class="text-label">SR&amp;ED Eligible</p>
            <p class="mt-1 text-2xl font-bold text-primary">{summary.sredHours.toFixed(1)}</p>
            <p class="text-xs text-gray-400">{summary.totalHours > 0 ? Math.round((summary.sredHours / summary.totalHours) * 100) : 0}% of total</p>
          </div>
          <div class="card p-5">
            <p class="text-label">Non-Eligible</p>
            <p class="mt-1 text-2xl font-bold text-gray-600">{summary.nonSredHours.toFixed(1)}</p>
          </div>
        </div>
      {/if}

      <!-- Personnel breakdown -->
      {#if personnelData.length > 0}
        <div class="card mt-6 p-5">
          <h3 class="mb-3 text-sm font-semibold text-gray-900">Personnel Breakdown</h3>
          <table class="w-full text-sm">
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
          <h3 class="mb-3 text-sm font-semibold text-gray-900">
            Extracted Timesheet Entries
            <span class="ml-2 text-xs font-normal text-gray-400">
              {sredEntries.length} eligible, {nonSredEntries.length} non-eligible
            </span>
          </h3>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200">
                  <th class="text-label pb-2 text-left">Person</th>
                  <th class="text-label pb-2 text-left">Date</th>
                  <th class="text-label pb-2 text-right">Hours</th>
                  <th class="text-label pb-2 text-left">Description</th>
                  <th class="text-label pb-2 text-left">SR&amp;ED</th>
                  <th class="text-label pb-2 text-left">Confidence</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each entries as entry, i (i)}
                  <tr class={entry.sredEligible ? "" : "opacity-60"}>
                    <td class="whitespace-nowrap py-2 font-medium text-gray-900">{entry.personName}</td>
                    <td class="whitespace-nowrap py-2 text-gray-600">{entry.date}</td>
                    <td class="py-2 text-right text-gray-600">{entry.hours.toFixed(1)}</td>
                    <td class="max-w-xs truncate py-2 text-xs text-gray-600">{entry.description}</td>
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
