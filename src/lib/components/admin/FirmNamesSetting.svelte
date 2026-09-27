<script lang="ts">
  // The consulting firm's own names (decision 26, audit wave 2): every AI
  // call hides them as it hides client names. Empty until an admin adds one.
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";

  let {
    names,
    onSave,
  }: {
    /** The saved names; undefined while loading. */
    names: string[] | undefined;
    onSave: (names: string[]) => Promise<unknown>;
  } = $props();

  // Non-dirty re-seed: server changes flow in until the admin edits.
  let rows = $state<string[]>([]);
  let seed = $state<string[] | null>(null);
  const cleaned = $derived(rows.map((row) => row.replace(/\s+/g, " ").trim()).filter(Boolean));
  const dirty = $derived(seed !== null && JSON.stringify(cleaned) !== JSON.stringify(seed));
  $effect(() => {
    if (!names) return;
    if ((seed === null || JSON.stringify(names) !== JSON.stringify(seed)) && !dirty) {
      rows = names.length > 0 ? [...names] : [""];
      seed = [...names];
    }
  });

  let saving = $state(false);
  let saved = $state(false);
  let error = $state("");

  async function save() {
    if (saving || !dirty) return;
    error = "";
    saved = false;
    saving = true;
    try {
      const next = [...cleaned];
      await onSave(next);
      seed = next;
      rows = next.length > 0 ? next : [""];
      saved = true;
      setTimeout(() => (saved = false), 2500);
    } catch (cause) {
      error = userErrorMessage(cause, "Could not save the firm names.");
    } finally {
      saving = false;
    }
  }
</script>

<section class="mt-6 rounded-xl border border-gray-200 bg-white px-5 py-4" aria-labelledby="firm-names-title">
  <h2 id="firm-names-title" class="text-sm font-medium text-gray-900">Firm name</h2>
  <p class="mt-1 max-w-2xl text-sm text-gray-600">
    Your firm's name and the short forms people use for it. Before any AI call, Banhall swaps
    these names for placeholders, the same way it hides client names. Nothing is hidden until
    you add a name.
  </p>
  {#if names === undefined}
    <div class="flex min-h-16 items-center justify-center"><Spinner /></div>
  {:else}
    <ul class="mt-4 flex max-w-md flex-col gap-2">
      {#each rows as _, index (index)}
        <li class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <Input
              id={`firm-name-${index}`}
              aria-label={`Firm name ${index + 1}`}
              placeholder="Name or short form"
              maxlength={120}
              bind:value={rows[index]}
            />
          </div>
          {#if rows.length > 1}
            <Button
              variant="danger-ghost"
              size="sm"
              aria-label={`Remove firm name ${index + 1}`}
              onclick={() => (rows = rows.filter((__, at) => at !== index))}
            >
              Remove
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" size="sm" disabled={rows.length >= 12} onclick={() => (rows = [...rows, ""])}>
        Add a name
      </Button>
      <span class="flex items-center gap-3">
        {#if saved}
          <span role="status" class="rounded-full bg-primary-wash px-2.5 py-1 text-xs font-medium text-primary-dark">Saved</span>
        {/if}
        <Button size="sm" onclick={save} disabled={saving || !dirty}>
          {#if saving}
            <Spinner size="sm" class="mr-2 h-3.5 w-3.5 border-white" />
          {/if}
          {saving ? "Saving..." : "Save names"}
        </Button>
      </span>
    </div>
    {#if error}
      <p role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
    {/if}
  {/if}
</section>
