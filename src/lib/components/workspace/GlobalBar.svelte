<script lang="ts">
  /**
   * The global bar (the page frame, owner 2026-10-28; Paper A1, S9 and S11):
   * 52px across the top of every desktop screen, on the gray page. The logo
   * at the left links Home; on the right, 6px apart, the bell opens What's
   * new with its unseen dot (owner answer 3) and the account button opens the
   * account menu below it. Below 1024px the shell hides it and each page bar
   * keeps its own hamburger and bell, as before.
   */
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { whatsNewLabel } from "$lib/shell/navigation";
  import BanhallLogo from "$lib/components/ui/BanhallLogo.svelte";
  import IdentityMenu from "$lib/components/shell/IdentityMenu.svelte";
  import { roleAvatarTone } from "$lib/components/ui/avatarTone";
  import { displayName } from "$lib/displayName";
  import { roleChipKind } from "$lib/roles/roleChip";
  import FrameIcon from "./FrameIcon.svelte";

  let { homeHref, class: className = "" }: { homeHref: string; class?: string } = $props();

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const user = $derived(userQ.data);
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);
  const userName = $derived(displayName(user, "Account"));
  // The menu's avatar keeps the person's own role colour (D3).
  const avatarTone = $derived(
    roleAvatarTone(
      roleChipKind({ role: user?.role ?? null, isOwner: user?.isOwner === true, isDeveloper: user?.isDeveloper === true })
    )
  );

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir";
</script>

<header data-global-bar class={`flex h-[3.25rem] min-w-0 shrink-0 items-center pl-3 pr-5 ${className}`}>
  <a
    href={homeHref}
    aria-label="Banhall home"
    data-global-bar-logo
    class={`flex shrink-0 items-center rounded-md pl-0.5 ${focusRing}`}
  >
    <BanhallLogo height={37} alt="" class="h-[2.3125rem] w-auto" />
  </a>
  <div class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
    <a
      href={resolve("/changelog")}
      data-global-bar-bell
      aria-label={whatsNewLabel(unseen)}
      class={`relative flex size-[1.875rem] shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-frame-tile hover:text-ink ${focusRing} motion-reduce:transition-none`}
    >
      <FrameIcon name="bell" />
      {#if unseen > 0}
        <span aria-hidden="true" data-global-bar-bell-dot class="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary"></span>
      {/if}
    </a>
    <IdentityMenu
      name={userName}
      email={user?.email ?? null}
      imageUrl={user?.imageUrl ?? null}
      seed={user?._id}
      tone={avatarTone}
      isDeveloper={user?.isDeveloper === true}
      placement="below"
    >
      {#snippet trigger({ props, open })}
        <button
          {...props}
          type="button"
          data-global-bar-account
          aria-label={`${userName}, account menu`}
          class={`flex h-[1.875rem] min-w-0 items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-left transition-colors ${focusRing} motion-reduce:transition-none ${open ? "bg-frame-tile" : "hover:bg-frame-tile"}`}
        >
          <span data-global-bar-account-name class="min-w-0 truncate text-[0.8125rem] font-medium leading-[calc(18/13)] text-ink">{userName}</span>
          <FrameIcon name="chevron-down" class="text-ink-muted" />
        </button>
      {/snippet}
    </IdentityMenu>
  </div>
</header>
