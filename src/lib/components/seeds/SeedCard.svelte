<script lang="ts">
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import { SEED_TAG_DISPLAY_LABELS } from "../../../../shared/pdSubsections";
  import { isLongForSeed, MAX_EDITED_BULLET_CHARS } from "../../../../convex/lib/seedContract";
  import { describeSource, EMPTY_SOURCE_ATTRIBUTION } from "./attribution";
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
    /** Whether the device is keeping unsaved text across navigation/reload (A2). */
    retained?: boolean;
    /** Why mutation controls are absent while unsaved text is kept. */
    unavailableNotice?: string;
  } = $props();

  const uid = $props.id();
  let citationsOpen = $state(false);
  // Local mirrors of the stored draft so typing stays responsive; every change
  // is published to the owner, which remains the authoritative copy.
  let edit = $state<SeedEditDraft | null>(null);
  let feedback = $state<SeedFeedbackDraft | null>(null);
  let savingEdit = $state(false);
  let sendingFeedback = $state(false);
  let hydratedDraftSignature = $state<string | null>(null);

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
  const hasUnsavedText = $derived(
    !!edit || (!!feedback && feedback.instruction.trim().length > 0)
  );

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
    const value = next ? { ...next } : null;
    onDraftChange((current) => composed(current, { edit: value }));
  }

  function publishFeedback(next: SeedFeedbackDraft | null) {
    feedback = next;
    const value = next ? { ...next } : null;
    onDraftChange((current) => composed(current, { feedback: value }));
  }

  function tagLabel(tag: string) {
    switch (tag) {
      case "conservative":
      case "aggressive":
      case "high_level":
      case "detailed":
      case "technical":
      case "alternative_angle":
        return SEED_TAG_DISPLAY_LABELS[tag];
      default:
        return tag;
    }
  }

  function beginEdit() {
    if (!canEdit) return;
    publishEdit({
      bulletOne: item.bullets[0] ?? "",
      bulletTwo: item.bullets[1] ?? "",
      baseSeedStageVersion: seedStageVersion,
    });
  }

  function openFeedback() {
    if (!canEdit || feedback) return;
    publishFeedback({ instruction: "", baseSeedStageVersion: seedStageVersion });
  }

  async function saveEdit() {
    if (!canEdit || !edit || editStale || savingEdit) return;
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
    if (!canEdit || !feedback || feedbackStale || sendingFeedback) return;
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
</script>

<article
  class={`rounded-xl border p-4 transition-colors ${item.selected ? "border-primary bg-primary-wash" : "border-line bg-surface"}`}
  data-seed-id={item.seedId}
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
      <div class="mb-2 flex flex-wrap items-center gap-1.5">
        <span class={`rounded-full px-2 py-0.5 text-label ${item.selected ? "bg-primary text-white" : "bg-gray-100 text-gray-700!"}`}>
          {item.selected ? "Selected" : "Available"}
        </span>
        <span class="rounded-full bg-chrome px-2 py-0.5 text-label text-ink-secondary!">
          {item.support === "writer_asserted" ? "Writer asserted" : "Source supported"}
        </span>
        {#if item.edited}
          <span class="rounded-full bg-chrome px-2 py-0.5 text-label text-ink-secondary!">Edited</span>
        {/if}
        {#if item.revisionOfSeedId}
          <span class="rounded-full bg-gray-100 px-2 py-0.5 text-label text-gray-700!">Revised seed</span>
        {/if}
        {#if item.outdated}
          <span class="rounded-full bg-gap-bg px-2 py-0.5 text-label text-gap-text!">Outdated</span>
        {/if}
      </div>

      {#if edit && canEdit}
        <div class="space-y-2">
          <label class="block">
            <span class="text-label">Bullet 1</span>
            <textarea
              value={edit.bulletOne}
              oninput={(event) => {
                if (edit) publishEdit({ ...edit, bulletOne: event.currentTarget.value });
              }}
              rows="2"
              maxlength={MAX_EDITED_BULLET_CHARS}
              class="field-control mt-1 min-h-11 w-full resize-y rounded-lg bg-surface px-3 py-2 text-body"
            ></textarea>
          </label>
          <label class="block">
            <span class="text-label">Bullet 2, optional</span>
            <textarea
              value={edit.bulletTwo}
              oninput={(event) => {
                if (edit) publishEdit({ ...edit, bulletTwo: event.currentTarget.value });
              }}
              rows="2"
              maxlength={MAX_EDITED_BULLET_CHARS}
              class="field-control mt-1 min-h-11 w-full resize-y rounded-lg bg-surface px-3 py-2 text-body"
            ></textarea>
          </label>
          {#if editStale}
            <div class="rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" role="status">
              <p>This wording began against an older decision version. Review the current wording before saving it.</p>
              <p class="mt-1 text-data">Current wording: {item.bullets.join(" ")}</p>
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
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              onclick={saveEdit}
              disabled={savingEdit || !edit.bulletOne.trim() || editStale}
            >{savingEdit ? "Saving…" : "Save wording"}</Button>
            <Button size="sm" variant="ghost" onclick={() => publishEdit(null)}>Cancel</Button>
            {#if editLong}
              <p class="ml-auto self-center text-data text-gap-text!" aria-live="polite" data-seed-long-note>Long for a seed</p>
            {/if}
          </div>
        </div>
      {:else}
        <ul class="space-y-1 pl-5 text-body text-ink">
          {#each item.bullets as bullet}
            <li class="list-disc">{bullet}</li>
          {/each}
        </ul>
        {#if item.edited || item.revisionOfSeedId}
          <div class="mt-2 rounded-lg bg-gray-50 p-2 text-data text-ink-muted">
            <p>Original wording: {item.originalBullets.join(" ")}</p>
            {#if item.revisionOfSeedId}<p class="mt-1 break-all">Revises Seed {item.revisionOfSeedId}</p>{/if}
          </div>
        {/if}
      {/if}

      <div class="mt-3 flex flex-wrap gap-1.5">
        {#each item.tags as tag}
          <span class="rounded-full bg-gray-100 px-2 py-0.5 text-data text-gray-700!">
            {tagLabel(tag)}
          </span>
        {/each}
      </div>

      {#if item.provenance.length > 0 || item.provenanceTruncated}
        <button
          type="button"
          aria-expanded={citationsOpen}
          aria-controls={`seed-citations-${uid}`}
          onclick={() => (citationsOpen = !citationsOpen)}
          class="mt-3 flex min-h-11 items-center gap-1.5 rounded-md text-body text-action-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Evidence
          <DisclosureChevron open={citationsOpen} class="size-3.5" />
        </button>
        <Disclosure id={`seed-citations-${uid}`} open={citationsOpen}>
          <div class="space-y-3 rounded-lg bg-gray-50 p-3">
            {#each item.provenance as citation (citation._id)}
              {@const source = describeSource(sourceAttribution, String(citation.sourceId))}
              <figure>
                <!-- A missing name is labelled by the state of the read, never
                     presented as an attributed source. -->
                <figcaption
                  class={source.attributed ? "text-label" : "text-label text-ink-muted! italic"}
                  data-attributed={source.attributed}
                >{source.label}</figcaption>
                <blockquote class="mt-1 border-l-2 border-line pl-3 text-body text-ink-muted">
                  {citation.exactExcerpt}
                </blockquote>
              </figure>
            {/each}
            {#if item.provenanceTruncated}
              <p class="text-data text-gap-text!">More evidence is available in Batch history.</p>
            {/if}
          </div>
        </Disclosure>
      {/if}

      {#if canEdit && !edit}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onclick={beginEdit} disabled={busy}>Edit</Button>
          {#if item.edited}
            <Button size="sm" variant="ghost" onclick={onRestore} disabled={busy}>Restore original wording</Button>
          {/if}
          {#if !feedback}
            <Button size="sm" variant="ghost" onclick={openFeedback} disabled={busy}>Give feedback</Button>
          {/if}
        </div>
      {/if}

      {#if feedback && canEdit}
        <div class="mt-3 rounded-lg border border-line-soft bg-gray-50 p-3">
          <label class="block">
            <span class="text-label">Revision instruction</span>
            <textarea
              value={feedback.instruction}
              oninput={(event) => {
                if (feedback) publishFeedback({ ...feedback, instruction: event.currentTarget.value });
              }}
              rows="3"
              maxlength="300"
              class="field-control mt-1 min-h-11 w-full resize-y rounded-lg bg-surface px-3 py-2 text-body"
            ></textarea>
          </label>
          {#if feedbackStale}
            <div class="mt-2 rounded-lg bg-gap-bg px-3 py-2 text-body text-gap-text!" role="status">
              <p>This instruction began against an older decision version. Review the current Seed before requesting it.</p>
              <p class="mt-1 text-data">Current wording: {item.bullets.join(" ")}</p>
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
          <div class="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              onclick={sendFeedback}
              disabled={sendingFeedback || !feedback.instruction.trim() || feedbackStale}
            >{sendingFeedback ? "Requesting…" : "Request revision"}</Button>
            <Button size="sm" variant="ghost" onclick={() => publishFeedback(null)}>Cancel</Button>
          </div>
        </div>
      {/if}

      {#if !canEdit && hasUnsavedText}
        <!-- The retention promise is truthful: it names the device only while
             storage is mirroring the text (A2). -->
        <p class="mt-3 text-data text-ink-muted" data-draft-retained={retained}>
          {retained
            ? "Your unsaved text for this Seed is kept on this device."
            : "Your unsaved text for this Seed stays in this open workspace only; this device cannot keep it across navigation or reload."}
          {unavailableNotice}
        </p>
      {/if}
    </div>
  </div>
</article>
