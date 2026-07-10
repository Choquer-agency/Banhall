<script lang="ts">
  import { userErrorMessage } from "$lib/errors";
  let {
    commenterName,
    onSubmit,
    onCancel,
    autoFocus,
    highlightText,
  }: {
    commenterName: string;
    onSubmit: (body: string, suggestedEdit?: string) => void | Promise<void>;
    onCancel?: () => void;
    autoFocus?: boolean;
    highlightText?: string;
  } = $props();

  let body = $state("");
  let suggestedEdit = $state("");
  let showSuggestEdit = $state(false);
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  let suggestedEl: HTMLTextAreaElement | null = $state(null);
  let pending = $state(false);
  let error = $state("");

  async function submit() {
    if (!body.trim() || pending) return;
    pending = true;
    error = "";
    try {
      await onSubmit(body.trim(), suggestedEdit.trim() || undefined);
      body = "";
      suggestedEdit = "";
      showSuggestEdit = false;
    } catch (submitError) {
      error = userErrorMessage(
        submitError,
        "The comment could not be saved. Your draft was retained."
      );
    } finally {
      pending = false;
    }
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    await submit();
  }

  async function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      await submit();
      return;
    }
    if (e.key === "Escape") onCancel?.();
  }

  // React's autoFocus: focus the textarea on mount when requested.
  $effect(() => {
    if (autoFocus) textareaEl?.focus();
    if (showSuggestEdit) suggestedEl?.focus();
  });
</script>

<form onsubmit={handleSubmit} aria-busy={pending}>
  <div class="flex items-center gap-1.5 mb-1.5">
    <span class="text-xs font-medium text-gray-600">
      {commenterName}
    </span>
  </div>
  <label class="block">
    <span class="sr-only">Comment</span>
    <textarea
    disabled={pending}
    bind:this={textareaEl}
    bind:value={body}
    onkeydown={handleKeyDown}
    placeholder="Add a comment..."
    rows={2}
    class="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
  ></textarea>
  </label>

  <!-- Suggest edit toggle -->
  {#if highlightText && !showSuggestEdit}
    <button
      type="button"
      onclick={() => {
        showSuggestEdit = true;
        suggestedEdit = highlightText ?? "";
      }}
      class="mt-1 text-[10px] text-primary hover:text-primary-dark transition-colors"
    >
      + Suggest an edit
    </button>
  {/if}

  {#if showSuggestEdit}
    <div class="mt-1.5">
      <label class="block text-[10px] font-medium text-gray-500">
        Replace with:
        <textarea
        bind:this={suggestedEl}
        disabled={pending}
        bind:value={suggestedEdit}
        rows={2}
        class="mt-0.5 w-full resize-none rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      ></textarea>
      </label>
      <button
        type="button"
        onclick={() => {
          showSuggestEdit = false;
          suggestedEdit = "";
        }}
        class="mt-0.5 text-[10px] text-gray-400 hover:text-gray-600"
      >
        Remove suggestion
      </button>
    </div>
  {/if}

  {#if error}
    <p class="mt-1 text-xs text-red-700" role="alert">{error}</p>
  {/if}
  <div class="mt-1.5 flex items-center justify-between">
    <p class="text-[10px] text-gray-400">Command or Control+Enter to submit</p>
    <div class="flex items-center gap-1.5">
      {#if onCancel}
        <button
          type="button"
          disabled={pending}
          onclick={onCancel}
          class="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      {/if}
      <button
        type="submit"
        disabled={pending || !body.trim()}
        class="rounded-md bg-navy px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Saving..." : "Comment"}
      </button>
    </div>
  </div>
</form>
