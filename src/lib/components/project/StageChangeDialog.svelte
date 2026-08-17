<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import { MAX_WORKFLOW_NOTE_CHARS, type WorkflowStageOption } from "../../../../shared/workflowLabels";
  import type { WorkflowStage } from "../../../../shared/workflowStages";

  let {
    open = $bindable(false),
    currentStageLabel,
    options,
    busy = false,
    errorMessage = null,
    stale = false,
    latestStageLabel = null,
    onUseLatest,
    onSubmit,
  }: {
    open?: boolean;
    currentStageLabel: string;
    options: WorkflowStageOption[];
    busy?: boolean;
    errorMessage?: string | null;
    stale?: boolean;
    latestStageLabel?: string | null;
    onUseLatest?: () => void;
    onSubmit: (to: WorkflowStage, note?: string) => void | Promise<void>;
  } = $props();

  let selectedStage = $state<WorkflowStage | null>(null);
  let note = $state("");
  let reconcileMessage = $state<string | null>(null);
  const selected = $derived(options.find((option) => option.to === selectedStage) ?? null);
  const trimmedNote = $derived(note.trim());
  const noteTooLong = $derived(note.length > MAX_WORKFLOW_NOTE_CHARS);
  const canSubmit = $derived(
    Boolean(selected) &&
      !selected?.disabledReason &&
      !busy &&
      !stale &&
      !noteTooLong &&
      (!selected?.requiresNote || Boolean(trimmedNote))
  );

  function reset() {
    selectedStage = null;
    note = "";
    reconcileMessage = null;
  }

  $effect(() => {
    if (selectedStage && !options.some((option) => option.to === selectedStage)) {
      selectedStage = null;
      reconcileMessage = latestStageLabel
        ? `Your selected stage is no longer available from ${latestStageLabel}. Your audit note has been preserved.`
        : "Your selected stage is no longer available. Your audit note has been preserved.";
    }
  });

  function selectOption(option: WorkflowStageOption) {
    if (option.disabledReason || busy) return;
    selectedStage = option.to;
  }

  function moveSelection(event: KeyboardEvent, index: number) {
    const enabled = options.filter((option) => !option.disabledReason);
    const current = enabled.findIndex((option) => option.to === options[index]?.to);
    if (current < 0 || enabled.length === 0) return;
    let next = current;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (current + 1) % enabled.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else return;
    event.preventDefault();
    selectedStage = enabled[next].to;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-stage-option="${enabled[next].to}"]`)?.focus();
    });
  }

  async function submit() {
    if (!canSubmit || !selected) return;
    await onSubmit(selected.to, trimmedNote || undefined);
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
                  <Dialog.Title class="text-title">Change workflow stage</Dialog.Title>
                  <Dialog.Description class="mt-1 text-sm text-ink-muted">
                    Current stage: {currentStageLabel}
                  </Dialog.Description>
                </div>
                <Dialog.Close aria-label="Close stage dialog" class="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-navy motion-reduce:transition-none">
                  <svg class="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Dialog.Close>
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {#if stale}
                  <div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" role="status">
                    <p>
                      This project's workflow changed while this dialog was open{latestStageLabel ? `. It is now ${latestStageLabel}.` : "."}
                      Review the latest options before continuing.
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

                {#if reconcileMessage}
                  <p class="mb-4 text-sm leading-relaxed text-amber-900" role="status">{reconcileMessage}</p>
                {/if}

                {#if options.length === 0}
                  <p class="text-sm text-ink-muted">No workflow transitions are available to you from this stage.</p>
                {:else}
                  <div class="space-y-2" role="radiogroup" aria-label="Next workflow stage">
                    {#each options as option, index (option.to)}
                      {@const reasonId = `stage-${option.to}-reason`}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selectedStage === option.to}
                        aria-describedby={option.disabledReason ? reasonId : undefined}
                        aria-disabled={Boolean(option.disabledReason) || busy}
                        tabindex={selectedStage === option.to || (!selectedStage && !option.disabledReason && options.findIndex((item) => !item.disabledReason) === index) ? 0 : -1}
                        data-stage-option={option.to}
                        onclick={() => selectOption(option)}
                        onkeydown={(event) => moveSelection(event, index)}
                        class={`min-h-11 w-full rounded-xl border px-4 py-3 text-left transition-colors motion-reduce:transition-none ${
                          selectedStage === option.to
                            ? "border-primary-selected bg-primary-wash"
                            : "border-line bg-white hover:border-primary hover:bg-primary-wash"
                        } ${option.disabledReason || busy ? "cursor-not-allowed border-line-soft bg-gray-50 opacity-70" : ""}`}
                      >
                        <span class="block text-sm font-semibold text-ink">{option.label}</span>
                        <span class="mt-0.5 block text-xs leading-5 text-ink-muted">{option.description}</span>
                        {#if option.disabledReason}
                          <span id={reasonId} class="mt-1 block text-xs font-medium text-amber-800">{option.disabledReason}</span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                {/if}

                {#if selected || note}
                  <label class="mt-5 block" for="workflow-note">
                    <span class="text-label text-ink-secondary">Audit note{#if selected?.requiresNote}<span class="text-red-600"> *</span>{/if}</span>
                    <textarea
                      id="workflow-note"
                      bind:value={note}
                      rows="4"
                      required={selected?.requiresNote ?? false}
                      disabled={busy}
                      placeholder={selected?.requiresNote ? "Explain this workflow change" : "Optional context for the audit history"}
                    class="field-control mt-1.5 w-full resize-y rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint disabled:opacity-60"
                    ></textarea>
                  </label>
                  <p class={noteTooLong ? "mt-1 text-right text-xs font-medium text-red-700" : "mt-1 text-right text-xs text-ink-secondary"}>
                    {note.length.toLocaleString("en-CA")} / {MAX_WORKFLOW_NOTE_CHARS.toLocaleString("en-CA")}
                  </p>
                {/if}

                {#if errorMessage}
                  <p class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errorMessage}</p>
                {/if}
              </div>

              <div class="flex flex-col-reverse gap-2 border-t border-line-soft px-5 py-4 sm:flex-row sm:justify-end">
                <Dialog.Close class="min-h-11 rounded-lg px-4 text-sm font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-navy motion-reduce:transition-none">Cancel</Dialog.Close>
                <button type="button" disabled={!canSubmit} onclick={submit} class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none">
                  {busy ? "Changing…" : "Change stage"}
                </button>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
