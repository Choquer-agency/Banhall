<script lang="ts">
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";
  import LazyModule from "$lib/components/ui/LazyModule.svelte";
</script>

<WorkspaceGate currentWhileLoading={false}>
  {#snippet current()}
    <LazyModule load={() => import("$lib/components/project/CurrentProjectPage.svelte")} label="report workspace">
      {#snippet children(CurrentProjectPage)}
        <CurrentProjectPage />
      {/snippet}
    </LazyModule>
  {/snippet}
  {#snippet preview()}
    <LazyModule load={() => import("$lib/components/project/PreviewProjectPage.svelte")} label="report workspace">
      {#snippet children(PreviewProjectPage)}
        <PreviewProjectPage />
      {/snippet}
    </LazyModule>
  {/snippet}
</WorkspaceGate>
