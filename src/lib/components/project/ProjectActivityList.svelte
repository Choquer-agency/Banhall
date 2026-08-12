<script lang="ts">
  // Read-only project activity timeline: an append-only CRM grammar over
  // the canonical immutable audit events (projectEvents + workItemEvents).
  // Dense ruled rows — timestamp, actor, labelled event, text diff, optional
  // note — never decorative cards, never color-only diffs, no mutations.
  import {
    formatActivityTimestamp,
    presentActivityEntry,
    type ActivityEntry,
  } from "$lib/workflow/activityPresentation";

  let {
    // Aliased for consistency with WorkflowDetailsPanel (`state` shadows the rune).
    state: listState,
    entries = [],
    truncated = false,
    labelledBy,
  }: {
    state: "loading" | "ready" | "error" | "denied";
    entries?: ActivityEntry[];
    truncated?: boolean;
    labelledBy: string;
  } = $props();
</script>

{#if listState === "loading"}
  <div class="space-y-2 py-3" aria-busy="true">
    <span class="sr-only" role="status">Loading project activity…</span>
    <div class="h-4 w-40 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
    <div class="h-4 w-52 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
    <div class="h-4 w-32 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
  </div>
{:else if listState === "error"}
  <p class="py-3 text-sm leading-relaxed text-red-700" role="alert">
    Project activity is temporarily unavailable. Close and reopen Workflow to retry.
  </p>
{:else if listState === "denied"}
  <p class="py-3 text-sm leading-relaxed text-ink-secondary">
    Project activity is not available for this project.
  </p>
{:else if entries.length === 0}
  <p class="py-3 text-sm leading-relaxed text-ink-secondary">
    No recorded activity yet. Ownership, stage, and work changes will appear here.
  </p>
{:else}
  <ol role="list" aria-labelledby={labelledBy} class="divide-y divide-line-soft">
    {#each entries as entry (entry.id)}
      {@const presentation = presentActivityEntry(entry)}
      <li data-activity-entry={entry.kind} class="py-2.5">
        <p class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <time datetime={new Date(entry.at).toISOString()} class="text-data text-ink-muted">
            {formatActivityTimestamp(entry.at)}
          </time>
          <span class="text-xs font-medium text-ink-secondary">{entry.actor.label}</span>
        </p>
        <p class="mt-0.5 text-sm font-semibold text-ink">{presentation.label}</p>
        {#if presentation.detail}
          <p class="mt-0.5 text-xs leading-5 text-ink-secondary">{presentation.detail}</p>
        {/if}
        {#if presentation.note}
          <p class="mt-0.5 text-xs leading-5 text-ink-muted">Note: {presentation.note}</p>
        {/if}
      </li>
    {/each}
  </ol>
  {#if truncated}
    <p data-activity-truncated class="border-t border-line-soft pt-2 text-xs leading-relaxed text-ink-muted">
      Showing the {entries.length} most recent events. Older history is preserved but not loaded here.
    </p>
  {/if}
{/if}
