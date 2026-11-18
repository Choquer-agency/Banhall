<!--
  An approved file's details in the file view (2026-11-17,
  docs/product-domain.md: edit after approval and Send back to review),
  Admins only like the whole Import page. A note says what changing them
  does and does not do (APPROVED_EDIT_NOTE), then each detail the file
  takes (the shared rule, approvedEditApplies): Writer and Reviewer (the
  writer picker; a reviewer can also be cleared), Science code (a final
  PD), PD title (the shared Input, saved with Save or Enter) and "Reviewed
  by CRA" (a final PD). Each change is saved on its own (editApprovedFile)
  and sets this file alone. Then "Send back to review", which shows its
  confirm in place; once the file is sent back the view closes.
-->
<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { CaretDownIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import Button from "$lib/components/ui/Button.svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import ScienceCodeList from "$lib/components/project/details/ScienceCodeList.svelte";
  import ImportPickerPopover from "./ImportPickerPopover.svelte";
  import ImportSendBackConfirm from "./ImportSendBackConfirm.svelte";
  import ImportWriterList from "./ImportWriterList.svelte";
  import { editApproved, sendBackFiles, type ApprovedEditPatch } from "./importActions";
  import { APPROVED_EDIT_NOTE, approvedEdits, CRA_REVIEWED, PD_TITLE_MAX, type ApprovedEditField } from "./importApproved";
  import { scienceCodeDisplay } from "$lib/components/project/details/detailsFormat";
  import type { SheetFileRow } from "./importFormat";
  import { CHOICE_ROW, SHEET_SMALL } from "./sheetLayout";

  let {
    file,
    onSentBack,
  }: {
    file: Pick<
      SheetFileRow,
      "_id" | "status" | "category" | "writerId" | "writerName" | "reviewerId" | "reviewerName" | "scienceCode" | "pdTitle" | "craReviewed"
    >;
    onSentBack: () => void;
  } = $props();

  const editApprovedFile = useMutation(api.ingestion.editApprovedFile);
  const sendBackToReview = useMutation(api.ingestion.sendBackToReview);

  const can = $derived(approvedEdits(file));
  let busy = $state(false);
  let confirming = $state(false);
  let title = $state("");
  // The title box starts from the stored title, and again whenever it changes on the server.
  $effect.pre(() => {
    title = file.pdTitle ?? "";
  });
  const titleChanged = $derived(title.trim().replace(/\s+/g, " ") !== (file.pdTitle ?? ""));

  async function save(field: ApprovedEditField, patch: ApprovedEditPatch) {
    if (busy) return;
    busy = true;
    try {
      await editApproved(file._id, field, patch, editApprovedFile);
    } finally {
      busy = false;
    }
  }

  async function sendBack() {
    if (busy) return;
    busy = true;
    try {
      const { result } = await sendBackFiles([file._id], sendBackToReview);
      if (result.sentBack.includes(file._id)) onSentBack();
    } finally {
      busy = false;
      confirming = false;
    }
  }

  const code = $derived(file.scienceCode ? scienceCodeDisplay(file.scienceCode) : null);
  const FIELD_BUTTON =
    "field-control flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-3 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-60 data-[state=open]:text-ink pointer-coarse:h-11";
</script>

<section data-import-approved-details class="mt-6" aria-labelledby="import-approved-details">
  <h3 id="import-approved-details" class={`${SHEET_SMALL} tracking-[0.04em] text-ink-muted uppercase`}>Details</h3>
  <p class="mt-1.5 text-xs leading-[1.5] text-ink-muted">{APPROVED_EDIT_NOTE}</p>

  <div class="mt-3 grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
    {#if can.writer}
      <span class={`${SHEET_SMALL} text-ink-muted`} id="import-approved-writer">Writer</span>
      <ImportPickerPopover label="Writer">
        {#snippet trigger({ props })}
          <button {...props} type="button" disabled={busy} aria-labelledby="import-approved-writer" aria-describedby="import-approved-writer-value" data-import-approved-writer class={FIELD_BUTTON}>
            <span id="import-approved-writer-value" class="min-w-0 flex-1 truncate">{file.writerName ?? "No writer"}</span>
            <CaretDownIcon size="0.75rem" aria-hidden="true" class="shrink-0 text-ink-muted" />
          </button>
        {/snippet}
        {#snippet content({ close })}
          <ImportWriterList
            currentWriterId={file.writerId ?? null}
            onPick={(picked) => {
              close();
              if (!picked.current) void save("writer", { writer: picked.choice });
            }}
          />
        {/snippet}
      </ImportPickerPopover>
    {/if}

    {#if can.reviewer}
      <span class={`${SHEET_SMALL} text-ink-muted`} id="import-approved-reviewer">Reviewer</span>
      <ImportPickerPopover label="Reviewer">
        {#snippet trigger({ props })}
          <button {...props} type="button" disabled={busy} aria-labelledby="import-approved-reviewer" aria-describedby="import-approved-reviewer-value" data-import-approved-reviewer class={FIELD_BUTTON}>
            <span id="import-approved-reviewer-value" class="min-w-0 flex-1 truncate">{file.reviewerName ?? "No reviewer"}</span>
            <CaretDownIcon size="0.75rem" aria-hidden="true" class="shrink-0 text-ink-muted" />
          </button>
        {/snippet}
        {#snippet content({ close })}
          <ImportWriterList
            role="reviewer"
            currentWriterId={file.reviewerId ?? null}
            onPick={(picked) => {
              close();
              if (!picked.current) void save("reviewer", { reviewer: picked.choice });
            }}
          />
          {#if file.reviewerId}
            <div class="border-t border-line-soft p-1.5">
              <button
                type="button"
                data-import-approved-reviewer-clear
                onclick={() => {
                  close();
                  void save("reviewer", { reviewer: null });
                }}
                class={CHOICE_ROW}
              >No reviewer</button>
            </div>
          {/if}
        {/snippet}
      </ImportPickerPopover>
    {/if}

    {#if can.scienceCode}
      <span class={`${SHEET_SMALL} text-ink-muted`} id="import-approved-code">Science code</span>
      <ImportPickerPopover label="Science code" align="end" width="w-[22rem]">
        {#snippet trigger({ props })}
          <button {...props} type="button" disabled={busy} aria-labelledby="import-approved-code" aria-describedby="import-approved-code-value" data-import-approved-code class={FIELD_BUTTON}>
            <span id="import-approved-code-value" class="min-w-0 flex-1 truncate">
              {#if file.scienceCode}{file.scienceCode}{#if code && code.label !== file.scienceCode}{" "}<span class="text-ink-muted">{code.label}</span>{/if}{:else}No science code{/if}
            </span>
            <CaretDownIcon size="0.75rem" aria-hidden="true" class="shrink-0 text-ink-muted" />
          </button>
        {/snippet}
        {#snippet content({ close })}
          <ScienceCodeList
            value={file.scienceCode ?? null}
            clearable={false}
            onSelect={(picked) => {
              close();
              if (picked && picked !== file.scienceCode) void save("scienceCode", { scienceCode: picked });
            }}
          />
        {/snippet}
      </ImportPickerPopover>
    {/if}

    {#if can.pdTitle}
      <label for="import-approved-title" class={`${SHEET_SMALL} text-ink-muted`}>PD title</label>
      <form
        class="flex min-w-0 items-center gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          if (titleChanged) void save("pdTitle", { pdTitle: title });
        }}
      >
        <div class="min-w-0 flex-1">
          <Input
            id="import-approved-title"
            bind:value={title}
            maxlength={PD_TITLE_MAX}
            disabled={busy}
            placeholder="No title"
            data-import-approved-title
            class="h-9 py-0! text-[0.8125rem]! leading-[calc(18/13)]"
          />
        </div>
        <Button type="submit" variant="secondary" size="xs" disabled={busy || !titleChanged} data-import-approved-title-save>Save</Button>
      </form>
    {/if}

    {#if can.craReviewed}
      <span class={`${SHEET_SMALL} text-ink-muted`}>CRA</span>
      <div class="flex min-h-9 items-center">
        <!-- Function bindings: the box always shows what is saved, never a refused change. -->
        <Checkbox
          bind:checked={() => file.craReviewed === true, (value) => void save("craReviewed", { craReviewed: value === true })}
          disabled={busy}
          labelText={CRA_REVIEWED}
          data-import-approved-cra
        />
      </div>
    {/if}
  </div>

  <div class="mt-5 border-t border-line-soft pt-4">
    {#if confirming}
      <ImportSendBackConfirm count={1} {busy} onConfirm={() => void sendBack()} />
      <button
        type="button"
        data-import-send-back-cancel
        onclick={() => (confirming = false)}
        class="mt-1.5 flex min-h-8 w-full items-center justify-center rounded-md text-[0.8125rem] leading-[calc(18/13)] text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:min-h-11"
      >Keep it approved</button>
    {:else}
      <Button type="button" variant="secondary" size="xs" disabled={busy} onclick={() => (confirming = true)} data-import-approved-send-back>
        Send back to review
      </Button>
    {/if}
  </div>
</section>
