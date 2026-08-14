<!--
  Command palette (2026-08-13, Attio-research P0): one ⌘K surface for
  navigation, project search, and creation, mounted by WorkspaceShell so it
  is reachable on every shell page. Light Ledger Paper presentation by
  design — the portal renders OUTSIDE the workspace theme scope, so the
  panel keeps the base light tokens on both shell themes.

  Truth rules: project results come from the same bounded
  `dashboard.searchProjects` subscription the Projects view uses (live only
  while the palette is open with a settled query — no standing
  subscriptions); admin destinations are the shared ADMIN_ROUTES list,
  admin-role gated exactly like UserMenu. Creation stays navigation into
  the wizard (new projects begin in Intake).
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { Command, Dialog } from "bits-ui";
  import { fade } from "svelte/transition";
  import { usePaginatedQuery, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { ADMIN_ROUTES } from "$lib/dashboard/adminRoutes";
  import { searchShortcutHint } from "$lib/workspace/searchContinuity";
  import { popIn, popOut } from "$lib/motion/panelMotion";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";

  let {
    open = $bindable(false),
    myWorkHref = "/my-work",
    projectsHref = "/projects",
  }: {
    open?: boolean;
    /** Canonical rail hrefs (carry the layout/group params) so palette and
     * rail can never navigate to different variants of the same view. */
    myWorkHref?: string;
    projectsHref?: string;
  } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated && open ? {} : "skip"
  );
  const isAdmin = $derived(userQ.data?.role === "admin");

  let query = $state("");
  // Debounced server query — one search subscription per settled query,
  // never per keystroke (same discipline as the workspace header search).
  let settled = $state("");
  $effect(() => {
    const value = query.trim();
    const timer = setTimeout(() => (settled = value), 250);
    return () => clearTimeout(timer);
  });

  const searchQ = usePaginatedQuery(
    api.dashboard.searchProjects,
    () => (auth.isAuthenticated && open && settled ? { search: settled } : "skip"),
    { initialNumItems: 8 }
  );
  const results = $derived(open && settled ? searchQ.results : []);
  const searching = $derived(
    Boolean(settled) && (searchQ.status === "LoadingFirstPage" || query.trim() !== settled)
  );

  type Destination = { href: string; label: string; keywords?: string };
  const destinations = $derived.by((): Destination[] => {
    // myWorkHref/projectsHref arrive pre-built from the shell host (they
    // carry the canonical layout/group params); the rest resolve here.
    const base: Destination[] = [
      { href: myWorkHref, label: "Home", keywords: "home my work" },
      { href: projectsHref, label: "Projects", keywords: "projects board list" },
      { href: resolve("/settings"), label: "Settings", keywords: "settings account" },
    ];
    return isAdmin
      ? [...base, ...ADMIN_ROUTES.map((r) => ({ href: resolve(r.href), label: r.label, keywords: "admin" }))]
      : base;
  });
  // Static entries filter by simple inclusion; server results arrive
  // pre-ranked, so bits' own scorer stays off (shouldFilter=false).
  const matchesQuery = (item: Destination) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(q);
  };
  const visibleDestinations = $derived(destinations.filter(matchesQuery));
  const newProjectVisible = $derived(
    matchesQuery({ href: "", label: "New project", keywords: "create start wizard add" })
  );

  const shortcutHint = searchShortcutHint();

  function go(href: string) {
    open = false;
    void goto(href);
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      open = !open;
    }
  }

  $effect(() => {
    if (!open) {
      query = "";
      settled = "";
    }
  });

  const itemClass =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-secondary outline-none transition-colors data-selected:bg-chrome data-selected:text-ink motion-reduce:transition-none pointer-coarse:min-h-11";
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: overlayOpen })}
        {#if overlayOpen}
          <div
            {...props}
            transition:fade={{ duration: 150 }}
            class="fixed inset-0 z-[120] bg-black/40"
          ></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content forceMount>
      {#snippet child({ props, open: contentOpen })}
        {#if contentOpen}
          <div class="fixed inset-0 z-[121] flex items-start justify-center px-4 pt-[12vh]">
            <div
              {...props}
              in:popIn
              out:popOut
              class="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-md"
            >
              <Dialog.Title class="sr-only">Command palette</Dialog.Title>
              <Dialog.Description class="sr-only">
                Search projects, go to a page, or start an action.
              </Dialog.Description>
              <Command.Root shouldFilter={false} loop class="flex max-h-[60vh] flex-col">
                <div class="relative shrink-0 border-b border-line-soft">
                  <svg class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <Command.Input
                    bind:value={query}
                    placeholder="Search projects or jump to…"
                    class="input-chromeless h-12 w-full bg-transparent pl-10 pr-12 text-sm text-ink placeholder:text-ink-faint"
                  />
                  <kbd class="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-sans text-[0.6875rem] font-medium text-ink-faint">{shortcutHint}</kbd>
                </div>
                <Command.List class="min-h-0 flex-1 overflow-y-auto p-1.5">
                  <Command.Viewport>
                    {#if visibleDestinations.length > 0}
                      <Command.Group>
                        <Command.GroupHeading class="text-label px-2.5 pb-1 pt-2">Go to</Command.GroupHeading>
                        <Command.GroupItems>
                          {#each visibleDestinations as destination (destination.href)}
                            <Command.Item value={`go:${destination.href}`} onSelect={() => go(destination.href)} class={itemClass}>
                              <svg class="h-4 w-4 shrink-0 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5-5 5M6 7l5 5-5 5" /></svg>
                              {destination.label}
                            </Command.Item>
                          {/each}
                        </Command.GroupItems>
                      </Command.Group>
                    {/if}

                    {#if settled}
                      <Command.Group>
                        <Command.GroupHeading class="text-label px-2.5 pb-1 pt-2">Projects</Command.GroupHeading>
                        <Command.GroupItems>
                          {#if searching && results.length === 0}
                            <p class="px-2.5 py-2 text-[13px] text-ink-faint" role="status">Searching…</p>
                          {:else if results.length === 0}
                            <p class="px-2.5 py-2 text-[13px] text-ink-muted" role="status">No matching projects.</p>
                          {:else}
                            {#each results as project (project._id)}
                              <Command.Item value={`project:${project._id}`} onSelect={() => go(resolve("/project/[id]", { id: project._id }))} class={itemClass}>
                                <span class="min-w-0 flex-1 truncate text-ink">{project.title}</span>
                                <span class="max-w-32 truncate text-xs text-ink-muted">{project.clientName}</span>
                                {#if project.workflowStage}
                                  <StageBadge stage={project.workflowStage} dot />
                                {/if}
                              </Command.Item>
                            {/each}
                          {/if}
                        </Command.GroupItems>
                      </Command.Group>
                    {/if}

                    {#if newProjectVisible}
                      <Command.Group>
                        <Command.GroupHeading class="text-label px-2.5 pb-1 pt-2">Actions</Command.GroupHeading>
                        <Command.GroupItems>
                          <Command.Item value="action:new-project" onSelect={() => go(resolve("/project/new"))} class={itemClass}>
                            <svg class="h-4 w-4 shrink-0 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
                            New project
                            <span class="ml-auto text-[11px] text-ink-faint">Opens the wizard</span>
                          </Command.Item>
                        </Command.GroupItems>
                      </Command.Group>
                    {/if}

                    {#if !settled && visibleDestinations.length === 0 && !newProjectVisible}
                      <p class="px-2.5 py-6 text-center text-[13px] text-ink-muted">Nothing matches.</p>
                    {/if}
                  </Command.Viewport>
                </Command.List>
                <div
                  class="flex shrink-0 items-center gap-4 border-t border-line-soft px-3 py-2 text-[11px] text-ink-faint"
                  aria-hidden="true"
                >
                  <span class="inline-flex items-center gap-1.5">
                    <kbd class="font-sans font-medium text-ink-muted">↑↓</kbd>
                    Navigate
                  </span>
                  <span class="inline-flex items-center gap-1.5">
                    <kbd class="font-sans font-medium text-ink-muted">↵</kbd>
                    Open
                  </span>
                  <span class="ml-auto inline-flex items-center gap-1.5">
                    <kbd class="font-sans font-medium text-ink-muted">Esc</kbd>
                    Close
                  </span>
                </div>
              </Command.Root>
            </div>
          </div>
        {/if}
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
