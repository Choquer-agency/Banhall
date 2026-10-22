<script lang="ts">
  import type { WebSource } from "$lib/chat/webSources";
  import { faviconUrlFor } from "./primitives/sourceContext";

  /**
   * Chat parity Phase B (W3): the web sources a reply's searches returned,
   * under the reply, numbered as the reply cites them. Each link opens in a
   * new tab and sends no referrer; favicons are requested by hostname only.
   */
  interface Props {
    sources: readonly WebSource[];
  }

  let { sources }: Props = $props();
  const titleId = $props.id();
</script>

{#if sources.length}
  <section aria-labelledby={titleId} class="pt-1" data-web-sources>
    <p id={titleId} class="pb-1 text-[0.6875rem] leading-[calc(16/11)] text-ink-muted">Sources</p>
    <ol class="flex flex-wrap gap-1.5">
      {#each sources as source (source.n)}
        {@const favicon = faviconUrlFor(source.url)}
        <li class="min-w-0 max-w-full">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerpolicy="no-referrer"
            title={source.title}
            class="flex h-7 min-w-0 max-w-[16rem] items-center gap-1.5 rounded-full bg-chrome pr-2.5 pl-1.5 text-xs text-ink-muted no-underline transition-colors hover:bg-primary-wash hover:text-primary-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 pointer-coarse:h-11"
            data-web-source={source.n}
          >
            <span class="text-data shrink-0 text-ink-muted">{source.n}</span>
            {#if favicon}
              <img src={favicon} alt="" width="14" height="14" referrerpolicy="no-referrer" class="h-3.5 w-3.5 shrink-0 rounded-sm" />
            {/if}
            <span class="min-w-0 truncate text-ink">{source.title}</span>
            <span class="shrink-0 text-ink-muted">{source.domain}</span>
          </a>
        </li>
      {/each}
    </ol>
  </section>
{/if}
