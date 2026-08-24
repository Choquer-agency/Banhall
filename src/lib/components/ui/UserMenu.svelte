<!-- Avatar account menu in app bars; confirmed sign-out action in the workspace rail. -->
<script lang="ts">
  import { Dialog, DropdownMenu } from "bits-ui";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { authClient } from "$lib/authClient";
  import { clearAllOutboxes } from "$lib/uploads/attemptOutbox";
  import { api } from "../../../../convex/_generated/api";
  import { displayName } from "$lib/displayName";
  import { SignOutIcon } from "phosphor-svelte";
  import { toast } from "svelte-sonner";
  import { modalPop, overlayFade } from "$lib/motion";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";

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

{#if triggerVariant === "rail"}
  <Dialog.Root bind:open>
    <Tooltip text="Sign out" side="top" delayDuration={300}>
      {#snippet children({ props })}
        <Dialog.Trigger
          {...props}
          aria-label="Sign out"
          data-user-menu-rail
          class="flex size-11 shrink-0 items-center justify-center rounded-r-md text-ink-muted transition-colors duration-150 ease-out hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none md:size-9"
        >
          <SignOutIcon size={16} weight="regular" aria-hidden="true" />
        </Dialog.Trigger>
      {/snippet}
    </Tooltip>
    <Dialog.Portal>
      <Dialog.Overlay forceMount>
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:overlayFade
              class={`${menuLayer === "drawer" ? "z-[130]" : "z-[110]"} fixed inset-0 bg-navy/35`}
            ></div>
          {/if}
        {/snippet}
      </Dialog.Overlay>
      <div class={`${menuLayer === "drawer" ? "z-[130]" : "z-[110]"} pointer-events-none fixed inset-0 flex items-end p-0 sm:items-center sm:justify-center sm:p-4`}>
        <Dialog.Content
          forceMount
          onEscapeKeydown={(event) => {
            if (signingOut) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (signingOut) event.preventDefault();
          }}
        >
          {#snippet child({ props, open: isOpen })}
            {#if isOpen}
              <div
                {...props}
                transition:modalPop
                class="pointer-events-auto w-full rounded-t-xl border border-line bg-surface p-5 shadow-xl sm:max-w-sm sm:rounded-xl"
              >
                <Dialog.Title class="text-title">Sign out?</Dialog.Title>
                <Dialog.Description class="mt-1.5 text-sm leading-relaxed text-ink-secondary">
                  You’ll need to sign in again to access your Banhall workspace.
                </Dialog.Description>
                <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Dialog.Close
                    disabled={signingOut}
                    class="min-h-11 rounded-lg px-4 text-sm font-medium text-ink-secondary transition-colors hover:bg-workspace-rail-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-50"
                  >
                    Stay signed in
                  </Dialog.Close>
                  <button
                    type="button"
                    disabled={signingOut}
                    onclick={handleSignOut}
                    class="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"
                  >
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              </div>
            {/if}
          {/snippet}
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  </Dialog.Root>
{:else}
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
{/if}
