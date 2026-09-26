<script lang="ts">
  /**
   * D1 identity menu, opened from the rail identity row (expanded: above the
   * row; collapsed: to the right of the avatar). Account, View as another
   * role (developers only, decision 53), Flag an issue (everyone, decision
   * 53), then Sign out. Sign out follows the board: no confirm step.
   */
  import type { Snippet } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { EyeIcon, FlagIcon, SignOutIcon, UserIcon } from "phosphor-svelte";
  import { toast } from "svelte-sonner";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import KeyHint from "$lib/components/shell/KeyHint.svelte";
  import { signOutLocally } from "$lib/shell/signOut";
  import { viewAs } from "$lib/shell/viewAs.svelte";

  let {
    name,
    email = null,
    imageUrl = null,
    seed = undefined,
    isDeveloper = false,
    placement = "above",
    layer = "app",
    onNavigate = undefined,
    trigger,
  }: {
    name: string;
    email?: string | null;
    imageUrl?: string | null;
    seed?: string;
    /** The real developer flag (View as never hides its own way back). */
    isDeveloper?: boolean;
    placement?: "above" | "right";
    layer?: "app" | "drawer";
    onNavigate?: () => void;
    trigger: Snippet<[{ props: Record<string, unknown>; open: boolean }]>;
  } = $props();

  let open = $state(false);
  let signingOut = $state(false);

  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    open = false;
    try {
      await signOutLocally();
    } catch (error) {
      console.error("Sign-out failed", error);
      toast.error("Sign-out failed. Check your connection and try again.");
    } finally {
      signingOut = false;
    }
  }

  const item =
    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] leading-[19px] text-ink-secondary outline-none transition-colors data-highlighted:bg-chrome data-highlighted:text-ink motion-reduce:transition-none pointer-coarse:h-11";
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      {@render trigger({ props, open })}
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      data-identity-menu
      side={placement === "above" ? "top" : "right"}
      align={placement === "above" ? "start" : "end"}
      sideOffset={6}
      preventScroll={false}
      class={`${layer === "drawer" ? "z-[130]" : "z-[80]"} w-[252px] rounded-xl border border-line bg-surface p-1.5 shadow-menu`}
    >
      <div data-identity-menu-header class="flex items-center gap-2.5 p-2">
        <Avatar {name} {imageUrl} {seed} size={32} />
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="truncate text-[13px] font-medium leading-[18px] text-ink">{name}</p>
          {#if email}<p class="truncate text-xs leading-4 text-ink-muted">{email}</p>{/if}
        </div>
      </div>
      <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
      <DropdownMenu.Item
        class={item}
        onSelect={() => {
          onNavigate?.();
          void goto(resolve("/settings/account"));
        }}
      >
        <UserIcon size={15} aria-hidden="true" class="shrink-0" />
        <span class="flex-1">Account</span>
      </DropdownMenu.Item>
      {#if isDeveloper}
        <DropdownMenu.Item
          class={item}
          data-identity-view-as
          onSelect={() => {
            onNavigate?.();
            viewAs.dialogOpen = true;
          }}
        >
          <EyeIcon size={15} aria-hidden="true" class="shrink-0" />
          <span class="flex-1">View as another role</span>
          <KeyHint id="viewAs" variant="inline" />
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item
        class={item}
        data-identity-flag-issue
        onSelect={() => {
          onNavigate?.();
          window.dispatchEvent(new CustomEvent("banhall:flag-issue"));
        }}
      >
        <FlagIcon size={15} aria-hidden="true" class="shrink-0" />
        <span class="flex-1">Flag an issue</span>
      </DropdownMenu.Item>
      <DropdownMenu.Separator class="my-1 h-px bg-line-soft" />
      <DropdownMenu.Item class={item} disabled={signingOut} onSelect={signOut}>
        <SignOutIcon size={15} aria-hidden="true" class="shrink-0" />
        <span class="flex-1">{signingOut ? "Signing out..." : "Sign out"}</span>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
