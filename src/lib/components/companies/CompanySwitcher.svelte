<!--
  The company switcher in a company page's bar (2026-11-04, Paper "State /
  Company switcher open"): the company's name as a button that opens a
  panel listing every company. Type to find one (case and accents ignored),
  arrow keys move through the list, Enter opens it, Esc closes. The panel
  shows the person's recent companies (from the Projects page) first, then
  every company A to Z with its project count, and at its foot "View all
  companies" and, for those who may create projects, New company. The
  company list is read only while the panel is open.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { Popover } from "bits-ui";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { IconArrowRight, IconCheck, IconPlus, IconSearch } from "$lib/components/icons";
  import { popIn, popOut } from "$lib/motion/panelMotion";
  import { loadRecentCompanies } from "$lib/workspace/recentCompanies";
  import { normalizeDashboardText } from "../../../../shared/dashboardProjection";

  let {
    companyKey,
    companyName,
    userId = null,
    allCompaniesHref,
    onSelect,
    onNewCompany = null,
  }: {
    companyKey: string;
    companyName: string;
    /** The signed-in person, for their recent companies. */
    userId?: string | null;
    allCompaniesHref: string;
    onSelect: (key: string) => void;
    /** New company, for those who may create projects; null hides it. */
    onNewCompany?: (() => void) | null;
  } = $props();

  const auth = useAuth();
  let open = $state(false);
  let query = $state("");
  let active = $state(0);
  let inputEl: HTMLInputElement | null = $state(null);
  const listId = $props.id();

  const clientsQ = useQuery(api.clients.listClients, () => (auth.isAuthenticated && open ? {} : "skip"));
  const companies = $derived(clientsQ.data?.clients ?? []);
  const counts = $derived(new Map(companies.map((company) => [company.key, company.projectCount])));

  const needle = $derived(normalizeDashboardText(query));
  const matches = (name: string) => !needle || normalizeDashboardText(name).includes(needle);
  // Recent companies still in the list, under their current names; the search hides this group.
  const recent = $derived.by(() => {
    if (needle || !open) return [];
    const names = new Map(companies.map((company) => [company.key, company.name]));
    return loadRecentCompanies(userId).flatMap((entry) => {
      const name = names.get(entry.key);
      return name ? [{ key: entry.key, name, projectCount: counts.get(entry.key) ?? 0 }] : [];
    });
  });
  const listed = $derived(companies.filter((company) => matches(company.name)));
  /** Every option in keyboard order: recent first, then all companies. */
  const options = $derived([
    ...recent.map((company) => ({ ...company, id: `${listId}-recent-${company.key}` })),
    ...listed.map((company) => ({ key: company.key, name: company.name, projectCount: company.projectCount, id: `${listId}-all-${company.key}` })),
  ]);

  $effect(() => {
    void needle;
    active = 0;
  });

  function pick(key: string) {
    open = false;
    if (key !== companyKey) onSelect(key);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (active + step + options.length) % options.length;
      void tick().then(() => document.getElementById(options[active]?.id ?? "")?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Home" && options.length > 0) {
      event.preventDefault();
      active = 0;
    } else if (event.key === "End" && options.length > 0) {
      event.preventDefault();
      active = options.length - 1;
    } else if (event.key === "Enter") {
      const option = options[active];
      if (!option) return;
      event.preventDefault();
      pick(option.key);
    }
  }

  $effect(() => {
    if (!open) query = "";
  });

  const optionClass =
    "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left outline-none data-[active]:bg-primary-wash pointer-coarse:h-11";
</script>

{#snippet option(entry: { key: string; name: string; projectCount: number; id: string }, index: number)}
  {@const current = entry.key === companyKey}
  <div
    id={entry.id}
    role="option"
    tabindex="-1"
    aria-selected={current}
    data-switcher-option={entry.key}
    data-active={index === active ? "" : undefined}
    class={optionClass}
    onpointermove={() => (active = index)}
    onclick={() => pick(entry.key)}
    onkeydown={(event) => {
      if (event.key === "Enter") pick(entry.key);
    }}
  >
    <span class={`min-w-0 flex-1 truncate text-sm leading-[calc(9/7)] text-ink ${current ? "font-medium" : ""}`}>{entry.name}</span>
    <span class="shrink-0 text-xs leading-[calc(4/3)] text-ink-muted">{entry.projectCount}</span>
    <span class="flex w-3.5 shrink-0 justify-center text-primary-selected">
      {#if current}<IconCheck size={14} strokeWidth={2.4} />{/if}
    </span>
  </div>
{/snippet}

<Popover.Root bind:open>
  <Popover.Trigger
    data-company-switcher
    aria-label={`${companyName}, switch company`}
    class="inline-flex h-9 min-w-0 max-w-[min(22rem,50vw)] items-center gap-2.5 rounded-[0.625rem] border border-primary-line bg-primary-wash pr-2.5 pl-3.5 text-sm font-medium leading-[calc(9/7)] text-fir transition-colors hover:border-primary-ring focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir data-[state=open]:border-primary-selected motion-reduce:transition-none pointer-coarse:h-11"
  >
    <span class="min-w-0 truncate">{companyName}</span>
    <svg viewBox="0 0 24 24" aria-hidden="true" class="size-3.5 shrink-0">
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" fill="none" stroke="var(--color-primary-selected)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      forceMount
      side="bottom"
      align="start"
      sideOffset={8}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        void tick().then(() => inputEl?.focus());
      }}
    >
      {#snippet child({ props, wrapperProps, open: contentOpen })}
        <div {...wrapperProps}>
          {#if contentOpen}
            <div
              {...props}
              in:popIn
              out:popOut
              data-company-switcher-panel
              class="z-[100] flex w-[21.25rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[0.875rem] border border-line bg-surface shadow-menu outline-none"
            >
              <div class="flex h-[2.875rem] shrink-0 items-center gap-2.5 border-b border-line-soft px-3.5">
                <IconSearch size={15} strokeWidth={2} class="shrink-0 text-ink-muted" />
                <input
                  bind:this={inputEl}
                  bind:value={query}
                  type="text"
                  role="combobox"
                  aria-label="Find a company"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={options[active]?.id}
                  placeholder="Find a company"
                  autocomplete="off"
                  data-company-switcher-search
                  onkeydown={onKeydown}
                  class="input-chromeless min-w-0 flex-1 bg-transparent text-sm leading-[calc(9/7)] text-ink outline-none placeholder:text-ink-muted"
                />
                <span aria-hidden="true" class="shrink-0 rounded-[0.3125rem] border border-line px-1.5 py-0.5 font-mono text-[0.6875rem] leading-[calc(14/11)] text-ink-muted">Esc</span>
              </div>
              <div id={listId} role="listbox" aria-label="Companies" class="max-h-[min(24rem,60vh)] overflow-y-auto">
                {#if clientsQ.data === undefined && !clientsQ.error}
                  <p role="status" class="px-4 py-3 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Loading companies...</p>
                {:else if clientsQ.error}
                  <p role="alert" class="px-4 py-3 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Companies could not be loaded.</p>
                {:else}
                  {#if recent.length > 0}
                    <div role="group" aria-labelledby={`${listId}-recent`} class="flex flex-col gap-0.5 p-2" data-switcher-group="recent">
                      <p id={`${listId}-recent`} class="px-2 pt-1 pb-1.5 text-xs leading-[calc(4/3)] text-ink-muted">Recent</p>
                      {#each recent as entry, index (entry.key)}
                        {@render option({ ...entry, id: options[index]!.id }, index)}
                      {/each}
                    </div>
                  {/if}
                  <div
                    role="group"
                    aria-labelledby={`${listId}-all`}
                    class={`flex flex-col gap-0.5 p-2 ${recent.length > 0 ? "border-t border-line-soft" : ""}`}
                    data-switcher-group="all"
                  >
                    <p id={`${listId}-all`} class="px-2 pt-1 pb-1.5 text-xs leading-[calc(4/3)] text-ink-muted">All companies</p>
                    {#each listed as entry, index (entry.key)}
                      {@render option(options[recent.length + index]!, recent.length + index)}
                    {:else}
                      <p class="px-2 py-2 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">No company matches "{query.trim()}".</p>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="flex shrink-0 items-center justify-between gap-3 border-t border-line-soft bg-canvas px-4 py-2.5">
                <a
                  href={allCompaniesHref}
                  data-switcher-all
                  onclick={() => (open = false)}
                  class="inline-flex items-center gap-1.5 rounded-sm text-[0.8125rem] leading-[calc(16/13)] text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir pointer-coarse:min-h-11"
                >View all companies <IconArrowRight size={13} strokeWidth={2.2} /></a>
                {#if onNewCompany}
                  <button
                    type="button"
                    data-switcher-new-company
                    onclick={() => {
                      open = false;
                      onNewCompany?.();
                    }}
                    class="inline-flex items-center gap-1.5 rounded-sm text-[0.8125rem] leading-[calc(16/13)] text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir pointer-coarse:min-h-11"
                  ><IconPlus size={13} strokeWidth={2.2} /> New company</button>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/snippet}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
