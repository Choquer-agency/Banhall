<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import { DropdownMenu, Popover } from "bits-ui";
  import { CheckIcon, QuotesIcon, XIcon } from "phosphor-svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { isLongForSeed, MAX_EDITED_BULLET_CHARS } from "../../../../convex/lib/seedContract";
  import { describeSource, EMPTY_SOURCE_ATTRIBUTION } from "./attribution";
  import { citationSpeakerLine, SPEAKER_CHECK_NOTE, type QuoteCitation } from "./citations";
  import { findExactQuoteSpans, segmentBullet } from "./exactQuote";
  import { MAX_CARD_TAGS, seedTagStyle } from "./seedTags";
  import SeedQuote from "./SeedQuote.svelte";
  import type {
    SeedCardData,
    SeedDraftUpdate,
    SeedEditDraft,
    SeedFeedbackDraft,
    SeedLocalDraft,
    SeedSourceAttribution,
  } from "./types";

  let {
    generationId,
    roleId,
    seedStageVersion,
    item,
    canEdit,
    busy = false,
    sourceAttribution = EMPTY_SOURCE_ATTRIBUTION,
    onSelect,
    onEdit,
    onRestore,
    onFeedback,
    draft,
    onDraftChange,
    onOpenSource,
    nested = false,
    showOriginal = false,
    retained = true,
    unavailableNotice = "Editing is unavailable with your current access.",
    below = undefined,
  }: {
    generationId: string;
    roleId: string;
    /** The current server stage version; drafts keep their own base. */
    seedStageVersion: number;
    item: SeedCardData;
    canEdit: boolean;
    busy?: boolean;
    sourceAttribution?: SeedSourceAttribution;
    onSelect: (selected: boolean) => Promise<boolean>;
    onEdit: (bullets: string[], expectedSeedStageVersion: number) => Promise<boolean>;
    onRestore: () => Promise<boolean>;
    onFeedback: (instruction: string, expectedSeedStageVersion: number) => Promise<boolean>;
    draft?: SeedLocalDraft;
    onDraftChange: (update: SeedDraftUpdate) => void;
    /** Opens a quoted source in its transcript, where the host has a route. */
    onOpenSource?: (citation: QuoteCitation) => void;
    /** A revised seed shown under the seed its feedback targeted. */
    nested?: boolean;
    /** Batch history: an edited seed also lists its original wording. */
    showOriginal?: boolean;
    /** Whether the device is keeping unsaved text across navigation/reload (A2). */
    retained?: boolean;
    /** Why mutation controls are absent while unsaved text is kept. */
    unavailableNotice?: string;
    /** Rendered inside the card under its own content: the revised seeds
     * its feedback produced (board 3.2). */
    below?: Snippet;
  } = $props();

  /** One-click revision requests from the feedback menu (section 3). */
  const FEEDBACK_PRESETS = [
    { label: "More specific", instruction: "Make this seed more specific." },
    { label: "Shorter", instruction: "Make this seed shorter." },
    { label: "Different angle", instruction: "Take a different angle on this seed." },
    { label: "Plainer language", instruction: "Use plainer language in this seed." },
  ] as const;

  const uid = $props.id();
  // Local mirrors of the stored draft so typing stays responsive; every change
  // is published to the owner, which remains the authoritative copy.
  let edit = $state<SeedEditDraft | null>(null);
  let feedback = $state<SeedFeedbackDraft | null>(null);
  let savingEdit = $state(false);
  let sendingFeedback = $state(false);
  let sendingPreset = $state(false);
  // The Give feedback trigger. It stays focusable while a preset is sent, so
  // the menu can hand focus back to it, and it takes focus back when the
  // feedback box closes under the writer's focus.
  let feedbackTrigger = $state<HTMLElement | null>(null);
  let hydratedDraftSignature = $state<string | null>(null);
  let feedbackMenuOpen = $state(false);
  let quotesOpen = $state(false);
  // Esc on changed wording asks once before it discards (never a silent loss).
  let discardArmed = $state(false);
  let firstField = $state<HTMLTextAreaElement | null>(null);
  let feedbackField = $state<HTMLTextAreaElement | null>(null);

  $effect(() => {
    const signature = `${item.seedId}:${draft ? JSON.stringify(draft) : "none"}`;
    if (hydratedDraftSignature === signature) return;
    hydratedDraftSignature = signature;
    edit = draft?.edit ? { ...draft.edit } : null;
    feedback = draft?.feedback ? { ...draft.feedback } : null;
  });

  const editStale = $derived(!!edit && edit.baseSeedStageVersion !== seedStageVersion);
  const feedbackStale = $derived(
    !!feedback && feedback.baseSeedStageVersion !== seedStageVersion
  );
  // Soft note only: a writer's wording is never blocked by the AI Seed
  // contract (PRD FR-11).
  const editLong = $derived(
    !!edit && (isLongForSeed(edit.bulletOne) || isLongForSeed(edit.bulletTwo))
  );
  const editChanged = $derived(
    !!edit &&
      (edit.bulletOne !== (item.bullets[0] ?? "") || edit.bulletTwo !== (item.bullets[1] ?? ""))
  );
  const hasUnsavedText = $derived(
    !!edit || (!!feedback && feedback.instruction.trim().length > 0)
  );
  const editing = $derived(!!edit && canEdit);

  // Exact-quote underlines (decision 17): only the writer-untouched wording
  // is compared with the cited excerpts; an edited bullet loses them.
  const excerpts = $derived(item.provenance.map((citation) => citation.exactExcerpt));
  const bulletViews = $derived(
    item.bullets.map((bullet, index) => {
      const edited = item.edited && bullet !== (item.originalBullets[index] ?? null);
      const spans = edited ? [] : findExactQuoteSpans(bullet, excerpts);
      return { bullet, edited, segments: segmentBullet(bullet, spans), spans };
    })
  );
  // The revert control sits beside the first changed bullet (or the first
  // bullet when the change is not visible in the wording itself).
  const firstEditedBullet = $derived(
    item.edited ? Math.max(0, bulletViews.findIndex((view) => view.edited)) : -1
  );
  // Citations no bullet underlines stay reachable, with their source (A8).
  const unmatchedCitations = $derived.by(() => {
    const matched = new Set<number>();
    for (const view of bulletViews) for (const span of view.spans) matched.add(span.citationIndex);
    return item.provenance.filter((_, index) => !matched.has(index));
  });
  const showQuotes = $derived(unmatchedCitations.length > 0 || item.provenanceTruncated);
  const tags = $derived(item.tags.slice(0, MAX_CARD_TAGS).map(seedTagStyle));
  // A selected or revised seed shows its tools only on hover or focus, and
  // keeps them while one of their menus is open (board 3.2). They then sit at
  // the end of the card's tag row, in space that row keeps free for them, so
  // they never cover a bullet, Restore original wording or the feedback box.
  // A card without a tag row keeps the tools in their own row at its foot.
  // Coarse pointers have no hover, so there the tools always show.
  const tagRowShown = $derived(tags.length > 0 || item.support === "writer_asserted" || !!item.outdated);
  const footerFloating = $derived((item.selected || nested) && !editing);
  const footerHidden = $derived(footerFloating && !feedbackMenuOpen && !quotesOpen);
  const toolCount = $derived((showQuotes ? 1 : 0) + (canEdit ? 2 : 0));
  const toolsInTagRow = $derived(footerFloating && tagRowShown && toolCount > 0);

  function sameEdit(left: SeedEditDraft | null | undefined, right: SeedEditDraft) {
    return (
      !!left &&
      left.bulletOne === right.bulletOne &&
      left.bulletTwo === right.bulletTwo &&
      left.baseSeedStageVersion === right.baseSeedStageVersion
    );
  }

  function sameFeedback(left: SeedFeedbackDraft | null | undefined, right: SeedFeedbackDraft) {
    return (
      !!left &&
      left.instruction === right.instruction &&
      left.baseSeedStageVersion === right.baseSeedStageVersion
    );
  }

  function composed(
    current: SeedLocalDraft | undefined,
    part: { edit?: SeedEditDraft | null; feedback?: SeedFeedbackDraft | null }
  ): SeedLocalDraft | null {
    const next = {
      ownerGenerationId: current?.ownerGenerationId ?? generationId,
      ownerRoleId: current?.ownerRoleId ?? roleId,
      edit: part.edit !== undefined ? part.edit : (current?.edit ?? null),
      feedback: part.feedback !== undefined ? part.feedback : (current?.feedback ?? null),
    };
    return next.edit || next.feedback ? next : null;
  }

  function publishEdit(next: SeedEditDraft | null) {
    edit = next;
    discardArmed = false;
    const value = next ? { ...next } : null;
    onDraftChange((current) => composed(current, { edit: value }));
  }

  function publishFeedback(next: SeedFeedbackDraft | null) {
    feedback = next;
    const value = next ? { ...next } : null;
    onDraftChange((current) => composed(current, { feedback: value }));
  }

  async function beginEdit() {
    if (!canEdit) return;
    publishEdit({
      bulletOne: item.bullets[0] ?? "",
      bulletTwo: item.bullets[1] ?? "",
      baseSeedStageVersion: seedStageVersion,
    });
    await Promise.resolve();
    firstField?.focus();
  }

  async function openFeedbackField() {
    if (!canEdit) return;
    if (!feedback) publishFeedback({ instruction: "", baseSeedStageVersion: seedStageVersion });
    // The menu hands focus back to its trigger as it closes; the field takes
    // it afterwards.
    setTimeout(() => feedbackField?.focus(), 0);
  }

  async function sendPreset(instruction: string) {
    if (!canEdit || sendingPreset) return;
    sendingPreset = true;
    try {
      await onFeedback(instruction, seedStageVersion);
    } finally {
      sendingPreset = false;
    }
  }

  async function saveEdit() {
    if (!canEdit || !edit || editStale || savingEdit || !edit.bulletOne.trim()) return;
    const submitted = { ...edit };
    const commit = onDraftChange;
    savingEdit = true;
    try {
      const bullets = [submitted.bulletOne.trim(), submitted.bulletTwo.trim()].filter(Boolean);
      if (await onEdit(bullets, submitted.baseSeedStageVersion)) {
        // Only the unchanged submitted wording is cleared; text typed while
        // the save was pending stays for its own explicit review.
        commit((current) =>
          sameEdit(current?.edit, submitted) ? composed(current, { edit: null }) : (current ?? null)
        );
        if (sameEdit(edit, submitted)) edit = null;
      }
    } finally {
      savingEdit = false;
    }
  }

  async function sendFeedback() {
    if (!canEdit || !feedback || feedbackStale || sendingFeedback || !feedback.instruction.trim()) return;
    const submitted = { ...feedback };
    const commit = onDraftChange;
    sendingFeedback = true;
    try {
      if (await onFeedback(submitted.instruction.trim(), submitted.baseSeedStageVersion)) {
        commit((current) =>
          sameFeedback(current?.feedback, submitted)
            ? composed(current, { feedback: null })
            : (current ?? null)
        );
        if (sameFeedback(feedback, submitted)) {
          feedback = null;
          void returnFocusToFeedback();
        }
      }
    } finally {
      sendingFeedback = false;
    }
  }

  /** After the feedback box closes, focus that was inside it (now on the
   * page body) goes back to Give feedback; focus the writer moved elsewhere
   * stays where it is. */
  async function returnFocusToFeedback() {
    await tick();
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    feedbackTrigger?.focus();
  }

  /** Enter saves, Shift+Enter keeps a new line, Esc cancels. Changed wording
   * needs a second Esc, so a stray key never discards what was typed. */
  function editKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void saveEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!editChanged || discardArmed) publishEdit(null);
      else discardArmed = true;
    }
  }

  function feedbackKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendFeedback();
    }
  }

  // Card tools (board 3.1): 28px tiles, 14px strokes in secondary ink.
  const tile =
    "inline-flex size-7 items-center justify-center rounded-[7px] text-ink-secondary transition-colors hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-11";
  // Feedback menu rows (board 3.2): 28px, 12px text, 12px muted icons.
  const menuItem =
    "flex h-7 w-full cursor-default items-center gap-2 rounded-md px-2 text-left text-[12px] leading-4 text-ink outline-none data-[highlighted]:bg-gray-50 data-[disabled]:opacity-50 pointer-coarse:h-11";
</script>

{#snippet bulletText(view: (typeof bulletViews)[number])}
  {#each view.segments as segment, index (index)}
    {#if segment.citationIndex !== undefined && item.provenance[segment.citationIndex]}
      <SeedQuote
        text={segment.text}
        citation={item.provenance[segment.citationIndex]}
        {sourceAttribution}
        {onOpenSource}
      />
    {:else}{segment.text}{/if}
  {/each}
{/snippet}

{#snippet tagPills()}
  {#each tags as tag, index (index)}
    <span
      class={`inline-flex items-center rounded-full font-medium ${
        nested ? "h-[18px] px-1.5 text-[10px] leading-3" : "h-5 px-[7px] text-[11px] leading-[14px]"
      }`}
      style={`background:${tag.background};color:${tag.color}`}
      data-seed-tag
    >{tag.label}</span>
  {/each}
  {#if item.support === "writer_asserted"}
    <span class="text-[11px] leading-[14px] text-ink-muted" data-seed-marker="writer-asserted">Writer asserted</span>
  {/if}
  {#if item.outdated}
    <span
      class="inline-flex items-center gap-1 text-[11px] leading-[14px] text-gap-text!"
      data-seed-marker="outdated"
      title={item.outdated.changedRoleIds.length ? `Written before changes in ${item.outdated.changedRoleIds.join(", ")}` : undefined}
    ><span class="size-1.5 rounded-full bg-stale-dot" aria-hidden="true"></span>Outdated</span>
  {/if}
{/snippet}

{#snippet pencilIcon()}
  <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
{/snippet}

{#snippet revertIcon(className: string, strokeWidth: number)}
  <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
{/snippet}

{#snippet tools(placement: "tags" | "foot")}
  <div
    class={`flex items-center justify-end gap-2 transition-opacity motion-reduce:transition-none ${
      placement === "tags" ? "absolute top-1/2 right-0 -translate-y-1/2" : "mt-auto pt-2.5"
    } ${
      footerHidden
        ? "pointer-events-none opacity-0 group-hover/seed:pointer-events-auto group-hover/seed:opacity-100 group-focus-within/seed:pointer-events-auto group-focus-within/seed:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
        : ""
    }`}
    data-seed-footer={placement}
  >
      {#if showQuotes && !editing}
        <Popover.Root bind:open={quotesOpen}>
          <Tooltip text="Quoted lines">
            {#snippet children({ props: tipProps })}
              <Popover.Trigger {...tipProps} aria-label={`Quoted lines (${item.provenance.length})`} class={tile}>
                <QuotesIcon size={14} aria-hidden="true" />
              </Popover.Trigger>
            {/snippet}
          </Tooltip>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={4}
              class="z-[90] w-[304px] max-w-[calc(100vw-16px)] rounded-lg border border-line bg-surface px-3 py-2.5 shadow-lg"
              data-seed-quotes={item.seedId}
              aria-label="Quoted lines"
            >
              <p class="text-[10px] leading-3 font-medium tracking-[0.04em] text-ink-faint uppercase">Quoted lines</p>
              <div class="mt-2 space-y-3">
                {#each unmatchedCitations as citation (citation._id)}
                  {@const source = describeSource(sourceAttribution, String(citation.sourceId))}
                  {@const speakerLine = citationSpeakerLine(citation)}
                  <figure>
                    <blockquote class="font-serif text-[13px] leading-[18px] text-ink">“{citation.exactExcerpt}”</blockquote>
                    <!-- A missing name is labelled by the state of the read, never
                         presented as an attributed source. -->
                    <figcaption class="mt-1.5 flex items-end gap-3 text-[11px] leading-[14px]">
                      <span class="min-w-0 flex-1 text-ink-faint">
                        {#if speakerLine}<span class="block">{speakerLine}</span>{/if}
                        {#if citation.needsSpeakerCheck}<span class="block text-ink-muted" data-quote-speaker-check>{SPEAKER_CHECK_NOTE}</span>{/if}
                        <span
                          class={source.attributed ? "block" : "block italic"}
                          data-quote-source
                          data-attributed={source.attributed}
                        >{source.label}</span>
                      </span>
                      {#if onOpenSource}
                        <button
                          type="button"
                          class="shrink-0 rounded text-[11px] leading-[14px] text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          onclick={() => {
                            quotesOpen = false;
                            onOpenSource(citation);
                          }}
                        >Open in transcript</button>
                      {/if}
                    </figcaption>
                  </figure>
                {/each}
                {#if item.provenanceTruncated}
                  <p class="text-xs text-gap-text!">More quoted lines are available in Batch history.</p>
                {/if}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      {/if}

      {#if editing && edit}
        <Tooltip text="Save (Enter)">
          {#snippet children({ props })}
            <button
              {...props}
              type="button"
              aria-label={savingEdit ? "Saving…" : "Save wording"}
              class="inline-flex size-7 items-center justify-center rounded-[7px] bg-action-primary text-white transition-colors hover:bg-action-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-11"
              disabled={savingEdit || !edit?.bulletOne.trim() || editStale}
              onclick={saveEdit}
            ><CheckIcon size={14} weight="bold" aria-hidden="true" /></button>
          {/snippet}
        </Tooltip>
        <Tooltip text="Cancel (Esc)">
          {#snippet children({ props })}
            <button
              {...props}
              type="button"
              aria-label="Cancel editing"
              class="inline-flex size-7 items-center justify-center rounded-[7px] border border-line text-ink-secondary transition-colors hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary pointer-coarse:size-11"
              onclick={() => publishEdit(null)}
            ><XIcon size={13} aria-hidden="true" /></button>
          {/snippet}
        </Tooltip>
      {:else if canEdit}
        <Tooltip text="Edit">
          {#snippet children({ props })}
            <button {...props} type="button" aria-label="Edit" class={tile} disabled={busy} onclick={beginEdit}>
              {@render pencilIcon()}
            </button>
          {/snippet}
        </Tooltip>
        <DropdownMenu.Root bind:open={feedbackMenuOpen}>
          <Tooltip text="Give feedback">
            {#snippet children({ props: tipProps })}
              <DropdownMenu.Trigger
                {...tipProps}
                bind:ref={feedbackTrigger}
                aria-label="Give feedback"
                disabled={busy}
                class={`${tile} ${feedbackMenuOpen ? "bg-gray-50 text-ink" : ""}`}
              >
                <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </DropdownMenu.Trigger>
            {/snippet}
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="bottom"
              align="end"
              sideOffset={4}
              preventScroll={false}
              class="z-[90] w-[196px] rounded-[9px] border border-line bg-surface p-1 shadow-lg"
              data-seed-feedback-menu={item.seedId}
            >
              <p class="px-2 pt-1.5 pb-3 text-[10px] leading-3 font-medium tracking-[0.04em] text-ink-faint uppercase" id={`seed-feedback-menu-${uid}`}>Revise this seed</p>
              {#each FEEDBACK_PRESETS as preset (preset.label)}
                <DropdownMenu.Item class={menuItem} disabled={sendingPreset} onSelect={() => void sendPreset(preset.instruction)}>
                  <svg class="size-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    {#if preset.label === "More specific"}<path d="M4 12h16M12 4v16" />
                    {:else if preset.label === "Shorter"}<path d="M5 12h14" />
                    {:else if preset.label === "Different angle"}<path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
                    {:else}<path d="M4 7h16M4 12h10M4 17h6" />{/if}
                  </svg>
                  {preset.label}
                </DropdownMenu.Item>
              {/each}
              <DropdownMenu.Separator class="m-1 h-px bg-line-soft" />
              <DropdownMenu.Item class={menuItem} onSelect={() => void openFeedbackField()} data-feedback-custom>
                <AuroraMark size={14} />
                Tell it what to change…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      {/if}
    </div>
{/snippet}

{#snippet tagRow()}
  <!-- When the tools float here, the row keeps their width free (36px a
       tool, 52px on coarse pointers) and is tall enough for 44px targets. -->
  <div
    class={`flex flex-wrap items-center gap-1.5 ${
      toolsInTagRow ? "relative pr-[var(--seed-tools)] pointer-coarse:min-h-11 pointer-coarse:pr-[var(--seed-tools-coarse)]" : ""
    }`}
    style={toolsInTagRow ? `--seed-tools:${toolCount * 36}px;--seed-tools-coarse:${toolCount * 52}px` : undefined}
    data-seed-tag-row
  >
    {@render tagPills()}
    {#if toolsInTagRow}{@render tools("tags")}{/if}
  </div>
{/snippet}

<article
  class={`relative flex flex-1 flex-col border transition-colors motion-reduce:transition-none ${
    nested ? "rounded-lg" : "rounded-[10px]"
  } ${
    editing
      ? "border-primary bg-surface ring-2 ring-primary-wash"
      : item.selected
        ? "border-primary-light bg-[#F7FCFB]"
        : "border-line bg-surface"
  }`}
  data-seed-id={item.seedId}
  data-selected={item.selected}
  data-editing={editing}
>
  <!-- The card's own body, and its hover group: revised seeds sit outside
       it, so hovering or focusing one never reveals this card's tools, and
       the reverse. A card beside it in the same row may stretch it. -->
  <div
    class={`group/seed flex flex-1 flex-col ${
      nested ? `px-3 pt-2.5 ${below ? "pb-2" : "pb-2.5"}` : `px-4 pt-3.5 ${below ? "pb-3" : "pb-3.5"}`
    }`}
    data-seed-body
  >
  <div class={`flex items-start ${nested ? "gap-2.5" : "gap-3"}`}>
    <div class="pt-0.5">
      <Checkbox
        checked={item.selected}
        disabled={!canEdit || busy}
        aria-label={item.selected ? "Deselect seed" : "Select seed"}
        onCheckedChange={(selected) => {
          if (canEdit) void onSelect(selected);
        }}
        class="peer inline-flex size-4 flex-none items-center justify-center rounded-[4px] border-[1.5px] transition-colors duration-150 ease-out active:scale-[0.97] data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-line data-[state=unchecked]:bg-surface data-[state=unchecked]:hover:border-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[disabled]:opacity-50"
      />
    </div>
    <div class={`flex min-w-0 flex-1 flex-col ${nested ? "gap-1.5" : "gap-2"}`}>
      {#if !nested && tagRowShown}
        {@render tagRow()}
      {/if}

      {#if editing && edit}
        <div class="space-y-2">
          <textarea
            bind:this={firstField}
            aria-label="Bullet 1"
            value={edit.bulletOne}
            oninput={(event) => {
              if (edit) publishEdit({ ...edit, bulletOne: event.currentTarget.value });
            }}
            onkeydown={editKeydown}
            rows="2"
            maxlength={MAX_EDITED_BULLET_CHARS}
            class="field-control block min-h-11 w-full resize-none rounded-md px-2.5 py-2 text-[14px] leading-5 text-ink [field-sizing:content]"
          ></textarea>
          <textarea
            aria-label="Bullet 2, optional"
            placeholder="Second bullet, optional"
            value={edit.bulletTwo}
            oninput={(event) => {
              if (edit) publishEdit({ ...edit, bulletTwo: event.currentTarget.value });
            }}
            onkeydown={editKeydown}
            rows="2"
            maxlength={MAX_EDITED_BULLET_CHARS}
            class="field-control block min-h-11 w-full resize-none rounded-md px-2.5 py-2 text-[14px] leading-5 text-ink [field-sizing:content] placeholder:text-ink-faint"
          ></textarea>
          <p class="text-[12px] leading-4 text-ink-muted">Enter to save, Shift+Enter for a new line, Esc to cancel.</p>
          {#if discardArmed}
            <p class="text-[12px] leading-4 text-gap-text!" role="status" data-seed-discard-armed>Press Esc again to discard your changes.</p>
          {/if}
          {#if editLong}
            <p class="text-[12px] leading-4 text-gap-text!" aria-live="polite" data-seed-long-note>Long for a seed</p>
          {/if}
          {#if editStale}
            <div class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" role="status">
              <p>This wording began against an older decision version. Review the current wording before saving it.</p>
              <p class="mt-1 text-xs">Current wording: {item.bullets.join(" ")}</p>
              <Button
                class="mt-2"
                size="sm"
                variant="secondary"
                onclick={() => {
                  if (edit) publishEdit({ ...edit, baseSeedStageVersion: seedStageVersion });
                }}
              >Use current decision version</Button>
            </div>
          {/if}
        </div>
      {:else}
        <ul class="flex flex-col gap-1 text-[14px] leading-5 text-ink">
          {#each bulletViews as view, index (index)}
            <li class="flex items-start gap-2">
              {#if !nested}<span class="mt-2 size-1 shrink-0 rounded-full bg-ink-muted" aria-hidden="true"></span>{/if}
              <span class="min-w-0 flex-1">{@render bulletText(view)}</span>
              {#if canEdit && index === firstEditedBullet}
                <Tooltip text="Restore original wording">
                  {#snippet children({ props })}
                    <button
                      {...props}
                      type="button"
                      aria-label="Restore original wording"
                      class="-mt-px inline-flex size-[22px] shrink-0 items-center justify-center rounded-[5px] text-ink-secondary transition-colors hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-11"
                      disabled={busy}
                      onclick={onRestore}
                    >{@render revertIcon("size-[13px]", 1.8)}</button>
                  {/snippet}
                </Tooltip>
              {/if}
            </li>
          {/each}
        </ul>
        {#if showOriginal && item.edited}
          <p class="text-[12px] leading-4 text-ink-muted">Original wording: {item.originalBullets.join(" ")}</p>
        {/if}
      {/if}

      {#if nested && tagRowShown}
        {@render tagRow()}
      {/if}

      {#if feedback && canEdit}
        <div class="mt-1 rounded-lg border border-line-soft bg-canvas p-3">
          <textarea
            bind:this={feedbackField}
            aria-label="Tell it what to change"
            placeholder="Tell it what to change"
            value={feedback.instruction}
            oninput={(event) => {
              if (feedback) publishFeedback({ ...feedback, instruction: event.currentTarget.value });
            }}
            onkeydown={feedbackKeydown}
            rows="2"
            maxlength="300"
            class="field-control block min-h-11 w-full resize-none rounded-md px-2.5 py-1.5 text-body text-ink [field-sizing:content] placeholder:text-ink-faint"
          ></textarea>
          {#if feedbackStale}
            <div class="mt-2 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" role="status">
              <p>This instruction began against an older decision version. Review the current seed before sending it.</p>
              <p class="mt-1 text-xs">Current wording: {item.bullets.join(" ")}</p>
              <Button
                class="mt-2"
                size="sm"
                variant="secondary"
                onclick={() => {
                  if (feedback) publishFeedback({ ...feedback, baseSeedStageVersion: seedStageVersion });
                }}
              >Use current decision version</Button>
            </div>
          {/if}
          <div class="mt-2 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onclick={() => { publishFeedback(null); void returnFocusToFeedback(); }}>Cancel</Button>
            <Button
              size="sm"
              onclick={sendFeedback}
              disabled={sendingFeedback || !feedback.instruction.trim() || feedbackStale}
            >{sendingFeedback ? "Sending…" : "Send feedback"}</Button>
          </div>
        </div>
      {/if}

      {#if !canEdit && hasUnsavedText}
        <!-- The retention promise is truthful: it names the device only while
             storage is mirroring the text (A2). -->
        <p class="text-xs text-ink-muted" data-draft-retained={retained}>
          {retained
            ? "Your unsaved text for this Seed is kept on this device."
            : "Your unsaved text for this Seed stays in this open workspace only; this device cannot keep it across navigation or reload."}
          {unavailableNotice}
        </p>
      {/if}
    </div>
  </div>

  {#if (editing || canEdit || showQuotes) && !toolsInTagRow}
    {@render tools("foot")}
  {/if}
</div>

  {#if below}
    <div class={nested ? "px-3 pb-2.5" : "px-4 pb-3.5"} data-seed-below>{@render below()}</div>
  {/if}
</article>
