<!--
  Edit details for one project (Paper Z7m and Z7o, 2026-10-19; replaces the
  2026-10-14 side panel). A centered FormDialog, 600 wide, titled "Edit
  details" with the project's detail fields in two columns: title and
  project number, SR&ED title, client and fiscal year end, industry and
  science code, then tags. Owner, stage and Delete are not here: the stage
  changes inside the project and Delete stays in the card menu.

  The details come from the same reads as the project page's Details panel
  (`projects.getProject`, `projects.getProjectDetailsPanel`); the edit gate is
  that panel's `permissions.canEditDetails`, the 2026-09-15 metadata edit
  scope. Save writes only the fields that changed, through the existing
  single-project mutations, in field order. A failed write stops there with
  its message under the field and keeps every edit; the fields saved before
  it stay saved. A refusal from the server turns the dialog read only with a
  sentence that says why.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { IconCalendar, IconChevronDown } from "$lib/components/icons";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import ClientCombobox from "$lib/components/project-new/ClientCombobox.svelte";
  import TagPicker from "$lib/components/project-new/TagPicker.svelte";
  import ScienceCodePicker from "$lib/components/project/details/ScienceCodePicker.svelte";
  import { validateProjectNumber } from "$lib/components/project/details/detailsData.svelte";
  import { scienceCodeDisplay } from "$lib/components/project/details/detailsFormat";
  import { formatYearEnd } from "$lib/projects/fiscalYearGroups";
  import { utcDateFromInput } from "$lib/projects/bulkEdit";
  import { dashboardFiscalYear } from "../../../../shared/dashboardProjection";
  import NewClientDialog, { type NewClientResult } from "$lib/components/clients/NewClientDialog.svelte";
  import { industryLabel } from "$lib/industries";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import { addedClientOption, type ClientOption } from "$lib/clients/clientOptions";
  import { canCreateProjects } from "$lib/workspace/projectDuplicate";
  import type { CapabilityRole } from "../../../../shared/capabilities";
  import {
    changedProjectFields,
    projectEditValues,
    type ProjectEditField,
    type ProjectEditValues,
  } from "$lib/projects/projectEdit";
  import FormDialog from "$lib/components/ui/FormDialog.svelte";
  import {
    formCancel,
    formError,
    formField,
    formFieldAction,
    formLabel,
    formPicker,
    formPrimary,
    formSelect,
  } from "$lib/components/ui/formDialog";

  type Viewer = { _id: string; role?: CapabilityRole | null; isAnonymous?: boolean } | null;

  let {
    open = $bindable(false),
    projectId,
    viewer,
    returnFocus = undefined,
  }: {
    open?: boolean;
    /** The project to edit; the panel reads it while open. */
    projectId: string | null;
    viewer: Viewer;
    /** Where focus goes when the dialog closes (the card's menu trigger). */
    returnFocus?: () => HTMLElement | null | undefined;
  } = $props();

  const READ_ONLY_REASON =
    "You can view these details but not change them. Only the owner, someone with open work on this project, a manager or an admin can edit them.";

  const auth = useAuth();
  const live = $derived(auth.isAuthenticated && open && projectId !== null);
  const projectQ = useQuery(api.projects.getProject, () =>
    live ? { projectId: projectId as Id<"projects"> } : "skip"
  );
  const panelQ = useQuery(api.projects.getProjectDetailsPanel, () =>
    live ? { projectId: projectId as Id<"projects"> } : "skip"
  );
  const tagsQ = useQuery(api.tags.listTags, () => (live ? {} : "skip"));

  const updateTitles = useMutation(api.projects.updateProjectTitles);
  const updateClientName = useMutation(api.projects.updateProjectClientName);
  const updateFiscalYear = useMutation(api.projects.updateProjectFiscalYear);
  const setProjectNumber = useMutation(api.projects.setProjectNumber);
  const updateIndustry = useMutation(api.projects.updateProjectIndustry);
  const updateScienceCode = useMutation(api.projects.updateProjectScienceCode);
  const updateTags = useMutation(api.projects.updateProjectTags);

  const project = $derived(projectQ.data ?? null);
  const details = $derived(panelQ.data);

  // The draft starts from the saved values once per opening; live updates
  // after that never overwrite what the person is typing.
  let saved = $state<ProjectEditValues | null>(null);
  let draft = $state<ProjectEditValues | null>(null);
  let loadedFor = $state<string | null>(null);
  let deniedByServer = $state(false);
  let saving = $state(false);
  /** Escape was pressed over unsaved edits: say how to leave instead. */
  let escapeNote = $state(false);
  $effect(() => {
    if (!open || !dirty) escapeNote = false;
  });
  let errors = $state<Partial<Record<ProjectEditField, string>>>({});
  let clientPicked = $state<ClientOption | null>(null);
  let clientsLoading = $state(true);
  let extraClients = $state<ClientOption[]>([]);

  $effect(() => {
    if (!open) {
      untrack(() => {
        saved = null;
        draft = null;
        loadedFor = null;
        deniedByServer = false;
        errors = {};
        extraClients = [];
      });
      return;
    }
    const source = project;
    if (!source || !projectId || loadedFor === projectId) return;
    untrack(() => {
      saved = projectEditValues(source);
      draft = projectEditValues(source);
      loadedFor = projectId;
    });
  });

  const loading = $derived(open && (projectQ.data === undefined || details === undefined) && !projectQ.error && !panelQ.error);
  const unavailable = $derived(Boolean(projectQ.error || panelQ.error) || project === null || details === null);
  const canEdit = $derived(Boolean(details?.permissions.canEditDetails) && !deniedByServer);
  const changed = $derived(saved && draft ? changedProjectFields(saved, draft) : []);
  const dirty = $derived(canEdit && changed.length > 0);
  // UTC date parts, as the cards, the fiscal year groups and bulk edit read them.
  const fiscalEnd = $derived(draft ? utcDateFromInput(draft.fiscalYearEnd) : null);
  const fiscal = $derived(
    fiscalEnd === null ? null : { date: formatYearEnd(fiscalEnd), year: String(dashboardFiscalYear(fiscalEnd)) }
  );
  const science = $derived(draft ? scienceCodeDisplay(draft.scienceCode || null) : null);
  const mayCreateClient = $derived(canCreateProjects(viewer));
  const isAdmin = $derived(viewer?.role === "admin");

  let titleInput: HTMLInputElement | null = $state(null);
  let closeButton: HTMLButtonElement | null = $state(null);
  // Opened while still loading, focus starts on Close: move it to the title
  // once the fields show, unless the person has moved it themselves.
  $effect(() => {
    const input = titleInput;
    if (!open || !input || !canEdit) return;
    untrack(() => {
      if (document.activeElement === closeButton) input.focus();
    });
  });

  // ─── New client from the Client field (W9) ────────────────────────────────
  let newClientOpen = $state(false);
  let newClientName = $state("");
  function openNewClient(typedName: string) {
    newClientName = typedName;
    newClientOpen = true;
  }
  // An existing project keeps its own fiscal year end and industry: a
  // client's defaults fill only New project (2026-10-14 amendment).
  function onClientCreated(client: NewClientResult) {
    extraClients = [...extraClients, addedClientOption(client)];
    if (draft) draft.clientName = client.name;
  }

  // ─── Save ─────────────────────────────────────────────────────────────────
  function validate(next: ProjectEditValues, fields: readonly ProjectEditField[]) {
    const found: Partial<Record<ProjectEditField, string>> = {};
    if (fields.includes("title") && !next.title.trim()) found.title = "Add a title.";
    if (fields.includes("clientName")) {
      if (!next.clientName.trim()) found.clientName = "Pick a company.";
      else if (clientsLoading) found.clientName = "The company list is still loading. Try again in a moment.";
      else if (!clientPicked) found.clientName = "Pick a company from the list, or add it as a new company.";
    }
    if (fields.includes("projectNumber")) {
      try {
        validateProjectNumber(next.projectNumber);
      } catch (error) {
        found.projectNumber = error instanceof Error ? error.message : "Check the project number.";
      }
    }
    return found;
  }

  type Step = { fields: ProjectEditField[]; fallback: string; run: () => Promise<unknown> };

  /**
   * `next` and `clientName` are read when Save is clicked, before the first
   * write, so nothing typed or picked while the save runs can change what it
   * writes (the fields are disabled meanwhile too).
   */
  function steps(
    id: Id<"projects">,
    next: ProjectEditValues,
    fields: readonly ProjectEditField[],
    clientName: string
  ): Step[] {
    const list: Step[] = [];
    const has = (field: ProjectEditField) => fields.includes(field);
    if (has("title") || has("sredTitle")) {
      list.push({
        fields: (["title", "sredTitle"] as const).filter(has),
        fallback: "The title could not be saved.",
        run: () =>
          updateTitles({
            projectId: id,
            ...(has("title") ? { title: next.title.trim() } : {}),
            ...(has("sredTitle") ? { sredTitle: next.sredTitle.trim() } : {}),
          }),
      });
    }
    if (has("clientName")) {
      list.push({
        fields: ["clientName"],
        fallback: "The company could not be saved.",
        run: () => updateClientName({ projectId: id, clientName }),
      });
    }
    if (has("fiscalYearEnd")) {
      list.push({
        fields: ["fiscalYearEnd"],
        fallback: "The fiscal year end could not be saved.",
        run: () => updateFiscalYear({ projectId: id, fiscalYearEnd: utcDateFromInput(next.fiscalYearEnd) ?? undefined }),
      });
    }
    if (has("projectNumber")) {
      list.push({
        fields: ["projectNumber"],
        fallback: "The project number could not be saved.",
        run: () =>
          setProjectNumber({ projectId: id, projectNumber: validateProjectNumber(next.projectNumber) || undefined }),
      });
    }
    if (has("industry")) {
      list.push({
        fields: ["industry"],
        fallback: "The industry could not be saved.",
        run: () => updateIndustry({ projectId: id, industry: next.industry || undefined }),
      });
    }
    if (has("scienceCode")) {
      list.push({
        fields: ["scienceCode"],
        fallback: "The science code could not be saved.",
        run: () => updateScienceCode({ projectId: id, scienceCode: next.scienceCode || undefined }),
      });
    }
    if (has("tagIds")) {
      list.push({
        fields: ["tagIds"],
        fallback: "The tags could not be saved.",
        run: () => updateTags({ projectId: id, tagIds: next.tagIds as Id<"tags">[] }),
      });
    }
    return list;
  }

  async function save() {
    if (!draft || !saved || !projectId || saving || !dirty) return;
    const next = $state.snapshot(draft) as ProjectEditValues;
    const fields = changedProjectFields(saved, next);
    const found = validate(next, fields);
    errors = found;
    if (Object.keys(found).length > 0) return;
    // A listed client goes in under its own name, whatever case was typed.
    const clientName = clientPicked?.name ?? next.clientName.trim();
    const plan = steps(projectId as Id<"projects">, next, fields, clientName);
    saving = true;
    try {
      for (const step of plan) {
        try {
          await step.run();
        } catch (error) {
          if (userErrorCode(error) === "NOT_AUTHORIZED") {
            deniedByServer = true;
          } else {
            errors = { [step.fields[0]]: userErrorMessage(error, step.fallback) };
          }
          return;
        }
        // Saved: a retry does not write this field again.
        if (saved) {
          const done = saved;
          for (const field of step.fields) (done as Record<ProjectEditField, unknown>)[field] = structuredClone(next[field]);
        }
      }
      toast.success("Project details saved.");
      open = false;
    } finally {
      saving = false;
    }
  }

  const QUICK_PICKS = [
    { label: "Mar 31", month: 3, day: 31 },
    { label: "Jun 30", month: 6, day: 30 },
    { label: "Sep 30", month: 9, day: 30 },
    { label: "Dec 31", month: 12, day: 31 },
  ] as const;
</script>

{#snippet fieldError(field: ProjectEditField)}
  {#if errors[field]}
    <p id={`edit-project-${field}-error`} class={formError} role="alert" data-edit-error={field}>{errors[field]}</p>
  {/if}
{/snippet}

{#snippet readRow(label: string, value: string | null, attr: string)}
  <div class="flex min-h-9 items-start gap-3 py-2 text-sm leading-[calc(10/7)]" data-edit-readonly={attr}>
    <dt class="w-[8.75rem] shrink-0 text-ink-secondary">{label}</dt>
    <dd class="min-w-0 flex-1 break-words text-ink">{#if value}{value}{:else}<span class="text-ink-muted">Not set</span>{/if}</dd>
  </div>
{/snippet}

{#snippet footerNote()}
  {#if escapeNote}
    <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" role="status" data-edit-escape-note>Save your changes, or use Cancel to discard them.</p>
  {/if}
{/snippet}

{#snippet footer()}
  {#if canEdit && draft && !loading}
    <button type="button" data-edit-cancel disabled={saving} onclick={() => (open = false)} class={formCancel}>Cancel</button>
    <button type="button" data-edit-save disabled={!dirty || saving} onclick={() => void save()} class={formPrimary}>
      {saving ? "Saving..." : "Save changes"}
    </button>
  {:else}
    <button type="button" data-edit-done onclick={() => (open = false)} class={formCancel}>Close</button>
  {/if}
{/snippet}

<FormDialog
  bind:open
  bind:closeButton
  title="Edit details"
  srDescription="Change this project's details. Only the fields you change are saved."
  width={600}
  busy={saving}
  {dirty}
  onEscapeBlocked={() => (escapeNote = true)}
  testId="project-edit-panel"
  initialFocus={() => (canEdit && titleInput ? titleInput : closeButton)}
  {returnFocus}
  {footer}
  {footerNote}
>
  {#if loading}
    <div class="flex flex-col gap-3.5" role="status" aria-label="Loading project details" data-edit-loading>
      {#each [0, 1, 2, 3, 4] as item (item)}
        <div class="flex flex-col gap-1.5">
          <span class="h-4 w-24 animate-pulse rounded bg-chrome motion-reduce:animate-none"></span>
          <span class="h-9 animate-pulse rounded-lg bg-chrome motion-reduce:animate-none"></span>
        </div>
      {/each}
    </div>
  {:else if unavailable || !draft || !details}
    <p class="text-sm leading-[calc(10/7)] text-ink-secondary" role="alert" data-edit-unavailable>
      This project's details could not be loaded. Close this and try again.
    </p>
  {:else if !canEdit}
    <div class="flex flex-col gap-3">
      <p class="rounded-lg bg-gray-50 px-3 py-2.5 text-sm leading-[calc(10/7)] text-ink-secondary" role="status" data-edit-read-only>
        {READ_ONLY_REASON}
      </p>
      <dl class="flex flex-col">
        {@render readRow("Title", draft.title, "title")}
        {@render readRow("SR&ED title", draft.sredTitle, "sredTitle")}
        {@render readRow("Company", draft.clientName, "clientName")}
        {@render readRow("Fiscal year end", fiscal ? `${fiscal.date}, FY ${fiscal.year}` : null, "fiscalYearEnd")}
        {@render readRow("Number", draft.projectNumber, "projectNumber")}
        {@render readRow("Industry", draft.industry ? industryLabel(draft.industry) : null, "industry")}
        {@render readRow("Science code", science ? `${science.code} ${science.label}` : null, "scienceCode")}
        {@render readRow(
          "Tags",
          (tagsQ.data ?? []).filter((tag) => draft?.tagIds.includes(tag._id)).map((tag) => tag.name).join(", ") || null,
          "tagIds"
        )}
      </dl>
    </div>
  {:else}
    <form
      data-edit-form
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <!-- Read only while a save runs: what it writes was read on Save. -->
      <fieldset disabled={saving} data-edit-fields class="flex min-w-0 flex-col gap-3.5">
        <div class="flex gap-3">
          <label class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class={formLabel}>Title</span>
            <input
              bind:this={titleInput}
              bind:value={draft.title}
              data-edit-field="title"
              data-filled={draft.title.trim() ? "" : undefined}
              autocomplete="off"
              aria-invalid={errors.title ? "true" : undefined}
              aria-describedby={errors.title ? "edit-project-title-error" : undefined}
              class={`field-control ${formField}`}
            />
            {@render fieldError("title")}
          </label>
          <label class="flex w-24 shrink-0 flex-col gap-1.5">
            <span class={formLabel}>Number</span>
            <input
              bind:value={draft.projectNumber}
              data-edit-field="projectNumber"
              data-filled={draft.projectNumber.trim() ? "" : undefined}
              autocomplete="off"
              placeholder="Not set"
              aria-label="Project number"
              aria-invalid={errors.projectNumber ? "true" : undefined}
              aria-describedby={errors.projectNumber ? "edit-project-projectNumber-error" : undefined}
              class={`field-control ${formField}`}
            />
          </label>
        </div>
        {#if errors.projectNumber}
          <div class="-mt-2">{@render fieldError("projectNumber")}</div>
        {/if}

        <label class="flex flex-col gap-1.5">
          <span class={formLabel}>SR&amp;ED title</span>
          <input
            bind:value={draft.sredTitle}
            data-edit-field="sredTitle"
            data-filled={draft.sredTitle.trim() ? "" : undefined}
            autocomplete="off"
            placeholder="Add the formal SR&ED title"
            aria-invalid={errors.sredTitle ? "true" : undefined}
            class={`field-control ${formField}`}
          />
          {@render fieldError("sredTitle")}
        </label>

        <div class="flex gap-3 max-sm:flex-col">
          <div class="flex min-w-0 flex-1 flex-col gap-1.5" data-edit-field="clientName" data-filled={draft.clientName.trim() ? "" : undefined}>
            <label for="edit-project-client" class={formLabel}>Company</label>
            <ClientCombobox
              id="edit-project-client"
              bind:value={draft.clientName}
              bind:picked={clientPicked}
              bind:loading={clientsLoading}
              {extraClients}
              onNewClient={mayCreateClient ? openNewClient : undefined}
              inputClass="h-9 rounded-lg pl-3 text-sm! pointer-coarse:h-11"
            />
            {@render fieldError("clientName")}
          </div>

          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class={formLabel} id="edit-project-fiscal-label">Fiscal year end</span>
            <DatePicker
              bind:value={draft.fiscalYearEnd}
              heading="Year end"
              quickPicks={QUICK_PICKS}
              helper="The fiscal year takes the year of its end date."
              disabled={saving}
            >
              {#snippet trigger({ props })}
                <button {...props} type="button" aria-labelledby="edit-project-fiscal-label" data-edit-field="fiscalYearEnd" data-filled={fiscal ? "" : undefined} class={`field-control ${formPicker}`}>
                  <IconCalendar size={15} strokeWidth={1.5} class="shrink-0 text-ink-muted" />
                  {#if fiscal}
                    <span class="min-w-0 flex-1 truncate">{fiscal.date}</span>
                    <span class="shrink-0 text-[0.8125rem] leading-[calc(16/13)] text-ink-muted" data-edit-fiscal-year>FY {fiscal.year}</span>
                  {:else}
                    <span class="min-w-0 flex-1 truncate text-ink-muted">Choose the year end</span>
                  {/if}
                </button>
              {/snippet}
            </DatePicker>
            {#if draft.fiscalYearEnd}
              <div class="flex justify-end">
                <button type="button" data-edit-fiscal-clear onclick={() => draft && (draft.fiscalYearEnd = "")} class={formFieldAction}>Clear</button>
              </div>
            {/if}
            {@render fieldError("fiscalYearEnd")}
          </div>
        </div>

        <div class="flex gap-3 max-sm:flex-col">
          <div class="flex min-w-0 flex-1 flex-col gap-1.5" data-edit-field="industry" data-filled={draft.industry ? "" : undefined}>
            <label for="edit-project-industry" class={formLabel}>Industry</label>
            <IndustrySelect ariaLabel="Industry" id="edit-project-industry" bind:value={draft.industry} canCreate={isAdmin} disabled={saving} class={formSelect} />
            {@render fieldError("industry")}
          </div>

          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class={formLabel} id="edit-project-science-label">Science code</span>
            <ScienceCodePicker
              value={draft.scienceCode || null}
              onSelect={(code) => {
                if (draft) draft.scienceCode = code ?? "";
              }}
            >
              {#snippet trigger({ props })}
                <button {...props} type="button" aria-labelledby="edit-project-science-label" data-edit-field="scienceCode" data-filled={science ? "" : undefined} class={`field-control ${formPicker}`}>
                  {#if science}
                    <span class="min-w-0 flex-1 truncate">{science.code} {science.label}</span>
                  {:else}
                    <span class="min-w-0 flex-1 truncate text-ink-muted">Choose a science code</span>
                  {/if}
                  <IconChevronDown size={14} strokeWidth={1.6} class="shrink-0 text-ink-muted" />
                </button>
              {/snippet}
            </ScienceCodePicker>
            {@render fieldError("scienceCode")}
          </div>
        </div>

        <div class="flex flex-col gap-1.5" data-edit-field="tagIds" data-filled={draft.tagIds.length > 0 ? "" : undefined}>
          <span class={formLabel}>Tags</span>
          <TagPicker allTags={tagsQ.data ?? []} bind:selectedTagIds={draft.tagIds} label={null} variant="field" />
          {@render fieldError("tagIds")}
        </div>
      </fieldset>
    </form>
  {/if}
</FormDialog>

{#if mayCreateClient}
  <NewClientDialog
    bind:open={newClientOpen}
    initialName={newClientName}
    description="Once created, it fills the Company field on this project."
    canAddIndustry={isAdmin}
    onCreated={onClientCreated}
  />
{/if}
