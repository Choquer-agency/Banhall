<!--
  Test page: a sticky action bar on short content, so it ends mid-window
  (CandidateSelection's bar with little to show), not at the window's foot.
-->
<script lang="ts">
  import { stickyActionBar } from "$lib/shell/stickyActionBars.svelte";
</script>

<div class="flex flex-col">
  <p class="p-4">A short page.</p>
  <div data-mid-bar {@attach stickyActionBar} class="sticky bottom-0 h-14 border-t border-line-soft bg-surface">Bar</div>
</div>
