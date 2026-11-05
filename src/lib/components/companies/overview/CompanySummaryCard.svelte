<!--
  The company summary card (2026-11-04, Paper "Profile / Overview" and
  "Spec / Company summary footer states"): two or three plain sentences on
  what the company does. Drafted by AI from the website after a read saves,
  while no person has written one; Managers and Admins write or change it
  from Edit, and a later read never replaces their text.

  The footer says where the text came from, each line only when true:
  "Drafted by AI from <host>" on the left; "Edited by <name> on <date>"
  (on the right after an AI draft, else on the left). With neither, there
  is no footer. With no summary: "No summary yet." and, for those who may,
  Edit. A failed draft leaves it empty; nothing blocks.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import { IconPencil } from "$lib/components/icons";
  import { companyWebsiteHost } from "../../../../../shared/companyWebsite";
  import { MAX_COMPANY_SUMMARY_CHARS } from "../../../../../shared/companySummary";
  import { shortDate } from "$lib/companies/companies";

  type Summary = {
    text: string;
    aiDraftedFrom?: string;
    aiDraftedAt?: number;
    editedByName?: string;
    editedAt?: number;
  };

  let {
    clientId,
    summary,
    canEdit = false,
    websiteReading = false,
  }: {
    /** The company row (null for a company known only by its projects: nothing to save to). */
    clientId: string | null;
    summary: Summary | null;
    /** Managers and Admins (Edit company's rule). */
    canEdit?: boolean;
    /** The website is being read now, so a draft may follow. */
    websiteReading?: boolean;
  } = $props();

  const save = useMutation(api.companySummary.updateCompanySummary);
  let editing = $state(false);
  let draft = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  let editButton: HTMLButtonElement | null = $state(null);
  const fieldId = $props.id();

  const editable = $derived(canEdit && clientId !== null);
  const tooLong = $derived(draft.trim().length > MAX_COMPANY_SUMMARY_CHARS);
  const edited = $derived(summary?.editedByName && summary.editedAt !== undefined ? `Edited by ${summary.editedByName} on ${shortDate(summary.editedAt)}` : null);
  const hasFooter = $derived(Boolean(summary && (summary.aiDraftedFrom || edited)));

  async function startEdit() {
    draft = summary?.text ?? "";
    error = null;
    editing = true;
    await tick();
    textareaEl?.focus();
  }

  async function stopEdit() {
    editing = false;
    error = null;
    await tick();
    editButton?.focus();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!clientId || saving || tooLong) return;
    saving = true;
    error = null;
    try {
      await save({ clientId: clientId as Id<"clients">, text: draft });
      toast.success(draft.trim() ? "Summary saved" : "Summary removed");
      await stopEdit();
    } catch (caught) {
      const data = (caught as { data?: { message?: unknown } } | null)?.data;
      error = typeof data?.message === "string" ? data.message : "The summary could not be saved. Try again.";
    } finally {
      saving = false;
    }
  }
</script>

<section data-company-summary aria-labelledby={`${fieldId}-title`} class="flex flex-col overflow-hidden rounded-[0.875rem] border border-line bg-surface">
  <div class="flex items-center justify-between gap-4 px-5 pt-4">
    <div class="flex items-center gap-2.5">
      <span aria-hidden="true" class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-wash text-primary-selected">
        <svg viewBox="0 0 24 24" class="size-[0.9375rem]"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </span>
      <h2 id={`${fieldId}-title`} class="text-[0.9375rem] font-medium leading-[calc(4/3)] text-ink">Company summary</h2>
    </div>
    {#if editable && !editing}
      <button
        bind:this={editButton}
        type="button"
        data-company-summary-edit
        onclick={() => void startEdit()}
        class="inline-flex h-[1.875rem] shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[0.8125rem] leading-[calc(16/13)] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
      ><IconPencil size={13} strokeWidth={1.8} /> Edit<span class="sr-only"> the company summary</span></button>
    {/if}
  </div>

  {#if editing}
    <form onsubmit={submit} class="flex flex-col gap-2 px-5 pt-3 pb-[1.125rem]" data-company-summary-form>
      <label for={`${fieldId}-text`} class="sr-only">Company summary</label>
      <textarea
        bind:this={textareaEl}
        bind:value={draft}
        id={`${fieldId}-text`}
        rows="4"
        aria-invalid={tooLong || error ? "true" : undefined}
        aria-describedby={`${fieldId}-help`}
        data-company-summary-input
        onkeydown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            void stopEdit();
          }
        }}
        class="field-control w-full resize-y rounded-lg px-3 py-2.5 text-[0.9375rem] leading-[1.6] text-ink-secondary"
      ></textarea>
      <p id={`${fieldId}-help`} class={`text-xs leading-[calc(4/3)] ${tooLong || error ? "text-danger-ink-muted" : "text-ink-muted"}`} data-company-summary-help>
        {#if error}{error}{:else if tooLong}At most {MAX_COMPANY_SUMMARY_CHARS.toLocaleString("en-US")} characters.{:else}Two or three plain sentences on what the company does. Leave it empty to remove it.{/if}
      </p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          data-company-summary-cancel
          onclick={() => void stopEdit()}
          class="inline-flex h-[1.875rem] items-center rounded-md border border-line bg-surface px-3 text-[0.8125rem] font-medium leading-[calc(16/13)] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
        >Cancel</button>
        <button
          type="submit"
          data-company-summary-save
          disabled={saving || tooLong}
          class="inline-flex h-[1.875rem] items-center rounded-md bg-primary-selected px-3 text-[0.8125rem] font-medium leading-[calc(16/13)] text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11"
        >{saving ? "Saving..." : "Save"}</button>
      </div>
    </form>
  {:else if summary}
    <p data-company-summary-text class="whitespace-pre-line px-5 pt-3 pb-[1.125rem] text-[0.9375rem] leading-[1.6] text-ink-secondary">{summary.text}</p>
  {:else}
    <p data-company-summary-empty class="px-5 pt-3 pb-[1.125rem] text-[0.9375rem] leading-[1.6] text-ink-muted">
      No summary yet.{#if websiteReading}{" "}One is drafted from the website once it is read.{/if}
    </p>
  {/if}

  {#if hasFooter && summary && !editing}
    <div data-company-summary-footer class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line-soft bg-canvas px-5 py-3 text-xs leading-[calc(4/3)] text-ink-muted">
      {#if summary.aiDraftedFrom}
        <span class="flex min-w-0 items-center gap-1.5" data-company-summary-drafted>
          <svg viewBox="0 0 24 24" aria-hidden="true" class="size-3.5 shrink-0">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Drafted by AI from
          <a
            href={summary.aiDraftedFrom}
            target="_blank"
            rel="noopener noreferrer"
            class="truncate rounded-sm text-primary-selected underline decoration-gray-300 underline-offset-[3px] hover:decoration-primary-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
          >{companyWebsiteHost(summary.aiDraftedFrom)}</a>
        </span>
      {/if}
      {#if edited}
        <span data-company-summary-edited>{edited}</span>
      {/if}
    </div>
  {/if}
</section>
