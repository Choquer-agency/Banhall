<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import { MAX_WORKFLOW_NOTE_CHARS } from "../../../../shared/workflowLabels";
  import type { Id } from "../../../../convex/_generated/dataModel";

  export type OwnerCandidate = {
    userId: Id<"users">;
    label: string;
    initials: string;
    email: string | null;
    role: "writer" | "manager";
  };

  let {
    open = $bindable(false),
    currentOwnerLabel,
    candidates,
    loading = false,
    failed = false,
    truncated = false,
    busy = false,
    errorMessage = null,
    stale = false,
    latestOwnerLabel = null,
    onUseLatest,
    onSubmit,
  }: {
    open?: boolean;
    currentOwnerLabel: string | null;
    candidates: OwnerCandidate[];
    loading?: boolean;
    failed?: boolean;
    truncated?: boolean;
    busy?: boolean;
    errorMessage?: string | null;
    stale?: boolean;
    latestOwnerLabel?: string | null;
    onUseLatest?: () => void;
    onSubmit: (toUserId: Id<"users">, note?: string) => void | Promise<void>;
  } = $props();

  let selectedUserId = $state<Id<"users"> | null>(null);
  let note = $state("");
  const noteTooLong = $derived(note.length > MAX_WORKFLOW_NOTE_CHARS);
  const canSubmit = $derived(Boolean(selectedUserId) && !busy && !loading && !stale && !noteTooLong);

  function reset() {
    selectedUserId = null;
    note = "";
  }

  $effect(() => {
    if (selectedUserId && !candidates.some((candidate) => candidate.userId === selectedUserId)) {
      selectedUserId = null;
    }
  });

  function moveSelection(event: KeyboardEvent, index: number) {
    if (candidates.length === 0) return;
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % candidates.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + candidates.length) % candidates.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = candidates.length - 1;
    else return;
    event.preventDefault();
    selectedUserId = candidates[next].userId;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-owner-option="${candidates[next].userId}"]`)?.focus();
    });
  }

  async function submit() {
    if (!canSubmit || !selectedUserId) return;
    await onSubmit(selectedUserId, note.trim() || undefined);
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => {
    if (!isOpen) reset();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <div {...props} transition:overlayFade class="fixed inset-0 z-[110] bg-[#052A28]/80"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4">
      <Dialog.Content forceMount>
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div {...props} transition:modalPop class="card pointer-events-auto flex max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-lg flex-col overflow-hidden p-0 shadow-xl">
              <div class="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
                <div>
                  <Dialog.Title class="text-title">Transfer project ownership</Dialog.Title>
                  <Dialog.Description class="mt-1 text-sm text-ink-muted">
                    Current owner: {currentOwnerLabel ?? "—"}
                  </Dialog.Description>
                </div>
                <Dialog.Close aria-label="Close ownership dialog" class="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-navy motion-reduce:transition-none">
                  <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Dialog.Close>
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {#if stale}
                  <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" role="status">
                    <p>
                      This project's workflow changed while this dialog was open{latestOwnerLabel ? `. The current owner is ${latestOwnerLabel}.` : "."}
                      Review the latest candidates before continuing.
                    </p>
                    {#if onUseLatest}
                      <button
                        type="button"
                        class="mt-2 min-h-11 rounded-lg px-3 text-sm font-semibold text-navy transition-colors hover:bg-white hover:text-primary-selected motion-reduce:transition-none"
                        onclick={onUseLatest}
                      >
                        Use latest values
                      </button>
                    {/if}
                  </div>
                {/if}

                {#if loading}
                  <p class="text-sm text-ink-muted" aria-live="polite">Loading eligible owners…</p>
                {:else if failed}
                  <p class="text-sm text-ink-muted">Eligible owners could not be loaded.</p>
                {:else if candidates.length === 0}
                  <p class="text-sm text-ink-muted">No other eligible Consultants or Managers are available.</p>
                {:else}
                  <div class="space-y-2" role="radiogroup" aria-label="New project owner">
                    {#each candidates as candidate, index (candidate.userId)}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selectedUserId === candidate.userId}
                        aria-disabled={busy}
                        tabindex={selectedUserId === candidate.userId || (!selectedUserId && index === 0) ? 0 : -1}
                        data-owner-option={candidate.userId}
                        onclick={() => {
                          if (busy) return;
                          selectedUserId = candidate.userId;
                        }}
                        onkeydown={(event) => moveSelection(event, index)}
                        class={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors motion-reduce:transition-none ${
                          selectedUserId === candidate.userId
                            ? "border-primary-selected bg-primary-wash"
                            : "border-line bg-white hover:border-primary hover:bg-primary-wash"
                        } disabled:opacity-60`}
                      >
                        <span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-full bg-chrome text-xs font-semibold text-navy">{candidate.initials}</span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm font-semibold text-ink">{candidate.label}</span>
                          <span class="block truncate text-xs text-ink-muted">{candidate.email ?? "No email"}</span>
                        </span>
                        <span class="text-data shrink-0 text-ink-muted">{candidate.role === "writer" ? "Consultant" : "Manager"}</span>
                      </button>
                    {/each}
                  </div>
                {/if}

                {#if truncated}
                  <p class="mt-3 text-xs text-amber-800">The team roster is larger than this bounded list. Ask an administrator if the intended owner is not shown.</p>
                {/if}

                <label class="mt-5 block" for="ownership-note">
                  <span class="text-label">Audit note</span>
                  <textarea
                    id="ownership-note"
                    bind:value={note}
                    rows="3"
                    disabled={busy}
                    placeholder="Optional context for this transfer"
                    class="mt-1.5 w-full resize-y rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-primary focus:border-primary disabled:bg-gray-50 motion-reduce:transition-none"
                  ></textarea>
                </label>
                <p class={noteTooLong ? "mt-1 text-right text-xs font-medium text-red-700" : "mt-1 text-right text-xs text-ink-muted"}>
                  {note.length.toLocaleString("en-CA")} / {MAX_WORKFLOW_NOTE_CHARS.toLocaleString("en-CA")}
                </p>

                {#if errorMessage}
                  <p class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errorMessage}</p>
                {/if}
              </div>

              <div class="flex flex-col-reverse gap-2 border-t border-line-soft px-5 py-4 sm:flex-row sm:justify-end">
                <Dialog.Close class="min-h-11 rounded-lg px-4 text-sm font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-navy motion-reduce:transition-none">Cancel</Dialog.Close>
                <button type="button" disabled={!canSubmit} onclick={submit} class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none">
                  {busy ? "Transferring…" : "Transfer ownership"}
                </button>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
