<script lang="ts">
  import { onMount, tick } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import { diffWords } from "$lib/diff";
  import { userErrorMessage } from "$lib/errors";
  import {
    RULE_OVERRIDE_MANAGER_ONLY,
    brokenRuleLabel,
    describeBrokenRules,
    type BrokenRule,
  } from "../../../../shared/ruleOverride";

  /**
   * Owner 2026-10-28 (Paper rows 32 to 36): one suggestion card per Line.
   *
   * Folded it reads "Line 242", "3 options" and Review. Opened it shows one
   * version at a time with a pager. Review marks the change in the report
   * (or, where no report is beside the chat, in the card) and the footer
   * becomes Stop review and Accept. Once accepted the card folds to one teal
   * line; opened again it shows what went in and always offers Undo.
   */
  type Change = { before: string; after: string };

  interface Props {
    /** The Line the card edits ("242"); older cards may not know it. */
    line?: string | null;
    /** Each version's new wording, one entry per passage. Option 1 first. */
    options: string[][];
    /** The passages of one version, before and after, for the in-card review. */
    changesFor: (option: number) => Change[];
    /** A find/replace card: it replaces every match inside its Line. */
    everyMatch?: boolean;
    state: "pending" | "applied" | "rejected" | "stale";
    /** 0-based version the writer accepted, when the card offered options. */
    appliedOption?: number;
    /**
     * Whether the viewer may accept, dismiss or reword (report edit access).
     * "loading" hides those actions without a note; "denied" says why.
     */
    applyAccess?: "allowed" | "loading" | "denied";
    /**
     * 2026-11-02 (rule overrides): the rules this change goes against, and
     * whether the viewer may apply it anyway (Managers and Admins). Without
     * that right the card names the rules and says a manager can apply it.
     */
    ruleConflict?: { rules: BrokenRule[]; canOverride: boolean } | null;
    /** On an accepted card applied against rules, the note naming them. */
    overriddenNote?: string | null;
    /** This card is the one under review. */
    reviewing?: boolean;
    /** The report shows the marks and the review bar; else the card does. */
    reviewInReport?: boolean;
    /** The version on show, 0 for Option 1. */
    option?: number;
    onOptionChange?: (option: number) => void;
    onReview: () => void;
    onStopReview: () => void;
    onAccept: () => Promise<void>;
    onUndo?: () => Promise<void>;
    onReject?: () => Promise<void>;
    /** Save writer-authored wording for Option 1, then accept it. */
    onEditWording?: (wording: string[]) => Promise<void>;
    /** Continue discussing this suggestion in the shared composer. */
    onRefine?: () => Promise<void> | void;
    /** The reason an accept or undo failed, when no chat notice shows it. */
    error?: string | null;
    accepting?: boolean;
  }

  let {
    line = null,
    options,
    changesFor,
    everyMatch = false,
    state: editState,
    appliedOption,
    applyAccess = "allowed",
    ruleConflict = null,
    overriddenNote = null,
    reviewing = false,
    reviewInReport = false,
    option = 0,
    onOptionChange,
    onReview,
    onStopReview,
    onAccept,
    onUndo,
    onReject,
    onEditWording: editWordingHandler,
    onRefine,
    error = null,
    accepting = false,
  }: Props = $props();

  const componentId = $props.id();
  const bodyId = `${componentId}-body`;
  const canAct = $derived(applyAccess === "allowed");
  // A card against a rule waits for a manager: others may read and dismiss
  // it, but not review, reword or accept it.
  const managerOnly = $derived(ruleConflict !== null && !ruleConflict.canOverride);
  const canApply = $derived(canAct && !managerOnly);
  const onEditWording = $derived(canApply && option === 0 ? editWordingHandler : undefined);
  const optionCount = $derived(Math.max(1, options.length));
  const title = $derived(line ? `Line ${line}` : "Suggested edit");
  const shownOption = $derived(editState === "applied" ? (appliedOption ?? 0) : option);
  const shownWording = $derived((options[shownOption] ?? options[0] ?? []).filter((text) => text.trim() !== ""));

  let open = $state(false);
  let busy = $state(false);
  let localError = $state<string | null>(null);
  let editing = $state(false);
  let editedWording = $state<string[]>([]);
  let cardEl = $state<HTMLDivElement | null>(null);
  let menuActionChosen = false;

  // Review opens the card; leaving review keeps it open where it was.
  $effect(() => {
    if (reviewing) open = true;
  });
  // A card that is no longer pending cannot stay under review.
  $effect(() => {
    if (editState !== "pending" && reviewing) onStopReview();
  });
  // A review outlives this card's mount: the tray around the card can come
  // and go. The panel ends a review whose card is no longer waiting.

  // In-card review, where the report is not beside the chat.
  const inCardDiff = $derived(reviewing && !reviewInReport ? changesFor(shownOption).map(({ before, after }) => diffWords(before, after)) : []);

  async function run(action: () => Promise<void> | void) {
    busy = true;
    localError = null;
    try {
      await action();
    } catch (e) {
      localError = userErrorMessage(e, "Something went wrong with this suggestion.");
    } finally {
      busy = false;
    }
  }

  function stepOption(delta: number) {
    const next = Math.min(Math.max(0, option + delta), optionCount - 1);
    if (next !== option) onOptionChange?.(next);
  }

  async function startEditing() {
    editedWording = [...(options[0] ?? [])];
    editing = true;
    open = true;
    localError = null;
    await tick();
    cardEl?.querySelector("textarea")?.focus();
  }

  async function saveWording() {
    if (!onEditWording) return;
    await run(async () => {
      await onEditWording(editedWording);
      editing = false;
      editedWording = [];
    });
  }

  const shownError = $derived(error ?? localError);

  // Phase C (W3): "Copy wording" copies the version on show, and says "Copied".
  const wordingText = $derived(shownWording.map((text) => text.trim()).filter(Boolean).join("\n\n"));
  let wordingCopied = $state(false);
  let copyWordingFailed = $state(false);
  let copyWordingTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyWording() {
    clearTimeout(copyWordingTimer);
    try {
      await navigator.clipboard.writeText(wordingText);
      wordingCopied = true;
      copyWordingFailed = false;
    } catch {
      wordingCopied = false;
      copyWordingFailed = true;
    }
    copyWordingTimer = setTimeout(() => {
      wordingCopied = false;
      copyWordingFailed = false;
    }, 2000);
  }
  onMount(() => () => clearTimeout(copyWordingTimer));
</script>

{#snippet chevron(up: boolean, accepted = false)}
  <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    stroke={accepted ? "var(--color-primary-selected)" : "var(--color-ink-muted)"}>
    <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
  </svg>
{/snippet}

{#snippet toggle(label: string, accepted = false)}
  <button type="button" class="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-gray-50 pointer-coarse:size-11"
    aria-expanded={open} aria-controls={bodyId} aria-label={open ? `Hide ${label}` : `Show ${label}`}
    onclick={() => (open = !open)} data-proposed-edit-toggle>
    {@render chevron(open, accepted)}
  </button>
{/snippet}

{#snippet wording(texts: string[])}
  <div class="flex flex-col gap-2">
    {#each texts as text, index (index)}
      <p class="whitespace-pre-wrap text-sm font-light leading-[calc(11/7)] text-ink">{text}</p>
    {/each}
    {#if texts.length === 0}
      <p class="text-sm font-light leading-[calc(11/7)] text-ink-muted">Removes the passage.</p>
    {/if}
  </div>
{/snippet}

{#snippet conflictNotice()}
  {#if ruleConflict}
    <div class="flex flex-col gap-1.5 rounded-lg border border-warning-line bg-warning-surface px-3 py-2.5" data-rule-conflict>
      <p class="text-[0.8125rem] font-medium leading-[calc(18/13)] text-warning-ink">{describeBrokenRules(ruleConflict.rules)}</p>
      <ul class="flex flex-col gap-1">
        {#each ruleConflict.rules as rule (rule.name)}
          <li class="text-xs leading-[calc(4/3)] text-warning-body"><span class="sr-only">{brokenRuleLabel(rule)}: </span>{rule.reason}</li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

{#snippet moreMenu()}
  {#if editState !== "rejected" && (onEditWording || onRefine || (onReject && canAct) || wordingText)}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger aria-label="More actions for this suggestion" title="More actions" disabled={busy || accepting}
        class="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-gray-50 hover:text-ink disabled:opacity-50 pointer-coarse:size-11">
        <svg class="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="start" sideOffset={6} onCloseAutoFocus={(event) => {
          if (menuActionChosen) event.preventDefault();
          menuActionChosen = false;
        }} class="z-[100] w-44 rounded-xl border border-line bg-white p-1 shadow-menu">
          {#if onEditWording && editState === "pending"}
            <DropdownMenu.Item onSelect={() => { menuActionChosen = true; void startEditing(); }} class="flex min-h-8 w-full items-center rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11">
              Edit wording
            </DropdownMenu.Item>
          {/if}
          {#if onRefine && editState === "pending"}
            {@const refine = onRefine}
            <DropdownMenu.Item onSelect={() => { menuActionChosen = true; void run(refine); }} class="flex min-h-8 w-full items-center rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11">
              Refine with AI
            </DropdownMenu.Item>
          {/if}
          {#if wordingText}
            <DropdownMenu.Item onSelect={() => void copyWording()} data-copy-wording class="flex min-h-8 w-full items-center rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11">
              Copy wording
            </DropdownMenu.Item>
          {/if}
          {#if onReject && canAct && editState === "pending"}
            {@const reject = onReject}
            <DropdownMenu.Item onSelect={() => void run(reject)} class="flex min-h-8 w-full items-center rounded-md px-2 text-[0.8125rem] text-ink outline-none hover:bg-primary-wash focus:bg-primary-wash pointer-coarse:min-h-11" data-proposed-edit-dismiss>
              Dismiss
            </DropdownMenu.Item>
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  {/if}
  <span class="sr-only" aria-live="polite" aria-atomic="true" data-copy-wording-announcement>
    {wordingCopied ? "Copied" : copyWordingFailed ? "Couldn't copy. Try again." : ""}
  </span>
{/snippet}

{#if editState === "applied"}
  <!-- Accepted: one teal line; opened, what went in and Undo. -->
  <div bind:this={cardEl} class="overflow-hidden rounded-xl border border-primary-line {open ? 'bg-white' : 'bg-primary-wash'}" data-proposed-edit data-proposed-edit-state="applied">
    <div class="flex h-11 items-center gap-2 bg-primary-wash pl-3 pr-2">
      <svg class="size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary-selected)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span class="shrink-0 text-[0.8125rem] font-medium leading-[calc(18/13)] text-ink">{title}</span>
      <span class="min-w-0 flex-1 truncate text-[0.8125rem] font-medium leading-[calc(18/13)] text-primary-selected">
        {optionCount > 1 ? `Option ${(appliedOption ?? 0) + 1} accepted` : "Accepted"}
      </span>
      {@render toggle("what was accepted", true)}
    </div>
    {#if open}
      <div id={bodyId} class="border-t border-primary-line px-3.5 pb-3.5 pt-3">
        {@render wording(shownWording)}
        {#if overriddenNote}
          <p class="mt-2 text-xs leading-[calc(4/3)] text-warning-ink" data-rule-override-applied>{overriddenNote}</p>
        {/if}
      </div>
      {#if (onUndo && canAct) || wordingText}
        <div class="flex h-11 items-center gap-2 border-t border-line-soft pl-2 pr-2">
          {@render moreMenu()}
          <span class="flex-1"></span>
          {#if onUndo && canAct}
          {@const undo = onUndo}
          <button type="button" class="inline-flex h-7 items-center rounded-[0.4375rem] border border-line bg-white px-3 text-xs font-medium leading-[calc(4/3)] text-ink transition-colors hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-11"
            onclick={() => run(undo)} disabled={busy} data-proposed-edit-undo>
            {busy ? "Undoing…" : "Undo"}
          </button>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
{:else if editState !== "pending"}
  <!-- Dismissed, or no longer matching the report: one quiet line. -->
  <div class="flex h-11 items-center gap-2 rounded-xl border border-line bg-gray-50 pl-3 pr-2" data-proposed-edit data-proposed-edit-state={editState}>
    {#if editState === "stale"}
      <svg class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" />
      </svg>
    {/if}
    <span class="shrink-0 text-[0.8125rem] font-medium leading-[calc(18/13)] text-ink">{title}</span>
    <span class="min-w-0 flex-1 truncate text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">
      {editState === "stale" ? "No longer matches the report" : "Dismissed"}
    </span>
    {#if editState === "stale" && onRefine}
      {@const refine = onRefine}
      <button type="button" class="inline-flex h-7 items-center rounded-[0.4375rem] border border-line bg-white px-3 text-xs font-medium leading-[calc(4/3)] text-ink transition-colors hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-11"
        onclick={() => run(refine)} disabled={busy}>Refine</button>
    {/if}
    {#if editState === "stale"}
      {@render moreMenu()}
    {/if}
  </div>
{:else}
  <div bind:this={cardEl}
    class="flex flex-col rounded-xl border bg-white {reviewing ? 'border-primary-ring shadow-suggestion-review' : 'border-line shadow-suggestion-card'}"
    data-proposed-edit data-proposed-edit-state="pending" data-reviewing={reviewing || undefined}>
    {#if !open}
      <!-- Folded (V1, A1): the Line, how many options, Review. -->
      <div class="flex items-center gap-2.5 py-2 pl-3.5 pr-2">
        <div class="flex min-w-0 flex-1 flex-col gap-px">
          <span class="text-[0.8125rem] font-medium leading-[calc(18/13)] text-ink" data-proposed-edit-label>{title}</span>
          {#if optionCount > 1}
            <span class="text-xs leading-[calc(4/3)] text-ink-muted" data-proposed-edit-options>{optionCount} options</span>
          {/if}
          {#if ruleConflict}
            <span class="text-xs leading-[calc(4/3)] text-warning-ink-muted" data-rule-conflict-flag>
              {ruleConflict.rules.length > 1 ? `Goes against ${ruleConflict.rules.length} rules` : "Goes against a rule"}
            </span>
          {/if}
        </div>
        {#if canApply}
          <button type="button" class="inline-flex h-[1.875rem] shrink-0 items-center rounded-[0.4375rem] bg-primary-selected px-3 text-xs font-medium leading-[calc(4/3)] text-white transition-colors hover:bg-primary-dark pointer-coarse:min-h-11"
            onclick={onReview} data-proposed-edit-review>Review</button>
        {/if}
        {@render toggle("the suggestion")}
      </div>
    {:else}
      <!-- Opened (V2) and under review (V3). -->
      <div class="flex items-center gap-2.5 p-3">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <span class="shrink-0 text-[0.8125rem] font-medium leading-[calc(18/13)] text-ink" data-proposed-edit-label>{title}</span>
          {#if optionCount > 1 && option === 0}
            <span class="inline-flex h-5 shrink-0 items-center rounded-full border border-primary-line bg-primary-wash px-[0.4375rem] text-xs font-medium leading-[calc(4/3)] text-primary-selected">Recommended</span>
          {/if}
        </div>
        {@render toggle("the suggestion")}
      </div>
      <div id={bodyId} class="flex flex-col gap-2 border-t border-line-soft px-3.5 py-3">
        {@render conflictNotice()}
        {#if editing}
          {#each editedWording as text, index (index)}
            <label class="block">
              {#if editedWording.length > 1}
                <span class="mb-1.5 block text-xs leading-[calc(4/3)] text-ink-muted">Passage {index + 1}</span>
              {/if}
              <textarea value={text} oninput={(event) => { editedWording[index] = event.currentTarget.value; }}
                aria-label={editedWording.length > 1 ? `Edit passage ${index + 1} wording` : "Edit the wording"}
                rows={Math.min(7, Math.max(3, text.split("\n").length + 1))}
                class="field-control w-full resize-y rounded-md px-2.5 py-2 text-sm font-light leading-[calc(11/7)] text-ink"></textarea>
            </label>
          {/each}
        {:else}
          <div class="flex items-center gap-2">
            <span class="flex-1 text-[0.8125rem] font-medium leading-[calc(18/13)] text-ink">Option {option + 1}</span>
            {#if optionCount > 1}
              <button type="button" class="flex size-6 items-center justify-center rounded-md disabled:opacity-40 pointer-coarse:size-11" aria-label="Previous option"
                disabled={option === 0} onclick={() => stepOption(-1)}>
                <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-secondary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              <span class="text-xs leading-[calc(4/3)] text-ink-muted" aria-live="polite">{option + 1} of {optionCount}</span>
              <button type="button" class="flex size-6 items-center justify-center rounded-md disabled:opacity-40 pointer-coarse:size-11" aria-label="Next option"
                disabled={option >= optionCount - 1} onclick={() => stepOption(1)}>
                <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-secondary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            {/if}
          </div>
          {#if everyMatch}
            <p class="text-xs leading-[calc(4/3)] text-ink-muted">Replaces every match in {line ? `Line ${line}` : "the report"}.</p>
          {/if}
          {#if inCardDiff.length}
            <div class="flex flex-col gap-2" aria-label="Proposed changes">
              {#each inCardDiff as parts, index (index)}
                <p class="whitespace-pre-wrap text-sm font-light leading-[calc(11/7)] text-ink">
                  {#each parts as part, partIndex (partIndex)}
                    {#if part.type === "removed"}
                      <span class="rounded-[0.1875rem] bg-danger-surface px-0.5 text-danger-ink line-through">{part.text}</span>
                    {:else if part.type === "added"}
                      <span class="rounded-[0.1875rem] bg-success-soft px-0.5 text-success-ink">{part.text}</span>
                    {:else}
                      {part.text}
                    {/if}
                  {/each}
                </p>
              {/each}
            </div>
          {:else}
            {@render wording(shownWording)}
          {/if}
        {/if}
      </div>
      <div class="flex h-11 items-center gap-2 border-t border-line-soft pl-2 pr-2">
        {#if editing}
          <span class="flex-1"></span>
          <button type="button" class="inline-flex h-7 items-center rounded-[0.4375rem] border border-line bg-white px-2.5 text-xs font-medium leading-[calc(4/3)] text-ink hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-11"
            onclick={() => { editing = false; editedWording = []; }} disabled={busy}>Cancel</button>
          <button type="button" class="inline-flex h-7 items-center rounded-[0.4375rem] bg-primary-selected px-3 text-xs font-medium leading-[calc(4/3)] text-white hover:bg-primary-dark disabled:opacity-50 pointer-coarse:min-h-11"
            onclick={saveWording} disabled={busy}>{busy ? "Accepting…" : "Save and accept"}</button>
        {:else}
          {@render moreMenu()}
          <span class="flex-1"></span>
          {#if applyAccess === "denied"}
            <p class="pr-1.5 text-xs leading-[calc(4/3)] text-ink-muted" data-apply-unavailable>Only people who can edit this report can accept suggestions.</p>
          {:else if canAct && managerOnly}
            <p class="pr-1.5 text-xs leading-[calc(4/3)] text-ink-muted" data-apply-manager-only>{RULE_OVERRIDE_MANAGER_ONLY}</p>
          {:else if canAct && reviewing}
            <button type="button" class="inline-flex h-7 items-center rounded-[0.4375rem] border border-line bg-white px-2.5 text-xs font-medium leading-[calc(4/3)] text-ink hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-11"
              onclick={onStopReview} disabled={accepting} data-proposed-edit-stop-review>Stop review</button>
            <button type="button" class="inline-flex h-7 items-center rounded-[0.4375rem] bg-primary-selected px-3 text-xs font-medium leading-[calc(4/3)] text-white hover:bg-primary-dark disabled:opacity-50 pointer-coarse:min-h-11"
              onclick={() => void onAccept()} disabled={accepting} data-proposed-edit-accept>{accepting ? "Accepting…" : "Accept"}</button>
          {:else if canAct}
            <button type="button" class="inline-flex h-7 items-center rounded-[0.4375rem] bg-primary-selected px-2.5 text-xs font-medium leading-[calc(4/3)] text-white hover:bg-primary-dark pointer-coarse:min-h-11"
              onclick={onReview} data-proposed-edit-review>Review</button>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
{#if shownError}
  <p class="mt-1.5 text-xs leading-[calc(4/3)] text-danger-ink" role="alert" data-proposed-edit-error>{shownError}</p>
{/if}
