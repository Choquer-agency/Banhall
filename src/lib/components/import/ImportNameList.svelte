<!--
  A searchable list of names with a way to type one that is not listed (the
  Import sheet's writer and company pickers, board ao5), in the look of the
  science code list: a search field, the names, a check on the current one,
  then 'Use "Jordan Ellis"' for a name typed that is not in the list. The
  body of a popover: mount it when the popover opens. Options may carry a
  group (2026-11-16, the writer list: Team members, then Past writers), each
  under a quiet heading, and a quiet detail at the end ("No login").
-->
<script lang="ts">
  import { Command } from "bits-ui";
  import { CheckIcon, MagnifyingGlassIcon, PlusIcon } from "phosphor-svelte";

  type Option = { value: string; label: string; detail?: string | null; group?: string | null };

  let {
    label,
    placeholder,
    options,
    current = null,
    query = $bindable(""),
    filter = true,
    newText,
    canOfferNew = null,
    refuseTyped = null,
    hint = null,
    note = null,
    loading = false,
    onPick,
    onNew = null,
  }: {
    /** What the list is, for screen readers ("Writer"). */
    label: string;
    placeholder: string;
    options: readonly Option[];
    /** The value the file has now, checked. */
    current?: string | null;
    query?: string;
    /** Narrow the options by the text typed here; false when the host searches. */
    filter?: boolean;
    /** The choice for a typed name not in the list: 'Use "Jordan Ellis"'. */
    newText: (typed: string) => string;
    /**
     * Whether the typed name may be offered as new, when the host decides
     * (the company list waits for its search, and matches by company key);
     * null: when no option has the same name.
     */
    canOfferNew?: boolean | null;
    /** Why a typed name cannot be used ("not an email address"), shown in place of the choice; null when it can. */
    refuseTyped?: ((typed: string) => string | null) | null;
    /** A muted line when there is nothing to list yet ("Type a company name"). */
    hint?: string | null;
    /** Optional top helper note shown above the search box (e.g. initials scope warning). */
    note?: string | null;
    loading?: boolean;
    onPick: (value: string) => void;
    /** A typed name chosen with 'Use "..."'; onPick gets it when this is not given. */
    onNew?: ((typed: string) => void) | null;
  } = $props();

  const NEW = "\u0000new";
  const fold = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const typed = $derived(query.trim().replace(/\s+/g, " "));
  const shown = $derived(
    filter && typed ? options.filter((option) => fold(option.label).includes(fold(typed))) : options
  );
  const refusal = $derived(typed.length > 0 && refuseTyped ? refuseTyped(typed) : null);
  const offerNew = $derived(
    typed.length > 0 &&
      refusal === null &&
      (canOfferNew ?? !options.some((option) => fold(option.label) === fold(typed)))
  );
  /** The shown options in runs of one group, in order. */
  const sections = $derived.by(() => {
    const out: { group: string | null; options: Option[] }[] = [];
    for (const option of shown) {
      const group = option.group ?? null;
      const last = out.at(-1);
      if (last && last.group === group) last.options.push(option);
      else out.push({ group, options: [option] });
    }
    return out;
  });
  let highlighted = $state("");

  const itemClass =
    "flex min-h-[1.875rem] w-full cursor-default items-center gap-2.5 rounded-md px-2 py-1 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink outline-none data-[selected]:bg-primary-wash pointer-coarse:min-h-11";
</script>

{#snippet item(option: Option)}
  <Command.Item
    value={option.value}
    onSelect={() => onPick(option.value)}
    class={`${itemClass} ${option.value === current ? "bg-gray-50" : ""}`}
    aria-current={option.value === current ? "true" : undefined}
    data-import-name-option={option.value}
  >
    <span class="min-w-0 flex-1 truncate">{option.label}</span>
    {#if option.detail}
      <span data-import-name-detail class="shrink-0 text-xs leading-[calc(4/3)] text-ink-muted">{option.detail}</span>
    {/if}
    {#if option.value === current}
      <CheckIcon size="0.875rem" aria-label="Now" class="shrink-0 text-primary-selected" />
    {/if}
  </Command.Item>
{/snippet}

<Command.Root shouldFilter={false} loop {label} bind:value={highlighted} class="flex max-h-[min(20rem,calc(100dvh-8rem))] flex-col">
  {#if note}
    <p data-import-name-note class="shrink-0 border-b border-line-soft bg-gray-50 px-2.5 py-2 text-xs leading-[calc(4/3)] text-ink-secondary">
      {note}
    </p>
  {/if}
  <div class="shrink-0 px-2 pb-1 pt-2">
    <div class="field-control-shell flex h-[2.125rem] items-center gap-2 rounded-md px-2.5">
      <MagnifyingGlassIcon size="0.875rem" aria-hidden="true" class="pointer-events-none shrink-0 text-ink-muted" />
      <Command.Input
        bind:value={query}
        {placeholder}
        aria-label={placeholder}
        data-import-name-search
        class="input-chromeless h-full min-w-0 flex-1 bg-transparent text-[0.8125rem] text-ink placeholder:text-ink-muted"
      />
    </div>
  </div>
  <Command.List class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
    <Command.Viewport>
      {#each sections as section, index (section.group ?? `none-${index}`)}
        {#if section.group}
          <Command.Group value={section.group} data-import-name-group={section.group} class={index > 0 ? "mt-1 border-t border-line-soft pt-1" : ""}>
            <Command.GroupHeading class="px-2 pb-1 pt-1.5 text-xs leading-[calc(4/3)] text-ink-muted">{section.group}</Command.GroupHeading>
            <Command.GroupItems>
              {#each section.options as option (option.value)}
                {@render item(option)}
              {/each}
            </Command.GroupItems>
          </Command.Group>
        {:else}
          {#each section.options as option (option.value)}
            {@render item(option)}
          {/each}
        {/if}
      {/each}
      {#if offerNew}
        <Command.Item value={NEW} onSelect={() => (onNew ?? onPick)(typed)} class={itemClass} data-import-name-new>
          <PlusIcon size="0.875rem" aria-hidden="true" class="shrink-0 text-ink-muted" />
          <span class="min-w-0 flex-1 truncate">{newText(typed)}</span>
        </Command.Item>
      {/if}
      {#if refusal}
        <p data-import-name-refused class="px-2 py-2 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" role="status">{refusal}</p>
      {:else if shown.length === 0 && !offerNew}
        <p class="px-2 py-3 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" role="status">
          {loading ? "Searching..." : (hint ?? "No names yet.")}
        </p>
      {/if}
    </Command.Viewport>
  </Command.List>
</Command.Root>
