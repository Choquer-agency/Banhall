<script lang="ts">
  /**
   * D4: what a role-gated page shows while a developer views Banhall as a
   * role that cannot open it. Presentation only; the page's data is still
   * fetched with the developer's real access by whatever renders after exit.
   */
  import { resolve } from "$app/paths";
  import { IconEye } from "$lib/components/icons";
  import { VIEW_AS_LABELS, VIEW_AS_PLURALS, viewAs } from "$lib/shell/viewAs.svelte";
  import { exitViewAsWithToast } from "$lib/shell/viewAsActions";

  let { pageName }: { pageName: string } = $props();

  const role = $derived(viewAs.role);
</script>

{#if role}
  <div data-view-as-hidden-page class="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-10">
    <div class="flex w-full max-w-[420px] flex-col items-center gap-3.5 text-center">
      <span
        aria-hidden="true"
        class="flex size-11 items-center justify-center rounded-xl border border-warning-line bg-warning-surface text-warning-ink"
      >
        <IconEye size={20} strokeWidth={1.6} />
      </span>
      <div class="flex flex-col items-center gap-1.5">
        <h2 class="font-serif text-2xl font-normal leading-[30px] text-ink">
          {pageName} is hidden in {VIEW_AS_LABELS[role]} view
        </h2>
        <p class="text-sm leading-5 text-ink-muted">
          {VIEW_AS_PLURALS[role]} cannot open {pageName}, so this is what they would see. Exit the view to get back to it.
        </p>
      </div>
      <div class="flex flex-wrap justify-center gap-2.5 pt-1.5">
        <a
          href={resolve("/my-work")}
          data-view-as-home
          class="inline-flex h-9 items-center justify-center rounded-lg bg-chrome px-4 text-sm font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
        >Back to Home</a>
        <button
          type="button"
          data-view-as-exit
          onclick={exitViewAsWithToast}
          class="inline-flex h-9 items-center justify-center rounded-lg bg-fir px-4 text-sm font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
        >Exit {VIEW_AS_LABELS[role]} view</button>
      </div>
    </div>
  </div>
{/if}
