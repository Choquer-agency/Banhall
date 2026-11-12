<!--
  A file row's "..." menu on To review (board ao5), at the row's end, shown
  on hover and on keyboard focus: Move to another category (the six), Move
  to another company (the companies on the sheet, or a new name, in a
  picker that opens from the same button) and Delete. A file still being
  read cannot be deleted yet; the menu says so. "Open the file" comes with
  the file panel.
-->
<script lang="ts">
  import { DropdownMenu, Popover } from "bits-ui";
  import { BuildingsIcon, CaretRightIcon, CheckIcon, DotsThreeIcon, TagIcon, TrashIcon } from "phosphor-svelte";
  import ImportCompanyList from "./ImportCompanyList.svelte";
  import { MOVE_CATEGORIES } from "./importEdit";
  import type { ImportCategory } from "./importFormat";
  import { POPOVER_CARD, SHEET_SMALL } from "./sheetLayout";

  let {
    name,
    category,
    company = null,
    canDelete,
    onCategory,
    onCompany,
    onDelete,
  }: {
    /** The file, for the button's name. */
    name: string;
    category: ImportCategory;
    /** The company the file is in now. */
    company?: string | null;
    canDelete: boolean;
    onCategory: (category: ImportCategory) => void;
    onCompany: (name: string) => void;
    onDelete: () => void;
  } = $props();

  let menuOpen = $state(false);
  let companyOpen = $state(false);
  let button = $state<HTMLElement | null>(null);
  // Set when "Move to another company" is chosen: the company picker opens
  // once the menu has closed, so focus goes into the picker, not back here.
  let toCompany = false;

  const MENU_ITEM =
    "flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink data-[disabled]:opacity-50 pointer-coarse:min-h-11";
</script>

<DropdownMenu.Root bind:open={menuOpen}>
  <DropdownMenu.Trigger
    bind:ref={button}
    aria-label={`More for ${name}`}
    data-import-row-menu
    class={`relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-[opacity,background-color] hover:bg-gray-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir data-[state=open]:bg-primary-wash data-[state=open]:text-ink motion-reduce:transition-none pointer-coarse:size-11 ${
      companyOpen || menuOpen
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
        if (!toCompany) return;
        toCompany = false;
        event.preventDefault();
        companyOpen = true;
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
      <DropdownMenu.Item onSelect={() => (toCompany = true)} data-import-row-action="company" class={MENU_ITEM}>
        <BuildingsIcon size="0.875rem" aria-hidden="true" class="shrink-0" />
        Move to another company
      </DropdownMenu.Item>
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
