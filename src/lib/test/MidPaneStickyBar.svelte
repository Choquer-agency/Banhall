<!--
  Test page: a sticky action bar on short content, so it ends mid-window
  (CandidateSelection's bar with little to show), not at the window's foot.
  "Grow the content" lengthens the content above it until the bar pins to
  the foot, with no scroll. Its own pane always shows its scrollbar, so
  growing the content never resizes the bar itself.
-->
<script lang="ts">
  import { stickyActionBar } from "$lib/shell/stickyActionBars.svelte";

  let tall = $state(false);
</script>

<div class="h-dvh overflow-y-scroll">
  <div class="flex flex-col">
  <p class="p-4">A short page.</p>
  <button type="button" data-grow onclick={() => (tall = true)}>Grow the content</button>
  {#if tall}<div data-grown class="h-[125rem]"></div>{/if}
  <div data-mid-bar {@attach stickyActionBar} class="sticky bottom-0 h-14 border-t border-line-soft bg-surface">Bar</div>
  </div>
</div>
