<script lang="ts">
  import { onMount } from "svelte";
  import { ActionButton } from "./primitives";
  import { MAX_CHAT_MESSAGE_CHARS } from "../../../../shared/chatLimits";

  /**
   * Phase C (W2): the inline editor for a writer message. Enter sends,
   * Shift+Enter adds a line, Escape cancels. Sending makes an alternative;
   * the original stays one step back in the switcher.
   */
  interface Props {
    initial: string;
    disabled?: boolean;
    onSend: (text: string) => Promise<void> | void;
    onCancel: () => void;
  }

  let { initial, disabled = false, onSend, onCancel }: Props = $props();

  let text = $state("");
  let sending = $state(false);
  let textarea: HTMLTextAreaElement | null = $state(null);

  onMount(() => {
    text = initial;
    textarea?.focus();
    textarea?.setSelectionRange(text.length, text.length);
  });

  const trimmed = $derived(text.trim());
  const tooLong = $derived(trimmed.length > MAX_CHAT_MESSAGE_CHARS);
  const canSend = $derived(!!trimmed && !tooLong && !disabled && !sending);

  async function send() {
    if (!canSend) return;
    sending = true;
    try {
      await onSend(trimmed);
    } finally {
      sending = false;
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      // Handled here, so the report page keeps the Assistant open.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  }
</script>

<div class="flex w-full flex-col gap-2" data-message-editor>
  <textarea
    bind:this={textarea}
    bind:value={text}
    {onkeydown}
    aria-label="Edit your message"
    rows={Math.min(8, Math.max(2, text.split("\n").length))}
    class="field-control w-full resize-y rounded-md px-2.5 py-2 text-[0.8125rem] leading-[1.125rem] text-ink"
  ></textarea>
  {#if tooLong}
    <p class="text-xs text-red-600" role="alert">
      A message is limited to {MAX_CHAT_MESSAGE_CHARS.toLocaleString("en-US")} characters. Shorten it to send.
    </p>
  {/if}
  <div class="flex justify-end gap-1.5">
    <ActionButton variant="ghost" class="pointer-coarse:min-h-11" onclick={onCancel}>Cancel</ActionButton>
    <ActionButton variant="primary" class="pointer-coarse:min-h-11" disabled={!canSend}
      loading={sending} loadingLabel="Sending…" onclick={send}>Send</ActionButton>
  </div>
</div>
