<script lang="ts">
  import { page } from "$app/state";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";
  import LazyModule from "$lib/components/ui/LazyModule.svelte";
  import { loadCurrentProjectPage, loadPreviewProjectPage } from "$lib/components/project/projectPageModules";
  import { recordProjectOpen } from "$lib/workspace/recentProjects";

  // Broken behaviour #5: every open of a project page counts as recent, not
  // only workspace link clicks (a typed or pasted URL, back and forward, a
  // redirect). Recents live in this browser, so this is one local write per
  // project opened by a signed-in person; it keeps any title, stage and
  // client a link click already recorded.
  const auth = useAuth();
  let recordedId: string | null = null;
  $effect(() => {
    const id = page.params.id;
    if (!id || !auth.isAuthenticated || id === recordedId) return;
    recordedId = id;
    recordProjectOpen({ id });
  });
</script>

<WorkspaceGate currentWhileLoading={false}>
  {#snippet current()}
    <LazyModule load={loadCurrentProjectPage} label="report workspace">
      {#snippet children(CurrentProjectPage)}
        <CurrentProjectPage />
      {/snippet}
    </LazyModule>
  {/snippet}
  {#snippet preview()}
    <LazyModule load={loadPreviewProjectPage} label="report workspace">
      {#snippet children(PreviewProjectPage)}
        <PreviewProjectPage />
      {/snippet}
    </LazyModule>
  {/snippet}
</WorkspaceGate>
