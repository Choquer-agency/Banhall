<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import type { ExportValidationIssue } from "$lib/exportValidation";
  import type { ReportNote } from "$lib/reportSections";

  let {
    errors,
    warnings,
    notes = [],
    onCancel,
    onProceed,
    onShowNote,
  }: {
    errors: ExportValidationIssue[];
    warnings: ExportValidationIssue[];
    /**
     * 2026-10-29 (owner): every gap and inference still in the report, so
     * the writer sees each one and can jump to it before filing.
     */
    notes?: ReportNote[];
    onCancel: () => void;
    onProceed?: () => void;
    /** Closes the dialog and shows this note in the report. */
    onShowNote?: (note: ReportNote) => void;
  } = $props();

  const NOTE_KIND = { gap: "Gap", inferred: "Inferred" } as const;
  const noteLine = (note: ReportNote) => `Line ${note.section.slice(1)}`;

  const hasErrors = $derived(errors.length > 0);
  const title = $derived(hasErrors ? "Fix export errors" : "Review export warnings");
  const intro = $derived(
    hasErrors
      ? "The official export is blocked until these issues are resolved."
      : "Review these warnings before deciding whether to proceed with the official export."
  );

  // One entry per offending field — "Line 244" gets a single block listing its
  // line-count and word-count overruns instead of two identical red cards.
  type IssueGroup = { label: string; messages: string[] };
  function groupByField(issues: ExportValidationIssue[]): IssueGroup[] {
    // Set per group: identical messages (e.g. one per [GAP] marker in the same
    // section) collapse to one line — and duplicates would crash the keyed each.
    const groups = new Map<string, Set<string>>();
    for (const issue of issues) {
      const messages = groups.get(issue.label) ?? new Set<string>();
      messages.add(issue.message);
      groups.set(issue.label, messages);
    }
    return [...groups.entries()].map(([label, messages]) => ({
      label,
      messages: [...messages],
    }));
  }
  const errorGroups = $derived(groupByField(errors));
  const warningGroups = $derived(groupByField(warnings));

  // Deduped counts so the footer matches the section pills.
  const errorCount = $derived(errorGroups.reduce((n, g) => n + g.messages.length, 0));
  const warningCount = $derived(warningGroups.reduce((n, g) => n + g.messages.length, 0));
  const summary = $derived(
    [
      errorCount ? `${errorCount} blocking error${errorCount === 1 ? "" : "s"}` : "",
      warningCount ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  );
</script>

{#snippet issueSection(
  id: string,
  heading: string,
  groups: IssueGroup[],
  tone: "error" | "warning"
)}
  <section class="mt-4" aria-labelledby={id}>
    <div class="flex items-center gap-2">
      <h4 {id} class="text-label">{heading}</h4>
      <span
        class={`text-data inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 ${
          tone === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
        }`}
      >
        {groups.reduce((n, g) => n + g.messages.length, 0)}
      </span>
    </div>
    <ul class="mt-1.5 space-y-1.5">
      {#each groups as group (group.label)}
        <li
          class={`rounded-lg border px-3 py-2 ${
            tone === "error"
              ? "border-red-100 bg-red-50/70"
              : "border-amber-100 bg-amber-50/70"
          }`}
        >
          <p
            class={`text-[0.8125rem] font-medium ${
              tone === "error" ? "text-red-800" : "text-amber-900"
            }`}
          >
            {group.label}
          </p>
          <ul class="mt-0.5 space-y-0.5">
            {#each group.messages as message (message)}
              <li
                class={`text-xs leading-relaxed ${
                  tone === "error" ? "text-red-700/90" : "text-amber-800/90"
                }`}
              >
                {message}
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

<Dialog.Root
  open={true}
  onOpenChange={(open) => {
    if (!open) onCancel();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} transition:overlayFade class="fixed inset-0 z-[110] bg-navy/30"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4">
      <Dialog.Content forceMount>
        {#snippet child({ props, open })}
          {#if open}
            <div
              {...props}
              transition:modalPop
              class="card pointer-events-auto flex max-h-[85vh] w-full max-w-xl flex-col shadow-xl"
            >
              <!-- Header -->
              <div class="flex items-start gap-2.5 p-5 pb-0">
                <span
                  aria-hidden="true"
                  class={`flex h-8 w-8 flex-none items-center justify-center rounded-full ${
                    hasErrors ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
                  }`}
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </span>
                <div class="min-w-0 flex-1">
                  <Dialog.Title class="text-title">{title}</Dialog.Title>
                  <Dialog.Description class="mt-1 text-sm leading-relaxed text-gray-600">
                    {intro}
                  </Dialog.Description>
                </div>
              </div>

              <!-- Issues (scrolls; header and footer stay put) -->
              <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
                {#if errorGroups.length > 0}
                  {@render issueSection("export-errors-heading", "Blocking errors", errorGroups, "error")}
                {/if}
                {#if warningGroups.length > 0}
                  {@render issueSection("export-warnings-heading", "Warnings", warningGroups, "warning")}
                {/if}
                {#if notes.length > 0}
                  <section class="mt-4" aria-labelledby="export-notes-heading" data-export-notes>
                    <div class="flex items-center gap-2">
                      <h4 id="export-notes-heading" class="text-label">Notes to check</h4>
                      <span class="text-data inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-chrome px-1.5 text-ink-secondary">
                        {notes.length}
                      </span>
                    </div>
                    <p class="mt-1 text-xs leading-[1.5] text-ink-muted">
                      A gap needs the missing fact. An inference is not stated in the sources: check it, then delete its note to keep the sentence, or remove the sentence.
                    </p>
                    <ul class="mt-1.5 space-y-1.5">
                      {#each notes as note, index (index)}
                        <li class="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2" data-export-note={note.kind}>
                          <span
                            class={`mt-px inline-flex h-5 flex-none items-center rounded px-1.5 text-[0.6875rem] font-medium leading-[calc(16/11)] ${
                              note.kind === "gap" ? "bg-gap-bg text-gap-text" : "bg-inferred-bg text-inferred-text"
                            }`}
                          >
                            {NOTE_KIND[note.kind]}
                          </span>
                          <p class="min-w-0 flex-1 text-xs leading-[1.5] text-ink-secondary">
                            <span class="font-medium text-ink">{noteLine(note)}:</span>
                            {note.note || (note.kind === "gap" ? "Nothing named" : "No reason given")}
                          </p>
                          {#if onShowNote}
                            <button
                              type="button"
                              onclick={() => onShowNote(note)}
                              class="flex-none rounded-md px-2 py-0.5 text-xs font-medium leading-[1.5] text-primary-selected transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11"
                            >
                              Show<span class="sr-only"> this {note.kind === "gap" ? "gap" : "inference"} in {noteLine(note)}</span>
                            </button>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  </section>
                {/if}
              </div>

              <!-- Footer -->
              <div class="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
                <p class="text-xs text-gray-400">{summary}</p>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onclick={onCancel}
                    class="rounded-lg px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-chrome focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    Go back
                  </button>
                  {#if !hasErrors && onProceed}
                    <button
                      type="button"
                      onclick={onProceed}
                      class="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    >
                      Proceed anyway
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
