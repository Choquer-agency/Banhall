<!--
  Quiet notice on a stopped report (FR-43, owner decision 20): names the
  Sections marked Not drafted and offers "Draft the rest", which fills only
  those Sections into the same report and keeps the writer's edits. While a
  redraft runs the report is read-only, and the notice says so. When the
  latest attempt failed after it started, the notice says it did not finish,
  with the reason, and offers to try again.
-->
<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";
  import { sectionListText } from "./draftProgress";

  let {
    missingSections,
    onDraftRest,
    pending = false,
    errorMessage = null,
    failedAttempt = null,
    disabled = false,
  }: {
    missingSections: Array<{ number: string; title?: string }>;
    /** Starts `redraftMissingSections`; a rejection shows the retry message. */
    onDraftRest: () => void | Promise<void>;
    /** Host-known pending state (for example, the redraft run is live). */
    pending?: boolean;
    errorMessage?: string | null;
    /** The latest redraft attempt failed after it started (sanitized reason, if any). */
    failedAttempt?: { error: string | null } | null;
    /** No permission to draft, or another run is active. */
    disabled?: boolean;
  } = $props();

  let requesting = $state(false);
  let localError = $state<string | null>(null);
  const busy = $derived(pending || requesting);
  const shownError = $derived(errorMessage ?? localError);
  // A start error wins; an attempt failure shows only while nothing newer is
  // running or being requested.
  const attemptFailed = $derived(Boolean(failedAttempt) && !busy && !shownError);
  const numbers = $derived(missingSections.map((section) => section.number));
  const listText = $derived(sectionListText(numbers));
  const headline = $derived(
    numbers.length === 1
      ? `Writing stopped. ${capitalise(listText)} was not drafted.`
      : `Writing stopped. ${capitalise(listText)} were not drafted.`
  );

  function capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  async function draftRest() {
    if (busy || disabled) return;
    requesting = true;
    localError = null;
    try {
      await onDraftRest();
    } catch (error) {
      console.error("Draft the rest failed to start", error);
      localError = "Could not start drafting the missing sections. Try again.";
    } finally {
      requesting = false;
    }
  }
</script>

{#if missingSections.length > 0}
  <section
    aria-label="Sections not drafted"
    data-not-drafted-banner
    class="flex flex-col gap-3 rounded-xl border border-line-soft bg-canvas px-4 py-3 sm:flex-row sm:items-center"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <p class="text-sm font-medium text-ink">{headline}</p>
      <p class="text-[13px] leading-5 text-ink-muted">
        Draft the rest writes only the missing sections into this report. Your edits stay as they are.
      </p>
      {#if busy}
        <p class="text-[13px] leading-5 text-ink-secondary" role="status" data-redraft-status>
          Drafting the missing sections. Editing resumes when they are in.
        </p>
      {/if}
      {#if shownError}
        <p class="text-[13px] leading-5 text-red-700" role="alert">{shownError}</p>
      {:else if attemptFailed}
        <p class="text-[13px] leading-5 text-red-700" role="alert" data-redraft-failed>
          Drafting the missing sections did not finish.{#if failedAttempt?.error}{" "}{failedAttempt.error}{/if}
        </p>
      {/if}
    </div>
    <Button
      variant="secondary"
      size="sm"
      class="h-9 shrink-0 self-start sm:self-auto"
      disabled={busy || disabled}
      onclick={draftRest}
      data-draft-rest
    >
      {busy ? "Drafting…" : attemptFailed ? "Try again" : "Draft the rest"}
    </Button>
  </section>
{/if}
