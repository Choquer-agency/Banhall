<!-- Avatar account menu in app bars (the workspace rail uses shell/IdentityMenu). -->
<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { signOutLocally } from "$lib/shell/signOut";
  import { api } from "../../../../convex/_generated/api";
  import { displayName } from "$lib/displayName";
  import { GearSixIcon, SignOutIcon } from "phosphor-svelte";
  import { toast } from "svelte-sonner";

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const user = $derived(userQ.data);

  const label = $derived(displayName(user, ""));
  const initials = $derived.by(() => {
    if (user?.firstName || user?.lastName) {
      return (
        ((user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")).toUpperCase() || "?"
      );
    }
    const name = user?.name?.trim();
    if (name) {
      const parts = name.split(/\s+/);
      return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
    }
    return user?.email?.[0]?.toUpperCase() ?? "?";
  });

  let {
    tone = "dark",
    menuTheme = "light",
    menuLayer = "app",
  }: {
    tone?: "dark" | "light";
    /** Portaled menu surface theme — "dark" keeps it inside the workspace dark scope. */
    menuTheme?: "light" | "dark";
    /**
     * Portaled surface layer. Drawer menus must clear the modal drawer
     * (z-110) while remaining managed by the dialog/dropdown focus scopes.
     */
    menuLayer?: "app" | "drawer";
  } = $props();

  let open = $state(false);
  let signingOut = $state(false);

  async function handleSignOut() {
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
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger
    aria-label="Account menu"
    class={`flex h-11 w-11 items-center justify-center rounded-full text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:h-8 md:w-8 ${
      tone === "light"
        ? open
          ? "bg-navy text-white"
          : "bg-chrome text-navy hover:bg-primary-wash"
        : open
          ? "bg-white text-navy"
          : "bg-white/15 text-white hover:bg-white/25"
    }`}
  >
    {initials}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      data-workspace-theme={menuTheme === "dark" ? "dark" : undefined}
      side="bottom"
      align="end"
      sideOffset={8}
      preventScroll={false}
      data-menu-layer={menuLayer}
      class={`${menuLayer === "drawer" ? "z-[130]" : "z-[80]"} w-56 overflow-hidden rounded-lg border border-line bg-surface shadow-lg`}
    >
      <div data-account-menu-identity class="flex items-center gap-2.5 border-b border-line-soft px-3.5 py-3">
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-chrome text-[0.6875rem] font-semibold text-fir">{initials}</span>
        <p class="min-w-0 truncate text-sm font-semibold text-ink">{label || "Account"}</p>
      </div>
      <div>
      <DropdownMenu.Item
        onSelect={() => goto(resolve("/settings")).catch(() => toast.error("Settings could not open. Please try again."))}
        class="flex h-11 min-h-11 w-full shrink-0 items-center gap-2.5 px-3.5 text-left text-sm text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:bg-primary-wash focus-visible:text-ink focus-visible:outline-none"
      >
        <GearSixIcon size={16} weight="regular" aria-hidden="true" class="shrink-0" />
        Settings
      </DropdownMenu.Item>
      <DropdownMenu.Item
        onSelect={handleSignOut}
        disabled={signingOut}
        class="flex h-11 min-h-11 w-full shrink-0 items-center gap-2.5 px-3.5 text-left text-sm text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600 focus-visible:outline-none data-[disabled]:opacity-50"
      >
        <SignOutIcon size={16} weight="regular" aria-hidden="true" class="shrink-0" />
        {signingOut ? "Signing out…" : "Sign out"}
      </DropdownMenu.Item>
      </div>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
