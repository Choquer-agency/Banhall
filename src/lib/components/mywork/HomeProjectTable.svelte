<!--
  One Home table (ui-design-final.md section 9, boards 1.1 and 1.2): a view
  chip that shows or hides the table, then Name, Client, Stage and Last
  edited. Each row is one link to the project; the name link stretches over
  the whole row. Rows carry data-recent-* so opening one records it in this
  device's Recently opened list.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { resolve } from "$app/paths";
  import { CaretDownIcon } from "phosphor-svelte";
  import HomeStageChip from "$lib/components/mywork/HomeStageChip.svelte";
  import DuplicateProjectButton from "$lib/components/workspace/DuplicateProjectButton.svelte";
  import { formatEdited } from "$lib/components/project/details/detailsFormat";
  import { clientInitial, clientTone, type HomeRow } from "$lib/mywork/homeRows";
  import { setProjectPagingContext } from "$lib/workspace/projectPagingContext";

  let {
    id,
    label,
    icon,
    rows,
    count = null,
    bounded = false,
    now,
    first = false,
    empty,
    footer,
  }: {
    id: string;
    label: string;
    icon: "table" | "clock";
    /** undefined while loading. */
    rows: HomeRow[] | undefined;
    count?: string | null;
    /** More rows exist beyond the loaded ones (paging context qualifier). */
    bounded?: boolean;
    now: number;
    /** The first table sits flush with the panel top; later ones get 40px above. */
    first?: boolean;
    empty: Snippet;
    footer?: Snippet;
  } = $props();

  let open = $state(true);

  function stashContext() {
    if (!rows) return;
    setProjectPagingContext({ ids: rows.map((row) => row.projectId), label, bounded });
  }
</script>

<section data-home-table={id} aria-labelledby={`${id}-label`}>
  <div class={`flex items-center gap-2 border-b border-line ${first ? "pb-4" : "pb-3 pt-10"}`}>
    <h2 class="flex">
      <button
        type="button"
        data-home-view-chip
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onclick={() => (open = !open)}
        class="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-gray-50 px-2 transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none"
      >
        {#if icon === "table"}
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" class="shrink-0 text-ink-secondary">
            <rect x="1.5" y="1.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path d="M1.5 5.5h11M5.5 5.5v7" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" class="shrink-0 text-ink-secondary">
            <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path d="M7 4v3l2 1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
        {/if}
        <span id={`${id}-label`} class="text-[13px] font-medium leading-[18px] text-ink">{label}</span>
        {#if count}
          <span data-home-table-count class="text-xs leading-[18px] text-ink-muted">{count}</span>
        {/if}
        <CaretDownIcon
          size={12}
          aria-hidden="true"
          class={`shrink-0 text-ink-muted transition-transform duration-200 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
        />
      </button>
    </h2>
  </div>

  {#if open}
    <div id={`${id}-body`}>
      {#if rows === undefined}
        <div role="status" aria-label={`Loading ${label}`} class="flex flex-col">
          {#each [0, 1, 2] as index (index)}
            <div class="flex h-11 items-center gap-3 border-b border-line-soft px-2">
              <span class="h-4 w-4 animate-pulse rounded bg-chrome motion-reduce:animate-none"></span>
              <span class="h-3 w-48 max-w-[50%] animate-pulse rounded bg-chrome motion-reduce:animate-none"></span>
            </div>
          {/each}
        </div>
      {:else if rows.length === 0}
        <div data-home-table-empty class="border-b border-line-soft px-2 py-3.5 text-xs leading-5 text-ink-muted">
          {@render empty()}
        </div>
      {:else}
        <table class="w-full table-fixed border-collapse text-left">
          <caption class="sr-only">{label}</caption>
          <thead>
            <tr class="h-9 border-b border-line-soft text-[11px] leading-4 text-ink-muted">
              <th scope="col" class="pl-2 font-normal">Name</th>
              <th scope="col" class="w-[136px] font-normal max-sm:hidden">Client</th>
              <th scope="col" class="w-[120px] font-normal">Stage</th>
              <th scope="col" class="w-[84px] font-normal max-sm:hidden">Last edited</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.projectId)}
              <tr data-home-row={row.projectId} class="group/project relative h-11 border-b border-line-soft transition-colors hover:bg-primary-wash motion-reduce:transition-none">
                <td class="pl-2 pr-3">
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      data-home-client-mark
                      class={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-medium leading-3 ${clientTone(row.clientName)}`}
                    >{clientInitial(row.clientName)}</span>
                    <a
                      href={resolve("/project/[id]", { id: row.projectId })}
                      data-recent-title={row.title}
                      data-recent-stage={row.stage}
                      data-recent-client={row.clientName || undefined}
                      onclick={stashContext}
                      class="min-w-0 truncate text-[13px] font-medium leading-[18px] text-ink outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-fir"
                    >{row.title}</a>
                    <DuplicateProjectButton projectId={row.projectId} projectTitle={row.title} deleting={row.deleting} class="ml-auto" />
                  </div>
                </td>
                <td class="pr-3 max-sm:hidden">
                  {#if row.clientName.trim()}
                    <span class="inline-block max-w-full truncate rounded border border-line px-[7px] py-0.5 align-middle text-xs leading-4 text-ink">{row.clientName}</span>
                  {/if}
                </td>
                <td class="pr-3"><HomeStageChip stage={row.stage} /></td>
                <td class="truncate text-xs leading-4 text-ink-secondary max-sm:hidden">
                  {row.editedAt ? formatEdited(row.editedAt, now) : ""}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {@render footer?.()}
    </div>
  {/if}
</section>
