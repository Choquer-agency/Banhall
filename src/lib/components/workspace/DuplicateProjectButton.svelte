<!--
  Duplicate action for one project card or row (owner request 2026-09-25).
  Opens the New project wizard prefilled from this project, with its
  transcripts and files carried over and Step by step preselected.

  Host contract:
  - The card or row carries the named group class `group/project`; the
    button stays in layout at all times (only its opacity changes), so
    nothing shifts when it appears on hover or focus-within.
  - Hosts with a stretched title link (`after:absolute after:inset-0`) need
    nothing else: the button is `relative z-10`, above that layer.
  - Touch devices (pointer: coarse) always show it, with a 44px hit area.

  It renders nothing for a viewer who cannot create projects (the rule
  `projects.createProject` enforces) or for a project being deleted.
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { CopyIcon } from "phosphor-svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { api } from "../../../../convex/_generated/api";
  import { canCreateProjects, duplicateProjectSearch } from "$lib/workspace/projectDuplicate";

  let {
    projectId,
    projectTitle,
    deleting = false,
    class: className = "",
  }: {
    projectId: string;
    projectTitle: string;
    /** The project is mid-deletion: never offer to copy it. */
    deleting?: boolean;
    /** Placement tweaks from the host (margins, alignment). */
    class?: string;
  } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const allowed = $derived(!deleting && canCreateProjects(userQ.data));

  function duplicate(event: MouseEvent) {
    // The card or row around this button is itself a link target; this
    // click must only start the duplicate.
    event.preventDefault();
    event.stopPropagation();
    void goto(`${resolve("/project/new")}${duplicateProjectSearch(projectId)}`);
  }
</script>

{#if allowed}
  <Tooltip text="Duplicate">
    {#snippet children({ props })}
      <button
        {...props}
        type="button"
        data-duplicate-project={projectId}
        aria-label={`Duplicate ${projectTitle}`}
        draggable="false"
        onclick={(event) => {
          (props.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
          duplicate(event);
        }}
        class={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-surface hover:text-ink focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy group-hover/project:opacity-100 group-focus-within/project:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-[''] ${className}`}
      >
        <CopyIcon size={15} aria-hidden="true" />
      </button>
    {/snippet}
  </Tooltip>
{/if}
