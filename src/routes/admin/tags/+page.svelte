<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc, Id } from "../../../../convex/_generated/dataModel";

  type Tag = Doc<"tags">;
  type TagKind = NonNullable<Tag["kind"]>;

  const auth = useAuth();
  const currentUserQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const isAdmin = $derived(currentUserQ.data?.role === "admin");
  const tagsQ = useQuery(api.tags.listTags, () =>
    auth.isAuthenticated && isAdmin ? {} : "skip"
  );
  const createTag = useMutation(api.tags.createTag);
  const renameTag = useMutation(api.tags.renameTag);
  const moveTag = useMutation(api.tags.moveTag);
  const deleteTag = useMutation(api.tags.deleteTag);
  const seedDefaults = useMutation(api.tags.seedDefaultTags);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const tags = $derived(tagsQ.data ?? []);
  const tagById = $derived(
    new Map(tags.map((tag) => [tag._id as string, tag]))
  );
  const tagRows = $derived.by(() => {
    const ordered = [...tags].sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        String(a._id).localeCompare(String(b._id))
    );
    const byId = tagById;
    const childrenByParent = new Map<string, Tag[]>();
    const roots: Tag[] = [];
    for (const tag of ordered) {
      const parentId = tag.parentId as string | undefined;
      if (!parentId || !byId.has(parentId)) {
        roots.push(tag);
        continue;
      }
      const children = childrenByParent.get(parentId) ?? [];
      children.push(tag);
      childrenByParent.set(parentId, children);
    }

    const rows: Array<{ tag: Tag; depth: number; isLast: boolean }> = [];
    const visited = new Set<string>();
    const append = (tag: Tag, depth: number, isLast: boolean) => {
      const id = tag._id as string;
      if (visited.has(id)) return;
      visited.add(id);
      rows.push({ tag, depth, isLast });
      const children = childrenByParent.get(id) ?? [];
      children.forEach((child, i) =>
        append(child, depth + 1, i === children.length - 1)
      );
    };
    roots.forEach((root, i) => append(root, 0, i === roots.length - 1));
    // Keep legacy cyclic rows visible so an admin can move them back to top level.
    for (const tag of ordered) append(tag, 0, true);
    return rows;
  });

  const KIND_STYLES: Record<string, string> = {
    industry: "bg-primary/10 text-primary-dark",
    writer: "bg-navy/10 text-navy",
    custom: "bg-chrome text-gray-500",
  };

  const KIND_ITEMS = [
    { value: "custom", label: "Custom" },
    { value: "industry", label: "Industry" },
    { value: "writer", label: "Consultant" },
  ];

  // Indent nested tags with non-breaking spaces so hierarchy survives HTML
  // whitespace collapsing inside the combobox list.
  const indentLabel = (depth: number, name: string) =>
    "  ".repeat(depth) + name;

  const newParentItems = $derived([
    { value: "", label: "Top level" },
    ...tagRows.map((row) => ({
      value: row.tag._id as string,
      label: indentLabel(row.depth, row.tag.name),
    })),
  ]);

  function moveParentItems(tag: Tag) {
    return [
      // Keep a legacy broken parent visible so the current value still renders.
      ...(tag.parentId && !canUseAsParent(tag._id, tag.parentId)
        ? [{ value: tag.parentId as string, label: "Missing or invalid parent" }]
        : []),
      { value: "", label: "Top level" },
      ...tagRows
        .filter(({ tag: candidate }) => canUseAsParent(tag._id, candidate._id))
        .map((row) => ({
          value: row.tag._id as string,
          label: indentLabel(row.depth, row.tag.name),
        })),
    ];
  }

  let newName = $state("");
  let newParent = $state<string>("");
  // string (not TagKind) so it can bind:value into SelectInput; cast on use.
  let newKind = $state<string>("custom");
  let error = $state("");
  let busy = $state(false);
  let confirmDeleteId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editingName = $state("");

  function canUseAsParent(tagId: string, candidateId: string): boolean {
    if (!tagById.has(candidateId)) return false;
    if (candidateId === tagId) return false;
    const visited = new Set<string>();
    let currentId: string | undefined = candidateId;
    while (currentId) {
      if (currentId === tagId) return false;
      if (visited.has(currentId)) return false;
      visited.add(currentId);
      currentId = tagById.get(currentId)?.parentId as string | undefined;
    }
    return true;
  }

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    error = "";
    busy = true;
    try {
      await fn();
      return true;
    } catch (cause) {
      error = userErrorMessage(cause, "Something went wrong.");
      return false;
    } finally {
      busy = false;
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const created = await run(() =>
      createTag({
        name,
        kind: newKind as TagKind,
        ...(newParent ? { parentId: newParent as Id<"tags"> } : {}),
      })
    );
    if (created) newName = "";
  }

  function startRename(tag: Tag) {
    editingId = tag._id;
    editingName = tag.name;
    confirmDeleteId = null;
  }

  function cancelRename() {
    editingId = null;
    editingName = "";
  }

  async function saveRename() {
    if (!editingId || busy) return;
    const id = editingId as Id<"tags">;
    const name = editingName.trim();
    const original = tagById.get(editingId)?.name;
    if (!name || name === original) {
      cancelRename();
      return;
    }
    const renamed = await run(() => renameTag({ tagId: id, name }));
    if (renamed) cancelRename();
  }

  async function handleMove(tagId: string, parentId: string) {
    await run(() =>
      moveTag({
        tagId: tagId as Id<"tags">,
        ...(parentId ? { parentId: parentId as Id<"tags"> } : {}),
      })
    );
  }

  async function confirmDelete(id: string) {
    confirmDeleteId = null;
    await run(() => deleteTag({ tagId: id as Id<"tags"> }));
  }
</script>

{#snippet tagRow(tag: Tag, depth: number)}
  <div
    class="group flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-50 py-1.5 pr-3 transition-colors last:border-0 hover:bg-canvas/60"
    style={`padding-left: ${0.75 + depth * 1.75}rem`}
  >
    {#if depth > 0}
      <span class="select-none text-gray-300" aria-hidden="true">└</span>
    {/if}

    {#if editingId === tag._id}
      <!-- Rename state: explicit Save / Cancel; Enter saves, Esc cancels. -->
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={editingName}
        autofocus
        aria-label={`Rename ${tag.name}`}
        onkeydown={(event) => {
          if (event.key === "Enter") saveRename();
          if (event.key === "Escape") cancelRename();
        }}
        class="h-8 w-52 rounded-md border border-navy px-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-navy"
      />
      <span class="ml-auto flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onclick={cancelRename}
          class="rounded-md px-2.5 py-1 text-xs text-gray-500 transition-colors hover:bg-chrome hover:text-navy disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !editingName.trim()}
          onclick={saveRename}
          class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:pointer-events-none disabled:opacity-50"
        >
          Save
        </button>
      </span>
    {:else if confirmDeleteId === tag._id}
      <span class="text-sm text-gray-800">{tag.name}</span>
      <span class="ml-auto flex items-center gap-2">
        <span class="text-xs text-red-600">Delete this tag?</span>
        <button
          type="button"
          disabled={busy}
          onclick={() => confirmDelete(tag._id)}
          class="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
        >
          Delete
        </button>
        <button
          type="button"
          disabled={busy}
          onclick={() => (confirmDeleteId = null)}
          class="rounded-md px-2.5 py-1 text-xs text-gray-500 transition-colors hover:bg-chrome hover:text-navy disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    {:else}
      <span class={`text-sm text-gray-800 ${depth === 0 ? "font-medium" : ""}`}>
        {tag.name}
      </span>
      <span
        class={`rounded-full px-2 py-0.5 text-[0.6875rem] leading-4 ${KIND_STYLES[tag.kind ?? "custom"] ?? KIND_STYLES.custom}`}
      >
        {tag.kind ?? "custom"}
      </span>

      <!-- Actions surface on hover/focus to keep rows quiet. -->
      <span class="ml-auto flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <label class="flex items-center gap-1.5 text-xs text-gray-400">
          Nest under
          <SelectInput
            size="sm"
            value={(tag.parentId as string) ?? ""}
            items={moveParentItems(tag)}
            disabled={busy}
            placeholder={`Parent for ${tag.name}`}
            class="w-44"
            onValueChange={(next) => handleMove(tag._id, next)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          aria-label={`Rename ${tag.name}`}
          onclick={() => startRename(tag)}
          class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-chrome hover:text-navy disabled:opacity-50"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
          </svg>
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label={`Delete ${tag.name}`}
          onclick={() => {
            confirmDeleteId = tag._id;
            editingId = null;
          }}
          class="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </span>
    {/if}
  </div>
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "Project tags" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] px-6 pt-12 pb-10">
      {#if currentUserQ.data === undefined}
        <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
      {:else if !isAdmin}
        <h1 class="text-display">Project tags</h1>
        <p class="mt-3 text-sm text-gray-500">
          Tag management is available to administrators only.
        </p>
      {:else}
        <div class="flex items-end justify-between gap-4">
          <div>
            <h1 class="text-display">Project tags</h1>
            <p class="mt-1 text-sm text-gray-500">
              Curate the tag taxonomy writers apply to projects. Parent filters
              include every nested descendant.
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onclick={() => run(() => seedDefaults({}))}
          >
            Repair defaults
          </Button>
        </div>

        {#if error}
          <p role="alert" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        {/if}

        <!-- Taxonomy tree left, create panel right (stacks on small screens). -->
        <div class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <!-- New tag -->
        <div class="card p-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
          <p class="text-label">New tag</p>
          <div class="mt-3 flex flex-col items-stretch gap-3">
            <label class="flex flex-col gap-1 text-xs text-gray-500">
              Name
              <input
                bind:value={newName}
                placeholder="e.g. Robotics"
                disabled={busy}
                onkeydown={(event) => event.key === "Enter" && handleCreate()}
                class="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy disabled:opacity-50"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-gray-500" for="new-tag-kind">
              Kind
              <SelectInput
                id="new-tag-kind"
                bind:value={newKind}
                items={KIND_ITEMS}
                disabled={busy}
                placeholder="Kind"
                class="w-full"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-gray-500" for="new-tag-parent">
              Nest under
              <SelectInput
                id="new-tag-parent"
                bind:value={newParent}
                items={newParentItems}
                disabled={busy}
                placeholder="Top level"
                class="w-full"
              />
            </label>
            <Button onclick={handleCreate} disabled={busy || !newName.trim()}>
              Add tag
            </Button>
          </div>
        </div>

        <div class="lg:col-start-1 lg:row-start-1">
          {#if tagsQ.data === undefined}
            <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
          {:else if tags.length === 0}
            <div class="card flex flex-col items-center gap-2 px-6 py-10 text-center">
              <p class="text-sm text-gray-600">No tags yet.</p>
              <p class="text-xs text-gray-400">
                Repair the default taxonomy or add your first tag alongside.
              </p>
            </div>
          {:else}
            <div class="card overflow-hidden py-1">
              {#each tagRows as row (row.tag._id)}
                {@render tagRow(row.tag, row.depth)}
              {/each}
            </div>
            <p class="mt-2 text-xs text-gray-400">
              Deleting a tag moves its children up one level and removes only that
              tag from every project.
            </p>
          {/if}
        </div>
        </div>
      {/if}
    </main>
  </div>
{/if}
