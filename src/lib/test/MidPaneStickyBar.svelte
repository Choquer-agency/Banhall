<!--
  Test page: a sticky action bar on short content, so it ends mid-window
  (CandidateSelection's bar with little to show), not at the window's foot.
  "Grow the content" lengthens the content above it until the bar pins to
  the foot, with no scroll.
-->
<script lang="ts">
  import { stickyActionBar } from "$lib/shell/stickyActionBars.svelte";

  let tall = $state(false);
</script>

<div class="flex flex-col">
  <p class="p-4">A short page.</p>
  <button type="button" data-grow onclick={() => (tall = true)}>Grow the content</button>
  {#if tall}<div data-grown style="height:2000px"></div>{/if}
  <div data-mid-bar {@attach stickyActionBar} class="sticky bottom-0 h-14 border-t border-line-soft bg-surface">Bar</div>
</div>
