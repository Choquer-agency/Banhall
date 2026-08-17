<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { Streamdown } from "svelte-streamdown";
  import { api } from "../../../convex/_generated/api";

  const auth = useAuth();
  const entriesQ = useQuery(api.changelog.listEntries, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const currentUserQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const isAdmin = $derived(currentUserQ.data?.role === "admin");
  const markSeen = useMutation(api.changelog.markSeen);
  const publishEntry = useMutation(api.changelog.publishEntry);
  const deleteEntry = useMutation(api.changelog.deleteEntry);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  // Opening the page clears the unseen badge.
  let seenMarked = false;
  $effect(() => {
    if (!seenMarked && auth.isAuthenticated && entriesQ.data !== undefined) {
      seenMarked = true;
      void markSeen({});
    }
  });

  const KIND_STYLES: Record<string, string> = {
    feature: "bg-primary/10 text-primary-dark",
    fix: "bg-amber-50 text-amber-700",
    mixed: "bg-chrome text-ink-muted",
  };
  const KIND_LABELS: Record<string, string> = {
    feature: "New",
    fix: "Fixes",
    mixed: "Updates",
  };

  // Admin composer.
  let composing = $state(false);
  let title = $state("");
  let body = $state("");
  let kind = $state<"feature" | "fix" | "mixed">("mixed");
  let publishing = $state(false);
  let error = $state("");

  async function handlePublish() {
    if (publishing) return;
    error = "";
    publishing = true;
    try {
      await publishEntry({ title, body, kind });
      title = "";
      body = "";
      kind = "mixed";
      composing = false;
    } catch (cause) {
      error = userErrorMessage(cause, "Could not publish the entry.");
    } finally {
      publishing = false;
    }
  }

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString("en-CA", { dateStyle: "long" });
  }
</script>

{#snippet changelogContent(showHeading: boolean)}
    <main class={`w-full flex-1 ${showHeading ? "mx-auto max-w-[var(--container-shell)] px-6 pt-12" : "px-4 pt-6 sm:px-6"} pb-10`}>
      <div class={`w-full ${showHeading ? "mx-auto max-w-3xl" : ""}`}>
        <div class={`flex flex-wrap items-start gap-4 ${showHeading ? "justify-between" : "justify-end"}`}>
          {#if showHeading}
            <div>
              <h1 class="text-display">What's new</h1>
              <p class="mt-1 text-sm text-ink-muted">
                Features and fixes shipped since you last looked — no meeting required.
              </p>
            </div>
          {/if}
          {#if isAdmin && !composing}
            <Button onclick={() => (composing = true)}>New entry</Button>
          {/if}
        </div>

        {#if composing}
          <section class="card mt-6 p-5">
            <h2 class="text-title">Publish an entry</h2>
            <div class="mt-4 flex flex-col gap-3">
              <input
                bind:value={title}
                placeholder="e.g. Excel uploads, single-page project setup"
                class="field-control block w-full rounded-lg px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint"
              />
              <textarea
                rows={8}
                bind:value={body}
                placeholder={"Markdown supported.\n\n- Added X\n- Fixed Y"}
                class="field-control block w-full rounded-lg px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint"
              ></textarea>
              <div class="flex items-center justify-between gap-3">
                <SelectInput
                  size="sm"
                  value={kind}
                  items={[
                    { value: "mixed", label: "Updates" },
                    { value: "feature", label: "New features" },
                    { value: "fix", label: "Bug fixes" },
                  ]}
                  class="w-40"
                  onValueChange={(next) => (kind = next as typeof kind)}
                />
                <span class="flex items-center gap-2">
                  <Button variant="ghost" onclick={() => (composing = false)} disabled={publishing}>
                    Cancel
                  </Button>
                  <Button onclick={handlePublish} disabled={publishing || !title.trim() || !body.trim()}>
                    {publishing ? "Publishing…" : "Publish"}
                  </Button>
                </span>
              </div>
              {#if error}
                <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
              {/if}
            </div>
          </section>
        {/if}

        {#if entriesQ.data === undefined}
          <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
        {:else if entriesQ.data.length === 0}
          <p class="mt-10 text-sm text-ink-faint">Nothing published yet — check back after the next sprint.</p>
        {:else}
          <div class="mt-8 flex flex-col gap-6">
            {#each entriesQ.data as entry (entry._id)}
              <article class="card p-5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2.5">
                    <span class={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLES[entry.kind]}`}>
                      {KIND_LABELS[entry.kind]}
                    </span>
                    <h2 class="text-title">{entry.title}</h2>
                  </div>
                  <span class="flex items-center gap-3">
                    <time class="text-xs text-ink-faint">{fmtDate(entry.publishedAt)}</time>
                    {#if isAdmin}
                      <button
                        type="button"
                        onclick={() => deleteEntry({ id: entry._id })}
                        class="rounded-md px-1.5 py-0.5 text-xs text-ink-faint transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        Delete
                      </button>
                    {/if}
                  </span>
                </div>
                <div class="chat-markdown mt-3 text-sm leading-relaxed text-ink-secondary">
                  <Streamdown content={entry.body} />
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </div>
    </main>
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <WorkspaceGate currentWhileLoading={false}>
    {#snippet current()}
      <div class="flex flex-1 flex-col bg-canvas">
        <AppNav breadcrumbs={[{ label: "What's new" }]} />
        <PageBar backHref="/dashboard" backLabel="Back" />
        {@render changelogContent(true)}
      </div>
    {/snippet}
    {#snippet preview()}
      <WorkspaceChrome title="What's new" description="Features and fixes shipped to Banhall">
        {#snippet children()}
          {@render changelogContent(false)}
        {/snippet}
      </WorkspaceChrome>
    {/snippet}
  </WorkspaceGate>
{/if}
