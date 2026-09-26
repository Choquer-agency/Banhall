<script lang="ts">
  /**
   * A5 Admin flyout on the collapsed rail. Opens on hover after a 150ms
   * intent delay and from the keyboard (Enter, Space) or a click, so it is
   * never hover-only. Arrow keys move between items (bits-ui menu); Esc and
   * leaving with the pointer close it and focus returns to the Admin icon.
   */
  import type { Snippet } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { IconChevronRight } from "$lib/components/icons";
  import {
    ADMIN_GROUPS,
    ADMIN_INGESTION_PATH,
    ADMIN_LANDING_PATH,
  } from "$lib/dashboard/adminRoutes";
  import AdminRouteIcon from "$lib/components/shell/AdminRouteIcon.svelte";
  import KeyHint from "$lib/components/shell/KeyHint.svelte";

  let {
    attentionTotal = 0,
    ingestionFailed = 0,
    onNavigate = undefined,
    trigger,
  }: {
    attentionTotal?: number;
    ingestionFailed?: number;
    onNavigate?: () => void;
    trigger: Snippet<[{ props: Record<string, unknown>; open: boolean }]>;
  } = $props();

  const HOVER_INTENT_MS = 150;
  const CLOSE_DELAY_MS = 120;

  let open = $state(false);
  let openedByHover = false;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (openTimer) clearTimeout(openTimer);
    if (closeTimer) clearTimeout(closeTimer);
    openTimer = closeTimer = null;
  }

  function pointerEnter(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    if (open || openTimer) return;
    openTimer = setTimeout(() => {
      openTimer = null;
      openedByHover = true;
      open = true;
    }, HOVER_INTENT_MS);
  }

  function pointerLeave(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    if (openTimer) clearTimeout(openTimer);
    openTimer = null;
    if (!open) return;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      open = false;
    }, CLOSE_DELAY_MS);
  }

  function go(href: string) {
    open = false;
    onNavigate?.();
    void goto(resolve(href as "/"));
  }

  $effect(() => () => clearTimers());

  const item =
    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] leading-[19px] text-ink-secondary outline-none transition-colors data-highlighted:bg-chrome data-highlighted:text-ink motion-reduce:transition-none pointer-coarse:h-11";
</script>

<DropdownMenu.Root
  bind:open
  onOpenChange={(value) => {
    if (!value) openedByHover = false;
  }}
>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      {@render trigger({
        props: { ...props, onpointerenter: pointerEnter, onpointerleave: pointerLeave },
        open,
      })}
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      data-admin-flyout
      side="right"
      align="start"
      sideOffset={16}
      alignOffset={-2}
      preventScroll={false}
      onOpenAutoFocus={(event) => {
        // A hover preview must not steal focus from wherever it is.
        if (openedByHover) event.preventDefault();
      }}
      onpointerenter={pointerEnter}
      onpointerleave={pointerLeave}
      class="z-[80] w-[252px] rounded-xl border border-line bg-surface p-1.5 shadow-menu outline-none"
    >
      <div data-admin-flyout-header class="flex items-center gap-2 px-2 pb-0.5 pt-1.5">
        <p class="text-[13px] font-medium leading-[18px] text-ink">Admin</p>
        {#if attentionTotal > 0}
          <p data-admin-flyout-attention class="text-xs leading-4 text-warning-ink-muted">{attentionTotal} needs a look</p>
        {/if}
      </div>
      {#each ADMIN_GROUPS as group, index (group.key)}
        <DropdownMenu.Group>
          <!-- A5: group headings in muted ink, 6px above the first and 12px above the rest. -->
          <DropdownMenu.GroupHeading class={`px-2 pb-1 text-[11px] leading-4 text-ink-muted ${index === 0 ? "pt-1.5" : "pt-3"}`}>{group.label}</DropdownMenu.GroupHeading>
          {#each group.routes as route (route.href)}
            <DropdownMenu.Item class={item} data-admin-flyout-item={route.href} onSelect={() => go(route.href)}>
              <AdminRouteIcon icon={route.icon} />
              <span class="flex-1">{route.label}</span>
              {#if route.href === ADMIN_INGESTION_PATH && ingestionFailed > 0}
                <span class="text-xs leading-4 text-warning-ink-muted">{ingestionFailed} failed</span>
              {/if}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Group>
      {/each}
      <DropdownMenu.Separator data-admin-flyout-rule class="my-1.5 h-px bg-line-soft" />
      <DropdownMenu.Item class={item} data-admin-flyout-open onSelect={() => go(ADMIN_LANDING_PATH)}>
        <IconChevronRight size={15} strokeWidth={1.5} class="shrink-0 text-ink" />
        <span class="flex-1 text-ink">Open Admin</span>
        <KeyHint id="goAdmin" variant="inline" />
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
