<!--
  The project's interviews on the Sources tab (2026-09-24, the transcript
  method). One row per transcript with its detected format, a row menu to
  Replace or Remove it, and "Add transcript". Presentational: the page reads
  the files and calls the mutations through the callbacks. Changes are
  refused while a report is generating (`blockedReason`); frozen generations
  never read these rows.
-->
<script module lang="ts">
  import type { TranscriptSourceFormat } from "../../../../../shared/transcriptParse";

  export type TranscriptListRow = {
    _id: string;
    label: string;
    wordCount: number;
    createdAt: number;
    sourceFormat?: TranscriptSourceFormat;
    speakerStatus?: "unchecked" | "needs_check" | "confirmed";
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import { DotsThreeIcon, MicrophoneIcon, PlusIcon } from "phosphor-svelte";
  import { TRANSCRIPT_ACCEPT, TRANSCRIPT_FORMAT_LABELS } from "../../../../../shared/transcriptParse";

  let {
    transcripts,
    canEdit = false,
    blockedReason = null,
    busy = false,
    onAdd,
    onReplace,
    onRemove,
    speakers,
  }: {
    transcripts: TranscriptListRow[];
    /** Whether this viewer may add, replace and remove transcripts. */
    canEdit?: boolean;
    /** Why changes are refused right now (a report is generating), if they are. */
    blockedReason?: string | null;
    /** A change is in flight. */
    busy?: boolean;
    onAdd?: (file: File) => void | Promise<void>;
    onReplace?: (transcriptId: string, file: File) => void | Promise<void>;
    onRemove?: (transcriptId: string) => void | Promise<void>;
    /** The Speakers control for one row (a popover), when the page offers it. */
    speakers?: Snippet<[TranscriptListRow]>;
  } = $props();

  let fileInput: HTMLInputElement | null = $state(null);
  // Which row the picked file replaces; null means the pick adds a transcript.
  let replacing = $state<string | null>(null);
  const disabled = $derived(busy || blockedReason !== null);

  function pick(target: string | null) {
    if (disabled) return;
    replacing = target;
    fileInput?.click();
  }

  async function picked(files: FileList | null) {
    const file = files?.[0];
    const target = replacing;
    replacing = null;
    if (!file) return;
    if (target) await onReplace?.(target, file);
    else await onAdd?.(file);
  }

  const itemClass =
    "flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-3.5 text-left text-sm text-ink-secondary outline-none transition-colors hover:bg-primary-wash hover:text-ink data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
</script>

<section class="mt-6" aria-labelledby="sources-transcripts" data-transcript-sources>
  <div class="flex items-center justify-between gap-3">
    <h3 id="sources-transcripts" class="text-xs uppercase tracking-wide text-ink-muted">Interviews</h3>
    {#if canEdit}
      <button
        type="button"
        data-add-transcript
        class="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
        {disabled}
        aria-describedby={blockedReason ? "sources-transcripts-blocked" : undefined}
        onclick={() => pick(null)}
      >
        <PlusIcon size={14} aria-hidden="true" />
        Add transcript
      </button>
    {/if}
  </div>
  {#if canEdit && blockedReason}
    <p id="sources-transcripts-blocked" class="mt-1 text-xs text-ink-muted" data-transcripts-blocked>{blockedReason}</p>
  {/if}

  {#if transcripts.length === 0}
    <p class="mt-2 text-[13px] text-ink-secondary">No interviews yet.</p>
  {:else}
    <ul class="mt-2 divide-y divide-line-soft border-y border-line-soft">
      {#each transcripts as transcript (transcript._id)}
        <li class="flex min-h-11 items-center gap-3 py-2 text-[13px]" data-transcript-row={transcript._id}>
          <MicrophoneIcon size={16} aria-hidden="true" class="shrink-0 text-ink-muted" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-ink">{transcript.label}</span>
            <span class="block text-xs text-ink-muted" data-transcript-meta>
              {transcript.sourceFormat && transcript.sourceFormat !== "unknown" ? `${TRANSCRIPT_FORMAT_LABELS[transcript.sourceFormat]}, ` : ""}{transcript.wordCount.toLocaleString()} words
            </span>
          </span>
          {#if speakers}
            {@render speakers(transcript)}
          {/if}
          {#if canEdit}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                aria-label={`More actions for ${transcript.label}`}
                data-transcript-menu={transcript._id}
                class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
              >
                <DotsThreeIcon size={18} weight="bold" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  class="z-[100] w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
                >
                  <DropdownMenu.Item
                    class={itemClass}
                    {disabled}
                    data-transcript-replace={transcript._id}
                    onSelect={() => pick(transcript._id)}
                  >
                    Replace
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    class={`${itemClass} hover:text-red-600 data-[highlighted]:text-red-600`}
                    {disabled}
                    data-transcript-remove={transcript._id}
                    onSelect={() => onRemove?.(transcript._id)}
                  >
                    Remove
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <input
    bind:this={fileInput}
    type="file"
    accept={TRANSCRIPT_ACCEPT}
    class="hidden"
    data-transcript-file-input
    onchange={(event) => {
      void picked(event.currentTarget.files);
      event.currentTarget.value = "";
    }}
  />
</section>
