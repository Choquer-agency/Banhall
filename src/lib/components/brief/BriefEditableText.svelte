<script lang="ts">
  import { tick } from "svelte";

  /**
   * Story 4 brief-entry inline edit (EXPERIENCE.md › brief-entry): click or
   * Enter opens a `field-control` textarea on chrome with a primary-light
   * focus ring; blur or Cmd/Ctrl+Enter saves; Esc reverts. An unchanged or
   * empty draft calls nothing. A failed save keeps the draft open.
   */
  let {
    text,
    canEdit,
    label,
    emptyText = "",
    onSave,
    onCancel = undefined,
    onOpen = undefined,
  }: {
    text: string;
    canEdit: boolean;
    /** What is being edited, for the field's accessible name ("Storyline"). */
    label: string;
    /** Shown in place of empty text (e.g. "Type a Storyline"). */
    emptyText?: string;
    /** Resolves true once saved; false keeps the draft in the field. */
    onSave: (text: string) => Promise<boolean>;
    /** Called when the writer leaves the field without saving. */
    onCancel?: (() => void) | undefined;
    /** Called when editing begins, so the container can pin the Brief version this edit is based on. */
    onOpen?: (() => void) | undefined;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let busy = false;
  let trigger: HTMLButtonElement | null = $state(null);

  function autofocus(node: HTMLTextAreaElement) {
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }

  function open() {
    draft = text;
    editing = true;
    onOpen?.();
  }

  async function close(returnFocus: boolean) {
    editing = false;
    if (returnFocus) {
      await tick();
      trigger?.focus();
    }
  }

  async function commit(returnFocus: boolean) {
    if (!editing || busy) return;
    if (draft === text || !draft.trim()) {
      onCancel?.();
      await close(returnFocus);
      return;
    }
    busy = true;
    const saved = await onSave(draft);
    busy = false;
    if (saved) await close(returnFocus);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      draft = text;
      onCancel?.();
      void close(true);
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commit(true);
    }
  }
</script>

{#if editing}
  <textarea
    use:autofocus
    bind:value={draft}
    aria-label={`Edit ${label}`}
    rows="3"
    class="field-control brief-field block min-h-11 w-full resize-y rounded-md px-2 py-2 text-body"
    onblur={() => void commit(false)}
    onkeydown={onKeydown}
  ></textarea>
{:else if canEdit}
  <button
    bind:this={trigger}
    type="button"
    aria-label={text ? `${label}: ${text}. Edit` : `${label}: ${emptyText || "empty"}. Edit`}
    class="block min-h-11 w-full rounded-md px-2 py-2 text-left text-body transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none"
    onclick={open}
  >
    {#if text}
      <span class="whitespace-pre-line">{text}</span>
    {:else}
      <span class="text-ink-faint">{emptyText}</span>
    {/if}
  </button>
{:else}
  <p class="px-2 py-2 text-body whitespace-pre-line">
    {#if text}{text}{:else}<span class="text-ink-muted">{emptyText}</span>{/if}
  </p>
{/if}

<style>
  /* DESIGN.md brief-entry: a chrome edit field with a primary-light focus
     ring, inset-only like every field-control. */
  .brief-field {
    background-color: var(--color-chrome);
  }
  .brief-field:hover:not(:focus):not(:disabled) {
    background-color: var(--color-chrome);
    box-shadow: inset 0 0 0 1px var(--color-line);
  }
  .brief-field:focus,
  .brief-field:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-primary-light);
  }
</style>
