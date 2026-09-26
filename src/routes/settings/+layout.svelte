<script lang="ts">
  // Settings shell: auth guard + one chrome for every /settings/* page.
  // Sections are real routes; this layout owns the round 2 tabs (workspace
  // experience, I1 to I5: full width, no sub-rail) or the inline nav column
  // (current experience) and the child page owns only its own content.
  import type { Snippet } from "svelte";
  import { goToLogin } from "$lib/auth/goToLogin";
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import PageContainer from "$lib/components/ui/PageContainer.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";
  import SettingsTabs from "$lib/components/settings/SettingsTabs.svelte";
  import { IconGear } from "$lib/components/icons";
  import { SETTINGS_SECTIONS, settingsSectionForPath } from "$lib/settings/sections";

  let { children: pageContent }: { children: Snippet } = $props();

  const auth = useAuth();
  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goToLogin();
    }
  });

  const links = SETTINGS_SECTIONS.map((s) => ({ ...s, href: resolve(s.path) }));
  const active = $derived(settingsSectionForPath(page.url.pathname));
</script>

{#snippet sectionNav()}
  <!-- Current-experience nav column. Scrolls horizontally only below md; the
       scroll box gets inner padding so focus rings are not clipped. -->
  <nav aria-label="Settings sections" class="md:sticky md:top-4">
    <ul class="flex gap-1 max-md:-my-1 max-md:overflow-x-auto max-md:py-1 md:flex-col md:gap-px">
      {#each links as item (item.key)}
        {@const current = active.key === item.key}
        <li>
          <a
            href={item.href}
            aria-current={current ? "page" : undefined}
            class={`flex h-8 w-full items-center whitespace-nowrap rounded-md px-2.5 text-left text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none ${
              current
                ? "bg-workspace-rail-selected text-ink"
                : "text-ink-secondary hover:bg-workspace-rail-hover hover:text-ink"
            }`}
          >
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <WorkspaceGate currentWhileLoading={false}>
    {#snippet current()}
      <div class="flex flex-1 flex-col bg-canvas">
        <AppNav breadcrumbs={[{ label: "Settings" }, { label: active.label }]} />
        <PageBar backHref="/dashboard" backLabel="Back" />
        <PageContainer>
          <h1 class="text-display">Settings</h1>
          <p class="mt-1 max-w-2xl text-sm text-ink-muted">
            Your name, your password, and how Banhall writes your reports.
          </p>
          <div class="mt-8 grid items-start gap-8 md:grid-cols-[11.5rem_minmax(0,1fr)]">
            {@render sectionNav()}
            <div class="min-w-0">{@render pageContent()}</div>
          </div>
        </PageContainer>
      </div>
    {/snippet}
    {#snippet preview()}
      <WorkspaceChrome title="Settings" subtitle={active.label} icon={IconGear} panel="padded" padding="wide">
        {#snippet children()}
          <div data-settings-frame class="flex flex-col gap-6">
            <div class="flex flex-col gap-3.5">
              <h2 data-settings-title class="font-serif text-[28px] font-normal leading-[34px] text-ink">Settings</h2>
              <SettingsTabs tabs={links} activeKey={active.key} />
            </div>
            <div class="min-w-0">{@render pageContent()}</div>
          </div>
        {/snippet}
      </WorkspaceChrome>
    {/snippet}
  </WorkspaceGate>
{/if}
