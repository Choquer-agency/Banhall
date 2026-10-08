<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import Spinner from "./Spinner.svelte";
  import Button from "./Button.svelte";

  let { load, active = true, label, children, pending = undefined }: {
    load: () => Promise<{ default: T }>;
    active?: boolean;
    label: string;
    children: Snippet<[T]>;
    /** Replaces the inline spinner while the module loads (route-level loaders). */
    pending?: Snippet;
  } = $props();

  let request = $state.raw<Promise<{ default: T }> | null>(null);
  // Activation is one-way. Hiding a tool must preserve its component instance.
  $effect(() => {
    if (active && !request) request = load();
  });
</script>

{#if request}
  {#await request}
    {#if pending}
      {@render pending()}
    {:else}
    <!-- One status for assistive tech: the spinner's own is hidden. -->
    <div class="flex flex-1 items-center justify-center gap-2 p-4 text-sm text-ink-muted" role="status" aria-label={`Loading ${label}`}>
      <span aria-hidden="true"><Spinner size="sm" /></span> Loading {label}…
    </div>
    {/if}
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
