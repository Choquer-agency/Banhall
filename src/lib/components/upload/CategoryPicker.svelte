<script lang="ts">
  import { CONTEXT_CATEGORIES, type ContextCategoryId } from "$lib/contextCategories";

  /**
   * Asks which category the chosen files belong to before they upload. Every
   * project file carries one, because the category sets how much weight the
   * writing gives it. Presentational: files and callbacks arrive as props.
   */
  let {
    fileNames,
    onPick,
    onCancel,
  }: {
    fileNames: string[];
    onPick: (category: ContextCategoryId) => void;
    onCancel: () => void;
  } = $props();

  const uid = $props.id();
  const promptId = `${uid}-category-prompt`;
  let group: HTMLDivElement | null = $state(null);

  function trimName(name: string): string {
    return name.length > 40 ? `${name.slice(0, 37)}…` : name;
  }

  const prompt = $derived(
    fileNames.length === 1
      ? `Choose a category for “${trimName(fileNames[0])}”.`
      : `Choose a category for these ${fileNames.length} files.`
  );

  // The picker appears after the system file dialog closes. Moving focus to
  // the first choice lets a keyboard user answer it straight away.
  $effect(() => {
    group?.querySelector("button")?.focus();
  });
</script>

<div
  bind:this={group}
  role="group"
  aria-labelledby={promptId}
  class="rounded-xl border border-line bg-chrome/50 p-3"
  data-category-picker
>
  <p id={promptId} class="mb-2 text-xs text-ink">{prompt}</p>
  <div class="flex flex-wrap gap-1.5">
    {#each CONTEXT_CATEGORIES as category (category.id)}
      <button
        type="button"
        onclick={() => onPick(category.id)}
        class={`min-h-8 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium transition-opacity hover:opacity-80 motion-reduce:transition-none ${category.pill}`}
      >
        {category.label}
      </button>
    {/each}
    <button
      type="button"
      onclick={onCancel}
      class="min-h-8 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink motion-reduce:transition-none"
    >
      Cancel
    </button>
  </div>
</div>
