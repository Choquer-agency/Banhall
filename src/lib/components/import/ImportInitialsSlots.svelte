<!--
  Positional initials reassignment for a staged PD on To review (2026-11-23):
  shows the 4 positional filename slots (Writer, Reviewer, Client, Financial),
  lets an Admin shift initials left or right between adjacent slots or edit
  any slot directly, and toggle whether the reviewer is still in progress
  (lowercase initials such as ".mo"). Saving calls
  ingestion.reassignFileInitials, marks the slots manually edited, and
  re-resolves Writer and Reviewer against the team roster.
-->
<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { ArrowLeftIcon, ArrowRightIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { userErrorMessage } from "$lib/errors";
  import { INITIALS_RULE, savedInitials } from "../../../../shared/importSheetRules";
  import { IMPORT_TOAST } from "./importActions";
  import { SHEET_SMALL } from "./sheetLayout";

  type SlotKey = "writer" | "reviewer" | "client" | "financial";

  const SLOTS: readonly { key: SlotKey; label: string }[] = [
    { key: "writer", label: "Writer" },
    { key: "reviewer", label: "Reviewer" },
    { key: "client", label: "Client" },
    { key: "financial", label: "Financial" },
  ];

  let {
    fileId,
    writerInitials = undefined,
    reviewerInitials = undefined,
    clientInitials = undefined,
    financialInitials = undefined,
    reviewerInProgress = false,
  }: {
    fileId: Id<"ingestionItems">;
    writerInitials?: string;
    reviewerInitials?: string;
    clientInitials?: string;
    financialInitials?: string;
    reviewerInProgress?: boolean;
  } = $props();

  const reassign = useMutation(api.ingestion.reassignFileInitials);

  let values = $state<Record<SlotKey, string>>({
    writer: "",
    reviewer: "",
    client: "",
    financial: "",
  });
  let inProgress = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    values = {
      writer: writerInitials ?? "",
      reviewer: reviewerInitials ?? "",
      client: clientInitials ?? "",
      financial: financialInitials ?? "",
    };
    inProgress = reviewerInProgress === true;
    error = null;
  });

  const dirty = $derived(
    values.writer.trim().toUpperCase() !== (writerInitials ?? "").toUpperCase() ||
      values.reviewer.trim().toUpperCase() !== (reviewerInitials ?? "").toUpperCase() ||
      values.client.trim().toUpperCase() !== (clientInitials ?? "").toUpperCase() ||
      values.financial.trim().toUpperCase() !== (financialInitials ?? "").toUpperCase() ||
      (values.reviewer.trim() !== "" && inProgress !== (reviewerInProgress === true))
  );

  function swapSlots(indexA: number, indexB: number) {
    const keyA = SLOTS[indexA]?.key;
    const keyB = SLOTS[indexB]?.key;
    if (!keyA || !keyB) return;
    const next = { ...values };
    const tmp = next[keyA];
    next[keyA] = next[keyB];
    next[keyB] = tmp;
    values = next;
    error = null;
  }

  function cleanSlot(raw: string): string | null | "invalid" {
    const cleaned = savedInitials(raw);
    if (cleaned === null) return "invalid";
    return cleaned === "" ? null : cleaned;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    const nextWriter = cleanSlot(values.writer);
    const nextReviewer = cleanSlot(values.reviewer);
    const nextClient = cleanSlot(values.client);
    const nextFinancial = cleanSlot(values.financial);
    if (nextWriter === "invalid" || nextReviewer === "invalid" || nextClient === "invalid" || nextFinancial === "invalid") {
      error = INITIALS_RULE;
      return;
    }
    saving = true;
    error = null;
    try {
      await reassign({
        id: fileId,
        writerInitials: nextWriter,
        reviewerInitials: nextReviewer,
        clientInitials: nextClient,
        financialInitials: nextFinancial,
        reviewerInProgress: nextReviewer !== null ? inProgress : false,
      });
      toast("Initials updated", IMPORT_TOAST);
    } catch (cause) {
      error = userErrorMessage(cause, "Could not update initials.");
    } finally {
      saving = false;
    }
  }
</script>

<section class="mt-5 rounded-lg border border-line-soft bg-gray-50/70 p-3.5" data-import-initials-slots>
  <div class="flex items-baseline justify-between gap-2">
    <h3 class={`${SHEET_SMALL} tracking-[0.04em] text-ink-muted uppercase`}>Filename initials</h3>
    <span class={`${SHEET_SMALL} text-ink-muted`}>Use arrows to shift roles</span>
  </div>
  <form class="mt-2.5 flex flex-col gap-2.5" onsubmit={save} novalidate>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {#each SLOTS as slot, index (slot.key)}
        <div class="flex flex-col gap-1 rounded-md border border-line-soft bg-surface p-2" data-import-initials-slot={slot.key}>
          <label for={`initials-slot-${slot.key}`} class={`${SHEET_SMALL} text-ink-muted`}>{slot.label}</label>
          <input
            id={`initials-slot-${slot.key}`}
            data-import-initials-input={slot.key}
            type="text"
            autocomplete="off"
            spellcheck="false"
            maxlength={6}
            placeholder="-"
            bind:value={values[slot.key]}
            class="field-control h-7 w-full rounded px-1.5 text-center text-xs font-medium uppercase text-ink"
          />
          <div class="flex items-center justify-between pt-0.5">
            <button
              type="button"
              disabled={index === 0 || saving}
              aria-label={`Move ${slot.label} initials left`}
              data-import-initials-shift-left={slot.key}
              onclick={() => swapSlots(index, index - 1)}
              class="flex size-6 items-center justify-center rounded text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink disabled:opacity-30"
            >
              <ArrowLeftIcon size="0.75rem" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={index === SLOTS.length - 1 || saving}
              aria-label={`Move ${slot.label} initials right`}
              data-import-initials-shift-right={slot.key}
              onclick={() => swapSlots(index, index + 1)}
              class="flex size-6 items-center justify-center rounded text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink disabled:opacity-30"
            >
              <ArrowRightIcon size="0.75rem" aria-hidden="true" />
            </button>
          </div>
        </div>
      {/each}
    </div>

    {#if values.reviewer.trim() !== ""}
      <label class={`flex items-center gap-2 ${SHEET_SMALL} text-ink-secondary`}>
        <input
          type="checkbox"
          data-import-initials-reviewer-in-progress
          bind:checked={inProgress}
          class="size-3.5 rounded border-line accent-fir"
        />
        <span>Reviewer in progress (lowercase initials)</span>
      </label>
    {/if}

    {#if error}
      <p role="alert" class="text-xs text-danger-ink-muted">{error}</p>
    {/if}

    {#if dirty}
      <div class="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          data-import-initials-save
          class="h-7 rounded-md bg-fir px-3 text-xs font-medium text-white disabled:opacity-50"
        >{saving ? "Saving..." : "Save initials"}</button>
      </div>
    {/if}
  </form>
</section>
