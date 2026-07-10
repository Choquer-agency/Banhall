<!--
  BNH-35 tag selector: selected tags render as removable bubbles next to the
  label; a "+" button opens a searchable dropdown of the full tag taxonomy.
-->
<script lang="ts">
  import { popoverPop } from "$lib/motion";

  type Tag = { _id: string; name: string; parentId?: string | null };

  let {
    allTags,
    selectedTagIds = $bindable([]),
    size = "md",
    label = "Tags",
    onChange,
  }: {
    allTags: Tag[];
    selectedTagIds?: string[];
    /** "sm" — compact toolbar variant (dashboard filter row). */
    size?: "md" | "sm";
    /** null — hide the built-in label (caller renders its own). */
    label?: string | null;
    /** Fires after every toggle with the updated selection (for persistence). */
    onChange?: (ids: string[]) => void;
  } = $props();

  let open = $state(false);
  let search = $state("");
  let root: HTMLDivElement | null = $state(null);
  let searchInput: HTMLInputElement | null = $state(null);

  const selectedTags = $derived(allTags.filter((t) => selectedTagIds.includes(t._id)));
  const query = $derived(search.trim().toLowerCase());
  const parentTags = $derived(allTags.filter((t) => !t.parentId));
  // Filtered taxonomy: a parent stays visible if it or any child matches.
  const groups = $derived(
    parentTags
      .map((parent) => {
        const children = allTags.filter((t) => t.parentId === parent._id);
        if (!query) return { parent, children };
        const parentHit = parent.name.toLowerCase().includes(query);
        const childHits = children.filter((c) => c.name.toLowerCase().includes(query));
        if (!parentHit && childHits.length === 0) return null;
        return { parent, children: parentHit ? children : childHits };
      })
      .filter((g): g is { parent: Tag; children: Tag[] } => g !== null)
  );

  function toggle(id: string) {
    selectedTagIds = selectedTagIds.includes(id)
      ? selectedTagIds.filter((t) => t !== id)
      : [...selectedTagIds, id];
    onChange?.(selectedTagIds);
  }

  function openPicker() {
    open = !open;
    search = "";
    if (open) setTimeout(() => searchInput?.focus(), 0);
  }

  function onWindowClick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === "Escape" && (open = false)} />

<div class="relative flex flex-wrap items-center gap-1.5" bind:this={root}>
  {#if label !== null}
    <span class={size === "sm" ? "text-xs text-gray-400" : "text-sm font-medium text-gray-700"}>{label}</span>
  {/if}

  {#each selectedTags as tag (tag._id)}
    <span
      class={`inline-flex items-center gap-1 rounded-full text-xs font-medium text-white ${
        size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1"
      } ${tag.parentId ? "bg-primary" : "bg-navy"}`}
    >
      {tag.name}
      <button
        type="button"
        aria-label={`Remove tag ${tag.name}`}
        onclick={() => toggle(tag._id)}
        class="text-white/70 transition-colors hover:text-white"
      >
        ×
      </button>
    </span>
  {/each}

  <button
    type="button"
    aria-label="Add tags"
    aria-expanded={open}
    onclick={openPicker}
    class={`flex items-center justify-center rounded-full bg-chrome font-medium text-gray-500 transition-colors hover:bg-navy hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
      size === "sm" ? "h-5 w-5 text-xs" : "h-6 w-6 text-sm"
    }`}
  >
    +
  </button>

  {#if open}
    <!-- Compact dropdown is the one true size — same on every surface. -->
    <div
      transition:popoverPop
      class="absolute left-0 top-full z-50 mt-1.5 w-56 origin-top-left overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
    >
      <input
        bind:this={searchInput}
        type="text"
        bind:value={search}
        placeholder="Search tags…"
        class="tag-search w-full border-b border-gray-200 px-3 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none"
      />
      <div class="max-h-56 overflow-y-auto py-1">
        {#each groups as { parent, children } (parent._id)}
          {#each [parent, ...children] as tag (tag._id)}
            {@const selected = selectedTagIds.includes(tag._id)}
            <button
              type="button"
              onclick={() => toggle(tag._id)}
              class={`flex w-full items-center justify-between px-3 py-1 text-left text-xs transition-colors hover:bg-primary/10 ${
                tag.parentId ? "pl-7 text-gray-600" : "font-medium text-gray-800"
              } ${selected ? "text-primary-dark" : ""}`}
            >
              {tag.name}
              {#if selected}
                <svg class="h-3.5 w-3.5 flex-none text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              {/if}
            </button>
          {/each}
        {:else}
          <p class="px-3 py-2 text-xs text-gray-400">No matching tags.</p>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  /* layout.css paints every input's focus border with the primary brand color;
     this dropdown's search field must stay on the gray ramp instead. */
  .tag-search:focus {
    border-color: var(--color-gray-200);
  }
</style>
