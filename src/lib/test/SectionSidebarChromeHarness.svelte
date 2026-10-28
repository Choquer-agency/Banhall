<script lang="ts">
  // Test harness: WorkspaceChrome with the real Settings section sidebar.
  import type { Snippet } from "svelte";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import SettingsSidebar from "$lib/components/workspace/sidebars/SettingsSidebar.svelte";

  let { children }: { children: Snippet } = $props();
</script>

{#snippet sidebar()}<SettingsSidebar />{/snippet}
<WorkspaceChrome title="Notifications" {sidebar}>{@render children()}</WorkspaceChrome>
