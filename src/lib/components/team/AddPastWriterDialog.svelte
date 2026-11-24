<script lang="ts">
  // Team, add or edit a person without a Banhall login (former staff or
  // current writers/reviewers pre-entered before uploading PDs). Admins set
  // their name, initials, PD staff role, active/former status, and (when
  // creating) an optional custom weight.
  import TeamDialog from "./TeamDialog.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import { userErrorMessage } from "$lib/errors";
  import {
    INITIALS_RULE,
    looksLikeEmail,
    savedInitials,
  } from "../../../../shared/importSheetRules";
  import {
    defaultWeightForStaffRole,
    parseWriterWeight,
    WRITER_STAFF_ROLES,
    WRITER_STAFF_ROLE_DEFAULT_WEIGHTS,
    WRITER_STAFF_ROLE_LABELS,
    WRITER_WEIGHT_RULE,
    writerWeightText,
    type WriterStaffRole,
  } from "../../../../shared/writerWeight";

  export type PastWriterFormValues = {
    name: string;
    initials: string;
    staffRole: WriterStaffRole | null;
    isActive: boolean;
    weight: number | null;
  };

  let {
    open = $bindable(false),
    mode = "create",
    canSetWeight = false,
    initialName = null,
    initialInitials = null,
    initialStaffRole = null,
    initialIsActive = true,
    onSubmit,
  }: {
    open?: boolean;
    mode?: "create" | "edit";
    canSetWeight?: boolean;
    initialName?: string | null;
    initialInitials?: string | null;
    initialStaffRole?: WriterStaffRole | null;
    initialIsActive?: boolean;
    onSubmit: (values: PastWriterFormValues) => Promise<unknown>;
  } = $props();

  let name = $state("");
  let initials = $state("");
  let staffRole = $state<WriterStaffRole | "">("");
  let isActive = $state(true);
  let weightText = $state("");
  let saving = $state(false);
  let error = $state("");
  let nameInput: HTMLInputElement | null = $state(null);

  $effect(() => {
    if (open) {
      name = initialName ?? "";
      initials = initialInitials ?? "";
      staffRole = initialStaffRole ?? "";
      isActive = initialIsActive ?? true;
      weightText = "";
      error = "";
    }
  });

  const selectedStaffRole = $derived<WriterStaffRole | null>(staffRole === "" ? null : staffRole);
  const roleDefaultText = $derived(writerWeightText(defaultWeightForStaffRole(selectedStaffRole)));
  const title = $derived(mode === "create" ? "Add person without login" : "Edit initials and status");
  const description = $derived(
    mode === "create"
      ? "Pre-enter current or former staff so Import matches their initials in PD filenames right away."
      : "Update this person's initials, PD role, or active status. They still have no login."
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    const cleanName = name.trim();
    const cleanedInitials = savedInitials(initials);
    if (cleanedInitials === null) {
      error = INITIALS_RULE;
      return;
    }
    if (looksLikeEmail(cleanName)) {
      error = "Type the writer's name, not an email address.";
      return;
    }
    if (mode === "create" && !cleanName) {
      error = "Type the person's name.";
      return;
    }
    if (!cleanName && !cleanedInitials) {
      error = "Enter a name, initials, or both.";
      return;
    }
    let parsedWeight: number | null = null;
    if (mode === "create" && canSetWeight) {
      const parsed = parseWriterWeight(weightText);
      if (parsed === "invalid") {
        error = WRITER_WEIGHT_RULE;
        return;
      }
      parsedWeight = parsed;
    }
    saving = true;
    error = "";
    try {
      await onSubmit({
        name: cleanName,
        initials: cleanedInitials,
        staffRole: selectedStaffRole,
        isActive,
        weight: parsedWeight,
      });
      open = false;
    } catch (cause) {
      error = userErrorMessage(cause, "Could not save this person. Try again.");
    } finally {
      saving = false;
    }
  }
</script>

<TeamDialog
  bind:open
  width={460}
  busy={saving}
  testId="past-writer-dialog"
  initialFocus={() => nameInput}
  {title}
  {description}
>
  <form id="past-writer-form" class="flex flex-col gap-4 px-7 pt-5" onsubmit={submit} novalidate>
    <div class="flex flex-col gap-1.5">
      <label for="past-writer-name" class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">Name</label>
      <Input
        bind:ref={nameInput}
        id="past-writer-name"
        data-past-writer-name-input
        type="text"
        autocomplete="off"
        maxlength={120}
        placeholder="Dana Whitlock"
        bind:value={name}
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="past-writer-initials" class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">Initials</label>
      <Input
        id="past-writer-initials"
        data-past-writer-initials-input
        type="text"
        autocomplete="off"
        spellcheck="false"
        maxlength={8}
        placeholder="DW"
        bind:value={initials}
        class="w-32 uppercase"
      />
      <p class="text-xs leading-[calc(4/3)] text-ink-muted">1 to 4 letters, matched against PD filenames during Import.</p>
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="past-writer-staff-role" class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">PD staff role</label>
      <select
        id="past-writer-staff-role"
        data-past-writer-staff-role-select
        bind:value={staffRole}
        class="field-control h-9 w-full rounded-lg px-3 text-sm text-ink"
      >
        <option value="">{canSetWeight ? "Not set (default weight 0.7)" : "Not set"}</option>
        {#each WRITER_STAFF_ROLES as role (role)}
          {@const w = WRITER_STAFF_ROLE_DEFAULT_WEIGHTS[role]}
          <option value={role}>
            {#if canSetWeight}
              {WRITER_STAFF_ROLE_LABELS[role]} ({w !== null ? `default weight ${writerWeightText(w)}` : "unweighted"})
            {:else}
              {WRITER_STAFF_ROLE_LABELS[role]}
            {/if}
          </option>
        {/each}
      </select>
    </div>

    <fieldset class="flex flex-col gap-1.5">
      <legend class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">Status</legend>
      <div class="flex gap-2">
        <button
          type="button"
          data-past-writer-status="active"
          aria-pressed={isActive}
          onclick={() => (isActive = true)}
          class={`h-9 flex-1 rounded-lg border px-3 text-sm font-medium transition-colors ${
            isActive ? "border-fir bg-primary-wash text-ink" : "border-line bg-surface text-ink-muted hover:text-ink"
          }`}
        >Current staff</button>
        <button
          type="button"
          data-past-writer-status="former"
          aria-pressed={!isActive}
          onclick={() => (isActive = false)}
          class={`h-9 flex-1 rounded-lg border px-3 text-sm font-medium transition-colors ${
            !isActive ? "border-fir bg-primary-wash text-ink" : "border-line bg-surface text-ink-muted hover:text-ink"
          }`}
        >Former staff</button>
      </div>
    </fieldset>

    {#if mode === "create" && canSetWeight}
      <div class="flex flex-col gap-1.5">
        <label for="past-writer-weight" class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">Custom weight (optional)</label>
        <Input
          id="past-writer-weight"
          data-past-writer-weight-input
          type="text"
          inputmode="decimal"
          autocomplete="off"
          spellcheck="false"
          maxlength={8}
          placeholder={roleDefaultText}
          bind:value={weightText}
          class="w-32"
        />
        <p class="text-xs leading-[calc(4/3)] text-ink-muted">
          Leave empty to use {roleDefaultText} from their PD role. Only workspace owners and developers see weights.
        </p>
      </div>
    {/if}

    {#if error}
      <p role="alert" class="rounded-[0.625rem] border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted">{error}</p>
    {/if}
  </form>
  {#snippet footer()}
    <div class="mt-5 flex items-center justify-end gap-2 border-t border-line-soft py-4 pl-7 pr-5">
      <button type="button" disabled={saving} onclick={() => (open = false)} class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-[calc(10/7)] font-medium text-ink hover:bg-primary-wash disabled:opacity-50">Cancel</button>
      <button type="submit" form="past-writer-form" data-past-writer-save disabled={saving} class="h-9 rounded-lg bg-fir px-4 text-sm leading-[calc(10/7)] font-medium text-white disabled:opacity-50">{saving ? "Saving..." : mode === "create" ? "Add person" : "Save"}</button>
    </div>
  {/snippet}
</TeamDialog>
