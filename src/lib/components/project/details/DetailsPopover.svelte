<!--
  Details peek (ui-design-final.md section 8, board 5.2): a 360px popover with
  a notch to the i toggle. It shows the status line, Fiscal year, Science
  code, Owner and Edited, and "Open all details". It opens while the pointer
  rests on the toggle (the toggle's click still opens the full panel) and
  stays open while the pointer is inside it.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import PersonAvatar from "./PersonAvatar.svelte";
  import StageChip from "./StageChip.svelte";
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

  // Board 5.2: 32px rows, a 92px label column and a 12px gap.
  const row = "grid min-h-8 grid-cols-[92px_minmax(0,1fr)] items-center gap-x-3 px-2";
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
      class="z-[120] w-[360px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-surface px-2 pb-2.5 pt-3 text-[13px] leading-[18px] shadow-[0_16px_40px_#16211F1F] outline-none"
    >
      <Popover.Arrow>
        {#snippet child({ props })}
          <span {...props} data-details-popover-notch>
            <span class="block size-2.5 translate-y-1/2 rotate-45 rounded-[2px] border-l border-t border-line bg-surface"></span>
          </span>
        {/snippet}
      </Popover.Arrow>
      {#if data}
        <p class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 pb-1 pt-0.5">
          <StageChip stage={data.stage} />
          {#if data.currentHandoff}
            <span class="text-ink-muted">with</span>
            <span class="flex min-w-0 items-center gap-2 text-ink">
              <PersonAvatar initials={data.currentHandoff.initials} seed={String(data.currentHandoff.assigneeId)} isYou={data.currentHandoff.isYou} />
              <span class="truncate">{data.currentHandoff.assigneeLabel}</span>
            </span>
          {/if}
        </p>
        <dl class="mt-2.5 flex flex-col">
          <div class={row}>
            <dt class="text-ink-muted">Fiscal year</dt>
            <dd class="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-ink">
              {#if fiscal}<span>{fiscal.year}</span> <span class="truncate text-ink-muted">({fiscal.date})</span>{:else}<span class="text-ink-faint">Not set</span>{/if}
            </dd>
          </div>
          <div class={row}>
            <dt class="text-ink-muted">Science code</dt>
            <dd class="flex min-w-0 items-center gap-1.5 text-ink">
              {#if science}<span class="min-w-0 truncate">{science.label}</span> <span class="shrink-0 font-mono text-xs text-ink-muted">{science.code}</span>{:else}<span class="text-ink-faint">Not set</span>{/if}
            </dd>
          </div>
          <div class={row}>
            <dt class="text-ink-muted">Owner</dt>
            <dd class="flex min-w-0 items-center gap-1.5 text-ink">
              {#if data.owner}
                <PersonAvatar initials={data.owner.initials} seed={String(data.owner.userId)} isYou={data.owner.isYou} />
                <span class="truncate">{data.owner.label}{data.owner.isYou ? " (you)" : ""}</span>
              {:else}
                <span class="text-ink-faint">No owner recorded</span>
              {/if}
            </dd>
          </div>
          <div class={row}>
            <dt class="text-ink-muted">Edited</dt>
            <dd class="flex items-center text-ink-secondary">{formatEdited(data.editedAt, now)}</dd>
          </div>
        </dl>
        <div class="mt-2.5 flex justify-end border-t border-line-soft px-2 pt-1">
          <button
            type="button"
            onclick={() => {
              open = false;
              onOpenAll();
            }}
            class="mt-2 rounded-md text-[13px] font-medium leading-[18px] text-primary-selected transition-colors hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
          >
            Open all details
          </button>
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
