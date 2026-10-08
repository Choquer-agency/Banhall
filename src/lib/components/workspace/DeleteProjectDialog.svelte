<script lang="ts">
  // Paper K2 and K3 (2026-10-07): confirm before a project is deleted for
  // good. The frame, buttons and refusal note follow the C5 Revoke invite
  // dialog: Keep project (chrome, focused on open) and the filled red Delete
  // project. A refusal from the server (open work, or no longer allowed)
  // shows its own words and dims Delete until the dialog opens again.
  import { tick } from "svelte";
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import TeamDialog from "$lib/components/team/TeamDialog.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";

  let {
    open = $bindable(false),
    projectId,
    projectTitle,
    onDeleted = undefined,
    onDeleting = undefined,
  }: {
    open?: boolean;
    projectId: string;
    projectTitle: string;
    /** After a successful delete, for example to leave the project page. */
    onDeleted?: () => void;
    /**
     * True as the request starts, false if it fails. The project page uses
     * it to show its loading frame, not "Project not found", while it
     * leaves: the project reads as gone before the request returns.
     */
    onDeleting?: (pending: boolean) => void;
  } = $props();

  const deleteProject = useMutation(api.projects.deleteProject);
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let keepButton: HTMLButtonElement | null = $state(null);

  // Each opening starts clean.
  $effect(() => {
    if (open) errorMessage = null;
  });

  async function confirm() {
    if (busy || errorMessage) return;
    busy = true;
    // The host may unmount this dialog the moment the project starts
    // deleting (its row or page goes away), so read everything first.
    const title = projectTitle;
    const done = onDeleted;
    const pending = onDeleting;
    pending?.(true);
    try {
      await deleteProject({ projectId: projectId as Id<"projects"> });
      open = false;
      toast.success(`Deleted ${title}.`);
      done?.();
    } catch (error) {
      pending?.(false);
      errorMessage = userErrorMessage(error, "This project could not be deleted. Try again.");
    } finally {
      busy = false;
    }
    // A refusal disables the focused Delete button, which drops focus out
    // of the dialog; Keep project takes it instead.
    if (errorMessage) {
      await tick();
      keepButton?.focus();
    }
  }
</script>

<TeamDialog
  bind:open
  width={460}
  top={320}
  initialFocus={() => keepButton}
  {busy}
  testId="delete-project-dialog"
  title={`Delete ${projectTitle}?`}
  description="This permanently deletes the project's report, transcripts, files and history. You can't undo this."
>
  {#if errorMessage}
    <p role="alert" class="mx-7 mt-4 rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger-ink-muted">{errorMessage}</p>
  {/if}
  {#snippet footer()}
    <div class="flex items-center justify-end gap-2 pb-[1.125rem] pl-7 pr-5 pt-5">
      <button
        bind:this={keepButton}
        type="button"
        data-keep-project
        disabled={busy}
        onclick={() => (open = false)}
        class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-5 font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >Keep project</button>
      <button
        type="button"
        data-confirm-delete-project
        disabled={busy || errorMessage !== null}
        onclick={() => void confirm()}
        class="h-9 rounded-lg bg-danger-action px-4 text-sm leading-5 font-medium text-white hover:bg-danger-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 disabled:opacity-50"
      >{busy ? "Deleting..." : "Delete project"}</button>
    </div>
  {/snippet}
</TeamDialog>
