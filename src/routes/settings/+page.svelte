<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../convex/_generated/api";


  const auth = useAuth();
  const profileQ = useQuery(api.writerProfiles.getMyProfile, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const saveMyProfile = useMutation(api.writerProfiles.saveMyProfile);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  let customInstructions = $state("");
  let enabled = $state(true);
  let hydrated = false;
  // Seed the form once from the stored profile (don't clobber in-flight edits
  // on later reactive updates).
  $effect(() => {
    if (hydrated || profileQ.data === undefined) return;
    hydrated = true;
    if (profileQ.data) {
      customInstructions = profileQ.data.customInstructions;
      enabled = profileQ.data.enabled;
    }
  });

  let saving = $state(false);
  let saved = $state(false);
  let error = $state("");

  async function handleSave() {
    if (saving) return;
    error = "";
    saved = false;
    saving = true;
    try {
      await saveMyProfile({ customInstructions, enabled });
      saved = true;
      setTimeout(() => (saved = false), 2500);
    } catch (cause) {
      error = userErrorMessage(cause, "Could not save your writing preferences.");
    } finally {
      saving = false;
    }
  }
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "Settings" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] flex-1 px-6 pt-12 pb-8">
      <div class="mx-auto w-full max-w-3xl">
        <h1 class="text-display">Settings</h1>

        {#if profileQ.data === undefined}
          <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
        {:else}
          <section class="card mt-6 p-5">
            <h2 class="text-title">Writing preferences</h2>
            <p class="mt-1 text-sm text-gray-500">
              Applied to every report you generate. Never overrides CRA
              structural requirements, banned-word rules, or length limits.
            </p>

            <label class="mt-4 block">
              <span class="text-label">Your personal style instructions</span>
              <textarea
                rows={10}
                bind:value={customInstructions}
                placeholder={"e.g. Prefer short declarative sentences. Lead each iteration with the hypothesis tested. Avoid the passive voice in the work narrative."}
                class="mt-2 block w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              ></textarea>
              <span class="mt-1 block text-right text-xs text-gray-400">
                {customInstructions.length.toLocaleString()} characters
              </span>
            </label>

            <div class="mt-3 flex items-center justify-between gap-4">
              <label class="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  bind:checked={enabled}
                  class="h-3.5 w-3.5 accent-primary"
                />
                Apply my preferences to new generations
              </label>
              <span class="flex items-center gap-3">
                {#if saved}
                  <span class="text-xs text-primary">Saved</span>
                {/if}
                <Button onclick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </span>
            </div>

            {#if error}
              <p role="alert" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            {/if}
          </section>
        {/if}
      </div>
    </main>
  </div>
{/if}
