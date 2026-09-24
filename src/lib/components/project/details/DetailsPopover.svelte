<!--
  Details peek (ui-design-final.md section 8, board 5.2): a 360px popover with
  a notch to the i toggle. It shows the status line, Fiscal year, Science
  code, Owner and Edited, and "Open all details". It opens while the pointer
  rests on the toggle (the toggle's click still opens the full panel) and
  stays open while the pointer is inside it.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import PersonAvatar from "./PersonAvatar.svelte";
  import { fiscalYearParts, formatEdited, scienceCodeDisplay } from "./detailsFormat";
  import type { DetailsPanelData } from "./types";

  let {
    data,
    anchor,
    open = $bindable(false),
    disabled = false,
    onOpenAll,
  }: {
    data: DetailsPanelData | null | undefined;
    anchor: HTMLElement | null;
    open?: boolean;
    /** No peek while the full panel is open. */
    disabled?: boolean;
    onOpenAll: () => void;
  } = $props();

  const OPEN_DELAY = 450;
  const CLOSE_DELAY = 200;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let now = $state(Date.now());

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }
  function scheduleOpen() {
    clear();
    if (disabled || !data) return;
    timer = setTimeout(() => {
      now = Date.now();
      open = true;
    }, OPEN_DELAY);
  }
  function scheduleClose() {
    clear();
    timer = setTimeout(() => (open = false), CLOSE_DELAY);
  }

  $effect(() => {
    const element = anchor;
    if (!element) return;
    const enter = () => scheduleOpen();
    const leave = () => scheduleClose();
    const press = () => {
      clear();
      open = false;
    };
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("pointerdown", press);
    return () => {
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("pointerdown", press);
      clear();
    };
  });

  $effect(() => {
    if (disabled) {
      clear();
      open = false;
    }
  });

  const fiscal = $derived(fiscalYearParts(data?.fiscalYearEnd));
  const science = $derived(scienceCodeDisplay(data?.scienceCode));
</script>

<Popover.Root bind:open>
  <Popover.Portal>
    <Popover.Content
      customAnchor={anchor}
      side="bottom"
      align="end"
      alignOffset={-12}
      sideOffset={8}
      collisionPadding={12}
      trapFocus={false}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onpointerenter={clear}
      onpointerleave={scheduleClose}
      data-details-popover
      aria-label="Details"
      class="z-[120] w-[360px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-surface text-[13px] shadow-lg outline-none"
    >
      <Popover.Arrow>
        {#snippet child({ props })}
          <span {...props} data-details-popover-notch>
            <span class="block size-3 translate-y-1/2 rotate-45 rounded-[2px] border-l border-t border-line bg-surface"></span>
          </span>
        {/snippet}
      </Popover.Arrow>
      {#if data}
        <div class="p-4 pb-3">
          <p class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <StageBadge stage={data.stage} dot />
            {#if data.currentHandoff}
              <span class="text-ink-muted">with</span>
              <span class="flex min-w-0 items-center gap-1.5 text-ink">
                <PersonAvatar initials={data.currentHandoff.initials} seed={String(data.currentHandoff.assigneeId)} isYou={data.currentHandoff.isYou} />
                <span class="truncate">{data.currentHandoff.assigneeLabel}</span>
              </span>
            {/if}
          </p>
          <dl class="mt-3 grid grid-cols-[104px_minmax(0,1fr)] gap-y-1">
            <dt class="flex min-h-8 items-center text-ink-muted">Fiscal year</dt>
            <dd class="flex min-h-8 items-center truncate text-ink">
              {#if fiscal}{fiscal.year} <span class="ml-1 text-ink-muted">({fiscal.date})</span>{:else}<span class="text-ink-faint">Not set</span>{/if}
            </dd>
            <dt class="flex min-h-8 items-center text-ink-muted">Science code</dt>
            <dd class="flex min-h-8 min-w-0 items-center text-ink">
              {#if science}<span class="truncate">{science.label}</span><span class="ml-2 font-mono text-xs text-ink-muted">{science.code}</span>{:else}<span class="text-ink-faint">Not set</span>{/if}
            </dd>
            <dt class="flex min-h-8 items-center text-ink-muted">Owner</dt>
            <dd class="flex min-h-8 min-w-0 items-center gap-2 text-ink">
              {#if data.owner}
                <PersonAvatar initials={data.owner.initials} seed={String(data.owner.userId)} isYou={data.owner.isYou} />
                <span class="truncate">{data.owner.label}{data.owner.isYou ? " (you)" : ""}</span>
              {:else}
                <span class="text-ink-faint">No owner recorded</span>
              {/if}
            </dd>
            <dt class="flex min-h-8 items-center text-ink-muted">Edited</dt>
            <dd class="flex min-h-8 items-center text-ink-secondary">{formatEdited(data.editedAt, now)}</dd>
          </dl>
        </div>
        <div class="flex justify-end border-t border-line-soft px-4 py-2.5">
          <button
            type="button"
            onclick={() => {
              open = false;
              onOpenAll();
            }}
            class="rounded-md px-1 text-[13px] text-primary-selected transition-colors hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
          >
            Open all details
          </button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
