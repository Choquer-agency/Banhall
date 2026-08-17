<script lang="ts">
  // Compact in-plane toolbar on the light workspace plane: drawer hamburger
  // below 1280px, active view title + truthful count, centered ~300px search
  // with the ^K affordance, and the New project action. On narrow screens
  // search collapses to an icon that reveals a full-width row. The bar
  // shares the content plane (bg-canvas — white in the workspace scope)
  // with a hairline divider; the shared Button's theme-aware primary-action
  // role carries creation in both light and dark scopes. The decorative left
  // title tick was removed 2026-08-06 — the title stands alone.
  import { resolve } from "$app/paths";
  import { MagnifyingGlassIcon, PlusIcon } from "phosphor-svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import { searchShortcutHint } from "$lib/workspace/searchContinuity";

  let {
    title,
    count = null,
    searchValue,
    onSearchChange,
    onOpenNavigation,
    railHidden = false,
    onToggleRail = null,
    showNewProject = true,
  }: {
    title: string;
    count?: string | null;
    searchValue: string;
    onSearchChange: (value: string) => void;
    onOpenNavigation: () => void;
    /** Desktop rail visibility state for the persistent hide/show toggle. */
    railHidden?: boolean;
    /**
     * Desktop rail hide/show (2026-08-08 amendment). Lives in the content
     * pane so it stays reachable while the rail is hidden (Obvious/
     * Databricks pattern). Omitted (null) hides the control entirely.
     */
    onToggleRail?: (() => void) | null;
    /** Home already leads with project intake, so its duplicate nav CTA is hidden. */
    showNewProject?: boolean;
  } = $props();

  let desktopInput: HTMLInputElement | null = $state(null);
  let mobileInput: HTMLInputElement | null = $state(null);
  let mobileSearchOpen = $state(false);
  // Focus-continuity anchor (live Obvious evidence 2026-08-08: its search
  // dialog restores focus on Escape). When search focus is INVOKED — ⌘K,
  // the rail search button, the mobile reveal toggle — the element that had
  // focus is recorded so Escape can hand focus straight back instead of
  // dropping it on <body>. Direct pointer focus records nothing: Escape
  // then simply blurs, exactly as before.
  let restoreFocusTo: HTMLElement | null = null;

  // Platform-truthful hint: both handlers accept Meta or Control, and the
  // visible copy now names the platform's own key instead of mixing ⌃K/⌘K.
  const shortcutHint = searchShortcutHint();

  function rememberInvoker() {
    const active = document.activeElement;
    restoreFocusTo =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== desktopInput &&
      active !== mobileInput
        ? active
        : null;
  }

  export function focusSearch(options: { select?: boolean } = {}) {
    const select = options.select ?? true;
    rememberInvoker();
    const place = (input: HTMLInputElement) => {
      input.focus();
      if (select) {
        input.select();
      } else {
        // Continuity focus (restored mid-typed query): caret at the end so
        // the next keystroke appends instead of replacing the query.
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }
    };
    // The centered field exists from `md` up; below that, reveal the row.
    if (desktopInput && desktopInput.offsetParent !== null) {
      place(desktopInput);
      return;
    }
    mobileSearchOpen = true;
    queueMicrotask(() => {
      if (mobileInput) place(mobileInput);
    });
  }

  // ⌘K moved to the shell-owned command palette (2026-08-13, Attio-research
  // P0) — the header field keeps click/rail-invoked focus and its Escape
  // continuity; the kbd hint now names the palette shortcut.
  function handleInputKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.key === "Escape") {
      onSearchChange("");
      mobileSearchOpen = false;
      // Escape restores focus to the invoker (⌘K origin, rail button,
      // mobile toggle) when one was recorded and still exists; otherwise
      // it blurs as before. One-shot — a later Escape never re-steals.
      const target = restoreFocusTo;
      restoreFocusTo = null;
      if (target?.isConnected) {
        target.focus();
      } else {
        event.currentTarget.blur();
      }
    }
  }
</script>

{#snippet searchField(assign: (el: HTMLInputElement) => void, withHint: boolean)}
  <div class="relative w-full">
    <MagnifyingGlassIcon class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" size={15} weight="regular" aria-hidden="true" />
    <input
      use:assign
      type="search"
      value={searchValue}
      oninput={(event) => onSearchChange(event.currentTarget.value)}
      onkeydown={handleInputKeydown}
      aria-label="Search projects"
      placeholder="Search projects…"
      class={`field-control h-7 w-full rounded-lg pl-8 text-[0.8125rem] text-ink placeholder:text-ink-faint ${withHint ? "pr-10" : "pr-3"}`}
    />
    {#if withHint}
      <kbd class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-sans text-[0.6875rem] font-medium text-ink-faint">{shortcutHint}</kbd>
    {/if}
  </div>
{/snippet}

<header data-workspace-toolbar data-workspace-page-header class="flex h-[49px] shrink-0 items-center gap-2 border-b border-workspace-rail-line bg-canvas px-3 sm:px-4">
  <!-- Shared drawer hamburger + desktop rail toggle: one a11y contract,
       owned by WorkspaceShellControls (dedup with WorkspaceChrome). -->
  <WorkspaceShellControls tone="light" {onOpenNavigation} {railHidden} {onToggleRail} />

  <div class="flex min-w-0 items-baseline gap-2">
    <h1 class="truncate text-[0.875rem] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
    {#if count}
      <span class="text-[0.8125rem] text-ink-muted">{count}</span>
    {/if}
  </div>

  <!-- Below the persistent-rail breakpoint the header carries search. On a
       full desktop the measured Attio pattern has one search surface in the
       rail, so the duplicate centre field leaves the composition. -->
  <div class="hidden min-w-0 flex-1 items-center justify-center px-2 md:flex xl:hidden">
    <div class="w-full max-w-[18.75rem]">
      {@render searchField((el) => (desktopInput = el), true)}
    </div>
  </div>

  <div class="ml-auto flex shrink-0 items-center gap-1.5">
    <button
      type="button"
      aria-label="Search projects"
      aria-expanded={mobileSearchOpen}
      aria-controls="workspace-mobile-search"
      onclick={(event) => {
        mobileSearchOpen = !mobileSearchOpen;
        if (mobileSearchOpen) {
          // The toggle is the invoker: Escape in the revealed row hands
          // focus back here instead of dropping it on <body>.
          restoreFocusTo = event.currentTarget;
          queueMicrotask(() => mobileInput?.focus());
        }
      }}
      class="flex h-11 w-11 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-workspace-rail-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none md:hidden"
    >
      <MagnifyingGlassIcon size={18} weight="regular" aria-hidden="true" />
    </button>

    {#if showNewProject}
      <Button
        href={resolve("/project/new")}
        size="xs"
        class="gap-1.5 motion-reduce:transition-none"
      >
        <PlusIcon size={15} weight="bold" aria-hidden="true" />
        <span class="hidden sm:inline">New project</span>
        <span class="sr-only sm:hidden">New project</span>
      </Button>
    {/if}
  </div>
</header>

<!-- Animated mobile search disclosure (2026-08-08 amendment): the revealed
     row enters/exits with the shared ≥300ms disclosure motion instead of
     snapping; reduced motion collapses to instant inside the primitive. -->
<div class="md:hidden">
  <Disclosure id="workspace-mobile-search" open={mobileSearchOpen}>
    <div class="border-b border-line-soft bg-canvas px-3 pb-2 pt-0.5">
      {@render searchField((el) => (mobileInput = el), false)}
    </div>
  </Disclosure>
</div>
