<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import type { AssigneeCandidate } from "./AssignmentComposerDialog.svelte";

  let {
    open = $bindable(false), candidates, selectedId = null, loading = false, failed = false, busy = false, errorMessage = null, onUseLatest, onSubmit,
  }: {
    open?: boolean; candidates: AssigneeCandidate[]; selectedId?: Id<"users"> | null; loading?: boolean; failed?: boolean; busy?: boolean;
    errorMessage?: string | null; onUseLatest?: () => void; onSubmit: (userId: Id<"users">) => void | Promise<void>;
  } = $props();
  let assigneeId = $state<Id<"users"> | null>(null);
  $effect(() => { if (open) assigneeId = selectedId; });
  async function submit() { if (assigneeId && !busy) await onSubmit(assigneeId); }
</script>
<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>{#snippet child({ props, open: isOpen })}{#if isOpen}<div {...props} transition:overlayFade class="fixed inset-0 z-[130] bg-[#052A28]/80"></div>{/if}{/snippet}</Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[130] flex items-end sm:items-center sm:justify-center sm:p-4">
      <Dialog.Content forceMount onEscapeKeydown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>{#snippet child({ props, open: isOpen })}{#if isOpen}
        <form {...props} onsubmit={(event) => { event.preventDefault(); void submit(); }} transition:modalPop class="pointer-events-auto max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-xl">
          <Dialog.Title class="text-title">Reassign handoff</Dialog.Title><Dialog.Description class="mt-1 text-sm text-ink-secondary">Choose who has the next action.</Dialog.Description>
          {#if loading}<p class="mt-5 text-sm text-ink-muted" role="status">Loading eligible assignees…</p>{:else if failed}<p class="mt-5 text-sm text-red-700" role="alert">Eligible assignees could not be loaded.</p>{:else if candidates.length === 0}<p class="mt-5 text-sm text-ink-muted">No eligible assignees are available.</p>{:else}<div class="mt-5 space-y-2" role="radiogroup" aria-label="New assignee">{#each candidates as candidate (candidate.userId)}<button type="button" role="radio" aria-checked={assigneeId === candidate.userId} onclick={() => (assigneeId = candidate.userId)} class={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${assigneeId === candidate.userId ? "border-primary-selected bg-primary-wash" : "border-line hover:bg-primary-wash"}`}><span class="flex size-9 items-center justify-center rounded-full bg-chrome text-xs font-semibold text-navy">{candidate.initials}</span><span class="text-sm font-semibold text-ink">{candidate.label}</span></button>{/each}</div>{/if}
          {#if errorMessage}<div class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert"><p>{errorMessage}</p>{#if onUseLatest}<button type="button" class="mt-2 min-h-11 rounded-lg px-3 font-semibold text-navy hover:bg-white" onclick={onUseLatest}>Use latest values</button>{/if}</div>{/if}
          <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Dialog.Close disabled={busy} class="min-h-11 rounded-lg px-4 text-sm font-medium text-ink-secondary hover:bg-primary-wash disabled:opacity-50">Cancel</Dialog.Close><button type="submit" disabled={!assigneeId || busy} class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Reassigning…" : "Reassign handoff"}</button></div>
        </form>
      {/if}{/snippet}</Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
