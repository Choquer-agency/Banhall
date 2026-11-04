<script lang="ts">
  /**
   * The Team section sidebar (the page frame, owner 2026-10-28; Paper S11):
   * Invite people for those who may invite, then People and Pending invites
   * with their counts. Both sit on the one Team page, so the rows jump to
   * their table; People is marked unless the address points at the invites.
   */
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import SectionSidebar from "../SectionSidebar.svelte";
  import SectionSidebarLink from "../SectionSidebarLink.svelte";
  import FrameIcon from "../FrameIcon.svelte";

  let {
    peopleCount = null,
    invitesCount = null,
    onInvite = null,
    inviteDisabled = false,
  }: {
    peopleCount?: number | null;
    invitesCount?: number | null;
    /** Null hides Invite people (no `invites.manage`). */
    onInvite?: (() => void) | null;
    /** The loading frame draws Invite people in its place before it can open. */
    inviteDisabled?: boolean;
  } = $props();

  const teamHref = `${resolve("/")}team`;
  const onInvites = $derived(page.url.hash === "#team-pending-invites");
</script>

<SectionSidebar
  section="team"
  title="Team"
  action={onInvite ? { label: "Invite people", onclick: onInvite, disabled: inviteDisabled } : null}
>
  <nav aria-label="Team" class="flex shrink-0 flex-col gap-0.5 pt-3">
    <SectionSidebarLink href={`${teamHref}#team-people`} label="People" data-team-sidebar="people" active={!onInvites} count={peopleCount}>
      {#snippet icon()}<FrameIcon name="people" />{/snippet}
    </SectionSidebarLink>
    <SectionSidebarLink
      href={`${teamHref}#team-pending-invites`}
      label="Pending invites"
      data-team-sidebar="invites"
      active={onInvites}
      count={invitesCount}
    >
      {#snippet icon()}<FrameIcon name="mail" />{/snippet}
    </SectionSidebarLink>
  </nav>
</SectionSidebar>
