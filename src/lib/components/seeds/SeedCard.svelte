<script lang="ts">
  import { DropdownMenu, Popover } from "bits-ui";
  import {
    ArrowCounterClockwiseIcon,
    ChatCircleIcon,
    CheckIcon,
    MinusIcon,
    PencilSimpleIcon,
    PlusIcon,
    QuotesIcon,
    TextAlignLeftIcon,
    XIcon,
  } from "phosphor-svelte";
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
  const footerRevealOnHover = $derived((item.selected || nested) && !feedbackMenuOpen && !quotesOpen);

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
        if (sameFeedback(feedback, submitted)) feedback = null;
      }
    } finally {
      sendingFeedback = false;
    }
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

  const tile =
    "inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-chrome hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-11";
  const menuItem =
    "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink outline-none data-[highlighted]:bg-gray-50 data-[disabled]:opacity-50 pointer-coarse:h-11";
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
      class="inline-flex h-5 items-center rounded-full px-2 text-xs"
      style={`background:${tag.background};color:${tag.color}`}
      data-seed-tag
    >{tag.label}</span>
  {/each}
  {#if item.support === "writer_asserted"}
    <span class="text-xs text-ink-muted" data-seed-marker="writer-asserted">Writer asserted</span>
  {/if}
  {#if item.outdated}
    <span
      class="inline-flex items-center gap-1 text-xs text-gap-text!"
      data-seed-marker="outdated"
      title={item.outdated.changedRoleIds.length ? `Written before changes in ${item.outdated.changedRoleIds.join(", ")}` : undefined}
    ><span class="size-1.5 rounded-full bg-gap-text" aria-hidden="true"></span>Outdated</span>
  {/if}
{/snippet}

<article
  class={`group relative flex flex-col rounded-xl border transition-colors motion-reduce:transition-none ${
    nested ? "p-3" : "p-4"
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
  <div class="flex items-start gap-3">
    <div class="pt-0.5">
      <Checkbox
        checked={item.selected}
        disabled={!canEdit || busy}
        aria-label={item.selected ? "Deselect seed" : "Select seed"}
        onCheckedChange={(selected) => {
          if (canEdit) void onSelect(selected);
        }}
      />
    </div>
    <div class="min-w-0 flex-1">
      {#if !nested && (tags.length > 0 || item.support === "writer_asserted" || item.outdated)}
        <div class="mb-2 flex flex-wrap items-center gap-1.5">{@render tagPills()}</div>
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
            class="field-control block min-h-11 w-full resize-none rounded-md px-2.5 py-1.5 text-[15px] leading-relaxed text-ink [field-sizing:content]"
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
            class="field-control block min-h-11 w-full resize-none rounded-md px-2.5 py-1.5 text-[15px] leading-relaxed text-ink [field-sizing:content] placeholder:text-ink-faint"
          ></textarea>
          <p class="text-xs text-ink-muted">Enter to save, Shift+Enter for a new line, Esc to cancel.</p>
          {#if discardArmed}
            <p class="text-xs text-gap-text!" role="status" data-seed-discard-armed>Press Esc again to discard your changes.</p>
          {/if}
          {#if editLong}
            <p class="text-xs text-gap-text!" aria-live="polite" data-seed-long-note>Long for a seed</p>
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
        <ul class={`space-y-1 text-[15px] leading-relaxed text-ink ${nested ? "" : "pl-4"}`}>
          {#each bulletViews as view, index (index)}
            <li class={`${nested ? "" : "list-disc marker:text-ink-faint"}`}>
              <span class="flex items-start gap-2">
                <span class="min-w-0 flex-1">{@render bulletText(view)}</span>
                {#if canEdit && index === firstEditedBullet}
                  <Tooltip text="Restore original wording">
                    {#snippet children({ props })}
                      <button
                        {...props}
                        type="button"
                        aria-label="Restore original wording"
                        class={`${tile} -mt-0.5 shrink-0`}
                        disabled={busy}
                        onclick={onRestore}
                      ><ArrowCounterClockwiseIcon size={14} aria-hidden="true" /></button>
                    {/snippet}
                  </Tooltip>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
        {#if showOriginal && item.edited}
          <p class="mt-2 text-xs text-ink-muted">Original wording: {item.originalBullets.join(" ")}</p>
        {/if}
      {/if}

      {#if nested && (tags.length > 0 || item.support === "writer_asserted" || item.outdated)}
        <div class="mt-2 flex flex-wrap items-center gap-1.5">{@render tagPills()}</div>
      {/if}

      {#if feedback && canEdit}
        <div class="mt-3 rounded-lg border border-line-soft bg-canvas p-3">
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
            <Button size="sm" variant="secondary" onclick={() => publishFeedback(null)}>Cancel</Button>
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
        <p class="mt-3 text-xs text-ink-muted" data-draft-retained={retained}>
          {retained
            ? "Your unsaved text for this Seed is kept on this device."
            : "Your unsaved text for this Seed stays in this open workspace only; this device cannot keep it across navigation or reload."}
          {unavailableNotice}
        </p>
      {/if}
    </div>
  </div>

  {#if editing || canEdit || showQuotes}
    <div
      class={`mt-auto flex items-center justify-end gap-1 pt-3 transition-opacity motion-reduce:transition-none ${
        footerRevealOnHover && !editing
          ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
          : ""
      }`}
      data-seed-footer
    >
      {#if showQuotes && !editing}
        <Popover.Root bind:open={quotesOpen}>
          <Tooltip text="Quoted lines">
            {#snippet children({ props: tipProps })}
              <Popover.Trigger {...tipProps} aria-label={`Quoted lines (${item.provenance.length})`} class={tile}>
                <QuotesIcon size={15} aria-hidden="true" />
              </Popover.Trigger>
            {/snippet}
          </Tooltip>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={6}
              class="z-[90] w-72 max-w-[calc(100vw-16px)] rounded-lg border border-line bg-surface p-3 shadow-lg"
              data-seed-quotes={item.seedId}
              aria-label="Quoted lines"
            >
              <p class="text-label">Quoted lines</p>
              <div class="mt-2 space-y-3">
                {#each unmatchedCitations as citation (citation._id)}
                  {@const source = describeSource(sourceAttribution, String(citation.sourceId))}
                  {@const speakerLine = citationSpeakerLine(citation)}
                  <figure>
                    <blockquote class="text-sm leading-snug text-ink">“{citation.exactExcerpt}”</blockquote>
                    <!-- A missing name is labelled by the state of the read, never
                         presented as an attributed source. -->
                    <figcaption class="mt-1">
                      {#if speakerLine}<span class="block text-xs text-ink-secondary">{speakerLine}</span>{/if}
                      {#if citation.needsSpeakerCheck}<span class="block text-xs text-ink-muted" data-quote-speaker-check>{SPEAKER_CHECK_NOTE}</span>{/if}
                      <span
                        class={source.attributed ? "block text-xs text-ink-muted" : "block text-xs italic text-ink-muted"}
                        data-quote-source
                        data-attributed={source.attributed}
                      >{source.label}</span>
                      {#if onOpenSource}
                        <button
                          type="button"
                          class="mt-1 rounded text-xs font-medium text-action-primary hover:text-action-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
              class="inline-flex size-7 items-center justify-center rounded-md bg-action-primary text-white transition-colors hover:bg-action-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-11"
              disabled={savingEdit || !edit?.bulletOne.trim() || editStale}
              onclick={saveEdit}
            ><CheckIcon size={15} weight="bold" aria-hidden="true" /></button>
          {/snippet}
        </Tooltip>
        <Tooltip text="Cancel (Esc)">
          {#snippet children({ props })}
            <button
              {...props}
              type="button"
              aria-label="Cancel editing"
              class="inline-flex size-7 items-center justify-center rounded-md border border-line text-ink-secondary transition-colors hover:bg-chrome hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary pointer-coarse:size-11"
              onclick={() => publishEdit(null)}
            ><XIcon size={14} aria-hidden="true" /></button>
          {/snippet}
        </Tooltip>
      {:else if canEdit}
        <Tooltip text="Edit">
          {#snippet children({ props })}
            <button {...props} type="button" aria-label="Edit" class={tile} disabled={busy} onclick={beginEdit}>
              <PencilSimpleIcon size={15} aria-hidden="true" />
            </button>
          {/snippet}
        </Tooltip>
        <DropdownMenu.Root bind:open={feedbackMenuOpen}>
          <Tooltip text="Give feedback">
            {#snippet children({ props: tipProps })}
              <DropdownMenu.Trigger
                {...tipProps}
                aria-label="Give feedback"
                disabled={busy || sendingPreset}
                class={`${tile} ${feedbackMenuOpen ? "bg-chrome text-ink" : ""}`}
              >
                <ChatCircleIcon size={15} aria-hidden="true" />
              </DropdownMenu.Trigger>
            {/snippet}
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="bottom"
              align="end"
              sideOffset={6}
              preventScroll={false}
              class="z-[90] w-[196px] rounded-lg border border-line bg-surface p-1 shadow-lg"
              data-seed-feedback-menu={item.seedId}
            >
              <p class="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted" id={`seed-feedback-menu-${uid}`}>Revise this seed</p>
              {#each FEEDBACK_PRESETS as preset (preset.label)}
                <DropdownMenu.Item class={menuItem} onSelect={() => void sendPreset(preset.instruction)}>
                  <span class="inline-flex size-4 items-center justify-center text-ink-muted" aria-hidden="true">
                    {#if preset.label === "More specific"}<PlusIcon size={13} />
                    {:else if preset.label === "Shorter"}<MinusIcon size={13} />
                    {:else if preset.label === "Different angle"}<ArrowCounterClockwiseIcon size={13} />
                    {:else}<TextAlignLeftIcon size={13} />{/if}
                  </span>
                  {preset.label}
                </DropdownMenu.Item>
              {/each}
              <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
              <DropdownMenu.Item class={menuItem} onSelect={() => void openFeedbackField()} data-feedback-custom>
                <AuroraMark size={16} />
                Tell it what to change…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      {/if}
    </div>
  {/if}
</article>
