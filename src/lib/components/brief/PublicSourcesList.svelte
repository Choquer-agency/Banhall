<script lang="ts" module>
  /** The record a draft keeps of its public background (`generations.getWebBackground`). */
  export type WebBackgroundRecord = {
    status: "used" | "off_for_run" | "not_requested" | "off_for_deployment" | "no_queries" | "failed" | "timed_out";
    queries: Array<{ query: string; kind: "technology" | "cra"; status: "ok" | "failed" }>;
    sources: Array<{ n: number; url: string; title: string; domain: string }>;
    droppedQueries: number;
    cached: boolean;
    reason?: string;
  };

  export const PUBLIC_SOURCES_COPY = {
    title: "Public sources used",
    meta: "Background only, not evidence",
    explainer:
      "The draft could use these web pages to explain the technology and standard practice. A sentence that relies on one carries an [INFERRED: ...] marker naming its number, for you to check.",
    searched: "Searched for",
    offForRun: "Public background was turned off for this draft.",
    none: "No public background was used in this draft.",
  } as const;

  /** The line shown when nothing was used, or null when the list shows. */
  export function publicSourcesNote(record: WebBackgroundRecord): string | null {
    if (record.status === "used" && record.sources.length > 0) return null;
    if (record.status === "off_for_run") return PUBLIC_SOURCES_COPY.offForRun;
    return record.reason ? `${PUBLIC_SOURCES_COPY.none} ${record.reason}` : PUBLIC_SOURCES_COPY.none;
  }
</script>

<script lang="ts">
  /**
   * 2026-11-02 (proposed): the public web pages a draft was given as
   * background, numbered as the draft's [INFERRED: ...] markers name them
   * (W1, W2...), and the searches as sent. Nothing for a deployment that
   * does not look up background.
   */
  let { record }: { record: WebBackgroundRecord } = $props();

  const note = $derived(publicSourcesNote(record));
  const searched = $derived(record.queries.map((query) => query.query).join("; "));
</script>

{#if record.status !== "off_for_deployment" && record.status !== "not_requested"}
  <section class="border-t border-line-soft" data-public-sources aria-labelledby="public-sources-title">
    <div class="flex min-h-11 items-center gap-2 bg-gray-50 px-4 py-2">
      <h3 id="public-sources-title" class="m-0 text-label font-normal">{PUBLIC_SOURCES_COPY.title}</h3>
      <span class="min-w-0 truncate text-data text-ink-muted">{PUBLIC_SOURCES_COPY.meta}</span>
    </div>
    {#if note}
      <p class="px-4 py-3 text-body text-ink-muted" data-public-sources-note>{note}</p>
    {:else}
      <p class="px-4 pt-3 text-data text-ink-muted">{PUBLIC_SOURCES_COPY.explainer}</p>
      <ul class="m-0 list-none p-0 pt-1">
        {#each record.sources as source (source.n)}
          <li class="flex items-baseline gap-3 border-b border-line-soft px-4 py-2.5" data-public-source={source.n}>
            <span class="w-7 shrink-0 text-data text-ink-muted">W{source.n}</span>
            <span class="min-w-0 flex-1 break-words text-body">
              <a href={source.url} target="_blank" rel="noopener noreferrer" class="text-ink underline decoration-line underline-offset-2 hover:decoration-ink">{source.title}</a>
              <span class="block text-data text-ink-muted">{source.domain}</span>
            </span>
          </li>
        {/each}
      </ul>
      {#if searched}
        <p class="px-4 py-3 text-data text-ink-muted" data-public-sources-queries>{PUBLIC_SOURCES_COPY.searched}: {searched}</p>
      {/if}
    {/if}
  </section>
{/if}
