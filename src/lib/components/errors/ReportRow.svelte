<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { formatReportMarkdown } from "./format";

  const TYPE_LABEL: Record<string, string> = {
    nav: "nav",
    click: "click",
    network: "net",
    console: "log",
    error: "error",
  };

  function timeAgo(ts: number): string {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  let { report }: { report: Doc<"errorReports"> } = $props();

  let open = $state(false);
  let copied = $state(false);

  const setStatus = useMutation(api.errorReports.setStatus);
  const deleteError = useMutation(api.errorReports.deleteError);

  const isResolved = $derived(report.status === "resolved");

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatReportMarkdown(report));
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      /* clipboard blocked — ignore */
    }
  }
</script>

<div
  class={`rounded-xl border bg-white transition-colors ${
    isResolved ? "border-gray-100 opacity-60" : "border-gray-200"
  }`}
>
  <!-- Collapsed header row -->
  <button
    onclick={() => (open = !open)}
    class="flex w-full items-center gap-3 px-4 py-3 text-left"
  >
    <svg
      class={`h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform ${
        open ? "rotate-90" : ""
      }`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
    </svg>

    <span
      class={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        report.reportType === "feature"
          ? "bg-primary/15 text-primary-dark"
          : report.kind === "manual"
            ? "bg-amber-100 text-amber-700"
            : "bg-red-100 text-red-700"
      }`}
    >
      {report.reportType === "feature"
        ? "Feature"
        : report.kind === "manual"
          ? "Bug"
          : "Error"}
    </span>

    <span class="min-w-0 flex-1 truncate text-sm text-navy">
      {report.message}
    </span>

    <span class="hidden flex-shrink-0 truncate text-xs text-gray-400 sm:block sm:max-w-[160px]">
      {report.url}
    </span>
    <span class="flex-shrink-0 text-xs text-gray-400">
      {timeAgo(report.createdAt)}
    </span>
  </button>

  <!-- Expanded detail -->
  {#if open}
    <div class="space-y-4 border-t border-gray-100 px-4 py-4 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <button
          onclick={copy}
          class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark"
        >
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
            />
          </svg>
          {copied ? "Copied!" : "Copy for Claude Code"}
        </button>
        <button
          onclick={() =>
            setStatus({
              id: report._id,
              status: isResolved ? "open" : "resolved",
            })}
          class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          {isResolved ? "Reopen" : "Mark resolved"}
        </button>
        <button
          onclick={() => deleteError({ id: report._id })}
          class="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-red-600"
        >
          Delete
        </button>
      </div>

      <dl class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
        <dt class="text-gray-400">Page</dt>
        <dd class="break-all font-mono text-navy">{report.url}</dd>
        {#if report.source}
          <dt class="text-gray-400">Source</dt>
          <dd class="break-all font-mono text-navy">
            {report.source}
          </dd>
        {/if}
        {#if report.userEmail}
          <dt class="text-gray-400">Reporter</dt>
          <dd class="text-navy">{report.userEmail}</dd>
        {/if}
        <dt class="text-gray-400">When</dt>
        <dd class="text-navy">
          {new Date(report.createdAt).toLocaleString()}
        </dd>
      </dl>

      {#if report.userNote}
        <div>
          <p class="mb-1 text-xs font-semibold text-gray-500">
            What the user said
          </p>
          <p class="whitespace-pre-wrap rounded-lg bg-chrome px-3 py-2 text-sm text-navy">
            {report.userNote}
          </p>
        </div>
      {/if}

      {#if report.breadcrumbs.length > 0}
        <div>
          <p class="mb-1 text-xs font-semibold text-gray-500">
            Recent activity (most recent last)
          </p>
          <ol class="space-y-1">
            {#each report.breadcrumbs as b, i (i)}
              <li class="flex items-start gap-2 text-xs">
                <span class="mt-0.5 w-12 flex-shrink-0 font-mono text-gray-400">
                  {TYPE_LABEL[b.type] ?? b.type}
                </span>
                <span class="min-w-0 text-navy">
                  {b.label}
                  {#if b.detail}
                    <span class="text-gray-400"> — {b.detail}</span>
                  {/if}
                </span>
              </li>
            {/each}
          </ol>
        </div>
      {/if}

      {#if report.stack}
        <div>
          <p class="mb-1 text-xs font-semibold text-gray-500">
            Stack trace
          </p>
          <pre class="overflow-x-auto rounded-lg bg-navy px-3 py-2 text-[11px] leading-relaxed text-white/80">{report.stack}</pre>
        </div>
      {/if}

      {#if report.userAgent}
        <p class="break-all text-[11px] text-gray-400">
          {report.userAgent}
        </p>
      {/if}
    </div>
  {/if}
</div>
