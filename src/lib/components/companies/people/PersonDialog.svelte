<!--
  Add person and Edit person (2026-11-04, Paper "People / Add person" and
  "People / Add person, required fields missing"): first name, last name,
  role and email are required (marked *), the phone is optional, and the
  Main contact box marks this person as the company's main contact. Errors
  show under each field once the person tries to save; a field's error
  clears as soon as it is fixed. The host saves through `onSave`, which
  rejects with a message the dialog shows above its buttons.
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import { modalPop, overlayFade } from "$lib/motion";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import { checkContact, type ContactField } from "../../../../../shared/companyContacts";
  import type { PersonDraft } from "./peopleFormat";

  let {
    open = $bindable(false),
    mode,
    companyName,
    initial,
    onSave,
  }: {
    open?: boolean;
    mode: "add" | "edit";
    companyName: string;
    /** The person as the dialog opens (empty fields to add someone). */
    initial: PersonDraft;
    /** Saves the person; a rejection's message is shown in the dialog. */
    onSave: (person: PersonDraft) => Promise<void>;
  } = $props();

  let draft = $state<PersonDraft>({ firstName: "", lastName: "", role: "", email: "", phone: "", isMain: false });
  let tried = $state(false);
  let saving = $state(false);
  let failure = $state<string | null>(null);

  // Each opening starts from the person it opened with.
  let wasOpen = false;
  $effect.pre(() => {
    if (open && !wasOpen) {
      draft = { ...initial };
      tried = false;
      saving = false;
      failure = null;
    }
    wasOpen = open;
  });

  const errors = $derived(tried ? checkContact(draft).errors : {});
  const title = $derived(mode === "add" ? "Add person" : "Edit person");
  const emailPlaceholder = $derived(`name@${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "company"}.example`);

  const FIELD_ORDER: ContactField[] = ["firstName", "lastName", "role", "email", "phone"];

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    tried = true;
    failure = null;
    const found = checkContact(draft).errors;
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      document.getElementById(`person-${first}`)?.focus();
      return;
    }
    saving = true;
    try {
      await onSave({ ...draft });
      open = false;
    } catch (error) {
      failure = error instanceof Error && error.message ? error.message : "This person could not be saved. Try again.";
    } finally {
      saving = false;
    }
  }

  const label = "text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink";
  const errorLine = "text-xs leading-[calc(4/3)] text-danger-ink-muted";
</script>

{#snippet required()}<span class="text-danger-ink-muted" aria-hidden="true"> *</span>{/snippet}

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}<div {...props} transition:overlayFade class="fixed inset-0 z-[105] bg-form-dialog-scrim"></div>{/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[105] flex items-center justify-center p-4">
      <Dialog.Content
        forceMount
        onEscapeKeydown={(event) => saving && event.preventDefault()}
        onInteractOutside={(event) => saving && event.preventDefault()}
      >
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:modalPop
              data-person-dialog={mode}
              class="pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-[27.5rem] max-w-full flex-col overflow-y-auto rounded-xl bg-surface p-6 shadow-dialog outline-none"
            >
              <form class="flex flex-col gap-5" novalidate onsubmit={submit}>
                <div class="flex items-start gap-3">
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <Dialog.Title class="text-[0.9375rem] leading-[calc(4/3)] font-medium text-ink">{title}</Dialog.Title>
                    <Dialog.Description class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">
                      Fields marked <span class="text-danger-ink-muted">*</span> are required.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close
                    type="button"
                    aria-label="Close"
                    disabled={saving}
                    class="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none pointer-coarse:size-11"
                  >
                    <svg viewBox="0 0 24 24" class="size-[0.9375rem]" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                  </Dialog.Close>
                </div>

                <div class="flex flex-col gap-3.5">
                  <div class="flex gap-3">
                    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                      <label for="person-firstName" class={label}>First name{@render required()}</label>
                      <input
                        id="person-firstName"
                        bind:value={draft.firstName}
                        autocomplete="off"
                        aria-required="true"
                        aria-invalid={errors.firstName ? "true" : undefined}
                        aria-describedby={errors.firstName ? "person-firstName-error" : undefined}
                        class="field-control h-9 w-full rounded-lg px-3 text-sm leading-[calc(9/7)] text-ink placeholder:text-ink-faint aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-danger-ink-muted)]! motion-reduce:transition-none pointer-coarse:h-11"
                      />
                      {#if errors.firstName}<p id="person-firstName-error" class={errorLine}>{errors.firstName}</p>{/if}
                    </div>
                    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                      <label for="person-lastName" class={label}>Last name{@render required()}</label>
                      <input
                        id="person-lastName"
                        bind:value={draft.lastName}
                        autocomplete="off"
                        aria-required="true"
                        aria-invalid={errors.lastName ? "true" : undefined}
                        aria-describedby={errors.lastName ? "person-lastName-error" : undefined}
                        class="field-control h-9 w-full rounded-lg px-3 text-sm leading-[calc(9/7)] text-ink placeholder:text-ink-faint aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-danger-ink-muted)]! motion-reduce:transition-none pointer-coarse:h-11"
                      />
                      {#if errors.lastName}<p id="person-lastName-error" class={errorLine}>{errors.lastName}</p>{/if}
                    </div>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <label for="person-role" class={label}>Role{@render required()}</label>
                    <input
                      id="person-role"
                      bind:value={draft.role}
                      placeholder="For example, CFO"
                      autocomplete="off"
                      aria-required="true"
                      aria-invalid={errors.role ? "true" : undefined}
                      aria-describedby={errors.role ? "person-role-error" : undefined}
                      class="field-control h-9 w-full rounded-lg px-3 text-sm leading-[calc(9/7)] text-ink placeholder:text-ink-faint aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-danger-ink-muted)]! motion-reduce:transition-none pointer-coarse:h-11"
                    />
                    {#if errors.role}<p id="person-role-error" class={errorLine}>{errors.role}</p>{/if}
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <label for="person-email" class={label}>Email{@render required()}</label>
                    <input
                      id="person-email"
                      type="email"
                      bind:value={draft.email}
                      placeholder={emailPlaceholder}
                      autocomplete="off"
                      aria-required="true"
                      aria-invalid={errors.email ? "true" : undefined}
                      aria-describedby={errors.email ? "person-email-error" : undefined}
                      class="field-control h-9 w-full rounded-lg px-3 text-sm leading-[calc(9/7)] text-ink placeholder:text-ink-faint aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-danger-ink-muted)]! motion-reduce:transition-none pointer-coarse:h-11"
                    />
                    {#if errors.email}<p id="person-email-error" class={errorLine}>{errors.email}</p>{/if}
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-baseline gap-1.5">
                      <label for="person-phone" class={label}>Phone</label>
                      <span class="text-xs leading-[calc(4/3)] text-ink-muted">Optional</span>
                    </div>
                    <input
                      id="person-phone"
                      type="tel"
                      bind:value={draft.phone}
                      autocomplete="off"
                      aria-invalid={errors.phone ? "true" : undefined}
                      aria-describedby={errors.phone ? "person-phone-error" : undefined}
                      class="field-control h-9 w-full rounded-lg px-3 text-sm leading-[calc(9/7)] text-ink placeholder:text-ink-faint aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-danger-ink-muted)]! motion-reduce:transition-none pointer-coarse:h-11"
                    />
                    {#if errors.phone}<p id="person-phone-error" class={errorLine}>{errors.phone}</p>{/if}
                  </div>

                  <div class="pt-0.5 text-[0.8125rem] leading-[calc(16/13)] text-ink" data-person-main>
                    <Checkbox id="person-isMain" bind:checked={draft.isMain} labelText="Main contact" />
                  </div>
                </div>

                {#if failure}
                  <p role="alert" class="-mt-1 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted" data-person-failure>{failure}</p>
                {/if}

                <div class="flex justify-end gap-2">
                  <Dialog.Close
                    type="button"
                    disabled={saving}
                    class="flex h-[2.125rem] items-center rounded-[0.5625rem] border border-line bg-surface px-3.5 text-sm leading-[calc(9/7)] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
                  >Cancel</Dialog.Close>
                  <button
                    type="submit"
                    disabled={saving}
                    data-person-save
                    class="flex h-[2.125rem] items-center rounded-[0.5625rem] bg-primary-selected px-3.5 text-sm leading-[calc(9/7)] font-medium text-white transition-colors hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11"
                  >{mode === "add" ? "Add person" : "Save changes"}</button>
                </div>
              </form>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
