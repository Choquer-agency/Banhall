<!--
  Hand off view (ui-design-final.md section 8, board 5.1y C1 and C2): To (a
  searchable team list, the viewer last so they can take a project back),
  Stage (defaults to the next In progress stage; keeping the current stage is
  allowed), an optional Note, and the helper line naming where the person
  sees it. No due date. Picking a different stage is the user's confirmation
  of the stage change; a stage whose move needs a reason makes the note
  required.
-->
<script lang="ts">
  import { Command, Popover } from "bits-ui";
  import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon } from "phosphor-svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { WORKFLOW_STAGE_LABELS, MAX_WORKFLOW_NOTE_CHARS } from "../../../../../shared/workflowLabels";
  import type { WorkflowStage } from "../../../../../shared/workflowStages";
  import type { TransitionAuthority } from "../../../../../shared/workflowTransitions";
  import PersonAvatar from "./PersonAvatar.svelte";
  import { firstName, nextInProgressStage } from "./detailsFormat";
  import { handOffStageOptions } from "./stageMenu";
  import type { HandOffInput, TeamMember } from "./types";

  let {
    currentStage,
    team,
    teamLoading = false,
    teamError = null,
    initialStage = null,
    viewerAuthorities,
    onCancel,
    onSubmit,
  }: {
    currentStage: WorkflowStage;
    team: TeamMember[];
    teamLoading?: boolean;
    teamError?: string | null;
    /** Preselected stage (Send for review opens this view on Internal review). */
    initialStage?: WorkflowStage | null;
    viewerAuthorities?: readonly TransitionAuthority[];
    onCancel: () => void;
    /** Rejects with a user-facing Error; the view stays open with the error. */
    onSubmit: (input: HandOffInput) => Promise<void>;
  } = $props();

  const stageOptions = $derived(handOffStageOptions(currentStage, viewerAuthorities));
  // The wanted stage when it may be handed off into, else keeping the
  // current stage, else the first stage offered (a Delivered or Abandoned
  // project cannot stay where it is).
  const defaultStage = $derived.by((): WorkflowStage | null => {
    const wanted = initialStage ?? nextInProgressStage(currentStage);
    const offered = (candidate: WorkflowStage) => stageOptions.some((option) => option.stage === candidate);
    if (offered(wanted)) return wanted;
    if (offered(currentStage)) return currentStage;
    return stageOptions[0]?.stage ?? null;
  });

  let assigneeId = $state<string | null>(null);
  let chosenStage = $state<WorkflowStage | null>(null);
  let note = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let peopleOpen = $state(false);
  let stageOpen = $state(false);
  let query = $state("");

  const stage = $derived(chosenStage ?? defaultStage);
  const stageOption = $derived(stageOptions.find((option) => option.stage === stage) ?? null);
  const noteRequired = $derived(stageOption?.move === "reason");
  // The viewer sorts last so they can take a project back.
  const ordered = $derived([...team.filter((member) => !member.isYou), ...team.filter((member) => member.isYou)]);
  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return needle ? ordered.filter((member) => member.label.toLowerCase().includes(needle)) : ordered;
  });
  const assignee = $derived(team.find((member) => member.userId === assigneeId) ?? null);
  const canKeepStage = $derived(stageOptions.some((option) => option.current));
  const canSubmit = $derived(
    Boolean(assignee) &&
      stage !== null &&
      !busy &&
      note.length <= MAX_WORKFLOW_NOTE_CHARS &&
      (!noteRequired || note.trim().length > 0)
  );

  $effect(() => {
    if (!peopleOpen) query = "";
  });

  async function submit() {
    if (!assignee || !canSubmit || stage === null) return;
    busy = true;
    error = null;
    try {
      await onSubmit({ assigneeId: assignee.userId, assigneeLabel: assignee.label, stage, note: note.trim() });
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : "The hand off could not be saved.";
    } finally {
      busy = false;
    }
  }

  const fieldTrigger =
    "field-control flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-ink data-[state=open]:border-primary-selected";
</script>

<form
  data-hand-off-view
  class="flex flex-col gap-4"
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <div class="flex flex-col gap-1.5">
    <span id="hand-off-to-label" class="text-xs text-ink-muted">To</span>
    <Popover.Root bind:open={peopleOpen}>
      <Popover.Trigger>
        {#snippet child({ props })}
          <button {...props} type="button" class={fieldTrigger} aria-labelledby="hand-off-to-label hand-off-to-value" data-hand-off-to>
            <span id="hand-off-to-value" class="flex min-w-0 flex-1 items-center gap-2">
              {#if assignee}
                <PersonAvatar initials={assignee.initials} seed={String(assignee.userId)} isYou={assignee.isYou} />
                <span class="truncate">{assignee.label}{assignee.isYou ? " (you)" : ""}</span>
              {:else}
                <span class="text-ink-faint">Choose a person</span>
              {/if}
            </span>
            <CaretDownIcon size={12} aria-hidden="true" class="shrink-0 text-ink-muted" />
          </button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          class="z-[120] w-[var(--bits-popover-anchor-width)] min-w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-lg outline-none"
        >
          <Command.Root shouldFilter={false} loop label="People">
            <div class="relative border-b border-line-soft p-2">
              <MagnifyingGlassIcon size={14} aria-hidden="true" class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Command.Input
                bind:value={query}
                placeholder="Search people"
                aria-label="Search people"
                class="input-chromeless h-8 w-full rounded-md bg-transparent pl-7 pr-2 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </div>
            <Command.List class="max-h-64 overflow-y-auto p-1.5">
              <Command.Viewport>
                {#if teamLoading}
                  <p class="px-2 py-3 text-[13px] text-ink-muted" role="status">Loading the team...</p>
                {:else if teamError}
                  <p class="px-2 py-3 text-[13px] text-red-700" role="alert">{teamError}</p>
                {:else}
                  {#each filtered as member (member.userId)}
                    <Command.Item
                      value={String(member.userId)}
                      onSelect={() => {
                        assigneeId = member.userId;
                        peopleOpen = false;
                      }}
                      class="flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] text-ink outline-none data-[selected]:bg-primary-wash"
                    >
                      <PersonAvatar initials={member.initials} seed={String(member.userId)} isYou={member.isYou} />
                      <span class="min-w-0 flex-1 truncate">{member.label}{member.isYou ? " (you)" : ""}</span>
                      {#if member.userId === assigneeId}
                        <CheckIcon size={14} aria-hidden="true" class="shrink-0 text-primary-selected" />
                      {/if}
                    </Command.Item>
                  {:else}
                    <p class="px-2 py-3 text-[13px] text-ink-muted" role="status">No one matches.</p>
                  {/each}
                {/if}
              </Command.Viewport>
            </Command.List>
          </Command.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>

  <div class="flex flex-col gap-1.5">
    <span id="hand-off-stage-label" class="text-xs text-ink-muted">Stage</span>
    <Popover.Root bind:open={stageOpen}>
      <Popover.Trigger>
        {#snippet child({ props })}
          <button {...props} type="button" class={fieldTrigger} aria-labelledby="hand-off-stage-label hand-off-stage-value" data-hand-off-stage>
            <span id="hand-off-stage-value" class="flex min-w-0 flex-1 items-center">
              {#if stage}
                <StageBadge {stage} dot />
              {:else}
                <span class="text-ink-faint">No stage available</span>
              {/if}
            </span>
            <CaretDownIcon size={12} aria-hidden="true" class="shrink-0 text-ink-muted" />
          </button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          class="z-[120] max-h-80 w-[var(--bits-popover-anchor-width)] min-w-56 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg outline-none"
        >
          <div role="listbox" aria-label="Stage">
            {#each stageOptions as option (option.stage)}
              <button
                type="button"
                role="option"
                aria-selected={option.stage === stage}
                data-hand-off-stage-option={option.stage}
                onclick={() => {
                  chosenStage = option.stage;
                  stageOpen = false;
                }}
                class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-primary-wash focus-visible:bg-primary-wash focus-visible:outline-none"
              >
                <StageBadge stage={option.stage} dot />
                <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
                  {option.current ? "keep current" : option.move === "reason" ? "asks for a reason" : ""}
                </span>
                {#if option.stage === stage}
                  <CheckIcon size={14} aria-hidden="true" class="shrink-0 text-primary-selected" />
                {/if}
              </button>
            {/each}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <p class="text-xs leading-5 text-ink-muted">
      {#if stage === currentStage}
        The stage stays {WORKFLOW_STAGE_LABELS[currentStage]}.
      {:else if canKeepStage}
        The project moves to this stage when you hand off. Keep {WORKFLOW_STAGE_LABELS[currentStage]} if it should not move.
      {:else}
        The project moves to this stage when you hand off.
      {/if}
    </p>
  </div>

  <div class="flex flex-col gap-1.5">
    <label for="hand-off-note" class="text-xs text-ink-muted">{noteRequired ? "Reason (required)" : "Note (optional)"}</label>
    <textarea
      id="hand-off-note"
      bind:value={note}
      rows="3"
      class="field-control w-full resize-none rounded-lg px-3 py-2 text-[13px] text-ink"
    ></textarea>
    {#if note.length > MAX_WORKFLOW_NOTE_CHARS}
      <p class="text-xs text-red-700" role="alert">Keep the note under {MAX_WORKFLOW_NOTE_CHARS} characters.</p>
    {/if}
  </div>

  {#if assignee}
    <p data-hand-off-helper class="text-xs text-ink-muted">
      {assignee.isYou ? "You see" : `${firstName(assignee.label)} sees`} it under With you on {assignee.isYou ? "your" : "their"} home page.
    </p>
  {/if}
  {#if error}
    <p class="text-xs text-red-700" role="alert">{error}</p>
  {/if}

  <div class="grid grid-cols-2 gap-2">
    <Button type="button" variant="secondary" size="xs" class="h-9" disabled={busy} onclick={onCancel}>Cancel</Button>
    <Button type="submit" size="xs" class="h-9" disabled={!canSubmit} data-hand-off-submit>Hand off</Button>
  </div>
</form>
