<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import { useQuery, useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import ReadOnlyEditor from "$lib/components/review/ReadOnlyEditor.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { buildMilestoneOptions } from "./milestones";

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
   * - reportId: current report restored into and used to resolve project history
   * - beforeSnapshot: flush visible editor content and return its persisted revision
   * - onClose: close the modal (backdrop click, Escape, X button, and after a restore)
   */
  let {
    reportId,
    beforeSnapshot,
    onClose,
  }: {
    reportId: Id<"reports">;
    beforeSnapshot: () => Promise<number>;
    onClose: () => void;
  } = $props();

  const REASON_LABELS: Record<string, string> = {
    pre_chat_edit: "Before AI edit",
    manual: "Edit checkpoint",
    periodic: "Auto-save",
    pre_restore: "Before restore",
    milestone: "Milestone",
    generated: "Generated draft",
  };

  const snapshotsQ = useQuery(api.snapshots.listSnapshots, () => ({ reportId }));
  let selectedId = $state<Id<"reportSnapshots"> | null>(null);
  const selectedQ = useQuery(api.snapshots.getSnapshot, () =>
    selectedId
      ? { snapshotId: selectedId, targetReportId: reportId }
      : "skip"
  );
  const selected = $derived(selectedQ.data);
  const restoreSnapshot = useMutation(api.snapshots.restoreSnapshot);
  const createMilestoneSnapshot = useMutation(api.snapshots.createMilestoneSnapshot);

  let copied = $state(false);
  let restoring = $state(false);
  let preparingRestore = $state(false);
  let restoreConfirmation = $state<{
    snapshotId: Id<"reportSnapshots">;
    expectedRevisionNumber: number;
  } | null>(null);
  let restoreError = $state("");
  let milestoneLabel = $state("R0 draft");
  let savingMilestone = $state(false);
  let milestoneError = $state("");

  const snapshots = $derived(snapshotsQ.data ?? []);
  const milestoneSnapshots = $derived(snapshots.filter((s) => s.reason === "milestone"));
  const historySnapshots = $derived(snapshots.filter((s) => s.reason !== "milestone"));
  const milestoneOptions = $derived(buildMilestoneOptions(milestoneSnapshots));
  const milestoneItems = $derived(
    milestoneOptions.map((label) => ({ value: label, label }))
  );
  // Snap the selection to the first available option whenever the current
  // choice disappears (e.g. right after saving that milestone).
  $effect(() => {
    if (!milestoneOptions.includes(milestoneLabel) && milestoneOptions.length > 0) {
      milestoneLabel = milestoneOptions[0];
    }
  });

  $effect(() => {
    const snapshots = snapshotsQ.data;
    if (selectedId === null && snapshots && snapshots.length > 0) {
      selectedId = snapshots[0]._id;
    }
  });
  $effect(() => {
    void selectedId;
    restoreConfirmation = null;
    restoreError = "";
  });

  $effect(() => {
    if (milestoneOptions.length > 0 && !milestoneOptions.includes(milestoneLabel)) {
      milestoneLabel = milestoneOptions[0];
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
    if (
      !selectedId ||
      !selected ||
      selected._id !== selectedId ||
      preparingRestore ||
      restoring
    ) {
      return;
    }
    if (
      restoreConfirmation &&
      restoreConfirmation.snapshotId !== selectedId
    ) {
      restoreConfirmation = null;
      return;
    }
    if (!restoreConfirmation) {
      const snapshotId = selectedId;
      preparingRestore = true;
      restoreError = "";
      try {
        const expectedRevisionNumber = await beforeSnapshot();
        if (selectedId === snapshotId) {
          restoreConfirmation = { snapshotId, expectedRevisionNumber };
        }
      } catch (e) {
        restoreError = userErrorMessage(
          e,
          "The current report could not be saved before restore."
        );
      } finally {
        preparingRestore = false;
      }
      return;
    }

    restoring = true;
    restoreError = "";
    try {
      await restoreSnapshot({
        snapshotId: restoreConfirmation.snapshotId,
        targetReportId: reportId,
        expectedRevisionNumber: restoreConfirmation.expectedRevisionNumber,
      });
      onClose();
    } catch (e) {
      restoreError = userErrorMessage(e, "The version could not be restored.");
      restoreConfirmation = null;
    } finally {
      restoring = false;
    }
  }


  async function handleSaveMilestone() {
    const label = milestoneLabel.trim();
    if (!label || savingMilestone) return;
    savingMilestone = true;
    milestoneError = "";
    try {
      const expectedRevisionNumber = await beforeSnapshot();
      const id = await createMilestoneSnapshot({
        reportId,
        label,
        expectedRevisionNumber,
      });
      selectedId = id;
    } catch (e) {
      milestoneError = userErrorMessage(e, "The milestone could not be saved.");
    } finally {
      savingMilestone = false;
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
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} transition:overlayFade class="fixed inset-0 z-[100] bg-black/40"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <!-- Centering wrapper: clicks here are outside Dialog.Content, so they close -->
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <!-- Don't auto-focus the first focusable (the milestone combobox) —
           it popped its dropdown open every time History was opened. -->
      <Dialog.Content forceMount onOpenAutoFocus={(e) => e.preventDefault()}>
        {#snippet child({ props, open })}
        {#if open}
        <div
          {...props}
          transition:modalPop
          class="flex h-[80vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        >
    <!-- Snapshot list -->
    <div class="flex w-80 flex-shrink-0 flex-col border-r border-gray-200">
      <div class="border-b border-gray-200 px-4 py-3">
        <Dialog.Title class="text-sm font-semibold text-gray-700">
          Version history
        </Dialog.Title>
        <div class="mt-3 rounded-xl border border-gray-200 bg-canvas p-2.5">
          <label for="milestone-label" class="text-label">Save milestone</label>
          <div class="mt-2 flex gap-2">
            <SelectInput
              id="milestone-label"
              size="sm"
              bind:value={milestoneLabel}
              items={milestoneItems}
              placeholder="Milestone label"
              class="min-w-0 flex-1"
            />
            <button
              type="button"
              onclick={handleSaveMilestone}
              disabled={savingMilestone}
              class="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {savingMilestone ? "Saving…" : "Save"}
            </button>
          </div>
          {#if milestoneError}
            <p class="mt-1.5 text-xs text-red-600">{milestoneError}</p>
          {/if}
        </div>
      </div>
      <div class="flex-1 overflow-y-auto">
        {#if snapshotsQ.data === undefined}
          <p class="px-4 py-3 text-xs text-gray-400">Loading…</p>
        {:else if snapshots.length === 0}
          <p class="px-4 py-3 text-xs text-gray-400">
            No versions saved yet. Save a milestone or keep editing to create
            automatic checkpoints.
          </p>
        {:else}
          {#if milestoneSnapshots.length > 0}
            <p class="px-4 pb-1 pt-3 text-label">Milestones</p>
            {#each milestoneSnapshots as s (s._id)}
              <button
                type="button"
                onclick={() => (selectedId = s._id)}
                class={`block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                  selectedId === s._id ? "bg-primary-wash" : "hover:bg-primary-wash"
                }`}
              >
                <p class="text-sm font-semibold text-navy">
                  {s.label ?? REASON_LABELS[s.reason] ?? s.reason}
                </p>
                <p class="mt-0.5 text-xs text-gray-500">
                  Report v{s.reportVersion}{s.isCurrentReport ? " · current" : ""}
                  · {formatTimestamp(s.createdAt)}
                </p>
              </button>
            {/each}
          {/if}
          {#if historySnapshots.length > 0}
            <p class="px-4 pb-1 pt-3 text-label">Edit history</p>
            {#each historySnapshots as s (s._id)}
              <button
                type="button"
                onclick={() => (selectedId = s._id)}
                class={`block w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                  selectedId === s._id ? "bg-chrome" : "hover:bg-primary-wash"
                }`}
              >
                <p class="text-sm font-medium text-gray-800">
                  {formatTimestamp(s.createdAt)}
                </p>
                <p class="mt-0.5 text-xs text-gray-500">
                  Report v{s.reportVersion}{s.isCurrentReport ? " · current" : ""}
                  · {s.label ?? REASON_LABELS[s.reason] ?? s.reason}
                </p>
                {#if s.researchSessionId}
                  <p class="mt-1 text-[11px] font-medium text-primary">
                    Research-backed · {s.researchSourceCount} source{s.researchSourceCount === 1 ? "" : "s"}
                  </p>
                {/if}
              </button>
            {/each}
          {/if}
        {/if}
      </div>
    </div>

    <!-- Preview -->
    <div class="flex flex-1 flex-col">
      <div class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <span class="text-sm text-gray-500">
          {selected
            ? `Report v${selected.sourceReportVersion} · ${formatTimestamp(selected.createdAt)}`
            : "Preview"}
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={handleCopy}
            disabled={!selected}
            class="h-8 rounded-lg bg-gray-100 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            {copied ? "Copied!" : "Copy text"}
          </button>
          <button
            type="button"
            onclick={handleRestore}
            disabled={!selectedId || restoring || preparingRestore}
            class="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            title="Restores this version. Your current version is saved first, so nothing is lost."
          >
            {preparingRestore
              ? "Saving current…"
              : restoring
                ? "Restoring..."
                : restoreConfirmation
                  ? "Confirm restore"
                  : "Restore this version"}
          </button>
          {#if restoreConfirmation && !restoring && !preparingRestore}
            <button
              type="button"
              class="h-8 rounded-lg px-3 text-xs font-medium text-gray-600 hover:bg-gray-100"
              onclick={() => (restoreConfirmation = null)}
            >
              Cancel
            </button>
          {/if}
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
      {#if restoreConfirmation}
        <p class="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900" role="alert">
          Confirm restoring the selected version. The current report is saved as a recovery point first.
        </p>
      {/if}
      {#if restoreError}
        <p class="border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700" role="alert">
          {restoreError}
        </p>
      {/if}
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
        </div>
        {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
