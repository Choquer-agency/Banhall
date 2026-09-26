<script lang="ts">
  // J5 banner across the top of the accept page (48px, one centred row, 14px
  // text); J9 wraps it onto two lines on phones (12/20 padding, 13px then
  // 12px). The inviter avatar is 24px with 10px/500 initials on the banner
  // teal; "Join by" is the banner's muted teal. Dates are in the firm's time
  // zone.
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import { firmWeekdayDate } from "$lib/team/teamFormat";
  import type { Role } from "../../../../shared/roles";

  let {
    inviter,
    role,
    expiresAt,
  }: { inviter: { name: string; initials: string } | null; role: Role; expiresAt: number } = $props();

  const joinBy = $derived(`Join by ${firmWeekdayDate(expiresAt)}.`);
</script>

<div data-invite-banner class="flex w-full shrink-0 items-center gap-2.5 bg-workspace-page-icon px-5 py-3 sm:h-12 sm:justify-center sm:py-0">
  {#if inviter}
    <Avatar name={inviter.name} initials={inviter.initials} size={24} tone="invite" weight="medium" />
  {/if}
  <!-- Phones (J9): two lines, "invited you as". -->
  <div class="flex flex-col gap-1 sm:hidden">
    <p class="flex flex-wrap items-center gap-1.5 text-[13px] leading-[18px] text-fir">
      {inviter ? `${inviter.name} invited you as` : "You were invited as"}
      <RoleChip {role} />
    </p>
    <p data-invite-join-by class="text-xs leading-4 text-invite-banner-muted">{joinBy}</p>
  </div>
  <!-- Wider screens (J5): one centred row. -->
  <p class="hidden items-center gap-2.5 text-sm leading-5 text-fir sm:flex">
    {inviter ? `${inviter.name} invited you to join as` : "You were invited to join as"}
    <RoleChip {role} />
    <span data-invite-join-by class="text-invite-banner-muted">{joinBy}</span>
  </p>
</div>
