<script module lang="ts">
  /** The company as the page shows it when Edit company opens. */
  export type EditableCompany = {
    key: string;
    /** The company row, or null for a company known only by its projects. */
    clientId: string | null;
    /** That row's last change, sent back so a stale dialog is refused. */
    clientUpdatedAt: number | null;
    name: string;
    fiscalYearEndMonth?: number;
    fiscalYearEndDay?: number;
    industry?: string;
    /** The year end shown is the newest project's: the company has none saved. */
    fiscalYearEndFromProjects?: boolean;
    /** The industry shown is the newest project's: the company has none saved. */
    industryFromProjects?: boolean;
  };
</script>

<script lang="ts">
  // Edit company (2026-10-28; Managers and Admins, the people who merge
  // companies and archive company files). The one form dialog frame with
  // the New company fields: Name, Fiscal year end and Industry, filled from
  // the company. Save sends the whole company with the company as the dialog
  // opened it (its name, row and that row's last change), so a stale dialog
  // never overwrites a change made since (clients.updateCompany). A rename
  // moves every project of the company to the new name; a name another
  // company has is refused with "Merge them instead". Each opening starts
  // from the company as it is then.
  //
  // A year end or industry the company has not saved shows its newest
  // project's, marked "From the newest project". Saving leaves such a value
  // out while it is unchanged, so the company keeps following its projects;
  // only a value the person changed or chose is stored.
  import { untrack } from "svelte";
  import { useMutation } from "convex-svelte";
  import FormDialog from "$lib/components/ui/FormDialog.svelte";
  import { formCancel, formError, formField, formLabel, formPrimary, formSelect } from "$lib/components/ui/formDialog";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import FiscalYearEndPicker from "./FiscalYearEndPicker.svelte";

  let {
    open = $bindable(false),
    company,
    canAddIndustry = false,
    onSaved = undefined,
  }: {
    open?: boolean;
    company: EditableCompany;
    /** Admins may add an industry, as on New company. */
    canAddIndustry?: boolean;
    /** After a save: the company's key and name now (a rename moves the key). */
    onSaved?: (result: { key: string; name: string }) => void;
  } = $props();

  const updateCompany = useMutation(api.clients.updateCompany);

  let opened = $state<EditableCompany | null>(null);
  let name = $state("");
  let month = $state("");
  let day = $state("");
  let industry = $state("");
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  /** Escape was pressed over unsaved edits: say how to leave instead. */
  let escapeNote = $state(false);
  let nameInput: HTMLInputElement | null = $state(null);

  // Each opening starts from the company as the page shows it now.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      opened = { ...company };
      name = company.name;
      month = company.fiscalYearEndMonth !== undefined ? String(company.fiscalYearEndMonth) : "";
      day = company.fiscalYearEndDay !== undefined ? String(company.fiscalYearEndDay) : "";
      industry = company.industry ?? "";
      errorMessage = null;
      escapeNote = false;
      busy = false;
    });
  });

  const yearEndIncomplete = $derived(Boolean(month) !== Boolean(day));
  /** Still exactly the newest project's year end, which the company has not saved. */
  const yearEndBorrowed = $derived(
    opened?.fiscalYearEndFromProjects === true &&
      month === String(opened.fiscalYearEndMonth ?? "") &&
      day === String(opened.fiscalYearEndDay ?? "")
  );
  /** Still exactly the newest project's industry, which the company has not saved. */
  const industryBorrowed = $derived(
    opened?.industryFromProjects === true && industry !== "" && industry === (opened.industry ?? "")
  );
  const renames = $derived(opened !== null && name.trim() !== "" && name.trim() !== opened.name);
  const dirty = $derived.by(() => {
    if (!opened) return false;
    const openedMonth = opened.fiscalYearEndMonth !== undefined ? String(opened.fiscalYearEndMonth) : "";
    const openedDay = opened.fiscalYearEndDay !== undefined ? String(opened.fiscalYearEndDay) : "";
    return (
      name.trim() !== opened.name ||
      month !== openedMonth ||
      day !== openedDay ||
      industry !== (opened.industry ?? "")
    );
  });
  $effect(() => {
    if (!dirty) escapeNote = false;
  });
  const canSave = $derived(dirty && Boolean(name.trim()) && !yearEndIncomplete && !busy);

  async function save() {
    if (!canSave || !opened) return;
    busy = true;
    errorMessage = null;
    const done = onSaved;
    try {
      const result = await updateCompany({
        key: opened.key,
        expectedName: opened.name,
        expectedClientId: opened.clientId as Id<"clients"> | null,
        expectedUpdatedAt: opened.clientUpdatedAt,
        name: name.trim(),
        // A value borrowed from the newest project, unchanged, stays unsaved.
        ...(month && day && !yearEndBorrowed ? { fiscalYearEndMonth: Number(month), fiscalYearEndDay: Number(day) } : {}),
        ...(industry && !industryBorrowed ? { industry } : {}),
      });
      open = false;
      done?.({ key: result.key, name: result.name });
    } catch (error) {
      errorMessage = userErrorMessage(error, "This company could not be saved. Try again.");
    } finally {
      busy = false;
    }
  }
</script>

{#snippet footerNote()}
  {#if escapeNote}
    <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" role="status" data-edit-company-escape-note>Save your changes, or use Cancel to discard them.</p>
  {/if}
{/snippet}

{#snippet footer()}
  <button type="button" disabled={busy} onclick={() => (open = false)} class={formCancel}>Cancel</button>
  <button type="button" data-edit-company-save disabled={!canSave} onclick={() => void save()} class={formPrimary}>
    {busy ? "Saving..." : "Save changes"}
  </button>
{/snippet}

<FormDialog
  bind:open
  title="Edit company"
  srDescription="Change this company's name, fiscal year end and industry."
  initialFocus={() => nameInput}
  {busy}
  {dirty}
  onEscapeBlocked={() => (escapeNote = true)}
  testId="edit-company-dialog"
  {footer}
  {footerNote}
>
  <div class="flex flex-col gap-3.5">
    <div class="flex flex-col gap-1.5">
      <label for="edit-company-name" class={formLabel}>Name</label>
      <input
        id="edit-company-name"
        bind:this={nameInput}
        bind:value={name}
        autocomplete="off"
        maxlength={200}
        placeholder="Company name"
        data-filled={name.trim() ? "" : undefined}
        oninput={() => (errorMessage = null)}
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
        class={`field-control ${formField}`}
      />
      {#if renames}
        <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-edit-company-rename-note>Every project of this company takes the new name.</p>
      {/if}
      {#if errorMessage}
        <p role="alert" class={formError} data-edit-company-error>{errorMessage}</p>
      {/if}
    </div>

    <div class="flex flex-col gap-1.5">
      <span class={formLabel} id="edit-company-year-end-label">Fiscal year end</span>
      <FiscalYearEndPicker
        bind:month
        bind:day
        idPrefix="edit-company-year-end"
        labelId="edit-company-year-end-label"
        ariaPrefix="Fiscal year end"
        onValueChange={() => (errorMessage = null)}
      />
      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-edit-company-year-end-helper>
        {yearEndIncomplete
          ? "Pick both a month and a day, or leave both empty."
          : yearEndBorrowed
            ? "From the newest project"
            : "New projects for this company start with it. Projects you already have keep their own."}
      </p>
    </div>

    <div class="flex flex-col gap-1.5" data-filled={industry ? "" : undefined}>
      <label for="edit-company-industry" class={formLabel}>Industry</label>
      <IndustrySelect
        ariaLabel="Industry"
        id="edit-company-industry"
        bind:value={industry}
        canCreate={canAddIndustry}
        offer={opened?.industry ? [opened.industry] : []}
        class={formSelect}
      />
      {#if industryBorrowed}
        <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-edit-company-industry-helper>From the newest project</p>
      {/if}
    </div>
  </div>
</FormDialog>
