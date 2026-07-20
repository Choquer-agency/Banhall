<!--
  Avatar + account menu (app bar, right edge). Initials chip opens a dropdown:
  identity header, Settings, admin section (admins only), sign out. This is
  the ONE home for account/admin navigation — pages never render their own
  settings/sign-out links in the bar.
-->
<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { authClient } from "$lib/authClient";
  import { api } from "../../../../convex/_generated/api";
  import { displayName } from "$lib/displayName";

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const user = $derived(userQ.data);
  const isAdmin = $derived(user?.role === "admin");

  const ROLE_LABELS: Record<string, string> = {
    admin: "Admin",
    manager: "Manager",
    writer: "Consultant",
  };

  const ADMIN_ROUTES = [
    { href: "/admin/brain", label: "The Brain" },
    { href: "/admin/tags", label: "Project tags" },
    { href: "/admin/reviews", label: "Consultant QA reviews" },
    { href: "/admin/users", label: "Users & roles" },
    { href: "/admin/models", label: "Model preferences" },
    { href: "/admin/usage", label: "AI usage & cost" },
  ] as const;

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

  let open = $state(false);
  let signingOut = $state(false);

  async function handleSignOut() {
    if (signingOut) return;
    signingOut = true;
    try {
      await authClient.signOut();
      goto("/login", { replaceState: true });
    } finally {
      signingOut = false;
    }
  }

  const itemClass =
    "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink-secondary transition-colors hover:bg-primary-wash hover:text-navy focus-visible:bg-primary-wash focus-visible:outline-none";
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger
    aria-label="Account menu"
    class={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light ${
      open ? "bg-white text-navy" : "bg-white/15 text-white hover:bg-white/25"
    }`}
  >
    {initials}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      side="bottom"
      align="end"
      sideOffset={8}
      preventScroll={false}
      class="z-[80] w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
    >
      <!-- Identity header -->
      <div class="border-b border-gray-100 px-3.5 py-3">
        <p class="truncate text-sm font-semibold text-ink">{label || "—"}</p>
        <p class="mt-0.5 flex items-center gap-2">
          <span class="min-w-0 truncate text-xs text-ink-muted">{user?.email ?? ""}</span>
          {#if user?.role}
            <span class="flex-shrink-0 rounded-full bg-chrome px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          {/if}
        </p>
      </div>

      <div>
        <DropdownMenu.Item onSelect={() => goto("/settings")} class={itemClass}>
          <svg class="h-4 w-4 flex-shrink-0 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </DropdownMenu.Item>
      </div>

      {#if isAdmin}
        <div class="border-t border-gray-100" role="group" aria-label="Administration">
          <p class="text-label px-3.5 pb-1 pt-2">Administration</p>
          {#each ADMIN_ROUTES as route (route.href)}
            <DropdownMenu.Item onSelect={() => goto(route.href)} class={itemClass}>
              {route.label}
            </DropdownMenu.Item>
          {/each}
        </div>
      {/if}

      <div class="border-t border-gray-100">
        <DropdownMenu.Item
          onSelect={handleSignOut}
          disabled={signingOut}
          class="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:bg-red-50 focus-visible:text-red-600 focus-visible:outline-none data-[disabled]:opacity-50"
        >
          <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-7.5A2.25 2.25 0 003.75 5.25v13.5A2.25 2.25 0 006 21h7.5a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenu.Item>
      </div>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
