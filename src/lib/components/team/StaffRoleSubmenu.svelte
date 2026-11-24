<script lang="ts">
  // Admin submenu for setting a person's Banhall PD staff role (Technical
  // Manager, Technical Writer, Junior Technical Writer, Financial), which
  // supplies their default Brain quality weight when no custom weight is set.
  import { DropdownMenu } from "bits-ui";
  import { BriefcaseIcon } from "phosphor-svelte";
  import { IconCheck, IconChevronRight } from "$lib/components/icons";
  import { MENU_CONTENT, MENU_ITEM } from "./menuStyles";
  import {
    WRITER_STAFF_ROLES,
    WRITER_STAFF_ROLE_DEFAULT_WEIGHTS,
    WRITER_STAFF_ROLE_LABELS,
    writerWeightText,
    type WriterStaffRole,
  } from "../../../../shared/writerWeight";

  let {
    current = null,
    showDefaultWeights = false,
    onSelect,
  }: {
    current?: WriterStaffRole | null;
    /** Only Owner and Developer viewers see role default weights. */
    showDefaultWeights?: boolean;
    onSelect: (staffRole: WriterStaffRole | null) => void;
  } = $props();
</script>

<DropdownMenu.Sub>
  <DropdownMenu.SubTrigger
    data-menu-item="staff-role"
    class={`${MENU_ITEM} text-ink data-[state=open]:bg-workspace-rail-selected`}
  >
    <BriefcaseIcon size="0.9375rem" aria-hidden="true" class="shrink-0" />
    <span class="flex-1">PD role</span>
    <IconChevronRight size={12} strokeWidth={2} class="shrink-0 text-ink-muted" />
  </DropdownMenu.SubTrigger>
  <DropdownMenu.SubContent align="start" alignOffset={-5} sideOffset={12} class={`z-[110] w-64 ${MENU_CONTENT}`}>
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading class="px-2 pb-1 pt-1.5 text-xs leading-[calc(4/3)] text-ink-muted">
        PD staff role
      </DropdownMenu.GroupHeading>
      {#each WRITER_STAFF_ROLES as staffRole (staffRole)}
        {@const defaultWeight = WRITER_STAFF_ROLE_DEFAULT_WEIGHTS[staffRole]}
        <DropdownMenu.Item
          data-staff-role-choice={staffRole}
          aria-checked={staffRole === current}
          onSelect={() => onSelect(staffRole)}
          class="flex h-[2.125rem] cursor-default items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink outline-none data-[highlighted]:bg-primary-wash"
        >
          <span class="flex w-3.5 shrink-0 justify-center">
            {#if staffRole === current}
              <IconCheck size={14} strokeWidth={2.2} aria-label="Current PD role" aria-hidden="false" role="img" class="text-primary-selected" />
            {/if}
          </span>
          <span class="min-w-0 flex-1 truncate">{WRITER_STAFF_ROLE_LABELS[staffRole]}</span>
          {#if showDefaultWeights}
            <span class="shrink-0 text-xs tabular-nums text-ink-muted">
              {defaultWeight !== null ? writerWeightText(defaultWeight) : "No weight"}
            </span>
          {/if}
        </DropdownMenu.Item>
      {/each}
      {#if current !== null}
        <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
        <DropdownMenu.Item
          data-staff-role-choice="clear"
          onSelect={() => onSelect(null)}
          class="flex h-[2.125rem] cursor-default items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink-muted outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink"
        >
          <span class="w-3.5 shrink-0" aria-hidden="true"></span>
          <span>Clear PD role</span>
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Group>
  </DropdownMenu.SubContent>
</DropdownMenu.Sub>
