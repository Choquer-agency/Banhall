<!--
  A company's Activity tab (2026-11-04, the company profile; Paper
  "Activity / By day, with people and links"). One list by day, newest
  first: company files added, replaced, archived, restored and deleted,
  website reads, projects started for a fiscal year, stage moves and drafts
  started. Each row names who, what and when; a project is a light teal
  label that opens the project, a file a grey label that opens the Files tab
  (`onOpenFiles`, else the `?tab=files` link). Filters: Everyone or one person (the people seen so far),
  and All changes or one kind. 25 rows a page with Show more
  (companyActivity.listCompanyActivity). Mounted by CompanyView; its reads
  stop while hidden.
-->
<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { SvelteMap } from "svelte/reactivity";
  import { useConvexClient, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import { stageBadgeClasses } from "$lib/workflow/stagePresentation";
  import { userErrorMessage } from "$lib/errors";
  import { WORKFLOW_STAGE_LABELS } from "../../../../../shared/workflowLabels";
  import type { WorkflowStage } from "../../../../../shared/workflowStages";
  import {
    ACTIVITY_KINDS,
    avatarToneIndex,
    fileVerb,
    groupActivity,
    timeLabel,
    type ActivityActor,
    type ActivityEntry,
    type ActivityKind,
  } from "./activityFormat";

  let {
    companyKey,
    companyName,
    active = false,
    onOpenFiles = undefined,
  }: {
    companyKey: string;
    companyName: string;
    /** Shown; reads stop while hidden. */
    active?: boolean;
    /**
     * Opens the Files tab. When given, a file label calls it instead of
     * following its `?tab=files` link (which stays for open in a new tab).
     */
    onOpenFiles?: () => void;
    /** Accepted for the tab contract the placeholder had; Activity is read-only and has no count. */
    canManage?: boolean;
    onCount?: (count: number | null) => void;
  } = $props();

  type Page = { entries: ActivityEntry[]; continueCursor: string | null; projectsTruncated: boolean };

  const auth = useAuth();
  const client = useConvexClient();

  let personId = $state<string | null>(null);
  let kind = $state<ActivityKind | null>(null);

  function argsFor(cursor: string | null) {
    return {
      companyKey,
      cursor,
      ...(personId ? { personId: personId as Id<"users"> } : {}),
      ...(kind ? { kind } : {}),
    };
  }

  const firstQ = useQuery(api.companyActivity.listCompanyActivity, () =>
    auth.isAuthenticated && active ? argsFor(null) : "skip"
  );

  // Older pages, read once each (Show more); reset when the list changes.
  // The first page as it was at the first Show more is kept too: a newer
  // change pushes the live first page's last rows off it, and the older
  // pages start after the old boundary, so without it those rows would
  // belong to no page (Greptile, PR #33).
  let more = $state<Page[]>([]);
  let firstAtMore = $state<Page | null>(null);
  let loadingMore = $state(false);
  let moreError = $state<string | null>(null);
  const listKey = $derived(JSON.stringify([companyKey, personId, kind]));
  let shownKey = "";
  $effect.pre(() => {
    if (listKey !== shownKey) {
      shownKey = listKey;
      more = [];
      firstAtMore = null;
      moreError = null;
    }
  });

  const first = $derived(firstQ.data as Page | undefined);
  const entries = $derived.by(() => {
    if (!first) return [] as ActivityEntry[];
    const seen = new Set<string>();
    const all: ActivityEntry[] = [];
    for (const page of [first, ...(firstAtMore ? [firstAtMore] : []), ...more]) {
      for (const entry of page.entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        all.push(entry);
      }
    }
    return all;
  });
  const nextCursor = $derived(more.length > 0 ? more[more.length - 1].continueCursor : (first?.continueCursor ?? null));
  const days = $derived(groupActivity(entries, Date.now()));

  async function showMore() {
    if (!nextCursor || loadingMore) return;
    const key = listKey;
    const shownFirst = first;
    loadingMore = true;
    moreError = null;
    try {
      const page = (await client.query(api.companyActivity.listCompanyActivity, argsFor(nextCursor))) as Page;
      if (key === listKey) {
        if (more.length === 0 && firstAtMore === null && shownFirst) firstAtMore = shownFirst;
        more = [...more, page];
      }
    } catch (error) {
      if (key === listKey) moreError = userErrorMessage(error, "Older changes could not be loaded. Try again.");
    } finally {
      loadingMore = false;
    }
  }

  // The people the Everyone menu offers: everyone seen in this company's
  // activity so far, kept while filters change.
  const people = new SvelteMap<string, string>();
  let peopleFor = "";
  $effect(() => {
    if (peopleFor !== companyKey) {
      peopleFor = companyKey;
      people.clear();
      personId = null;
      kind = null;
    }
    for (const entry of entries) {
      if (entry.actor && !people.has(entry.actor.userId)) people.set(entry.actor.userId, entry.actor.label);
    }
  });
  const personOptions = $derived([...people].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)));
  const personLabel = $derived(personId ? (people.get(personId) ?? "One person") : "Everyone");
  const kindLabel = $derived(kind ? ACTIVITY_KINDS.find((option) => option.value === kind)!.label : "All changes");

  const TONES = [
    "bg-role-admin text-role-admin-ink",
    "bg-primary-highlight text-primary-selected",
    "bg-warning-soft text-warning-ink-muted",
  ];
  const toneOf = (actor: ActivityActor) => (actor ? TONES[avatarToneIndex(actor.userId, TONES.length)] : "bg-gray-100 text-ink-muted");
  const nameOf = (actor: ActivityActor) => actor?.label ?? "Someone";

  const filterTrigger =
    "flex h-8 items-center gap-1.5 rounded-lg bg-surface pl-3 pr-2.5 text-[0.8125rem] leading-[calc(16/13)] font-medium text-ink-secondary shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy data-[state=open]:bg-primary-wash motion-reduce:transition-none pointer-coarse:h-11";
  const menuItem =
    "flex min-h-9 w-full cursor-default items-center gap-2 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink data-[state=checked]:text-ink data-[state=checked]:font-medium pointer-coarse:min-h-11";
  const projectLabel =
    "inline-flex h-6 max-w-[20rem] shrink-0 items-center gap-1.5 rounded-md bg-primary-wash px-2 text-xs leading-[calc(4/3)] text-primary-selected transition-colors hover:bg-primary-highlight hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none";
  const fileLabel =
    "inline-flex h-6 max-w-[20rem] shrink-0 items-center gap-1.5 rounded-md bg-gray-50 px-2 text-xs leading-[calc(4/3)] text-ink";
</script>

{#snippet chevron()}
  <svg viewBox="0 0 24 24" class="size-3 text-ink-muted" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
{/snippet}

{#snippet check(on: boolean)}
  <span class="flex size-3.5 shrink-0 items-center justify-center text-primary-selected" aria-hidden="true">
    {#if on}<svg viewBox="0 0 24 24" class="size-3.5"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
  </span>
{/snippet}

{#snippet project(ref: { id: string; title: string })}
  <a href={`/project/${ref.id}`} class={projectLabel} data-activity-project={ref.id}>
    <svg viewBox="0 0 24 24" class="size-[0.8125rem] shrink-0" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    <span class="truncate">{ref.title}</span>
  </a>
{/snippet}

{#snippet stageChip(stage: string)}
  <span class={`inline-flex h-[1.375rem] shrink-0 items-center rounded-full px-2 text-[0.6875rem] leading-[calc(14/11)] font-medium ${stageBadgeClasses(stage as WorkflowStage).badge}`} data-activity-stage={stage}>
    {WORKFLOW_STAGE_LABELS[stage as WorkflowStage] ?? stage}
  </span>
{/snippet}

{#snippet avatar(actor: ActivityActor)}
  <span aria-hidden="true" class={`flex size-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] leading-[1.2] font-medium ${toneOf(actor)}`}>{actor?.initials ?? "?"}</span>
{/snippet}

{#snippet who(actor: ActivityActor)}<span class="font-medium text-ink">{nameOf(actor)}</span>{/snippet}

<section class="flex flex-col" data-company-activity aria-labelledby="company-activity-title">
  <div class="flex flex-wrap items-end gap-2">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <h2 id="company-activity-title" class="font-serif text-2xl leading-[calc(4/3)] font-normal text-ink">Activity</h2>
      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">What changed on {companyName} and its projects.</p>
    </div>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={filterTrigger} aria-label={`Show changes by: ${personLabel}`} data-activity-person-filter>
        <span class="max-w-[10rem] truncate">{personLabel}</span>
        {@render chevron()}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={4} class="z-[100] max-h-[20rem] min-w-[12.5rem] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-menu outline-none">
          <DropdownMenu.RadioGroup value={personId ?? ""} onValueChange={(value) => (personId = value || null)}>
            <DropdownMenu.RadioItem value="" class={menuItem} data-activity-person-option="">
              {#snippet children({ checked })}{@render check(checked)}Everyone{/snippet}
            </DropdownMenu.RadioItem>
            {#each personOptions as option (option.value)}
              <DropdownMenu.RadioItem value={option.value} class={menuItem} data-activity-person-option={option.value}>
                {#snippet children({ checked })}{@render check(checked)}<span class="truncate">{option.label}</span>{/snippet}
              </DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={filterTrigger} aria-label={`Show: ${kindLabel}`} data-activity-kind-filter>
        <span>{kindLabel}</span>
        {@render chevron()}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={4} class="z-[100] min-w-[12.5rem] rounded-lg border border-line bg-surface p-1 shadow-menu outline-none">
          <DropdownMenu.RadioGroup value={kind ?? ""} onValueChange={(value) => (kind = (value || null) as ActivityKind | null)}>
            <DropdownMenu.RadioItem value="" class={menuItem} data-activity-kind-option="">
              {#snippet children({ checked })}{@render check(checked)}All changes{/snippet}
            </DropdownMenu.RadioItem>
            {#each ACTIVITY_KINDS as option (option.value)}
              <DropdownMenu.RadioItem value={option.value} class={menuItem} data-activity-kind-option={option.value}>
                {#snippet children({ checked })}{@render check(checked)}{option.label}{/snippet}
              </DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>

  {#if firstQ.error}
    <p class="mt-7 border-t border-line-soft py-10 text-center text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-activity-failed>
      The activity could not be loaded. Reload the page to try again.
    </p>
  {:else if !first}
    <div class="mt-7 border-t border-line-soft" aria-busy="true" aria-label="Loading activity" data-activity-loading>
      {#each [0, 1, 2] as row (row)}
        <div class="flex gap-6 border-b border-line-soft py-[1.125rem]">
          <div class="flex w-[7.5rem] shrink-0 flex-col gap-1.5"><span class="h-3 w-14 rounded bg-skeleton-line"></span><span class="h-2.5 w-10 rounded bg-skeleton-line"></span></div>
          <div class="flex flex-1 items-center gap-2.5"><span class="size-6 rounded-full bg-skeleton-chip"></span><span class="h-3 w-64 rounded bg-skeleton-line"></span></div>
        </div>
      {/each}
    </div>
  {:else if days.length === 0 && !nextCursor}
    <p class="mt-7 border-t border-line-soft py-10 text-center text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-activity-empty>
      {personId || kind ? "No changes match these filters." : `Nothing has changed on ${companyName} yet.`}
    </p>
  {:else}
    <ol class="mt-7 flex flex-col border-t border-line-soft" data-activity-days>
      {#each days as day (day.key)}
        <li class="flex gap-6 border-b border-line-soft py-[1.125rem]" data-activity-day={day.key}>
          <div class="flex w-[7.5rem] shrink-0 flex-col gap-0.5">
            <span class="text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink" data-activity-day-title>{day.title}</span>
            <span class="text-xs leading-[calc(4/3)] text-ink-muted">{day.subtitle}</span>
          </div>
          <ul class="flex min-w-0 flex-1 flex-col gap-3">
            {#each day.rows as row (row.id)}
              <li class="flex min-w-0 flex-wrap items-center gap-2.5" data-activity-row={row.kind}>
                {#if row.kind === "website"}
                  <span aria-hidden="true" class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-highlight text-primary-selected">
                    <svg viewBox="0 0 24 24" class="size-[0.8125rem]">
                      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
                      <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <span class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" title={row.outcome === "failed" && row.reason ? row.reason : undefined}>
                    The website <span class="text-primary-selected">{row.host}</span>
                    {row.outcome === "failed" ? "could not be read" : "was read into files"}
                  </span>
                {:else}
                  {@render avatar(row.actor)}
                  {#if row.kind === "files"}
                    <span class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{@render who(row.actor)} {fileVerb(row.action, row.files.length)}</span>
                    {#if row.action === "removed"}
                      <span class={fileLabel} data-activity-file={row.files[0].fileId}>
                        <FileIcon name={row.files[0].fileName} size={13} />
                        <span class="truncate">{row.files[0].fileName}</span>
                      </span>
                    {:else}
                      <a
                        href="?tab=files"
                        onclick={(event) => {
                          if (!onOpenFiles || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                          event.preventDefault();
                          onOpenFiles();
                        }}
                        class={`${fileLabel} transition-colors hover:bg-gray-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none`} data-activity-file={row.files[0].fileId}>
                        <FileIcon name={row.files[0].fileName} size={13} />
                        <span class="truncate">{row.files[0].fileName}</span>
                      </a>
                    {/if}
                    {#if row.files.length > 1}
                      <span
                        class="inline-flex h-6 items-center rounded-md bg-gray-50 px-2 text-xs leading-[calc(4/3)] text-ink-muted"
                        title={row.files.slice(1).map((file) => file.fileName).join(", ")}
                        data-activity-more-files
                      >+{row.files.length - 1}</span>
                    {/if}
                  {:else if row.kind === "project_started"}
                    <span class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{@render who(row.actor)} started</span>
                    {@render project(row.project)}
                    {#if row.fiscalYear !== null}<span class="text-[0.8125rem] leading-[calc(16/13)] text-ink-secondary">for FY {row.fiscalYear}</span>{/if}
                  {:else if row.kind === "stage_moved"}
                    <span class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{@render who(row.actor)} moved</span>
                    {@render project(row.project)}
                    <span class="flex items-center gap-1.5">
                      {#if row.fromStage}
                        {@render stageChip(row.fromStage)}
                        <svg viewBox="0 0 24 24" class="size-3 text-ink-faint" aria-label="to"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                      {/if}
                      {@render stageChip(row.toStage)}
                    </span>
                  {:else if row.kind === "draft_started"}
                    <span class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{@render who(row.actor)} started drafting</span>
                    {@render project(row.project)}
                  {/if}
                {/if}
                <time datetime={new Date(row.at).toISOString()} class="ml-auto shrink-0 text-xs leading-[calc(4/3)] text-ink-faint">{timeLabel(row.at)}</time>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ol>

    {#if moreError}
      <p role="alert" class="mt-4 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted">{moreError}</p>
    {/if}
    {#if nextCursor}
      <div class="mt-4 flex justify-center">
        <button
          type="button"
          onclick={() => void showMore()}
          disabled={loadingMore}
          data-activity-show-more
          class="flex h-8 items-center rounded-lg border border-line bg-surface px-3.5 text-[0.8125rem] leading-[calc(16/13)] font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11"
        >{loadingMore ? "Loading..." : "Show more"}</button>
      </div>
    {/if}
    {#if [first, ...more].some((loaded) => loaded.projectsTruncated) && !nextCursor}
      <p class="mt-4 text-xs leading-[calc(4/3)] text-ink-muted" data-activity-truncated>
        Showing changes on the 50 newest projects of {companyName}.
      </p>
    {/if}
  {/if}
</section>
