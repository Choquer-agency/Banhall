<!--
  A company's People tab (2026-11-04, the company profile; Paper section 5:
  "People / Cedarline contacts, row menu open", "People / No one added yet").
  The company's own contacts, not Banhall users: a table of Name (initials,
  the role under the name, the Main contact badge), Email, Phone ("Not
  added" when there is none), Added and a row menu (Edit, Make main contact,
  Remove). "Find a person" narrows the list; Add person and the row menu
  are for people who may manage contacts (`canManage`); everyone else reads
  the list only. Mounted by CompanyView; its reads stop while hidden.
-->
<script lang="ts">
  import { AlertDialog, DropdownMenu } from "bits-ui";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import { userErrorMessage } from "$lib/errors";
  import { modalPop, overlayFade } from "$lib/motion";
  import PersonDialog from "./PersonDialog.svelte";
  import {
    EMPTY_PERSON,
    addedLabel,
    personInitials,
    personMatches,
    personName,
    type PersonDraft,
  } from "./peopleFormat";

  let {
    companyKey,
    companyName,
    active = false,
    canManage = false,
    onCount = undefined,
  }: {
    companyKey: string;
    companyName: string;
    /** Shown; reads stop while hidden. */
    active?: boolean;
    /** Add, edit, mark and remove contacts (companyContacts.manage). */
    canManage?: boolean;
    /** The number of contacts for the tab's count (read even while hidden); null while unknown. */
    onCount?: (count: number | null) => void;
  } = $props();

  const auth = useAuth();
  const contactsQ = useQuery(api.companyContacts.listCompanyContacts, () =>
    auth.isAuthenticated && active ? { companyKey } : "skip"
  );
  // The tab's count, read while the tab is mounted even when another tab shows.
  const countQ = useQuery(api.companyContacts.countCompanyContacts, () =>
    auth.isAuthenticated ? { companyKey } : "skip"
  );
  const addContact = useMutation(api.companyContacts.addCompanyContact);
  const updateContact = useMutation(api.companyContacts.updateCompanyContact);
  const setMainContact = useMutation(api.companyContacts.setMainCompanyContact);
  const removeContact = useMutation(api.companyContacts.removeCompanyContact);

  type Contact = NonNullable<typeof contactsQ.data>["contacts"][number];

  const contacts = $derived(contactsQ.data?.contacts ?? []);
  const loading = $derived(contactsQ.data === undefined && !contactsQ.error);
  let search = $state("");
  const shown = $derived(contacts.filter((contact) => personMatches(contact, search)));

  $effect(() => {
    if (!onCount) return;
    onCount(countQ.data ? countQ.data.count : null);
  });

  // ─── Add and edit ─────────────────────────────────────────────────────────
  let dialogOpen = $state(false);
  let dialogMode = $state<"add" | "edit">("add");
  let editing = $state<Contact | null>(null);
  let dialogInitial = $state<PersonDraft>({ ...EMPTY_PERSON });

  function openAdd() {
    dialogMode = "add";
    editing = null;
    dialogInitial = { ...EMPTY_PERSON, isMain: contacts.length === 0 };
    dialogOpen = true;
  }

  function openEdit(contact: Contact) {
    dialogMode = "edit";
    editing = contact;
    dialogInitial = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      role: contact.role,
      email: contact.email,
      phone: contact.phone ?? "",
      isMain: contact.isMain,
    };
    dialogOpen = true;
  }

  async function save(person: PersonDraft) {
    const fields = {
      firstName: person.firstName,
      lastName: person.lastName,
      role: person.role,
      email: person.email,
      phone: person.phone,
      isMain: person.isMain,
    };
    try {
      if (dialogMode === "edit" && editing) {
        await updateContact({ contactId: editing._id, ...fields });
      } else {
        await addContact({ companyKey, ...fields });
      }
    } catch (error) {
      throw new Error(userErrorMessage(error, "This person could not be saved. Try again."));
    }
  }

  // ─── Row actions ──────────────────────────────────────────────────────────
  let actionError = $state<string | null>(null);

  async function makeMain(contact: Contact) {
    actionError = null;
    try {
      await setMainContact({ contactId: contact._id });
    } catch (error) {
      actionError = userErrorMessage(error, `${personName(contact)} could not be made the main contact. Try again.`);
    }
  }

  let removeOpen = $state(false);
  let removing = $state<Contact | null>(null);

  async function remove(contactId: Id<"companyContacts">, name: string) {
    actionError = null;
    try {
      await removeContact({ contactId });
    } catch (error) {
      actionError = userErrorMessage(error, `${name} could not be removed. Try again.`);
    }
  }

  const columns = "grid grid-cols-[16.25rem_13.75rem_9.375rem_minmax(0,1fr)_2rem] items-center gap-6 pl-4 pr-3";
  const addButton =
    "flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary-highlight pl-2.5 pr-3 text-[0.8125rem] leading-[calc(16/13)] font-medium text-primary-selected transition-colors hover:bg-primary-line-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
  const menuItem =
    "flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink pointer-coarse:min-h-11";
</script>

{#snippet plusIcon()}
  <svg viewBox="0 0 24 24" class="size-3.5" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
{/snippet}

<section class="flex flex-col" data-company-people aria-labelledby="company-people-title">
  <div class="flex flex-wrap items-end gap-3">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <h2 id="company-people-title" class="font-serif text-2xl leading-[calc(4/3)] font-normal text-ink">People</h2>
      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Your contacts at {companyName}.</p>
    </div>
    {#if contacts.length > 0}
      <label class="field-control-shell flex h-8 w-[12.5rem] shrink-0 items-center gap-2 rounded-lg px-2.5 pointer-coarse:h-11">
        <svg viewBox="0 0 24 24" class="size-[0.8125rem] shrink-0 text-ink-muted" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span class="sr-only">Find a person</span>
        <input
          type="search"
          bind:value={search}
          placeholder="Find a person"
          data-people-search
          class="input-chromeless min-w-0 flex-1 bg-transparent text-[0.8125rem] leading-[calc(16/13)] text-ink placeholder:text-ink-faint"
        />
      </label>
    {/if}
    {#if canManage && contacts.length > 0}
      <button type="button" class={addButton} onclick={openAdd} data-people-add>
        {@render plusIcon()}
        Add person
      </button>
    {/if}
  </div>

  {#if actionError}
    <p role="alert" class="mt-4 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted" data-people-error>{actionError}</p>
  {/if}

  {#if contactsQ.error}
    <div class="mt-6 rounded-xl border border-line px-4 py-10 text-center text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-people-failed>
      The contacts could not be loaded. Reload the page to try again.
    </div>
  {:else if loading}
    <div class="mt-6 overflow-hidden rounded-xl border border-line" aria-busy="true" aria-label="Loading contacts" data-people-loading>
      <div class={`${columns} h-10 border-b border-line bg-gray-50`}></div>
      {#each [0, 1, 2] as row (row)}
        <div class={`${columns} h-[3.75rem] border-b border-line-soft last:border-b-0`}>
          <div class="flex items-center gap-2.5"><span class="size-[1.875rem] rounded-full bg-skeleton-chip"></span><span class="h-3 w-28 rounded bg-skeleton-line"></span></div>
          <span class="h-3 w-36 rounded bg-skeleton-line"></span>
          <span class="h-3 w-20 rounded bg-skeleton-line"></span>
          <span class="h-3 w-20 rounded bg-skeleton-line"></span>
          <span></span>
        </div>
      {/each}
    </div>
  {:else if contacts.length === 0}
    <div class="mt-6 flex h-[17.5rem] flex-col items-center justify-center gap-3 rounded-xl border border-line px-4 text-center" data-people-empty>
      <span class="flex size-11 items-center justify-center rounded-full bg-gray-50 text-ink-muted">
        <svg viewBox="0 0 24 24" class="size-5" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <div class="flex flex-col items-center gap-1">
        <p class="text-sm leading-[calc(10/7)] font-medium text-ink">No one added yet</p>
        <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">
          {canManage ? `Add the people you talk to at ${companyName}.` : `No one has added contacts for ${companyName} yet.`}
        </p>
      </div>
      {#if canManage}
        <button type="button" class={addButton} onclick={openAdd} data-people-add>
          {@render plusIcon()}
          Add person
        </button>
      {/if}
    </div>
  {:else}
    <div class="mt-6 overflow-x-auto rounded-xl border border-line" data-people-table>
      <div role="table" aria-label={`Contacts at ${companyName}`} class="min-w-[50rem]">
        <div role="rowgroup">
          <div role="row" class={`${columns} h-10 border-b border-line bg-gray-50 text-xs leading-[calc(4/3)] text-ink-muted`}>
            <span role="columnheader">Name</span>
            <span role="columnheader">Email</span>
            <span role="columnheader">Phone</span>
            <span role="columnheader">Added</span>
            <span role="columnheader"><span class="sr-only">Actions</span></span>
          </div>
        </div>
        <div role="rowgroup">
          {#each shown as contact (contact._id)}
            <div role="row" class={`${columns} h-[3.75rem] border-b border-line-soft last:border-b-0`} data-person-row={contact._id}>
              <div role="cell" class="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  class="flex size-[1.875rem] shrink-0 items-center justify-center rounded-full bg-gray-800 text-[0.6875rem] leading-[calc(14/11)] font-medium text-white"
                >{personInitials(contact)}</span>
                <div class="flex min-w-0 flex-col gap-px">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-[0.8125rem] leading-[calc(16/13)] font-medium text-ink" data-person-name>{personName(contact)}</span>
                    {#if contact.isMain}
                      <span class="inline-flex h-5 shrink-0 items-center rounded-full bg-primary-highlight px-[0.4375rem] text-[0.6875rem] leading-[calc(14/11)] font-medium text-primary-selected" data-person-main-badge>Main contact</span>
                    {/if}
                  </div>
                  <span class="truncate text-xs leading-[calc(4/3)] text-ink-muted" data-person-role>{contact.role}</span>
                </div>
              </div>
              <span role="cell" class="truncate text-[0.8125rem] leading-[calc(16/13)] text-ink-secondary">{contact.email}</span>
              {#if contact.phone}
                <span role="cell" class="truncate text-[0.8125rem] leading-[calc(16/13)] text-ink-secondary">{contact.phone}</span>
              {:else}
                <span role="cell" class="text-[0.8125rem] leading-[calc(16/13)] text-ink-faint">Not added</span>
              {/if}
              <span role="cell" class="text-[0.8125rem] leading-[calc(16/13)] text-ink-secondary">{addedLabel(contact.createdAt)}</span>
              <span role="cell" class="flex size-8 items-center justify-center">
                {#if canManage}
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      aria-label={`More actions for ${personName(contact)}`}
                      data-person-menu={contact._id}
                      class="flex size-8 items-center justify-center rounded-md text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy data-[state=open]:bg-primary-wash motion-reduce:transition-none pointer-coarse:size-11"
                    >
                      <svg viewBox="0 0 24 24" class="size-4" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="19" cy="12" r="1.7" fill="currentColor" />
                      </svg>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        side="bottom"
                        align="end"
                        sideOffset={4}
                        class="z-[100] w-[12.5rem] rounded-lg border border-line bg-surface p-1 shadow-menu outline-none"
                      >
                        <DropdownMenu.Item onSelect={() => openEdit(contact)} data-person-action="edit" class={menuItem}>
                          <svg viewBox="0 0 24 24" class="size-3.5 shrink-0 text-ink" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                          Edit
                        </DropdownMenu.Item>
                        {#if !contact.isMain}
                          <DropdownMenu.Item onSelect={() => void makeMain(contact)} data-person-action="main" class={menuItem}>
                            <svg viewBox="0 0 24 24" class="size-3.5 shrink-0" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                            Make main contact
                          </DropdownMenu.Item>
                        {/if}
                        <DropdownMenu.Separator class="-mx-1 my-1 h-px bg-line-soft" />
                        <DropdownMenu.Item
                          onSelect={() => {
                            removing = contact;
                            removeOpen = true;
                          }}
                          data-person-action="remove"
                          class="flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm leading-[calc(9/7)] text-danger-ink-muted outline-none data-[highlighted]:bg-danger-surface pointer-coarse:min-h-11"
                        >
                          <svg viewBox="0 0 24 24" class="size-3.5 shrink-0" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                          Remove
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                {/if}
              </span>
            </div>
          {:else}
            <div role="row" class="px-4 py-8 text-center text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-people-no-match>
              <span role="cell">No one matches "{search.trim()}".</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
    {#if contactsQ.data?.truncated}
      <p class="mt-3 text-xs leading-[calc(4/3)] text-ink-muted">Showing the first 500 people.</p>
    {/if}
  {/if}
</section>

{#if canManage}
  <PersonDialog bind:open={dialogOpen} mode={dialogMode} {companyName} initial={dialogInitial} onSave={save} />

  <AlertDialog.Root bind:open={removeOpen}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay forceMount>
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}<div {...props} transition:overlayFade class="fixed inset-0 z-[105] bg-form-dialog-scrim"></div>{/if}
        {/snippet}
      </AlertDialog.Overlay>
      <div class="pointer-events-none fixed inset-0 z-[105] flex items-center justify-center p-4">
        <AlertDialog.Content forceMount>
          {#snippet child({ props, open: isOpen })}
            {#if isOpen}
              <div
                {...props}
                transition:modalPop
                data-person-remove-dialog
                class="pointer-events-auto flex w-[27.5rem] max-w-full flex-col gap-4 rounded-xl bg-surface p-6 shadow-dialog outline-none"
              >
                <AlertDialog.Title class="text-[0.9375rem] leading-[calc(4/3)] font-medium text-ink">
                  Remove {removing ? personName(removing) : "this person"} from {companyName}?
                </AlertDialog.Title>
                <AlertDialog.Description class="text-[0.8125rem] leading-[calc(20/13)] text-ink-secondary">
                  They won't be listed as a contact anymore. Projects and files stay as they are.
                </AlertDialog.Description>
                <div class="flex justify-end gap-2 pt-1">
                  <AlertDialog.Cancel
                    class="flex h-[2.125rem] items-center rounded-lg border border-line bg-surface px-3.5 text-[0.8125rem] leading-[calc(16/13)] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11"
                  >Cancel</AlertDialog.Cancel>
                  <AlertDialog.Action
                    data-person-remove-confirm
                    onclick={() => {
                      removeOpen = false;
                      if (removing) void remove(removing._id, personName(removing));
                    }}
                    class="flex h-[2.125rem] items-center rounded-lg bg-danger-ink-muted px-3.5 text-[0.8125rem] leading-[calc(16/13)] font-medium text-white transition-colors hover:bg-danger-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger motion-reduce:transition-none pointer-coarse:h-11"
                  >Remove</AlertDialog.Action>
                </div>
              </div>
            {/if}
          {/snippet}
        </AlertDialog.Content>
      </div>
    </AlertDialog.Portal>
  </AlertDialog.Root>
{/if}
