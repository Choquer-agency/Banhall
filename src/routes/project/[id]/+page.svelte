<script lang="ts">
  import { IconDocument } from "$lib/components/icons";
  import WorkspaceLoadingShell from "$lib/components/workspace/WorkspaceLoadingShell.svelte";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";
  import LazyModule from "$lib/components/ui/LazyModule.svelte";
  import { loadCurrentProjectPage, loadPreviewProjectPage } from "$lib/components/project/projectPageModules";
  import { recentProjectTitle, recordProjectOpen } from "$lib/workspace/recentProjects";

  // Broken behaviour #5: every open of a project page counts as recent, not
  // only workspace link clicks (a typed or pasted URL, back and forward, a
  // redirect). Recents live in this browser, so this is one local write per
  // project opened by a signed-in person; it keeps any title, stage and
  // client a link click already recorded.
  const auth = useAuth();

  // The report workspace code starts loading with the session check and the
  // workspace decision instead of after them: a cold open used to wait for
  // both before asking for it (2026-09-28 load measurement).
  $effect(() => {
    if (page.url.searchParams.get("workspace") === "current") return;
    void loadPreviewProjectPage().catch(() => undefined);
  });

  // Every loading state draws the project workspace skeleton under the
  // project's own top bar: "Projects /", the document tile and, for a
  // project this browser opened before, its title.
  const pendingTitle = $derived(recentProjectTitle(page.params.id));
  const projectsCrumb = { label: "Projects", href: resolve("/projects") };

  let recordedId: string | null = null;
  $effect(() => {
    const id = page.params.id;
    if (!id || !auth.isAuthenticated || id === recordedId) return;
    recordedId = id;
    recordProjectOpen({ id });
  });
</script>

<!-- While pending: the shell with "Projects /" and the project skeleton. -->
<WorkspaceGate
  currentWhileLoading={false}
  pendingLayout="project"
  {pendingTitle}
  pendingIcon={IconDocument}
  pendingBreadcrumb={projectsCrumb}
>
  {#snippet current()}
    <LazyModule load={loadCurrentProjectPage} label="report workspace">
      {#snippet children(CurrentProjectPage)}
        <CurrentProjectPage />
      {/snippet}
    </LazyModule>
  {/snippet}
  {#snippet preview()}
    <LazyModule load={loadPreviewProjectPage} label="report workspace">
      {#snippet pending()}
        <WorkspaceLoadingShell layout="project" title={pendingTitle} icon={IconDocument} breadcrumb={projectsCrumb} label="Loading report workspace" />
      {/snippet}
      {#snippet children(PreviewProjectPage)}
        <PreviewProjectPage />
      {/snippet}
    </LazyModule>
  {/snippet}
</WorkspaceGate>
