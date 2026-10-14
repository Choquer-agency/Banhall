<script module lang="ts">
  /**
   * The client New client made, or the existing one "Use that client" chose.
   * A made client carries the usual year end and industry it was saved with,
   * so the page can fill an empty fiscal year and industry on the first pick
   * (an existing client's come from the client list).
   */
  export type NewClientResult = {
    clientId: string | null;
    key: string;
    name: string;
    fiscalYearEndMonth?: number;
    fiscalYearEndDay?: number;
    industry?: string;
  };
</script>

<script lang="ts">
  // New client (Paper W6 and W9; 2026-10-14 amendment, "Create a client").
  // A name, an optional usual fiscal year end (month and day) and an
  // optional industry. While the name is typed, findSimilarClients looks for
  // the same name (Create is refused) and for names that look alike (a
  // warning; the person decides). Both offer "Use that client". Create waits
  // for that check to answer for the name as it stands, so a look-alike is
  // never made unwarned; a failed check offers Try again. Each opening
  // starts from the initial props. Shared by New project and Projects.
  import { tick, untrack } from "svelte";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import TeamDialog from "$lib/components/team/TeamDialog.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { api } from "../../../../convex/_generated/api";

  let {
    open = $bindable(false),
    initialName = "",
    initialFiscalYearEnd = null,
    initialIndustry = "",
    onCreated = undefined,
    description = "Clients appear in the Client list when you start a project.",
    canAddIndustry = false,
  }: {
    open?: boolean;
    initialName?: string;
    initialFiscalYearEnd?: { month: number; day: number } | null;
    initialIndustry?: string;
    /** A new client, or an existing one picked with "Use that client" (clientId may be null). */
    onCreated?: (client: NewClientResult) => void;
    description?: string;
    /** Admins may add an industry, as on New project. */
    canAddIndustry?: boolean;
  } = $props();

  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  /** Days in each month with February 29 allowed (a usual year end has no year). */
  const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MONTH_ITEMS = [{ value: "", label: "Not set" }, ...MONTHS.map((label, index) => ({ value: String(index + 1), label }))];

  const auth = useAuth();
  const createClient = useMutation(api.clients.createClient);

  let name = $state("");
  let month = $state("");
  let day = $state("");
  let industry = $state("");
  let filledFromProject = $state(false);
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let nameInput: HTMLInputElement | null = $state(null);
  /** The name findSimilarClients was last asked about. */
  let checkedName = $state("");

  // Each opening starts clean, from the initial props.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = initialName.trim();
      month = initialFiscalYearEnd ? String(initialFiscalYearEnd.month) : "";
      day = initialFiscalYearEnd ? String(initialFiscalYearEnd.day) : "";
      filledFromProject = initialFiscalYearEnd !== null;
      industry = initialIndustry;
      errorMessage = null;
      busy = false;
      checkedName = name;
    });
  });

  const dayItems = $derived([
    { value: "", label: "Not set" },
    ...Array.from({ length: month ? DAYS_IN_MONTH[Number(month) - 1] : 31 }, (_, index) => ({
      value: String(index + 1),
      label: String(index + 1),
    })),
  ]);
  // A day past the new month's end moves to its last day.
  $effect(() => {
    if (!month || !day) return;
    const last = DAYS_IN_MONTH[Number(month) - 1];
    if (Number(day) > last) day = String(last);
  });

  // The same and look-alike names, asked 250ms after typing stops.
  $effect(() => {
    const next = name.trim();
    if (!open) return;
    const timer = setTimeout(() => (checkedName = next), 250);
    return () => clearTimeout(timer);
  });
  // Try again drops the failed check for a moment and asks afresh.
  let retryingCheck = $state(false);
  const similarQ = useQuery(api.clients.findSimilarClients, () =>
    open && auth.isAuthenticated && checkedName && !retryingCheck ? { name: checkedName } : "skip"
  );
  async function retryCheck() {
    retryingCheck = true;
    await tick();
    retryingCheck = false;
  }
  // Only an answer for the name as it stands now counts.
  const current = $derived(checkedName !== "" && checkedName === name.trim() && !retryingCheck);
  const checkFailed = $derived(current && Boolean(similarQ.error));
  const similar = $derived.by(() => {
    const data = similarQ.data;
    return current && !similarQ.error ? data : undefined;
  });
  const exact = $derived(similar?.exact ?? null);
  const lookAlikes = $derived(exact ? [] : (similar?.similar ?? []).slice(0, 3));

  const yearEndIncomplete = $derived(Boolean(month) !== Boolean(day));
  // Create waits for the check on this name: before it answers (typing,
  // the 250ms pause, the read itself) or after it failed, nothing is known
  // about look-alikes yet.
  const canCreate = $derived(
    Boolean(name.trim()) && similar !== undefined && !exact && !yearEndIncomplete && !busy
  );

  const projectCount = (count: number) =>
    count === 0 ? "no projects" : count === 1 ? "1 project" : `${count} projects`;

  function useExisting(client: { key: string; name: string }) {
    const done = onCreated;
    open = false;
    done?.({ clientId: null, key: client.key, name: client.name });
  }

  async function create() {
    if (!canCreate) return;
    busy = true;
    errorMessage = null;
    const done = onCreated;
    // What is sent is what the client is saved with: the page fills an empty
    // fiscal year and industry from it.
    const defaults = {
      ...(month && day ? { fiscalYearEndMonth: Number(month), fiscalYearEndDay: Number(day) } : {}),
      ...(industry ? { industry } : {}),
    };
    try {
      const created = await createClient({ name: name.trim(), ...defaults });
      open = false;
      done?.({ clientId: created.clientId, key: created.key, name: created.name, ...defaults });
    } catch (error) {
      errorMessage = userErrorMessage(error, "This client could not be created. Try again.");
    } finally {
      busy = false;
    }
  }

  const labelClass = "text-xs leading-4 text-ink-secondary";
  const selectClass =
    "[&_input]:h-9! [&_input]:rounded-lg! [&_input]:px-2.5! [&_input]:text-[0.8125rem]! pointer-coarse:[&_input]:h-11! [&_button]:right-[0.1875rem]! [&_button_svg]:[stroke-width:1.8]";
</script>

<TeamDialog
  bind:open
  width={480}
  top={200}
  initialFocus={() => nameInput}
  {busy}
  testId="new-client-dialog"
  title="New client"
  {description}
>
  <div class="flex flex-col gap-4 px-7 pt-5 pb-1">
    <div class="flex flex-col gap-1.5">
      <label for="new-client-name" class={labelClass}>Client name</label>
      <input
        id="new-client-name"
        bind:this={nameInput}
        bind:value={name}
        autocomplete="off"
        maxlength={200}
        placeholder="Client name"
        oninput={() => (errorMessage = null)}
        onkeydown={(event) => {
          // Enter in the name field creates the client.
          if (event.key === "Enter") {
            event.preventDefault();
            void create();
          }
        }}
        class="field-control h-9 w-full rounded-lg px-2.5 text-[0.8125rem] leading-[1.125rem] text-ink placeholder:text-ink-faint pointer-coarse:h-11"
      />
      {#if exact}
        <div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-[0.5625rem]" role="status" data-client-exists>
          <p class="min-w-0 flex-1 text-xs leading-[1.0625rem] text-ink-secondary">
            {exact.name} already exists, with {projectCount(exact.projectCount)}.
          </p>
          <button
            type="button"
            data-use-client={exact.key}
            onclick={() => useExisting(exact)}
            class="shrink-0 rounded-md text-xs leading-[1.0625rem] font-medium text-primary-selected hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >Use that client</button>
        </div>
      {/if}
      {#each lookAlikes as client (client.key)}
        <div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-[0.5625rem]" role="status" data-client-similar>
          <p class="min-w-0 flex-1 text-xs leading-[1.0625rem] text-ink-secondary">
            {client.name} already exists, with {projectCount(client.projectCount)}.
          </p>
          <button
            type="button"
            data-use-client={client.key}
            onclick={() => useExisting(client)}
            class="shrink-0 rounded-md text-xs leading-[1.0625rem] font-medium text-primary-selected hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >Use that client</button>
        </div>
      {/each}
      {#if checkFailed}
        <p role="alert" class="flex flex-wrap items-center gap-x-2 text-xs leading-4 text-danger-ink-muted" data-client-check-error>
          We could not check this name.
          <button
            type="button"
            data-client-check-retry
            onclick={() => void retryCheck()}
            class="rounded font-medium text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy pointer-coarse:min-h-11"
          >Try again</button>
        </p>
      {/if}
      {#if errorMessage}
        <p role="alert" class="rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger-ink-muted" data-new-client-error>{errorMessage}</p>
      {/if}
    </div>

    <div class="flex flex-col gap-1.5">
      <span class={labelClass} id="new-client-year-end-label">Usual fiscal year end</span>
      <div class="flex gap-2" role="group" aria-labelledby="new-client-year-end-label">
        <SelectInput
          id="new-client-year-end-month"
          bind:value={month}
          items={MONTH_ITEMS}
          placeholder="Month"
          ariaLabel="Usual fiscal year end month"
          class={`min-w-0 flex-1 ${selectClass}`}
          onValueChange={() => (filledFromProject = false)}
        />
        <SelectInput
          id="new-client-year-end-day"
          bind:value={day}
          items={dayItems}
          placeholder="Day"
          ariaLabel="Usual fiscal year end day"
          class={`w-[5.625rem] shrink-0 ${selectClass}`}
          onValueChange={() => (filledFromProject = false)}
        />
      </div>
      <p class="text-xs leading-4 text-ink-muted" data-year-end-helper>
        {yearEndIncomplete
          ? "Pick both a month and a day, or leave both empty."
          : filledFromProject
            ? "Filled from this project. New projects for this client start with it."
            : "Fills the fiscal year on new projects. You can change it on any project."}
      </p>
    </div>

    <div class="flex flex-col gap-1.5">
      <label for="new-client-industry" class={labelClass}>Industry</label>
      <IndustrySelect id="new-client-industry" bind:value={industry} canCreate={canAddIndustry} class={selectClass} />
    </div>
  </div>
  {#snippet footer()}
    <div class="mt-4 flex h-[3.75rem] shrink-0 items-center justify-end gap-2 border-t border-line-soft px-[1.375rem]">
      <button
        type="button"
        disabled={busy}
        onclick={() => (open = false)}
        class="h-8 rounded-lg px-3 text-[0.8125rem] leading-[1.125rem] text-ink-secondary hover:bg-primary-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 pointer-coarse:h-11"
      >Cancel</button>
      <button
        type="button"
        data-create-client
        disabled={!canCreate}
        onclick={() => void create()}
        class="h-8 rounded-lg bg-fir px-3.5 text-[0.8125rem] leading-[1.125rem] font-medium text-white hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fir focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11"
      >{busy ? "Creating..." : "Create client"}</button>
    </div>
  {/snippet}
</TeamDialog>
