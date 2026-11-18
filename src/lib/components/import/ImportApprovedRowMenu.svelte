<!--
  An approved file's "..." menu on the Approved tab (2026-11-17,
  docs/product-domain.md), at the row's end, shown on hover and on keyboard
  focus like the To review row menu: Open (the file view), on a final PD
  "Mark as reviewed by CRA" or 'Clear "Reviewed by CRA"', then Send back to
  review, which opens the confirm (ImportSendBackConfirm) under the same
  button once the menu has closed, so focus goes into it. Nothing here
  moves a file to another company, kind or fiscal year.
-->
<script lang="ts">
  import { DropdownMenu, Popover } from "bits-ui";
  import { ArrowUUpLeftIcon, DotsThreeIcon, FileTextIcon, SealCheckIcon } from "phosphor-svelte";
  import ImportSendBackConfirm from "./ImportSendBackConfirm.svelte";
  import { CLEAR_CRA_REVIEWED, MARK_CRA_REVIEWED } from "./importApproved";
  import { POPOVER_CARD } from "./sheetLayout";

  let {
    name,
    canMarkCra,
    craReviewed,
    busy = false,
    onOpen,
    onCra,
    onSendBack,
  }: {
    /** The file, for the button's name. */
    name: string;
    /** A final PD: the "Reviewed by CRA" item shows. */
    canMarkCra: boolean;
    craReviewed: boolean;
    busy?: boolean;
    /** Opens the file view; absent outside the page. */
    onOpen?: () => void;
    onCra: (value: boolean) => void;
    onSendBack: () => void;
  } = $props();

  let menuOpen = $state(false);
  let confirmOpen = $state(false);
  let button = $state<HTMLElement | null>(null);
  // Set when an item that opens something else is chosen: it opens once the
  // menu has given focus back to this button.
  let next: "open" | "confirm" | null = null;

  const MENU_ITEM =
    "flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink data-[disabled]:opacity-50 pointer-coarse:min-h-11";
</script>

<DropdownMenu.Root bind:open={menuOpen}>
  <DropdownMenu.Trigger
    bind:ref={button}
    aria-label={`More for ${name}`}
    data-import-row-menu
    data-import-approved-menu
    data-import-row-menu-active={confirmOpen || menuOpen ? "" : undefined}
    class={`relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-[opacity,background-color] hover:bg-gray-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-primary-wash data-[state=open]:text-ink motion-reduce:transition-none pointer-coarse:size-11 ${
      confirmOpen || menuOpen
        ? "bg-primary-wash text-ink"
        : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
    }`}
  >
    <DotsThreeIcon size="1rem" weight="bold" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      side="bottom"
      align="end"
      sideOffset={6}
      collisionPadding={12}
      onCloseAutoFocus={(event) => {
        const then = next;
        next = null;
        if (then === "open") {
          setTimeout(() => onOpen?.(), 0);
          return;
        }
        if (then === "confirm") {
          event.preventDefault();
          confirmOpen = true;
        }
      }}
      class="z-[100] w-[16.5rem] rounded-lg border border-line bg-surface p-1 shadow-menu outline-none"
      data-import-row-menu-content
    >
      {#if onOpen}
        <DropdownMenu.Item onSelect={() => (next = "open")} data-import-row-action="open" class={MENU_ITEM}>
          <FileTextIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
          Open
        </DropdownMenu.Item>
      {/if}
      {#if canMarkCra}
        <DropdownMenu.Item disabled={busy} onSelect={() => onCra(!craReviewed)} data-import-row-action="cra" class={MENU_ITEM}>
          <SealCheckIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
          {craReviewed ? CLEAR_CRA_REVIEWED : MARK_CRA_REVIEWED}
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator class="-mx-1 my-1 h-px bg-line-soft" />
      <DropdownMenu.Item disabled={busy} onSelect={() => (next = "confirm")} data-import-row-action="send-back" class={MENU_ITEM}>
        <ArrowUUpLeftIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
        Send back to review
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<Popover.Root bind:open={confirmOpen}>
  <Popover.Portal>
    <Popover.Content
      customAnchor={button}
      side="bottom"
      align="end"
      sideOffset={6}
      collisionPadding={12}
      aria-label="Send back to review"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (button?.isConnected) button.focus();
      }}
      class={`${POPOVER_CARD} w-[20rem] max-w-[calc(100vw-1.5rem)] p-3`}
      data-import-row-send-back
    >
      <ImportSendBackConfirm
        count={1}
        {busy}
        onConfirm={() => {
          confirmOpen = false;
          onSendBack();
        }}
      />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
