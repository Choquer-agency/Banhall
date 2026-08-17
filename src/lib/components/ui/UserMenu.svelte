<!-- Avatar account menu in app bars; Settings launcher in the workspace rail. -->
<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { authClient } from "$lib/authClient";
  import { clearAllOutboxes } from "$lib/uploads/attemptOutbox";
  import { api } from "../../../../convex/_generated/api";
  import { displayName } from "$lib/displayName";
  import { CaretUpDownIcon, GearSixIcon, SignOutIcon } from "phosphor-svelte";
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
    triggerVariant = "avatar",
  }: {
    tone?: "dark" | "light";
    /** Portaled menu surface theme — "dark" keeps it inside the workspace dark scope. */
    menuTheme?: "light" | "dark";
    /**
     * Portaled surface layer. Drawer menus must clear the modal drawer
     * (z-110) while remaining managed by the dialog/dropdown focus scopes.
     */
    menuLayer?: "app" | "drawer";
    /** Full-width Attio-style identity row inside the workspace rail. */
    triggerVariant?: "avatar" | "rail";
  } = $props();

  let open = $state(false);
  let signingOut = $state(false);

  function openSettings() {
    open = false;
    void goto(resolve("/settings"));
  }

  async function handleSignOut() {
    if (signingOut) return;
    signingOut = true;
    open = false;
    try {
      await authClient.signOut();
      // The next person on this browser must not inherit queued upload failures:
      // they would be recorded against whoever signs in next.
      clearAllOutboxes();
      // Use one client-side navigation after the session cookie is cleared.
      // The stable login shell remains mounted through auth propagation, so a
      // full document reload cannot flash the brand panel or restart the page.
      await goto(resolve("/login"), { replaceState: true, invalidateAll: true });
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
    aria-label={triggerVariant === "rail" ? "Settings menu" : "Account menu"}
    data-user-menu-rail={triggerVariant === "rail" ? "" : undefined}
    class={triggerVariant === "rail"
      ? `flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-ink transition-colors hover:bg-workspace-rail-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir md:h-9 ${open ? "bg-workspace-rail-selected" : ""}`
      : `flex h-11 w-11 items-center justify-center rounded-full text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:h-8 md:w-8 ${
          tone === "light"
            ? open
              ? "bg-navy text-white"
              : "bg-chrome text-navy hover:bg-primary-wash"
            : open
              ? "bg-white text-navy"
              : "bg-white/15 text-white hover:bg-white/25"
        }`}
  >
    {#if triggerVariant === "rail"}
      <GearSixIcon size={16} weight="regular" aria-hidden="true" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate">Settings</span>
      <CaretUpDownIcon size={14} weight="regular" aria-hidden="true" class="text-ink-muted" />
    {:else}
      {initials}
    {/if}
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
      {#if triggerVariant === "avatar"}
        <div data-account-menu-identity class="flex items-center gap-2.5 border-b border-line-soft px-3.5 py-3">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-chrome text-[0.6875rem] font-semibold text-fir">{initials}</span>
          <p class="min-w-0 truncate text-sm font-semibold text-ink">{label || "Account"}</p>
        </div>
      {/if}
      <div>
        {#if triggerVariant === "rail"}
          <DropdownMenu.Item
            onSelect={openSettings}
            class="flex h-11 min-h-11 w-full shrink-0 items-center gap-2.5 px-3.5 text-left text-sm font-medium text-ink transition-colors hover:bg-workspace-rail-hover focus-visible:bg-workspace-rail-hover focus-visible:outline-none"
          >
            <GearSixIcon size={16} weight="regular" aria-hidden="true" class="shrink-0" />
            Open Settings
          </DropdownMenu.Item>
        {/if}
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
