<script lang="ts">
  // Team, Past writers (writers from initials, 2026-11-16): the writers with
  // no login that imported PDs point at, under the members and pending
  // invites, shown only when there is at least one. Columns: Writer (its
  // name, or its initials with "Add a name"), Initials and PDs (how many
  // import files point at it). Admins get a row menu (Edit name, Link to an
  // account, Delete when no file points at it). When exactly one member has
  // the same saved initials the row says so quietly, with Link; it is never
  // linked automatically. A name read from a PD ("Prepared by ...") rather
  // than typed by a person has a quiet "From a PD" tag beside it. Others see
  // it read only. Same table look as Pending invites: 36px header, 48px rows.
  import PastWriterRowMenu from "./PastWriterRowMenu.svelte";
  import { formatCount } from "$lib/components/import/importFormat";

  export type PastWriter = {
    _id: string;
    name: string | null;
    initials: string | null;
    label: string;
    /** Its name was read from a PD, not typed by a person. */
    nameFromDocument?: boolean;
    fileCount: number;
    /** No file points at it or remembers it from before a pick. */
    canDelete: boolean;
    sameInitialsAs: { userId: string; name: string; canLink: boolean } | null;
  };

  let {
    writers,
    showActions,
    onEditName,
    onLink,
    onDelete,
  }: {
    writers: PastWriter[];
    showActions: boolean;
    onEditName: (writer: PastWriter) => void;
    /** Link, with the member the same-initials hint names, if any. */
    onLink: (writer: PastWriter, userId: string | null) => void;
    onDelete: (writer: PastWriter) => void;
  } = $props();

  const QUIET_BUTTON =
    "shrink-0 rounded text-[0.8125rem] leading-[calc(19/13)] text-primary-selected hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
</script>

<section id="team-past-writers" data-past-writers class="flex shrink-0 scroll-mt-4 flex-col gap-2.5 pt-2">
  <div class="flex flex-col gap-1">
    <h2 class="flex items-center gap-2">
      <span class="text-[0.9375rem] leading-[calc(22/15)] font-medium text-ink">Past writers</span>
      <span data-past-writers-count class="flex h-5 items-center rounded-full bg-chrome px-[0.4375rem] text-xs leading-[calc(4/3)] font-medium text-ink-secondary">{writers.length}</span>
    </h2>
    <p class="text-[0.8125rem] leading-[calc(19/13)] text-ink-muted">
      People who wrote imported PDs and have no login. They can be chosen as a writer on Import, but cannot sign in or be given work.
    </p>
  </div>
  <div class="overflow-x-auto rounded-[0.625rem] border border-line-soft">
    <div class="min-w-[40rem]" role="table" aria-label="Past writers">
      <div role="row" class="flex h-9 items-center gap-4 border-b border-line-soft bg-canvas px-4 text-xs leading-[calc(4/3)] text-ink-muted">
        <span role="columnheader" class="min-w-0 flex-1">Writer</span>
        <span role="columnheader" class="w-[5rem] shrink-0">Initials</span>
        <span role="columnheader" class={`w-[5rem] shrink-0 ${showActions ? "pr-8" : ""}`}>PDs</span>
        {#if showActions}<span role="columnheader" class="sr-only">Actions</span>{/if}
      </div>
      {#each writers as writer (writer._id)}
        <div role="row" data-past-writer-row={writer._id} class="relative flex h-12 items-center gap-4 border-b border-line-soft px-4 last:border-b-0">
          <span role="cell" class="flex min-w-0 flex-1 items-center gap-2.5">
            <span data-past-writer-name class="truncate text-[0.8125rem] leading-[calc(19/13)] font-medium text-ink">{writer.label}</span>
            {#if writer.name && writer.nameFromDocument}
              <span data-past-writer-from-pd class="shrink-0 text-xs leading-[calc(4/3)] text-ink-muted">From a PD</span>
            {/if}
            {#if !writer.name && showActions}
              <button type="button" data-past-writer-add-name onclick={() => onEditName(writer)} class={QUIET_BUTTON}>Add a name</button>
            {/if}
            {#if writer.sameInitialsAs}
              <span data-past-writer-hint class="flex min-w-0 items-center gap-1.5 text-[0.8125rem] leading-[calc(19/13)] text-ink-muted">
                <span class="truncate">Same initials as {writer.sameInitialsAs.name}</span>
                {#if showActions && writer.sameInitialsAs.canLink}
                  <button
                    type="button"
                    data-past-writer-hint-link
                    aria-label={`Link ${writer.label} to ${writer.sameInitialsAs.name}`}
                    onclick={() => onLink(writer, writer.sameInitialsAs?.userId ?? null)}
                    class={QUIET_BUTTON}
                  >Link</button>
                {/if}
              </span>
            {/if}
          </span>
          <span role="cell" data-past-writer-initials class="w-[5rem] shrink-0 truncate text-[0.8125rem] leading-[calc(19/13)] text-ink-secondary">{writer.initials ?? ""}</span>
          <span role="cell" data-past-writer-pds class={`w-[5rem] shrink-0 text-[0.8125rem] leading-[calc(19/13)] tabular-nums text-ink-secondary ${showActions ? "pr-8" : ""}`}>{formatCount(writer.fileCount)}</span>
          {#if showActions}
            <span role="cell" class="absolute right-4 top-1/2 flex w-7 -translate-y-1/2 justify-end">
              <PastWriterRowMenu
                label={writer.label}
                writerId={writer._id}
                canDelete={writer.canDelete}
                onEditName={() => onEditName(writer)}
                onLink={() => onLink(writer, null)}
                onDelete={() => onDelete(writer)}
              />
            </span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</section>
