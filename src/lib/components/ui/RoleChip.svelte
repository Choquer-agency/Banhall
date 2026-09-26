<script lang="ts">
  import type { Role } from "../../../../shared/roles";
  import { ROLE_CHIP_LABELS, roleChipKind, type RoleChipKind } from "$lib/roles/roleChip";

  /**
   * Round 2 role chip (HANDOFF "Global rules added this round"). Pass the
   * stored role plus the Owner and Developer display flags, or a resolved
   * `kind`. "md" is the 20px chip of the Team table, invite screens and View
   * as; "sm" is the 16px chip under the name in the rail identity row.
   */
  let {
    role = null,
    isOwner = false,
    isDeveloper = false,
    kind = undefined,
    size = "md",
    label = undefined,
    radius = undefined,
    class: className = "",
  }: {
    role?: Role | null;
    isOwner?: boolean;
    isDeveloper?: boolean;
    kind?: RoleChipKind;
    size?: "md" | "sm";
    /** Replaces the role name, keeping the role's colours ("Viewing as Consultant", D3). */
    label?: string;
    /** Corner radius in px when a board differs from the size's default (4 in the C3 role cards and C4 role menu). */
    radius?: number;
    class?: string;
  } = $props();

  const resolved = $derived(kind ?? roleChipKind({ role, isOwner, isDeveloper }));

  const toneStyles: Record<RoleChipKind, string> = {
    owner: "bg-role-owner text-role-owner-ink",
    admin: "bg-role-admin text-role-admin-ink",
    manager: "bg-role-manager text-role-manager-ink",
    consultant: "bg-role-consultant text-role-consultant-ink",
    developer: "bg-role-developer text-role-developer-ink",
  };

  const sizeStyles = {
    md: "h-5 rounded-[5px] px-[7px] text-xs leading-4",
    sm: "h-4 rounded-[4px] px-[5px] text-[10px] leading-[14px]",
  } as const;
</script>

{#if resolved}
  <span
    data-role-chip={resolved}
    class={`inline-flex shrink-0 items-center whitespace-nowrap font-medium ${sizeStyles[size]} ${toneStyles[resolved]} ${className}`}
    style:border-radius={radius === undefined ? undefined : `${radius}px`}
  >
    {label ?? ROLE_CHIP_LABELS[resolved]}
  </span>
{/if}
