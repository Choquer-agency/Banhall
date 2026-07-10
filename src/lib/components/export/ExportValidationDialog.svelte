<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import type { ExportValidationIssue } from "$lib/exportValidation";

  let {
    errors,
    warnings,
    onCancel,
    onProceed,
  }: {
    errors: ExportValidationIssue[];
    warnings: ExportValidationIssue[];
    onCancel: () => void;
    onProceed?: () => void;
  } = $props();

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
    const groups = new Map<string, string[]>();
    for (const issue of issues) {
      const messages = groups.get(issue.label) ?? [];
      messages.push(issue.message);
      groups.set(issue.label, messages);
    }
    return [...groups.entries()].map(([label, messages]) => ({ label, messages }));
  }
  const errorGroups = $derived(groupByField(errors));
  const warningGroups = $derived(groupByField(warnings));

  const summary = $derived(
    [
      errors.length
        ? `${errors.length} blocking error${errors.length === 1 ? "" : "s"}`
        : "",
      warnings.length
        ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
        : "",
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
