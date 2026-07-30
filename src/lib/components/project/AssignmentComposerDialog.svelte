<script lang="ts">
  import { Dialog } from "bits-ui";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { overlayFade, modalPop } from "$lib/motion";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import type { WorkItemKind } from "../../../../shared/workItems";
  import {
    MAX_WORK_ITEM_INSTRUCTIONS_CHARS,
    WORK_ITEM_BLOCKING_DEFAULTS,
    WORK_ITEM_KIND_LABELS,
  } from "../../../../shared/workItems";

  export type AssigneeCandidate = {
    userId: Id<"users">;
    label: string;
    initials: string;
    email: string | null;
    role: "writer" | "manager";
  };

  export type AssignmentValues = {
    assigneeId: Id<"users">;
    kind: WorkItemKind;
    dueDate: string;
    instructions: string;
    blocking: boolean;
    changeStage: boolean;
  };

  export type BlockingConflict = {
    workItemId: Id<"workItems">;
    assigneeLabel: string;
    kindLabel: string;
    canReassign: boolean;
  };

  let {
    open = $bindable(false),
    variant = "full",
    candidates,
    loading = false,
    failed = false,
    truncated = false,
    canUseFinancialKind = false,
    busy = false,
    errorMessage = null,
    conflict = null,
    initialKind = "other",
    initialBlocking = false,
    initialInstructions = "",
    initialDueDate = "",
    stale = false,
    latestWorkflowVersion = null,
    onUseLatest,
    onSubmit,
    onReassignConflict,
  }: {
    open?: boolean;
    variant?: "full" | "review";
    candidates: AssigneeCandidate[];
    loading?: boolean;
    failed?: boolean;
    truncated?: boolean;
    canUseFinancialKind?: boolean;
    busy?: boolean;
    errorMessage?: string | null;
    conflict?: BlockingConflict | null;
    initialKind?: WorkItemKind;
    initialBlocking?: boolean;
    initialInstructions?: string;
    initialDueDate?: string;
    stale?: boolean;
    latestWorkflowVersion?: number | null;
    onUseLatest?: () => void;
    onSubmit: (values: AssignmentValues) => void | Promise<void>;
    onReassignConflict?: (workItemId: Id<"workItems">, assigneeId: Id<"users">) => void;
  } = $props();

  let assigneeId = $state<Id<"users"> | null>(null);
  let kind = $state<WorkItemKind>("other");
  let dueDate = $state("");
  let instructions = $state("");
  let blocking = $state(false);
  let blockingTouched = $state(false);
  let changeStage = $state(false);
  let fieldError = $state<string | null>(null);
  let candidateSearch = $state("");

  const kindItems = $derived(
    Object.entries(WORK_ITEM_KIND_LABELS)
      .filter(([value]) => value !== "financial" || canUseFinancialKind)
      .map(([value, label]) => ({ value, label }))
  );
  const selectedAssignee = $derived(candidates.find((candidate) => candidate.userId === assigneeId));
  const visibleCandidates = $derived(
    candidateSearch.trim()
      ? candidates.filter((candidate) =>
          `${candidate.label} ${candidate.email ?? ""}`.toLowerCase().includes(candidateSearch.trim().toLowerCase())
        )
      : candidates
  );
  const noteTooLong = $derived(instructions.length > MAX_WORK_ITEM_INSTRUCTIONS_CHARS);
  const selectionVisible = $derived(Boolean(assigneeId && visibleCandidates.some((candidate) => candidate.userId === assigneeId)));
  const firstVisibleId = $derived(visibleCandidates[0]?.userId ?? null);
  const canSubmit = $derived(
    selectionVisible && Boolean(kind && instructions.trim()) && !noteTooLong && !busy && !loading && !stale
  );

  $effect(() => {
    if (open) reset();
  });

  function reset() {
    assigneeId = null;
    kind = initialKind;
    dueDate = initialDueDate;
    instructions = initialInstructions;
    blocking = initialBlocking;
    blockingTouched = false;
    changeStage = variant === "review";
    fieldError = null;
    candidateSearch = "";
  }

  function changeKind(value: string) {
    kind = value as WorkItemKind;
    if (!blockingTouched) blocking = WORK_ITEM_BLOCKING_DEFAULTS[kind];
  }

  async function submit() {
    if (!assigneeId) {
      fieldError = "Choose an assignee.";
      return;
    }
    if (!instructions.trim()) {
      fieldError = "Add instructions for the assignee.";
      return;
    }
    if (!selectionVisible) {
      fieldError = "Choose an assignee from the visible search results.";
      return;
    }
    if (!canSubmit) return;
    fieldError = null;
    await onSubmit({ assigneeId, kind, dueDate, instructions: instructions.trim(), blocking, changeStage });
  }

  function moveCandidate(event: KeyboardEvent, index: number) {
    if (visibleCandidates.length === 0) return;
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % visibleCandidates.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + visibleCandidates.length) % visibleCandidates.length;
    else return;
    event.preventDefault();
    assigneeId = visibleCandidates[next].userId;
    document.querySelector<HTMLElement>(`[data-assignee-option="${visibleCandidates[next].userId}"]`)?.focus();
  }

  function formKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => { if (!isOpen) reset(); }}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}<div {...props} transition:overlayFade class="fixed inset-0 z-[120] bg-[#052A28]/80"></div>{/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[120] flex items-end sm:items-center sm:justify-center sm:p-4">
      <Dialog.Content forceMount onEscapeKeydown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <form
              {...props}
              onsubmit={(event) => { event.preventDefault(); void submit(); }}
              onkeydown={formKeydown}
              transition:modalPop
              class="pointer-events-auto flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-xl sm:rounded-xl"
            >
              <header class="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
                <div>
                  <Dialog.Title class="text-title">{variant === "review" ? "Send for internal review" : "Assign work"}</Dialog.Title>
                  <Dialog.Description class="mt-1 text-sm text-ink-secondary">
                    {variant === "review" ? "Choose the reviewer and confirm the handoff." : "Give one person a clear next action."}
                  </Dialog.Description>
                </div>
                <Dialog.Close aria-label="Close assignment dialog" disabled={busy} class="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-navy disabled:opacity-50 motion-reduce:transition-none">
                  <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
                </Dialog.Close>
              </header>

              <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
                <fieldset disabled={busy}>
                  <legend class="text-label text-ink-secondary">Assignee <span class="text-red-600">*</span></legend>
                  {#if loading}
                    <p class="mt-2 text-sm text-ink-muted" role="status">Loading eligible assignees…</p>
                  {:else if failed}
                    <p class="mt-2 text-sm text-red-700" role="alert">Eligible assignees could not be loaded.</p>
                  {:else if candidates.length === 0}
                    <p class="mt-2 text-sm text-ink-muted">No eligible Consultants or Managers are available.</p>
                  {:else}
                    <input type="search" bind:value={candidateSearch} placeholder="Search Consultants and Managers" aria-label="Search assignees" class="mt-2 h-11 w-full rounded-lg border border-line px-3.5 text-sm outline-none focus:border-primary" />
                    <div class="mt-2 max-h-52 space-y-2 overflow-y-auto" role="radiogroup" aria-label="Work-item assignee">
                      {#each visibleCandidates as candidate (candidate.userId)}
                        <button type="button" role="radio" aria-checked={assigneeId === candidate.userId} tabindex={(selectionVisible && assigneeId === candidate.userId) || (!selectionVisible && firstVisibleId === candidate.userId) ? 0 : -1} data-assignee-option={candidate.userId} onclick={() => (assigneeId = candidate.userId)} onkeydown={(event) => moveCandidate(event, visibleCandidates.indexOf(candidate))} class={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors motion-reduce:transition-none ${assigneeId === candidate.userId ? "border-primary-selected bg-primary-wash" : "border-line hover:border-primary hover:bg-primary-wash"}`}>
                          <span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-full bg-chrome text-xs font-semibold text-navy">{candidate.initials}</span>
                          <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold text-ink">{candidate.label}</span><span class="block truncate text-xs text-ink-muted">{candidate.email ?? (candidate.role === "writer" ? "Consultant" : "Manager")}</span></span>
                        </button>
                      {:else}<p class="px-2 py-3 text-sm text-ink-muted">No matching assignees.</p>{/each}
                    </div>
                  {/if}
                  {#if truncated}<p class="mt-2 text-xs text-amber-800">The eligible roster is bounded. Refine with an administrator if the intended person is not shown.</p>{/if}
                </fieldset>

                {#if variant === "review"}
                  <dl class="divide-y divide-line-soft rounded-xl border border-line px-4">
                    <div class="flex items-center justify-between gap-4 py-3"><dt class="text-label">Work type</dt><dd class="text-sm font-semibold text-ink">Internal review</dd></div>
                    <div class="flex items-center justify-between gap-4 py-3"><dt class="text-label">Blocking handoff</dt><dd class="text-sm font-semibold text-ink">{blocking ? "Yes" : "No"}</dd></div>
                  </dl>
                {:else}
                  <label class="block" for="assignment-kind"><span class="text-label text-ink-secondary">Work type <span class="text-red-600">*</span></span><SelectInput id="assignment-kind" value={kind} items={kindItems} onValueChange={changeKind} disabled={busy} class="mt-1.5" /></label>
                {/if}

                <label class="block" for="assignment-due"><span class="text-label text-ink-secondary">Due date</span><input id="assignment-due" type="date" bind:value={dueDate} disabled={busy} class="mt-1.5 h-11 w-full rounded-lg border border-line bg-white px-3.5 text-sm text-ink outline-none transition-colors hover:border-primary focus:border-primary disabled:bg-gray-50 motion-reduce:transition-none" /><span class="mt-1 block text-xs text-ink-muted">Optional but recommended. Dates use Pacific time.</span></label>

                <label class="block" for="assignment-instructions"><span class="text-label text-ink-secondary">Instructions <span class="text-red-600">*</span></span><textarea id="assignment-instructions" bind:value={instructions} rows="4" disabled={busy} required placeholder="Describe the next action and expected outcome" class="mt-1.5 w-full resize-y rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-primary focus:border-primary disabled:bg-gray-50 motion-reduce:transition-none"></textarea></label>
                <p class={noteTooLong ? "-mt-4 text-right text-xs font-medium text-red-700" : "-mt-4 text-right text-xs text-ink-muted"}>{instructions.length.toLocaleString("en-CA")} / {MAX_WORK_ITEM_INSTRUCTIONS_CHARS.toLocaleString("en-CA")}</p>

                {#if variant === "full"}
                  <label class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-3 hover:bg-primary-wash"><input type="checkbox" bind:checked={blocking} onchange={() => (blockingTouched = true)} disabled={busy} class="mt-0.5 size-5 accent-primary-selected disabled:opacity-50" /><span><span class="block text-sm font-semibold text-ink">Blocking handoff</span><span class="mt-0.5 block text-xs leading-5 text-ink-muted">{selectedAssignee?.label ?? "The assignee"} will be shown as having the project's next action.</span></span></label>
                {/if}

                {#if variant === "review"}
                  <label class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-3 hover:bg-primary-wash"><input type="checkbox" bind:checked={changeStage} disabled={busy} class="mt-0.5 size-5 accent-primary-selected disabled:opacity-50" /><span><span class="block text-sm font-semibold text-ink">Also move Stage to Internal review</span><span class="mt-0.5 block text-xs leading-5 text-ink-muted">The assignment and Stage change will be recorded together.</span></span></label>
                {/if}

                {#if stale}
                  <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status"><p>The project workflow changed while this assignment was open{latestWorkflowVersion !== null ? ". Review the latest values before continuing." : "."}</p>{#if onUseLatest}<button type="button" class="mt-2 min-h-11 rounded-lg px-3 font-semibold text-navy hover:bg-white" onclick={onUseLatest}>Use latest values</button>{/if}</div>
                {/if}

                {#if conflict}
                  <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
                    <p>This project already has a {conflict.kindLabel.toLowerCase()} handoff with {conflict.assigneeLabel}. Reassign it instead?</p>
                    {#if conflict.canReassign && assigneeId && onReassignConflict}<button type="button" disabled={busy} class="mt-2 min-h-11 rounded-lg px-3 font-semibold text-navy hover:bg-white disabled:opacity-50" onclick={() => onReassignConflict(conflict!.workItemId, assigneeId!)}>Reassign that handoff</button>{/if}
                    <button type="button" disabled={busy} class="mt-2 min-h-11 rounded-lg px-3 font-semibold text-navy hover:bg-white disabled:opacity-50" onclick={() => { blocking = false; changeStage = false; }}>Assign as non-blocking instead</button>
                  </div>
                {/if}

                {#if fieldError || errorMessage}<p class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{fieldError ?? errorMessage}</p>{/if}
              </div>

              <footer class="flex flex-col-reverse gap-2 border-t border-line-soft px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
                <Dialog.Close disabled={busy} class="min-h-11 rounded-lg px-4 text-sm font-medium text-ink-secondary hover:bg-primary-wash disabled:opacity-50">Cancel</Dialog.Close>
                <button type="submit" disabled={!canSubmit} class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none">{busy ? "Assigning…" : variant === "review" && blocking ? "Send for internal review" : "Assign work"}</button>
              </footer>
            </form>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
