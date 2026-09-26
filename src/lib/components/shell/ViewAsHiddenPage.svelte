<script lang="ts">
  // TEMPORARY STUB (WS2 branch): WS1 owns this component (D4) and replaces
  // it on rebase. Same prop contract: the hidden page's name.
  import { resolve } from "$app/paths";
  import { exit, viewAs } from "$lib/shell/viewAs.svelte";

  let { pageName }: { pageName: string } = $props();

  const LABELS = { owner: "Owner", admin: "Admin", manager: "Manager", consultant: "Consultant" } as const;
  const roleLabel = $derived(viewAs.role ? LABELS[viewAs.role] : "this");
</script>

<div data-view-as-hidden-page class="mx-auto flex max-w-[420px] flex-col items-center gap-3 py-20 text-center">
  <h2 class="font-serif text-2xl leading-[30px] text-ink">{pageName} is hidden in {roleLabel} view</h2>
  <p class="text-sm text-ink-muted">Exit the view to get back to it.</p>
  <div class="flex gap-2">
    <a href={resolve("/my-work")} class="inline-flex h-9 items-center rounded-lg bg-chrome px-3.5 text-sm font-medium text-ink">Back to Home</a>
    <button type="button" onclick={exit} class="h-9 rounded-lg bg-fir px-3.5 text-sm font-medium text-white">Exit {roleLabel} view</button>
  </div>
</div>
