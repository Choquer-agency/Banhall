<!--
  A file row's "..." menu on To review (board ao5), at the row's end, shown
  on hover and on keyboard focus, and marked `data-import-row-menu-active`
  while it or its company picker is open (the row keeps room for it then,
  sheetLayout ROW_MENU_ROOM): Move to another category (the six), Move
  to another company (the companies on the sheet, or a new name, in a
  picker that opens from the same button) and Delete. A file still being
  read cannot be deleted yet; the menu says so. "Open the file" comes with
  the file panel. On a final PD (2026-11-17) it also marks the file as
  reviewed by CRA, or clears that mark, by hand.

  On a read final PD, draft or review copy (Greptile fix, 2026-11-17) the
  menu also sets the PD number, in a picker that opens from the same button
  the way the company picker does, so a missing or wrong number can be put
  right whether or not the file name gave one.
-->
<script lang="ts">
  import { DropdownMenu, Popover } from "bits-ui";
  import { BuildingsIcon, CaretRightIcon, CheckIcon, DotsThreeIcon, HashIcon, SealCheckIcon, TagIcon, TrashIcon } from "phosphor-svelte";
  import ImportCompanyList from "./ImportCompanyList.svelte";
  import ImportPdNumberList from "./ImportPdNumberList.svelte";
  import { MOVE_CATEGORIES } from "./importEdit";
  import type { ImportCategory } from "./importFormat";
  import { POPOVER_CARD, SHEET_SMALL } from "./sheetLayout";

  let {
    name,
    category,
    company = null,
    canDelete,
    pdNumber = null,
    canPdNumber = false,
    craReviewed = null,
    onCategory,
    onCompany,
    onPdNumber,
    onCra,
    onDelete,
  }: {
    /** The file, for the button's name. */
    name: string;
    category: ImportCategory;
    /** The company the file is in now. */
    company?: string | null;
    canDelete: boolean;
    /** The file's PD number now. */
    pdNumber?: string | null;
    /** The menu offers "Set the PD number" (rowAbilities). */
    canPdNumber?: boolean;
    /** Whether the file is marked as reviewed by CRA; null when the mark does not go on it. */
    craReviewed?: boolean | null;
    onCategory: (category: ImportCategory) => void;
    onCompany: (name: string) => void;
    onPdNumber?: (pdNumber: string) => void;
    /** Sets (true) or clears (false) the CRA mark. */
    onCra?: (reviewed: boolean) => void;
    onDelete: () => void;
  } = $props();

  let menuOpen = $state(false);
  let companyOpen = $state(false);
  let pdNumberOpen = $state(false);
  let button = $state<HTMLElement | null>(null);
  // Set when "Move to another company" or "Set the PD number" is chosen: its
  // picker opens once the menu has closed, so focus goes into the picker, not
  // back here.
  let opening: "company" | "pdNumber" | null = null;
  const pickerOpen = $derived(companyOpen || pdNumberOpen);

  const MENU_ITEM =
    "flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink data-[disabled]:opacity-50 pointer-coarse:min-h-11";
</script>

<DropdownMenu.Root bind:open={menuOpen}>
  <DropdownMenu.Trigger
    bind:ref={button}
    aria-label={`More for ${name}`}
    data-import-row-menu
    data-import-row-menu-active={pickerOpen || menuOpen ? "" : undefined}
    class={`relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-[opacity,background-color] hover:bg-gray-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-primary-wash data-[state=open]:text-ink motion-reduce:transition-none pointer-coarse:size-11 ${
      pickerOpen || menuOpen
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
        if (!opening) return;
        const next = opening;
        opening = null;
        event.preventDefault();
        if (next === "company") companyOpen = true;
        else pdNumberOpen = true;
      }}
      class="z-[100] w-[16.5rem] rounded-lg border border-line bg-surface p-1 shadow-menu outline-none"
      data-import-row-menu-content
    >
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger class={`${MENU_ITEM} data-[state=open]:bg-primary-wash`} data-import-row-action="category">
          <TagIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
          <span class="flex-1">Move to another category</span>
          <CaretRightIcon size="0.75rem" aria-hidden="true" class="shrink-0 text-ink-muted" />
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent sideOffset={6} collisionPadding={12} class="z-[110] w-[12.5rem] rounded-lg border border-line bg-surface p-1 shadow-menu outline-none">
          {#each MOVE_CATEGORIES as entry (entry.category)}
            <DropdownMenu.Item
              disabled={entry.category === category}
              onSelect={() => onCategory(entry.category)}
              data-import-move-category={entry.category}
              class={MENU_ITEM}
            >
              <span class="flex-1">{entry.label}</span>
              {#if entry.category === category}<CheckIcon size="0.875rem" aria-label="Now" class="shrink-0 text-primary-selected" />{/if}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
      <DropdownMenu.Item onSelect={() => (opening = "company")} data-import-row-action="company" class={MENU_ITEM}>
        <BuildingsIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
        Move to another company
      </DropdownMenu.Item>
      {#if canPdNumber}
        <DropdownMenu.Item onSelect={() => (opening = "pdNumber")} data-import-row-action="pd-number" class={MENU_ITEM}>
          <HashIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
          <span class="flex-1">{pdNumber ? "Change the PD number" : "Set the PD number"}</span>
          {#if pdNumber}<span class={`shrink-0 ${SHEET_SMALL} text-ink-muted`}>PD {pdNumber}</span>{/if}
        </DropdownMenu.Item>
      {/if}
      {#if craReviewed !== null && onCra}
        <DropdownMenu.Item onSelect={() => onCra?.(!craReviewed)} data-import-row-action="cra" class={MENU_ITEM}>
          <SealCheckIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
          {craReviewed ? 'Clear "Reviewed by CRA"' : "Mark as reviewed by CRA"}
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator class="-mx-1 my-1 h-px bg-line-soft" />
      <DropdownMenu.Item
        disabled={!canDelete}
        onSelect={onDelete}
        data-import-row-action="delete"
        class={`${MENU_ITEM} text-danger-ink-muted data-[highlighted]:bg-danger-surface data-[highlighted]:text-danger-ink-muted`}
      >
        <TrashIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
        Delete
      </DropdownMenu.Item>
      {#if !canDelete}
        <p class={`px-2.5 pb-1.5 ${SHEET_SMALL} text-ink-muted`}>It can be deleted once it is read.</p>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<Popover.Root bind:open={companyOpen}>
  <Popover.Portal>
    <Popover.Content
      customAnchor={button}
      side="bottom"
      align="end"
      sideOffset={6}
      collisionPadding={12}
      aria-label="Move to another company"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        button?.focus();
      }}
      class={`${POPOVER_CARD} w-[17.5rem] max-w-[calc(100vw-1.5rem)] overflow-hidden`}
      data-import-company-picker
    >
      <ImportCompanyList
        current={company}
        onPick={(next) => {
          companyOpen = false;
          if (next !== company) onCompany(next);
        }}
      />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<Popover.Root bind:open={pdNumberOpen}>
  <Popover.Portal>
    <Popover.Content
      customAnchor={button}
      side="bottom"
      align="end"
      sideOffset={6}
      collisionPadding={12}
      aria-label="PD number"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        button?.focus();
      }}
      class={`${POPOVER_CARD} w-[17.5rem] max-w-[calc(100vw-1.5rem)] overflow-hidden`}
      data-import-pd-number-picker
    >
      <ImportPdNumberList
        current={pdNumber}
        onPick={(next) => {
          pdNumberOpen = false;
          if (next !== pdNumber) onPdNumber?.(next);
        }}
      />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
