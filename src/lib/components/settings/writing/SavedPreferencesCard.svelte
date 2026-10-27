<script lang="ts">
  // Phase E (E1b): the writer's saved preferences. Suggestions first, each
  // approved, edited or dismissed by the writer; saved ones below with an on
  // or off switch, Edit and Delete. Only the writer sees this card. The page
  // owns the Convex calls; each callback resolves to an error message or null.
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Switch from "$lib/components/ui/Switch.svelte";

  type Suggestion = { _id: string; text: string; support: number };
  type Saved = { _id: string; text: string; on: boolean };

  let {
    suggestions,
    saved,
    limit,
    onApprove,
    onDismiss,
    onSave,
    onSetOn,
    onDelete,
    onDeleteAll,
  }: {
    suggestions: Suggestion[];
    saved: Saved[];
    limit: number;
    onApprove: (id: string) => Promise<string | null>;
    onDismiss: (id: string) => Promise<string | null>;
    /** A new preference (no id), or an edit of a saved one or a suggestion. */
    onSave: (id: string | null, text: string) => Promise<string | null>;
    onSetOn: (id: string, on: boolean) => Promise<string | null>;
    onDelete: (id: string) => Promise<string | null>;
    onDeleteAll: () => Promise<string | null>;
  } = $props();

  const MAX_CHARS = 160;
  let editingId = $state<string | null>(null);
  let editText = $state("");
  let newText = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let confirmingDeleteAll = $state(false);

  async function run(action: () => Promise<string | null>): Promise<boolean> {
    busy = true;
    error = null;
    try {
      error = await action();
    } finally {
      busy = false;
    }
    return error === null;
  }

  function startEdit(id: string, text: string) {
    editingId = id;
    editText = text;
    error = null;
  }

  async function saveEdit() {
    if (editingId && (await run(() => onSave(editingId, editText.trim())))) editingId = null;
  }

  async function add() {
    if (await run(() => onSave(null, newText.trim()))) newText = "";
  }

  function supportLine(support: number): string {
    return support === 1 ? "From 1 of your recent edits" : `From ${support} of your recent edits`;
  }
</script>

<section data-saved-preferences class="flex flex-col gap-4 rounded-[0.875rem] border border-line bg-surface px-6 py-[1.375rem]">
  <div class="flex flex-col gap-1">
    <h2 class="font-serif text-xl leading-[1.25] text-ink">Saved preferences</h2>
    <p class="text-sm leading-[calc(10/7)] text-ink-secondary">
      Short notes on how you like to write, used in your own drafts, Seeds and chat. Only you can see them. Drafts already made keep the preferences they used.
    </p>
  </div>

  {#if suggestions.length > 0}
    <div class="flex flex-col gap-2" data-suggestions>
      <h3 class="text-sm leading-[calc(10/7)] font-medium text-ink">Suggested from your work</h3>
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        {#each suggestions as suggestion (suggestion._id)}
          <li data-suggestion class="flex flex-col gap-2 rounded-lg bg-primary-wash px-3.5 py-3">
            {#if editingId === suggestion._id}
              <Input
                id={`edit-${suggestion._id}`}
                label="Edit the suggestion"
                bind:value={editText}
                maxlength={MAX_CHARS}
              />
              <div class="flex flex-wrap gap-2">
                <Button size="xs" disabled={busy || !editText.trim()} onclick={saveEdit}>Save</Button>
                <Button size="xs" variant="ghost" disabled={busy} onclick={() => (editingId = null)}>Cancel</Button>
              </div>
            {:else}
              <p class="text-sm leading-[calc(10/7)] text-ink">{suggestion.text}</p>
              <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">{supportLine(suggestion.support)}</p>
              <div class="flex flex-wrap gap-2">
                <Button size="xs" variant="secondary" disabled={busy} onclick={() => run(() => onApprove(suggestion._id))}>Approve</Button>
                <Button size="xs" variant="ghost" disabled={busy} onclick={() => startEdit(suggestion._id, suggestion.text)}>Edit</Button>
                <Button size="xs" variant="ghost" disabled={busy} onclick={() => run(() => onDismiss(suggestion._id))}>Dismiss</Button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    <h3 class="text-sm leading-[calc(10/7)] font-medium text-ink">Your preferences ({saved.length} of {limit})</h3>
    {#if saved.length === 0}
      <p data-no-preferences class="text-sm leading-[calc(10/7)] text-ink-muted">No saved preferences yet.</p>
    {:else}
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        {#each saved as preference (preference._id)}
          <li data-preference class="flex flex-wrap items-center gap-3 border-b border-line-soft py-2">
            {#if editingId === preference._id}
              <div class="flex min-w-[16rem] flex-1 flex-col gap-2">
                <Input id={`edit-${preference._id}`} label="Edit the preference" bind:value={editText} maxlength={MAX_CHARS} />
                <div class="flex flex-wrap gap-2">
                  <Button size="xs" disabled={busy || !editText.trim()} onclick={saveEdit}>Save</Button>
                  <Button size="xs" variant="ghost" disabled={busy} onclick={() => (editingId = null)}>Cancel</Button>
                </div>
              </div>
            {:else}
              <Switch
                checked={preference.on}
                disabled={busy}
                label={`Use: ${preference.text}`}
                onCheckedChange={(on) => run(() => onSetOn(preference._id, on))}
              />
              <p class={`min-w-[12rem] flex-1 text-sm leading-[calc(10/7)] ${preference.on ? "text-ink" : "text-ink-muted"}`}>{preference.text}</p>
              <Button size="xs" variant="ghost" disabled={busy} onclick={() => startEdit(preference._id, preference.text)}>Edit</Button>
              <Button size="xs" variant="danger-ghost" disabled={busy} onclick={() => run(() => onDelete(preference._id))}>Delete</Button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if saved.length < limit}
    <div class="flex flex-wrap items-end gap-2" data-add-preference>
      <div class="min-w-[16rem] flex-1">
        <Input
          id="new-preference"
          label="Add a preference"
          placeholder="Prefers 'we' to 'the company'."
          bind:value={newText}
          maxlength={MAX_CHARS}
        />
      </div>
      <Button size="sm" variant="secondary" disabled={busy || !newText.trim()} onclick={add}>Add</Button>
    </div>
  {/if}

  {#if error}
    <p role="alert" data-preference-error class="text-sm leading-[calc(10/7)] text-red-700">{error}</p>
  {/if}

  {#if saved.length > 0 || suggestions.length > 0}
    <div class="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
      {#if confirmingDeleteAll}
        <p class="text-sm leading-[calc(10/7)] text-ink">Delete every saved preference and suggestion? This cannot be undone.</p>
        <Button
          size="xs"
          variant="destructive-soft"
          disabled={busy}
          onclick={async () => {
            if (await run(onDeleteAll)) confirmingDeleteAll = false;
          }}>Delete all</Button
        >
        <Button size="xs" variant="ghost" disabled={busy} onclick={() => (confirmingDeleteAll = false)}>Cancel</Button>
      {:else}
        <Button size="xs" variant="danger-ghost" disabled={busy} onclick={() => (confirmingDeleteAll = true)}>Delete all saved preferences</Button>
      {/if}
    </div>
  {/if}
</section>
