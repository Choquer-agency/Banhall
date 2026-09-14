<script lang="ts">
  import { resolve } from "$app/paths";
  import Button from "$lib/components/ui/Button.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import BriefEditableText from "./BriefEditableText.svelte";
  import BriefSourceChip from "./BriefSourceChip.svelte";
  import {
    CONFIDENCE_WORDS,
    ELIGIBILITY_REASON_WORDS,
    INCLUSION_SOURCES_TRUNCATED_NOTE,
    INCLUSION_TRUNCATED_NOTE,
    changeSummary,
    inclusionTruncation,
    entryOrigin,
    groupBrief,
    inclusionHeader,
    inclusionStatusText,
    liveCount,
    offerHref,
    offerSentence,
    sourceChipLabel,
    type BriefEntryLike,
    type InclusionRow,
  } from "$lib/brief";
  import type { Snippet } from "svelte";

  /**
   * Story 4 brief-rail (DESIGN.md › brief-rail, EXPERIENCE.md › brief-rail).
   * Presentational: data in, callbacks out. The Brief never gates anything —
   * generation, apply and navigation proceed with zero interaction here.
   */
  type BriefView = {
    _id: string;
    version: number;
    storylineText: string;
    storylineOrigin: "writer" | "derived" | "edited";
    editedSinceGeneration: boolean;
    entries: BriefEntryLike[];
  };
  type InclusionView = {
    cap: number;
    documentsInContext: number;
    documentsTotal: number;
    /** DW-133: the document listing stopped at its read budget; the total is a lower bound. */
    documentsTruncated?: boolean;
    /** DW-133: the frozen sources stopped at the budget; transcripts and both counts are lower bounds. */
    sourcesTruncated?: boolean;
    rows: InclusionRow[];
  };
  type WriterSettingsView = {
    noProfileLine: string | null;
    offer: { supplyPath: "writer_notes" | "attachment"; fileName: string } | null;
  };

  let {
    brief,
    inclusion,
    writerSettings,
    generationId,
    canEdit,
    offerDismissed,
    onSaveEntry,
    onSaveStoryline,
    onResolveQuestion,
    onDismissOffer,
    onCancelEdit = undefined,
    onBeginEdit = undefined,
    onRegenerate = undefined,
    saveError = null,
    showHeading = true,
  }: {
    brief: BriefView | null | undefined;
    inclusion: InclusionView | null | undefined;
    writerSettings: WriterSettingsView | null | undefined;
    generationId: string;
    canEdit: boolean;
    offerDismissed: boolean;
    onSaveEntry: (entry: BriefEntryLike, text: string) => Promise<boolean>;
    onSaveStoryline: (text: string) => Promise<boolean>;
    onResolveQuestion: (
      entry: BriefEntryLike,
      resolvedBy: "use_evidence" | "keep_storyline"
    ) => void;
    onDismissOffer: () => void;
    /** An abandoned edit (Esc, or an unchanged blur). */
    onCancelEdit?: (() => void) | undefined;
    /** A text field started editing: the container pins the Brief version this edit is based on. */
    onBeginEdit?: (() => void) | undefined;
    /** Absent while a generation runs: there is nothing to regenerate yet. */
    onRegenerate?: (() => void) | undefined;
    saveError?: string | null;
    /** The rail card carries its own title; the inline placement does not. */
    showHeading?: boolean;
  } = $props();

  const uid = $props.id();
  const grouped = $derived(groupBrief(brief?.entries ?? []));
  const inclusionRecorded = $derived(
    (inclusion?.rows ?? []).some((row) => row.inclusion !== null)
  );
  const nothingDerived = $derived(
    !!brief &&
      !brief.storylineText.trim() &&
      grouped.storyline.length === 0 &&
      grouped.claimExclusion.length === 0 &&
      grouped.confidenceMap.length === 0 &&
      grouped.glossaryTerm.length === 0
  );
  const emptyGroupText = $derived(
    nothingDerived ? "Nothing to derive yet — add a transcript" : "None."
  );

  let open = $state({
    inputs: true,
    storyline: true,
    claimExclusion: false,
    confidenceMap: false,
    glossaryTerm: false,
  });
  type GroupKey = keyof typeof open;

  const ORIGIN_CHIP: Record<string, string> = {
    derived: "bg-gray-100 text-gray-700!",
    writer: "bg-primary-wash text-primary-selected!",
    edited: "bg-chrome text-ink-secondary!",
  };
  const STATUS_TONE: Record<string, string> = {
    included: "text-primary-selected",
    condensed: "text-gap-text",
    not_included: "text-ink-muted",
  };
</script>

{#snippet chip(text: string, tone: string)}
  <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-label ${tone}`}>{text}</span>
{/snippet}

{#snippet entryRow(entry: BriefEntryLike, label: string)}
  {@const removed = entry.change === "removed"}
  <li
    class={`border-b border-line-soft px-2 py-2 ${
      entry.change === "added"
        ? "border-l-2 border-l-primary-selected"
        : removed
          ? "border-l-2 border-l-ink-muted"
          : ""
    }`}
  >
    {#if removed}
      <p class="px-2 py-2 text-body text-ink-muted">{entry.text}</p>
    {:else}
      <BriefEditableText
        text={entry.text}
        {canEdit}
        {label}
        onSave={(text) => onSaveEntry(entry, text)}
        onCancel={onCancelEdit}
        onOpen={onBeginEdit}
      />
    {/if}
    <div class="flex flex-wrap items-center gap-1.5 px-2">
      {@render chip(entryOrigin(entry), ORIGIN_CHIP[entryOrigin(entry)])}
      {#if entry.reason}
        {@render chip(ELIGIBILITY_REASON_WORDS[entry.reason], "bg-gray-100 text-gray-700!")}
      {/if}
      {#if entry.confidence}
        {@render chip(CONFIDENCE_WORDS[entry.confidence], "bg-gray-100 text-gray-700!")}
      {/if}
      {#if entry.source}
        <BriefSourceChip
          label={sourceChipLabel(entry)}
          sourceLabel={sourceChipLabel(entry)}
          excerpt={entry.exactExcerpt}
        />
      {/if}
      {#if entry.change === "added" || removed}
        <span class="text-data text-ink-muted">{entry.change}</span>
      {/if}
    </div>
  </li>
{/snippet}

{#snippet group(key: GroupKey, title: string, meta: string | null, body: Snippet)}
  <!-- font-normal: the heading is structure, never weight (max 500). -->
  <h3 class="m-0 font-normal">
    <button
      type="button"
      class="flex min-h-11 w-full items-center gap-2 bg-gray-50 px-4 py-2 text-left transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
      aria-expanded={open[key]}
      aria-controls={`brief-${uid}-${key}`}
      onclick={() => (open[key] = !open[key])}
    >
      <span class="text-label">{title}</span>
      {#if meta}
        <span class="min-w-0 truncate text-data text-ink-muted">{meta}</span>
      {/if}
      <DisclosureChevron open={open[key]} class="ml-auto" />
    </button>
  </h3>
  <Disclosure id={`brief-${uid}-${key}`} open={open[key]}>
    {@render body()}
  </Disclosure>
{/snippet}

{#snippet entryGroupBody(entries: BriefEntryLike[], label: string)}
  {#if entries.length === 0}
    <p class="px-4 py-3 text-body text-ink-muted">{emptyGroupText}</p>
  {:else}
    <ul class="m-0 list-none p-0">
      {#each entries as entry (entry._id)}
        {@render entryRow(entry, label)}
      {/each}
    </ul>
  {/if}
{/snippet}

{#snippet inputsBody()}
  {#if inclusion && inclusion.rows.length > 0}
    <ul class="m-0 list-none p-0">
      {#each inclusion.rows as row (row.key)}
        <li class="flex items-baseline gap-3 border-b border-line-soft px-4 py-2.5">
          <span class="min-w-0 flex-1 break-words text-body">{row.label}</span>
          {#if row.inclusion}
            <span
              data-inclusion={row.inclusion}
              class={`shrink-0 text-right text-data ${STATUS_TONE[row.inclusion]}`}
            >
              {inclusionStatusText(row)}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {@const truncation = inclusion ? inclusionTruncation(inclusion) : null}
  {#if truncation}
    <p
      data-inclusion-truncated={truncation}
      class="border-b border-line-soft px-4 py-2.5 text-body text-ink-muted"
    >
      {truncation === "sources" ? INCLUSION_SOURCES_TRUNCATED_NOTE : INCLUSION_TRUNCATED_NOTE}
    </p>
  {/if}
  {#if writerSettings?.noProfileLine}
    <p class="border-b border-line-soft px-4 py-2.5 text-body">{writerSettings.noProfileLine}</p>
  {/if}
  {#if writerSettings?.offer && !offerDismissed}
    <div class="mx-4 my-3 flex flex-wrap items-center gap-2 rounded-md bg-primary-wash px-3 py-2">
      <p class="min-w-40 flex-1 text-body">{offerSentence(writerSettings.offer)}</p>
      <Button
        variant="secondary"
        size="sm"
        class="min-h-11 bg-surface"
        href={offerHref(resolve("/settings/writing"), generationId)}
      >
        Save to your Writer Profile
      </Button>
      <button
        type="button"
        aria-label="Dismiss the Writer Profile offer"
        class="flex h-11 w-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy motion-reduce:transition-none"
        onclick={onDismissOffer}
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {/if}
{/snippet}

{#snippet storylineBody()}
  <div class="border-b border-line-soft px-2 py-2">
    <BriefEditableText
      text={brief?.storylineText ?? ""}
      {canEdit}
      label="Storyline"
      emptyText={canEdit ? "Type a Storyline" : "No Storyline yet."}
      onSave={onSaveStoryline}
      onCancel={onCancelEdit}
      onOpen={onBeginEdit}
    />
    <div class="flex flex-wrap items-center gap-1.5 px-2">
      {@render chip(brief?.storylineOrigin ?? "derived", ORIGIN_CHIP[brief?.storylineOrigin ?? "derived"])}
    </div>
  </div>
  {@render entryGroupBody(grouped.storyline, "Storyline claim")}
{/snippet}

{#snippet claimExclusionBody()}{@render entryGroupBody(grouped.claimExclusion, "Claim Exclusion")}{/snippet}
{#snippet confidenceMapBody()}{@render entryGroupBody(grouped.confidenceMap, "Confidence Map entry")}{/snippet}
{#snippet glossaryBody()}{@render entryGroupBody(grouped.glossaryTerm, "Glossary Term")}{/snippet}

<aside aria-label="Brief" class="@container flex min-h-0 flex-col bg-surface">
  {#if showHeading}
    <header class="px-4 pt-4 pb-2">
      <h2 class="text-title">Brief</h2>
    </header>
  {/if}

  <p class="sr-only" aria-live="polite">
    {grouped.openQuestions.length > 0 ? "Storyline question raised" : ""}
  </p>

  {#if saveError}
    <p role="alert" class="mx-4 mt-3 rounded-md bg-gap-bg px-3 py-2 text-body text-gap-text!">
      {saveError}
    </p>
  {/if}

  {#each grouped.openQuestions as question (question._id)}
    <section aria-label="Storyline question" class="mx-4 mt-3 rounded-md bg-gap-bg p-3">
      <p class="text-body text-gap-text!">{question.question?.questionText}</p>
      <div class="mt-2 grid grid-cols-1 gap-3 @md:grid-cols-2">
        <div>
          <p class="text-label text-gap-text!">The Storyline</p>
          <p class="text-body text-gap-text!">{brief?.storylineText || "No Storyline yet."}</p>
        </div>
        <div>
          <p class="text-label text-gap-text!">The section's evidence</p>
          <p class="text-body text-gap-text!">{question.text}</p>
          {#if question.source}
            <BriefSourceChip
              label={sourceChipLabel(question)}
              sourceLabel={sourceChipLabel(question)}
              excerpt={question.exactExcerpt}
            />
          {/if}
        </div>
      </div>
      {#if canEdit}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            class="min-h-11"
            onclick={() => onResolveQuestion(question, "use_evidence")}
          >
            Use the section's evidence
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="min-h-11"
            onclick={() => onResolveQuestion(question, "keep_storyline")}
          >
            Keep the Storyline
          </Button>
        </div>
      {/if}
    </section>
  {/each}

  <div class="mt-3">
    {@render group(
      "inputs",
      "Inputs",
      inclusion && inclusionRecorded ? inclusionHeader(inclusion) : null,
      inputsBody
    )}
    {#if brief}
      {@render group(
        "storyline",
        "Storyline",
        changeSummary(grouped.storyline),
        storylineBody
      )}
      {@render group(
        "claimExclusion",
        "Claim Exclusions",
        changeSummary(grouped.claimExclusion) ?? `${liveCount(grouped.claimExclusion)}`,
        claimExclusionBody
      )}
      {@render group(
        "confidenceMap",
        "Confidence Map",
        changeSummary(grouped.confidenceMap) ?? `${liveCount(grouped.confidenceMap)}`,
        confidenceMapBody
      )}
      {@render group(
        "glossaryTerm",
        "Glossary Terms",
        changeSummary(grouped.glossaryTerm) ?? `${liveCount(grouped.glossaryTerm)}`,
        glossaryBody
      )}
    {/if}
  </div>

  {#if brief?.editedSinceGeneration && onRegenerate}
    <div class="border-t border-line-soft p-4">
      <Button variant="secondary" class="min-h-11 w-full" onclick={onRegenerate}>
        Regenerate with this Brief
      </Button>
    </div>
  {/if}
</aside>
