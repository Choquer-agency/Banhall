<script lang="ts">
  // Team, "Set weight" (writer weights, 2026-11-18 (second)): one field for
  // how much a person's imported final PDs count when the AI looks for past
  // examples in the Brain. A number from 0 to 1; empty goes back to the
  // default (0.7). Admins only, like the menu that opens it; the server
  // refuses anything else in the same words shown here.
  import TeamDialog from "./TeamDialog.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import { userErrorMessage } from "$lib/errors";
  import {
    defaultWeightForStaffRole,
    parseWriterWeight,
    WRITER_STAFF_ROLE_DEFAULT_WEIGHTS,
    WRITER_STAFF_ROLE_LABELS,
    WRITER_WEIGHT_RULE,
    writerWeightText,
    type WriterStaffRole,
  } from "../../../../shared/writerWeight";

  let {
    open = $bindable(false),
    name,
    weight,
    staffRole = null,
    onSubmit,
  }: {
    open?: boolean;
    /** The person or past writer, as Team shows them. */
    name: string;
    /** The weight saved now, or null when they use the default. */
    weight: number | null;
    /** The person's Banhall PD staff role, if set. */
    staffRole?: WriterStaffRole | null;
    onSubmit: (weight: number | null) => Promise<unknown>;
  } = $props();

  let value = $state("");
  let saving = $state(false);
  let error = $state("");
  let input: HTMLInputElement | null = $state(null);

  $effect(() => {
    if (open) {
      value = weight === null ? "" : writerWeightText(weight);
      error = "";
    }
  });

  const roleDefault = $derived(staffRole ? WRITER_STAFF_ROLE_DEFAULT_WEIGHTS[staffRole] : null);
  const defaultText = $derived(writerWeightText(defaultWeightForStaffRole(staffRole)));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    const parsed = parseWriterWeight(value);
    if (parsed === "invalid") {
      error = WRITER_WEIGHT_RULE;
      return;
    }
    saving = true;
    error = "";
    try {
      await onSubmit(parsed);
      open = false;
    } catch (cause) {
      error = userErrorMessage(cause, "The weight could not be saved. Try again.");
    } finally {
      saving = false;
    }
  }
</script>

<TeamDialog
  bind:open
  width={460}
  busy={saving}
  testId="writer-weight-dialog"
  initialFocus={() => input}
  title={`Weight for ${name}`}
  description="Ranks this writer's past PDs when the AI looks for examples in the Brain. 1 is the highest."
>
  <form id="writer-weight-form" class="flex flex-col gap-1.5 px-7 pt-5" onsubmit={submit} novalidate>
    <label for="writer-weight" class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">Weight</label>
    <Input
      bind:ref={input}
      id="writer-weight"
      data-writer-weight-input
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      maxlength={8}
      placeholder={defaultText}
      bind:value
      aria-invalid={error ? "true" : undefined}
      aria-describedby="writer-weight-help"
      class="w-32"
    />
    <p id="writer-weight-help" class="text-xs leading-[calc(4/3)] text-ink-muted">
      {#if roleDefault !== null && staffRole}
        A number from 0 to 1, with up to 3 decimal places. Leave it empty to use {defaultText}, the {WRITER_STAFF_ROLE_LABELS[staffRole]} default.
      {:else}
        A number from 0 to 1, with up to 3 decimal places. Leave it empty to use {defaultText}, the weight for writers with none.
      {/if}
    </p>
    <p data-writer-weight-note class="mt-1 text-xs leading-[calc(4/3)] text-ink-muted">
      Their PDs already in the Brain take the new weight within a few minutes.
    </p>
    {#if error}
      <p role="alert" class="mt-1 rounded-[0.625rem] border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted">{error}</p>
    {/if}
  </form>
  {#snippet footer()}
    <div class="mt-5 flex items-center justify-end gap-2 border-t border-line-soft py-4 pl-7 pr-5">
      <button type="button" disabled={saving} onclick={() => (open = false)} class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-[calc(10/7)] font-medium text-ink hover:bg-primary-wash disabled:opacity-50">Cancel</button>
      <button type="submit" form="writer-weight-form" data-writer-weight-save disabled={saving} class="h-9 rounded-lg bg-fir px-4 text-sm leading-[calc(10/7)] font-medium text-white disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
    </div>
  {/snippet}
</TeamDialog>
