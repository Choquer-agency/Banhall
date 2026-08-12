<script lang="ts">
  // The report route now shares the workspace rollout boundary. The current
  // component is the committed report workspace; the Obvious-inspired
  // Agent-left/report-right workbench is visible only to the preview cohort.
  // `?workspace=current` always restores the current report immediately.
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";
  import CurrentProjectPage from "$lib/components/project/CurrentProjectPage.svelte";
  import PreviewProjectPage from "$lib/components/project/PreviewProjectPage.svelte";
</script>

<WorkspaceGate currentWhileLoading={false}>
  {#snippet current()}
    <CurrentProjectPage />
  {/snippet}
  {#snippet preview()}
    <PreviewProjectPage />
  {/snippet}
</WorkspaceGate>
