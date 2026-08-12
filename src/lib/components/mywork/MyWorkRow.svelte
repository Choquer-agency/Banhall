<script lang="ts">
  import type { Snippet } from "svelte";
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { formatDue } from "$lib/workflow/due";

  let {
    href,
    title,
    workflowStage,
    dueAt,
    now,
    context,
    absentDueLabel,
    assignee,
    metadata,
    actions,
  }: {
    href: string;
    title: string;
    workflowStage: WorkflowStage;
    dueAt: number | null;
    now: number;
    context: string;
    absentDueLabel: string;
    assignee?: { label: string; initials: string } | null;
    metadata?: Snippet;
    actions?: Snippet;
  } = $props();

  const due = $derived(formatDue(dueAt, now));
</script>

<li class="border-b border-line-soft last:border-b-0">
  <!-- A real due date keeps first-line priority pinned right. An absent due
       state remains explicit in secondary metadata so it never steals title
       width. The same grid resolves Title → Due → context → assignee/actions
       on narrow screens. -->
  <div class="mywork-row grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2">
    <a
      {href}
      class={`row-start-1 min-w-0 truncate text-sm font-medium text-ink hover:text-primary-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${due ? "col-start-1" : "col-span-2"}`}
    >{title}</a>

    {#if due}
      <span
        data-due-state={due.overdue ? "overdue" : "scheduled"}
        class={`col-start-2 row-start-1 justify-self-end text-xs ${due.overdue ? "font-semibold text-red-700" : "text-ink-muted"}`}
      >{due.relative}</span>
    {/if}

    <span class="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <StageBadge stage={workflowStage} dot />
      {@render metadata?.()}
      <span class="min-w-0 truncate text-xs text-ink-muted">{context}</span>
      {#if !due}
        <span data-due-absent class="shrink-0 text-xs text-ink-muted">{absentDueLabel}</span>
      {/if}
    </span>

    <span class="col-start-2 row-start-2 flex shrink-0 items-center justify-end gap-x-3">
      {#if assignee}
        <!-- Named through real (sr-only) text: aria-label on a generic span
             is name-prohibited and unreliably exposed (the compact mobile
             row hides the visible name, so the text node is the truth). -->
        <span data-assignee class="flex items-center gap-1.5">
          <span class="sr-only">Assigned to {assignee.label}</span>
          <span class="mywork-avatar-sm flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-medium" aria-hidden="true">{assignee.initials}</span>
          <span class="hidden max-w-36 truncate text-xs text-ink-muted sm:inline" aria-hidden="true">{assignee.label}</span>
        </span>
      {/if}
      {@render actions?.()}
    </span>
  </div>
</li>

<style>
  .mywork-row {
    /* Rule 8: ≥300ms with a restrained ease-out (same curve as the shared
       Disclosure and shell transitions — no default-ease outlier). */
    transition: background-color 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .mywork-row:hover {
    background: var(--color-primary-wash);
  }
  .mywork-avatar-sm {
    background: var(--color-fir);
    color: #ffffff;
  }
  @media (prefers-reduced-motion: reduce) {
    .mywork-row {
      transition: none;
    }
  }
</style>
