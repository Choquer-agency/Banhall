<!--
  Delete action for one project card or row (Paper K1 and K4, 2026-10-07).
  Sits beside Duplicate and opens the confirm dialog.

  Host contract: the same as DuplicateProjectButton. The card or row carries
  the named group class `group/project`; the button keeps its place and only
  its opacity changes on hover or focus-within; it is `relative z-10`, above
  a stretched title link; touch devices always show it with a 44px hit area.

  It renders nothing unless the viewer may delete the project (its creator or
  an admin, the rule `projects.deleteProject` enforces), for a row that does
  not say who created it, or for a project already being deleted.
-->
<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { TrashIcon } from "phosphor-svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import DeleteProjectDialog from "./DeleteProjectDialog.svelte";
  import { api } from "../../../../convex/_generated/api";
  import { canDeleteProject } from "$lib/workspace/projectDelete";

  let {
    projectId,
    projectTitle,
    createdBy,
    deleting = false,
    class: className = "",
  }: {
    projectId: string;
    projectTitle: string;
    /** Who created the project; undefined when the row source does not say. */
    createdBy: string | undefined;
    /** The project is mid-deletion: nothing to offer. */
    deleting?: boolean;
    /** Placement tweaks from the host (margins, alignment). */
    class?: string;
  } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const allowed = $derived(canDeleteProject(userQ.data, createdBy, deleting));
  let dialogOpen = $state(false);

  function openDialog(event: MouseEvent) {
    // The card or row around this button is itself a link target; this
    // click must only open the dialog.
    event.preventDefault();
    event.stopPropagation();
    dialogOpen = true;
  }
</script>

{#if allowed}
  <Tooltip text="Delete">
    {#snippet children({ props })}
      <button
        {...props}
        type="button"
        data-delete-project={projectId}
        aria-label={`Delete ${projectTitle}`}
        draggable="false"
        onclick={(event) => {
          (props.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
          openDialog(event);
        }}
        class={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 transition-[opacity,background-color,color] hover:bg-danger-surface hover:text-danger-ink-muted focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy group-hover/project:opacity-100 group-focus-within/project:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-[''] ${className}`}
      >
        <TrashIcon size="0.9375rem" aria-hidden="true" />
      </button>
    {/snippet}
  </Tooltip>
  <DeleteProjectDialog bind:open={dialogOpen} {projectId} {projectTitle} />
{/if}
