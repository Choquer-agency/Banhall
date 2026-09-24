<!--
  Sources tab (ui-design-final.md section 2). Lists the project's interview
  transcripts and its active context documents from the page's existing
  metadata queries. Generation-frozen sources have no public read yet, so this
  shows the project's current sources; archived documents are listed apart as
  out of AI context.
-->
<script lang="ts">
  import { FileTextIcon, MicrophoneIcon } from "phosphor-svelte";

  type TranscriptRow = { _id: string; label: string; wordCount: number; createdAt: number };
  type DocumentRow = {
    _id: string;
    fileName: string;
    category: string | null;
    createdAt: number;
    sizeChars: number;
    archived: boolean;
    url: string | null;
  };

  let {
    transcripts,
    documents,
    loading = false,
  }: {
    transcripts: TranscriptRow[];
    documents: DocumentRow[];
    loading?: boolean;
  } = $props();

  const active = $derived(documents.filter((doc) => !doc.archived));
  const archived = $derived(documents.filter((doc) => doc.archived));

  function added(timestamp: number) {
    return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
</script>

<div data-sources-view class="mx-auto w-full max-w-[660px] px-6 py-10">
  <h2 class="font-serif text-2xl text-ink">Sources</h2>
  <p class="mt-1 text-[13px] text-ink-muted">The interviews and documents this report is written from.</p>

  {#if loading}
    <div class="mt-6 space-y-2" aria-busy="true">
      <span class="sr-only" role="status">Loading sources</span>
      <div class="skeleton-shimmer h-10 rounded-lg"></div>
      <div class="skeleton-shimmer h-10 rounded-lg"></div>
    </div>
  {:else if transcripts.length === 0 && documents.length === 0}
    <p class="mt-6 text-[13px] text-ink-secondary">No sources yet. Add a transcript or document to this project.</p>
  {:else}
    {#if transcripts.length > 0}
      <section class="mt-6" aria-labelledby="sources-transcripts">
        <h3 id="sources-transcripts" class="text-xs uppercase tracking-wide text-ink-muted">Interviews</h3>
        <ul class="mt-2 divide-y divide-line-soft border-y border-line-soft">
          {#each transcripts as transcript (transcript._id)}
            <li class="flex min-h-11 items-center gap-3 py-2 text-[13px]">
              <MicrophoneIcon size={16} aria-hidden="true" class="shrink-0 text-ink-muted" />
              <span class="min-w-0 flex-1 truncate text-ink">{transcript.label}</span>
              {#if transcript.wordCount > 0}
                <span class="shrink-0 text-xs text-ink-muted">{transcript.wordCount.toLocaleString()} words</span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if active.length > 0}
      <section class="mt-6" aria-labelledby="sources-documents">
        <h3 id="sources-documents" class="text-xs uppercase tracking-wide text-ink-muted">Documents</h3>
        <ul class="mt-2 divide-y divide-line-soft border-y border-line-soft">
          {#each active as doc (doc._id)}
            <li class="flex min-h-11 items-center gap-3 py-2 text-[13px]">
              <FileTextIcon size={16} aria-hidden="true" class="shrink-0 text-ink-muted" />
              {#if doc.url}
                <a href={doc.url} target="_blank" rel="noopener noreferrer" class="min-w-0 flex-1 truncate text-ink hover:text-primary-selected hover:underline">{doc.fileName}</a>
              {:else}
                <span class="min-w-0 flex-1 truncate text-ink">{doc.fileName}</span>
              {/if}
              <span class="shrink-0 text-xs text-ink-muted">Added {added(doc.createdAt)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if archived.length > 0}
      <section class="mt-6" aria-labelledby="sources-archived">
        <h3 id="sources-archived" class="text-xs uppercase tracking-wide text-ink-muted">Archived, not used by the AI</h3>
        <ul class="mt-2 divide-y divide-line-soft border-y border-line-soft">
          {#each archived as doc (doc._id)}
            <li class="flex min-h-11 items-center gap-3 py-2 text-[13px] text-ink-muted">
              <FileTextIcon size={16} aria-hidden="true" class="shrink-0" />
              <span class="min-w-0 flex-1 truncate">{doc.fileName}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>
