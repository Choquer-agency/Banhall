<script lang="ts">
  import PageBar from "./PageBar.svelte";
</script>

<div data-page-bar-fixture>
  <PageBar>
    {#snippet leading()}
      <button type="button" class="h-11 px-3">Workflow</button>
    {/snippet}
  </PageBar>
</div>
