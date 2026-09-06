<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import Spinner from "./Spinner.svelte";
  import Button from "./Button.svelte";

  let { load, active = true, label, children }: {
    load: () => Promise<{ default: T }>;
    active?: boolean;
    label: string;
    children: Snippet<[T]>;
  } = $props();

  let request = $state.raw<Promise<{ default: T }> | null>(null);
  // Activation is one-way. Hiding a tool must preserve its component instance.
  $effect(() => {
    if (active && !request) request = load();
  });
</script>

{#if request}
  {#await request}
    <div class="flex items-center justify-center gap-2 p-4 text-sm text-ink-muted" role="status" aria-label={`Loading ${label}`}>
      <Spinner size="sm" /> Loading {label}…
    </div>
  {:then module}
    {@render children(module.default)}
  {:catch}
    <div class="flex flex-col items-center justify-center gap-3 p-4 text-sm text-ink-muted" role="alert">
      <p>Could not load {label}.</p>
      <p>Reload the page to try again. Unsaved changes may be lost.</p>
      <Button variant="secondary" onclick={() => location.reload()}>Reload page</Button>
    </div>
  {/await}
{/if}
