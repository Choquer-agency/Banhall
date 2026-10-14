<!--
  Edit details for one project (Paper W2; 2026-10-14 amendment, "Edit
  details panel"). A side panel over the cards with the project's detail
  fields: title, SR&ED title, client, fiscal year end, project number,
  industry, science code and tags. Owner and stage are read only; the stage
  changes inside the project.

  The details come from the same reads as the project page's Details panel
  (`projects.getProject`, `projects.getProjectDetailsPanel`); the edit gate is
  that panel's `permissions.canEditDetails`, the 2026-09-15 metadata edit
  scope. Save writes only the fields that changed, through the existing
  single-project mutations, in field order. A failed write stops there with
  its message under the field and keeps every edit; the fields saved before
  it stay saved. A refusal from the server turns the panel read only with a
  sentence that says why.

  Delete stays the card menu's Delete dialog: the panel's Delete project
  hands the project back to the host, and shows only to people the card
  menu would show it to (canDeleteProject).
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { Dialog } from "bits-ui";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import { IconCalendar, IconChevronDown, IconClose } from "$lib/components/icons";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import ClientCombobox from "$lib/components/project-new/ClientCombobox.svelte";
  import TagPicker from "$lib/components/project-new/TagPicker.svelte";
  import ScienceCodePicker from "$lib/components/project/details/ScienceCodePicker.svelte";
  import { validateProjectNumber } from "$lib/components/project/details/detailsData.svelte";
  import { scienceCodeDisplay } from "$lib/components/project/details/detailsFormat";
  import { formatYearEnd } from "$lib/projects/fiscalYearGroups";
  import { utcDateFromInput } from "$lib/projects/bulkEdit";
  import { mostRecentYearEnd } from "$lib/clients/usualYearEnd";
  import { dashboardFiscalYear } from "../../../../shared/dashboardProjection";
  import NewClientDialog, { type NewClientResult } from "$lib/components/clients/NewClientDialog.svelte";
  import { industryLabel } from "$lib/industries";
  import { userErrorCode, userErrorMessage } from "$lib/errors";
  import { addedClientOption, type ClientOption } from "$lib/clients/clientOptions";
  import { canCreateProjects } from "$lib/workspace/projectDuplicate";
  import type { CapabilityRole } from "../../../../shared/capabilities";
  import { canDeleteProject } from "$lib/workspace/projectDelete";
  import {
    changedProjectFields,
    editPanelTitle,
    projectEditValues,
    type ProjectEditField,
    type ProjectEditValues,
  } from "$lib/projects/projectEdit";
  import ProjectsSidePanel from "./ProjectsSidePanel.svelte";

  type Viewer = { _id: string; role?: CapabilityRole | null; isAnonymous?: boolean } | null;

  let {
    open = $bindable(false),
    projectId,
    viewer,
    returnFocus = undefined,
    onDelete = undefined,
  }: {
    open?: boolean;
    /** The project to edit; the panel reads it while open. */
    projectId: string | null;
    viewer: Viewer;
    /** Where focus goes when the panel closes (the card's menu trigger). */
    returnFocus?: () => HTMLElement | null | undefined;
    /** Delete project: the host closes the panel and opens its Delete dialog. */
    onDelete?: (project: { id: string; title: string }) => void;
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
        fillOnPick = null;
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
  const projectNumber = $derived(saved?.projectNumber ?? project?.projectNumber ?? null);
  // UTC date parts, as the cards, the fiscal year groups and bulk edit read them.
  const fiscalEnd = $derived(draft ? utcDateFromInput(draft.fiscalYearEnd) : null);
  const fiscal = $derived(
    fiscalEnd === null ? null : { date: formatYearEnd(fiscalEnd), year: String(dashboardFiscalYear(fiscalEnd)) }
  );
  const science = $derived(draft ? scienceCodeDisplay(draft.scienceCode || null) : null);
  const showDelete = $derived(
    Boolean(onDelete && project && canDeleteProject(viewer, project.createdBy, project.deletionStartedAt !== undefined))
  );
  const mayCreateClient = $derived(canCreateProjects(viewer));
  const isAdmin = $derived(viewer?.role === "admin");

  let titleInput: HTMLInputElement | null = $state(null);
  let closeButton: HTMLButtonElement | null = $state(null);

  // ─── New client from the Client field (W9) ────────────────────────────────
  let newClientOpen = $state(false);
  let newClientName = $state("");
  function openNewClient(typedName: string) {
    newClientName = typedName;
    newClientOpen = true;
  }
  // The client New client made or chose fills an empty fiscal year end
  // (the most recent past occurrence of its usual year end) and an empty
  // industry, as picking a client does on New project. Only that first pick
  // fills: the option is the listed client when the list has it, else the
  // one the dialog handed back with the values it saved.
  let fillOnPick: string | null = null;
  function onClientCreated(client: NewClientResult) {
    extraClients = [...extraClients, addedClientOption(client)];
    fillOnPick = client.key;
    if (draft) draft.clientName = client.name;
  }
  function onClientPick(client: ClientOption | null) {
    if (!client || client.key !== fillOnPick || !draft) return;
    fillOnPick = null;
    if (!draft.fiscalYearEnd && client.fiscalYearEndMonth !== undefined && client.fiscalYearEndDay !== undefined) {
      const filled = mostRecentYearEnd(client.fiscalYearEndMonth, client.fiscalYearEndDay);
      if (filled) draft.fiscalYearEnd = filled;
    }
    if (!draft.industry && client.industry) draft.industry = client.industry;
  }

  // ─── Save ─────────────────────────────────────────────────────────────────
  function validate(next: ProjectEditValues, fields: readonly ProjectEditField[]) {
    const found: Partial<Record<ProjectEditField, string>> = {};
    if (fields.includes("title") && !next.title.trim()) found.title = "Add a title.";
    if (fields.includes("clientName")) {
      if (!next.clientName.trim()) found.clientName = "Pick a client.";
      else if (clientsLoading) found.clientName = "The client list is still loading. Try again in a moment.";
      else if (!clientPicked) found.clientName = "Pick a client from the list, or add it as a new client.";
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
        fallback: "The client could not be saved.",
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

  function requestDelete() {
    if (!project || !onDelete) return;
    const target = { id: String(project._id), title: project.title };
    open = false;
    onDelete(target);
  }

  const labelClass = "text-xs leading-4 text-ink-secondary";
  // Text inputs add `field-control` in their own class attribute (the
  // borderless form-control source contract reads it there).
  const fieldSize =
    "h-[2.125rem] w-full rounded-[0.4375rem] px-2.5 text-[0.8125rem] leading-[1.125rem] text-ink placeholder:text-ink-faint pointer-coarse:h-11";
  const pickerClass = `field-control ${fieldSize} flex items-center gap-2 text-left`;
  const selectClass =
    "[&_input]:h-[2.125rem]! [&_input]:rounded-[0.4375rem]! [&_input]:px-2.5! [&_input]:text-[0.8125rem]! pointer-coarse:[&_input]:h-11! [&_button]:right-[0.1875rem]!";
  const errorClass = "text-xs leading-4 text-danger-ink-muted";
  const QUICK_PICKS = [
    { label: "Mar 31", month: 3, day: 31 },
    { label: "Jun 30", month: 6, day: 30 },
    { label: "Sep 30", month: 9, day: 30 },
    { label: "Dec 31", month: 12, day: 31 },
  ] as const;
</script>

{#snippet fieldError(field: ProjectEditField)}
  {#if errors[field]}
    <p id={`edit-project-${field}-error`} class={errorClass} role="alert" data-edit-error={field}>{errors[field]}</p>
  {/if}
{/snippet}

{#snippet readRow(label: string, value: string | null, attr: string)}
  <div class="flex min-h-8 items-start gap-3 py-1.5 text-[0.8125rem] leading-[1.125rem]" data-edit-readonly={attr}>
    <dt class="w-[6.875rem] shrink-0 text-ink-secondary">{label}</dt>
    <dd class="min-w-0 flex-1 break-words text-ink">{#if value}{value}{:else}<span class="text-ink-faint">Not set</span>{/if}</dd>
  </div>
{/snippet}

<ProjectsSidePanel
  bind:open
  busy={saving}
  {dirty}
  onEscapeBlocked={() => (escapeNote = true)}
  testId="project-edit-panel"
  initialFocus={() => (canEdit && titleInput ? titleInput : closeButton)}
  {returnFocus}
>
  <header class="flex h-14 shrink-0 items-center gap-2 border-b border-line-soft px-5">
    <Dialog.Title class="min-w-0 truncate text-[0.9375rem] leading-5 font-medium text-ink" data-edit-title>
      {#if projectNumber}Edit project <span class="font-mono text-xs leading-4 font-normal text-ink-muted">#{projectNumber}</span>{:else}{editPanelTitle(null)}{/if}
    </Dialog.Title>
    <div class="flex-1"></div>
    <Dialog.Close
      bind:ref={closeButton}
      aria-label="Close"
      data-edit-close
      disabled={saving}
      class="-mr-2 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:size-11"
    >
      <IconClose size={16} strokeWidth={1.5} />
    </Dialog.Close>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
    {#if loading}
      <div class="flex flex-col gap-4 p-5" role="status" aria-label="Loading project details" data-edit-loading>
        {#each [0, 1, 2, 3, 4] as item (item)}
          <div class="flex flex-col gap-1.5">
            <span class="h-3 w-20 animate-pulse rounded bg-chrome motion-reduce:animate-none"></span>
            <span class="h-[2.125rem] animate-pulse rounded-[0.4375rem] bg-chrome motion-reduce:animate-none"></span>
          </div>
        {/each}
      </div>
    {:else if unavailable || !draft || !details}
      <p class="p-5 text-[0.8125rem] leading-[1.125rem] text-ink-secondary" role="alert" data-edit-unavailable>
        This project's details could not be loaded. Close the panel and try again.
      </p>
    {:else}
      <Dialog.Description class="sr-only">Change this project's details. Only the fields you change are saved.</Dialog.Description>
      {#if !canEdit}
        <div class="flex flex-col gap-3 p-5">
          <p class="rounded-lg bg-gray-50 px-3 py-2.5 text-[0.8125rem] leading-[1.125rem] text-ink-secondary" role="status" data-edit-read-only>
            {READ_ONLY_REASON}
          </p>
          <dl class="flex flex-col">
            {@render readRow("Title", draft.title, "title")}
            {@render readRow("SR&ED title", draft.sredTitle, "sredTitle")}
            {@render readRow("Client", draft.clientName, "clientName")}
            {@render readRow("Fiscal year end", fiscal ? `${fiscal.date}, FY ${fiscal.year}` : null, "fiscalYearEnd")}
            {@render readRow("Project number", draft.projectNumber, "projectNumber")}
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
          class="p-5"
          data-edit-form
          onsubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <!-- Read only while a save runs: what it writes was read on Save. -->
          <fieldset disabled={saving} data-edit-fields class="flex min-w-0 flex-col gap-4">
            <label class="flex flex-col gap-1.5">
              <span class={labelClass}>Title</span>
              <input
                bind:this={titleInput}
                bind:value={draft.title}
                data-edit-field="title"
                autocomplete="off"
                aria-invalid={errors.title ? "true" : undefined}
                aria-describedby={errors.title ? "edit-project-title-error" : undefined}
                class={`field-control ${fieldSize}`}
              />
              {@render fieldError("title")}
            </label>

            <label class="flex flex-col gap-1.5">
              <span class={labelClass}>SR&amp;ED title</span>
              <input
                bind:value={draft.sredTitle}
                data-edit-field="sredTitle"
                autocomplete="off"
                placeholder="Add the formal SR&ED title"
                aria-invalid={errors.sredTitle ? "true" : undefined}
                class={`field-control ${fieldSize}`}
              />
              {@render fieldError("sredTitle")}
            </label>

            <div class="flex flex-col gap-1.5" data-edit-field="clientName">
              <label for="edit-project-client" class={labelClass}>Client</label>
              <ClientCombobox
                id="edit-project-client"
                bind:value={draft.clientName}
                bind:picked={clientPicked}
                bind:loading={clientsLoading}
                {extraClients}
                onPick={onClientPick}
                onNewClient={mayCreateClient ? openNewClient : undefined}
                inputClass="h-[2.125rem] rounded-[0.4375rem] pl-2.5 text-[0.8125rem]! pointer-coarse:h-11"
              />
              {@render fieldError("clientName")}
            </div>

            <div class="flex flex-col gap-1.5">
              <div class="flex items-center gap-2">
                <span class={labelClass} id="edit-project-fiscal-label">Fiscal year end</span>
                {#if draft.fiscalYearEnd}
                  <button
                    type="button"
                    data-edit-fiscal-clear
                    onclick={() => draft && (draft.fiscalYearEnd = "")}
                    class="ml-auto rounded text-xs leading-4 text-ink-muted hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
                  >Clear</button>
                {/if}
              </div>
              <DatePicker
                bind:value={draft.fiscalYearEnd}
                heading="Year end"
                quickPicks={QUICK_PICKS}
                helper="The fiscal year takes the year of its end date."
                disabled={saving}
              >
                {#snippet trigger({ props })}
                  <button {...props} type="button" aria-labelledby="edit-project-fiscal-label" data-edit-field="fiscalYearEnd" class={pickerClass}>
                    <IconCalendar size={13} strokeWidth={1.4} class="shrink-0 text-ink-secondary" />
                    {#if fiscal}
                      <span class="min-w-0 flex-1 truncate">{fiscal.date}</span>
                      <span class="shrink-0 text-xs leading-4 text-ink-muted" data-edit-fiscal-year>FY {fiscal.year}</span>
                    {:else}
                      <span class="min-w-0 flex-1 truncate text-ink-faint">Choose the year end</span>
                    {/if}
                  </button>
                {/snippet}
              </DatePicker>
              {@render fieldError("fiscalYearEnd")}
            </div>

            <div class="flex gap-3">
              <label class="flex w-[6.875rem] shrink-0 flex-col gap-1.5">
                <span class={labelClass}>Project number</span>
                <input
                  bind:value={draft.projectNumber}
                  data-edit-field="projectNumber"
                  autocomplete="off"
                  placeholder="Not set"
                  aria-invalid={errors.projectNumber ? "true" : undefined}
                  aria-describedby={errors.projectNumber ? "edit-project-projectNumber-error" : undefined}
                  class={`field-control ${fieldSize} font-mono`}
                />
              </label>
              <div class="flex min-w-0 flex-1 flex-col gap-1.5" data-edit-field="industry">
                <label for="edit-project-industry" class={labelClass}>Industry</label>
                <IndustrySelect id="edit-project-industry" bind:value={draft.industry} canCreate={isAdmin} disabled={saving} class={selectClass} />
              </div>
            </div>
            {#if errors.projectNumber || errors.industry}
              <div class="-mt-2 flex flex-col gap-1">
                {@render fieldError("projectNumber")}
                {@render fieldError("industry")}
              </div>
            {/if}

            <div class="flex flex-col gap-1.5">
              <span class={labelClass} id="edit-project-science-label">Science code</span>
              <ScienceCodePicker
                value={draft.scienceCode || null}
                onSelect={(code) => {
                  if (draft) draft.scienceCode = code ?? "";
                }}
              >
                {#snippet trigger({ props })}
                  <button {...props} type="button" aria-labelledby="edit-project-science-label" data-edit-field="scienceCode" class={pickerClass}>
                    {#if science}
                      <span class="min-w-0 flex-1 truncate"><span class="font-mono">{science.code}</span> {science.label}</span>
                    {:else}
                      <span class="min-w-0 flex-1 truncate text-ink-faint">Choose a science code</span>
                    {/if}
                    <IconChevronDown size={12} strokeWidth={1.4} class="shrink-0 text-ink-muted" />
                  </button>
                {/snippet}
              </ScienceCodePicker>
              {@render fieldError("scienceCode")}
            </div>

            <div class="flex flex-col gap-1.5" data-edit-field="tagIds">
              <span class={labelClass}>Tags</span>
              <TagPicker allTags={tagsQ.data ?? []} bind:selectedTagIds={draft.tagIds} label={null} variant="field" />
              {@render fieldError("tagIds")}
            </div>
          </fieldset>
        </form>
      {/if}

      <dl class="mx-5 mb-5 flex flex-col border-t border-line-soft pt-3" data-edit-readonly-facts>
        <div class="flex min-h-8 items-center gap-3 text-[0.8125rem] leading-[1.125rem]" data-edit-owner>
          <dt class="w-[6.875rem] shrink-0 text-ink-secondary">Owner</dt>
          <dd class="min-w-0 flex-1 truncate text-ink">
            {#if details.owner}{details.owner.label}{details.owner.isYou ? " (you)" : ""}{:else}<span class="text-ink-faint">No owner recorded</span>{/if}
          </dd>
        </div>
        <div class="flex min-h-8 items-center gap-3 text-[0.8125rem] leading-[1.125rem]" data-edit-stage>
          <dt class="w-[6.875rem] shrink-0 text-ink-secondary">Stage</dt>
          <dd class="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 py-1.5">
            <span class="text-ink">{WORKFLOW_STAGE_LABELS[details.stage]}</span>
            <span class="text-ink-muted">Changed inside the project</span>
          </dd>
        </div>
      </dl>
    {/if}
  </div>

  <footer class="flex h-[3.75rem] shrink-0 items-center gap-2 border-t border-line-soft px-5">
    {#if escapeNote}
      <p class="min-w-0 flex-1 text-xs leading-4 text-ink-muted" role="status" data-edit-escape-note>Save your changes, or use Cancel to discard them.</p>
    {:else if showDelete && !loading}
      <button
        type="button"
        data-edit-delete
        disabled={saving}
        onclick={requestDelete}
        class="rounded-md text-[0.8125rem] leading-[1.125rem] text-gap-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11"
      >Delete project</button>
    {/if}
    <div class="flex-1"></div>
    {#if canEdit && draft && !loading}
      <button
        type="button"
        data-edit-cancel
        disabled={saving}
        onclick={() => (open = false)}
        class="flex h-8 items-center rounded-[0.4375rem] px-3 text-[0.8125rem] leading-[1.125rem] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
      >Cancel</button>
      <button
        type="button"
        data-edit-save
        disabled={!dirty || saving}
        onclick={() => void save()}
        class="flex h-8 items-center rounded-[0.4375rem] bg-primary-selected px-3.5 text-[0.8125rem] leading-[1.125rem] font-medium text-white transition-colors hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
      >{saving ? "Saving..." : "Save changes"}</button>
    {:else}
      <button
        type="button"
        data-edit-done
        onclick={() => (open = false)}
        class="flex h-8 items-center rounded-[0.4375rem] border border-line px-3 text-[0.8125rem] leading-[1.125rem] text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11"
      >Close</button>
    {/if}
  </footer>
</ProjectsSidePanel>

{#if mayCreateClient}
  <NewClientDialog
    bind:open={newClientOpen}
    initialName={newClientName}
    description="Once created, it fills the Client field on this project."
    canAddIndustry={isAdmin}
    onCreated={onClientCreated}
  />
{/if}
