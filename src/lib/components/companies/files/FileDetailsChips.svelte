<!--
  A company file's category and fiscal year as two chips (2026-11-04, Paper
  "Spec / Row menu actions", Edit details option C, and "Just added"): the
  same pattern in the row's Edit details and on a file just added, where
  Confirm keeps what the AI picked or what the person changed.
-->
<script lang="ts">
  import { Select } from "bits-ui";
  import { CaretDownIcon, CheckIcon } from "phosphor-svelte";
  import {
    CATEGORY_OPTIONS,
    categoryLabel,
    fiscalYearOf,
    fiscalYearOptions,
    type CompanyFileCategory,
    type ListedCompanyFile,
  } from "./fileMeta";

  let {
    file,
    action = "Save",
    busy = false,
    onSave,
    onCancel,
  }: {
    file: ListedCompanyFile;
    /** "Save" in Edit details, "Confirm" on a file just added. */
    action?: "Save" | "Confirm";
    busy?: boolean;
    onSave: (details: { category: CompanyFileCategory | null; fiscalYear: number | null }) => void;
    onCancel?: () => void;
  } = $props();

  const NONE = "none";
  // Starts from the file's details when the editor opens.
  // svelte-ignore state_referenced_locally
  let category = $state<string>(file.category ?? NONE);
  // svelte-ignore state_referenced_locally
  let year = $state<string>(fiscalYearOf(file)?.toString() ?? NONE);

  const categoryItems = [{ value: NONE, label: "No category" }, ...CATEGORY_OPTIONS];
  const yearItems = $derived([
    { value: NONE, label: "No fiscal year" },
    ...fiscalYearOptions(new Date(), fiscalYearOf(file)).map((value) => ({ value: String(value), label: `FY ${value}` })),
  ]);

  function save() {
    onSave({
      category: category === NONE ? null : (category as CompanyFileCategory),
      fiscalYear: year === NONE ? null : Number(year),
    });
  }

  const chip =
    "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-gray-50 pr-2 pl-2.5 text-xs leading-[calc(4/3)] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none";
  const content = "z-[120] max-h-72 min-w-[10rem] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-menu outline-none";
  const item =
    "flex min-h-8 cursor-default items-center justify-between gap-3 rounded-md px-2 text-xs leading-[calc(4/3)] text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink pointer-coarse:min-h-11";
</script>

<div class="flex flex-wrap items-center gap-2" data-file-details={file._id}>
  <Select.Root type="single" bind:value={category} items={categoryItems} disabled={busy}>
    <Select.Trigger aria-label={`Category of ${file.fileName}`} class={chip} data-file-details-category>
      <span class={category === NONE ? "text-ink-muted" : ""}>{category === NONE ? "No category" : categoryLabel(category as CompanyFileCategory)}</span>
      <CaretDownIcon size="0.75rem" aria-hidden="true" class="text-ink-muted" />
    </Select.Trigger>
    <Select.Portal>
      <Select.Content sideOffset={4} class={content}>
        {#each categoryItems as option (option.value)}
          <Select.Item value={option.value} label={option.label} class={item} data-file-details-category-option={option.value}>
            {#snippet children({ selected })}
              {option.label}
              {#if selected}<CheckIcon size="0.75rem" aria-hidden="true" />{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Portal>
  </Select.Root>

  <Select.Root type="single" bind:value={year} items={yearItems} disabled={busy}>
    <Select.Trigger aria-label={`Fiscal year of ${file.fileName}`} class={`${chip} font-mono tabular-nums`} data-file-details-year>
      <span class={year === NONE ? "font-sans text-ink-muted" : ""}>{year === NONE ? "No fiscal year" : `FY ${year}`}</span>
      <CaretDownIcon size="0.75rem" aria-hidden="true" class="text-ink-muted" />
    </Select.Trigger>
    <Select.Portal>
      <Select.Content sideOffset={4} class={content}>
        {#each yearItems as option (option.value)}
          <Select.Item value={option.value} label={option.label} class={item} data-file-details-year-option={option.value}>
            {#snippet children({ selected })}
              {option.label}
              {#if selected}<CheckIcon size="0.75rem" aria-hidden="true" />{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Portal>
  </Select.Root>

  <span class="ml-auto flex items-center gap-1">
    {#if onCancel}
      <button
        type="button"
        onclick={onCancel}
        disabled={busy}
        class="h-7 rounded-md px-2.5 text-xs leading-[calc(4/3)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
      >Cancel</button>
    {/if}
    <button
      type="button"
      onclick={save}
      disabled={busy}
      data-file-details-save
      class="inline-flex h-7 items-center gap-1 rounded-md bg-primary-wash px-2.5 text-xs leading-[calc(4/3)] font-medium text-primary-selected transition-colors hover:bg-chrome focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
    >
      {#if action === "Confirm"}<CheckIcon size="0.75rem" aria-hidden="true" />{/if}
      {action}
    </button>
  </span>
</div>
