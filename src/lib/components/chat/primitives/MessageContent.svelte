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

  const inherited = getMessageRoleContext();
  const resolvedRole = $derived(role ?? inherited?.role ?? "assistant");

  const roleClass = $derived(
    resolvedRole === "user"
      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 font-sans text-[0.8125rem] leading-relaxed text-navy"
      : cn("text-[0.8125rem] leading-relaxed text-gray-800", markdown && "chat-markdown")
  );
</script>

<div class={cn(roleClass, className)}>
  {#if markdown}
    <Streamdown content={text} />
  {:else if children}
    {@render children()}
  {:else}
    <p class="whitespace-pre-wrap">{text}</p>
  {/if}
</div>
