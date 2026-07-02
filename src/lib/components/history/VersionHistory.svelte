<script lang="ts">
  import { Dialog } from "bits-ui";
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import ReadOnlyEditor from "$lib/components/review/ReadOnlyEditor.svelte";

  /**
   * Version history modal (bits-ui Dialog).
   * Full-screen overlay (z-[100], click outside or Escape to close) with a
   * snapshot list on the left, a read-only preview on the right, plus copy-text
   * and non-destructive restore actions. Auto-selects the newest snapshot when
   * the list loads.
   *
   * Rendered conditionally by the parent, so the dialog is always open while
   * mounted; every close path funnels through onOpenChange -> onClose.
   *
   * Props:
   * - reportId: report whose snapshots are listed
   * - onClose: close the modal (backdrop click, Escape, X button, and after a restore)
   */
  let {
    reportId,
    onClose,
  }: {
    reportId: Id<"reports">;
    onClose: () => void;
  } = $props();

  const REASON_LABELS: Record<string, string> = {
    pre_chat_edit: "Before AI edit",
    manual: "Edit checkpoint",
    periodic: "Auto-save",
    pre_restore: "Before restore",
  };

  const snapshotsQ = useQuery(api.snapshots.listSnapshots, () => ({ reportId }));
  let selectedId = $state<Id<"reportSnapshots"> | null>(null);
  const selectedQ = useQuery(api.snapshots.getSnapshot, () =>
    selectedId ? { snapshotId: selectedId } : "skip"
  );
  const selected = $derived(selectedQ.data);
  const restoreSnapshot = useMutation(api.snapshots.restoreSnapshot);

  let copied = $state(false);
  let restoring = $state(false);

  $effect(() => {
    const snapshots = snapshotsQ.data;
    if (selectedId === null && snapshots && snapshots.length > 0) {
      selectedId = snapshots[0]._id;
    }
  });

  async function handleCopy() {
    if (!selected) return;
    const text = extractPlainText(selected.content);
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  async function handleRestore() {
    if (!selectedId) return;
    restoring = true;
    try {
      await restoreSnapshot({ snapshotId: selectedId });
      onClose();
    } catch (e) {
      console.error("Restore failed", e);
    } finally {
      restoring = false;
    }
  }

  function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleString("en-CA", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function extractPlainText(contentJson: string): string {
    try {
      const doc = JSON.parse(contentJson);
      const lines: string[] = [];
      const walk = (node: { type?: string; text?: string; content?: unknown[] }) => {
        if (node.type === "text" && typeof node.text === "string") {
          lines.push(node.text);
          return "inline";
        }
        const children = (node.content as (typeof node)[]) ?? [];
        if (node.type === "paragraph" || node.type === "heading") {
          const parts: string[] = [];
          for (const c of children) {
            if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
          }
          lines.push(parts.join(""));
          return "block";
        }
        for (const c of children) walk(c);
        return "block";
      };
      for (const node of (doc.content as { type?: string }[]) ?? []) walk(node);
      return lines.filter((l) => l.trim().length > 0).join("\n\n");
    } catch {
      return "";
    }
  }
</script>

<Dialog.Root
  open={true}
  onOpenChange={(o) => {
    if (!o) onClose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[100] bg-black/40" />
    <!-- Centering wrapper: clicks here are outside Dialog.Content, so they close -->
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <Dialog.Content
        class="flex h-[80vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
    <!-- Snapshot list -->
    <div class="flex w-72 flex-shrink-0 flex-col border-r border-gray-200">
      <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <Dialog.Title class="text-sm font-semibold text-gray-700">
          Version history
        </Dialog.Title>
      </div>
      <div class="flex-1 overflow-y-auto">
        {#if snapshotsQ.data === undefined}
          <p class="px-4 py-3 text-xs text-gray-400">Loading…</p>
        {:else if snapshotsQ.data.length === 0}
          <p class="px-4 py-3 text-xs text-gray-400">
            No versions saved yet. Snapshots are created automatically as you
            edit and before each AI change.
          </p>
        {:else}
          {#each snapshotsQ.data as s (s._id)}
            <button
              onclick={() => (selectedId = s._id)}
              class={`block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                selectedId === s._id ? "bg-chrome" : "hover:bg-primary-wash"
              }`}
            >
              <p class="text-sm font-medium text-gray-800">
                {formatTimestamp(s.createdAt)}
              </p>
              <p class="mt-0.5 text-xs text-gray-500">
                {s.label ?? REASON_LABELS[s.reason] ?? s.reason}
              </p>
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Preview -->
    <div class="flex flex-1 flex-col">
      <div class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <span class="text-sm text-gray-500">
          {selected ? formatTimestamp(selected.createdAt) : "Preview"}
        </span>
        <div class="flex items-center gap-2">
          <button
            onclick={handleCopy}
            disabled={!selected}
            class="h-8 rounded-lg bg-gray-100 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            {copied ? "Copied!" : "Copy text"}
          </button>
          <button
            onclick={handleRestore}
            disabled={!selectedId || restoring}
            class="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            title="Restores this version. Your current version is saved first, so nothing is lost."
          >
            {restoring ? "Restoring…" : "Restore this version"}
          </button>
          <Dialog.Close
            aria-label="Close version history"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-primary-wash hover:text-gray-600"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Dialog.Close>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto bg-canvas px-8 py-6">
        {#if selected}
          <div class="mx-auto max-w-[680px]">
            <ReadOnlyEditor content={selected.content} />
          </div>
        {:else}
          <p class="text-sm text-gray-400">
            Select a version to preview it.
          </p>
        {/if}
      </div>
      <p class="border-t border-gray-100 px-5 py-2 text-[11px] text-gray-400">
        Restoring is non-destructive — the current version is snapshotted
        first, so you can always come back to it.
      </p>
    </div>
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
