<!--
  Positional initials reassignment for a staged PD on To review (2026-11-23,
  updated 2026-11-24 for multi-writer / multi-client initials and CRA Section C
  client contact matching): shows the 4 positional filename slots (Writer,
  Reviewer, Client, Financial), lets an Admin shift initials left or right
  between adjacent slots, add co-writers or multiple comma-separated client
  initials, and toggle whether the reviewer is still in progress (lowercase
  initials such as ".mo"). Saving calls ingestion.reassignFileInitials, marks
  the slots manually edited, and re-resolves Writer and Reviewer against the
  team roster.
-->
<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "phosphor-svelte";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { userErrorMessage } from "$lib/errors";
  import { INITIALS_RULE, savedInitials } from "../../../../shared/importSheetRules";
  import { matchClientInitials, type DocumentClientName } from "../../../../shared/pdSectionC";
  import { IMPORT_TOAST } from "./importActions";
  import { SHEET_SMALL } from "./sheetLayout";

  type SlotKey = "writer" | "reviewer" | "client" | "financial";

  const SLOTS: readonly { key: SlotKey; label: string }[] = [
    { key: "writer", label: "Writer" },
    { key: "reviewer", label: "Reviewer" },
    { key: "client", label: "Client" },
    { key: "financial", label: "Financial" },
  ];

  const MAX_EXTRA = 5;

  let {
    fileId,
    writerInitials = undefined,
    reviewerInitials = undefined,
    clientInitials = undefined,
    financialInitials = undefined,
    coWriterInitials = undefined,
    extraClientInitials = undefined,
    initialsGroups = undefined,
    reviewerInProgress = false,
    documentClientNames = undefined,
    companyName = undefined,
  }: {
    fileId: Id<"ingestionItems">;
    writerInitials?: string;
    reviewerInitials?: string;
    clientInitials?: string;
    financialInitials?: string;
    coWriterInitials?: string[];
    extraClientInitials?: string[];
    initialsGroups?: string[];
    reviewerInProgress?: boolean;
    documentClientNames?: DocumentClientName[];
    companyName?: string;
  } = $props();

  const reassign = useMutation(api.ingestion.reassignFileInitials);

  function joinInitials(primary: string | undefined, extra: readonly string[] | undefined): string {
    return [primary, ...(extra ?? [])].filter((v): v is string => Boolean(v)).join(", ");
  }

  function normalizeList(raw: string): string[] {
    return raw
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
  }

  function parseInitialsList(raw: string): string[] | "invalid" {
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const cleaned = savedInitials(part);
      if (cleaned === null) return "invalid";
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      out.push(cleaned);
    }
    return out;
  }

  let values = $state<Record<SlotKey, string>>({
    writer: "",
    reviewer: "",
    client: "",
    financial: "",
  });
  let coWritersText = $state("");
  let showCoWriters = $state(false);
  let inProgress = $state(false);
  let droppedUnassigned = $state<string[]>([]);
  let saving = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    values = {
      writer: writerInitials ?? "",
      reviewer: reviewerInitials ?? "",
      client: joinInitials(clientInitials, extraClientInitials),
      financial: financialInitials ?? "",
    };
    coWritersText = (coWriterInitials ?? []).join(", ");
    showCoWriters = (coWriterInitials?.length ?? 0) > 0;
    inProgress = reviewerInProgress === true;
    droppedUnassigned = [];
    error = null;
  });

  const savedClientKey = $derived(joinInitials(clientInitials, extraClientInitials).toUpperCase());
  const currentClientKey = $derived(normalizeList(values.client).join(", "));
  const savedCoWritersKey = $derived((coWriterInitials ?? []).map((v) => v.toUpperCase()).join(", "));
  const currentCoWritersKey = $derived(normalizeList(coWritersText).join(", "));

  const unassignedGroups = $derived.by(() => {
    if (!initialsGroups || initialsGroups.length === 0) return [] as string[];
    const assigned = new Set<string>([
      values.writer.trim().toUpperCase(),
      values.reviewer.trim().toUpperCase(),
      values.financial.trim().toUpperCase(),
      ...normalizeList(values.client),
      ...normalizeList(coWritersText),
    ]);
    const dropped = new Set(droppedUnassigned.map((code) => code.toUpperCase()));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const group of initialsGroups) {
      const key = group.toUpperCase();
      if (!key || assigned.has(key) || dropped.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(group);
    }
    return out;
  });

  const dirty = $derived(
    values.writer.trim().toUpperCase() !== (writerInitials ?? "").toUpperCase() ||
      values.reviewer.trim().toUpperCase() !== (reviewerInitials ?? "").toUpperCase() ||
      currentClientKey !== savedClientKey ||
      values.financial.trim().toUpperCase() !== (financialInitials ?? "").toUpperCase() ||
      currentCoWritersKey !== savedCoWritersKey ||
      droppedUnassigned.length > 0 ||
      (values.reviewer.trim() !== "" && inProgress !== (reviewerInProgress === true))
  );

  const clientMatches = $derived.by(() => {
    if (!documentClientNames || documentClientNames.length === 0) return [];
    const tokens = normalizeList(values.client);
    const matches: { code: string; name: string }[] = [];
    for (const code of tokens) {
      const hit = matchClientInitials(documentClientNames, code, { companyName });
      if (hit) matches.push({ code, name: hit.name });
    }
    return matches;
  });

  const financialSectionCHint = $derived.by(() => {
    if (!documentClientNames || documentClientNames.length === 0) return null;
    const code = values.financial.trim().toUpperCase();
    if (!code) return null;
    const hit = matchClientInitials(documentClientNames, code, { companyName });
    return hit ? { code, name: hit.name } : null;
  });

  function swapSlots(indexA: number, indexB: number) {
    const keyA = SLOTS[indexA]?.key;
    const keyB = SLOTS[indexB]?.key;
    if (!keyA || !keyB) return;
    const next = { ...values };
    if (keyA === "client" || keyB === "client") {
      const otherKey = keyA === "client" ? keyB : keyA;
      const clientParts = values.client
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const firstClient = clientParts[0] ?? "";
      const restClient = clientParts.slice(1);
      const otherVal = values[otherKey].trim();
      next[otherKey] = firstClient;
      next.client = [otherVal, ...restClient].filter(Boolean).join(", ");
    } else {
      const tmp = next[keyA];
      next[keyA] = next[keyB];
      next[keyB] = tmp;
    }
    values = next;
    error = null;
  }

  function dropUnassigned(code: string) {
    const key = code.toUpperCase();
    if (!droppedUnassigned.includes(key)) {
      droppedUnassigned = [...droppedUnassigned, key];
    }
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
    const nextFinancial = cleanSlot(values.financial);
    const parsedClients = parseInitialsList(values.client);
    const parsedCoWriters = parseInitialsList(coWritersText);
    if (
      nextWriter === "invalid" ||
      nextReviewer === "invalid" ||
      nextFinancial === "invalid" ||
      parsedClients === "invalid" ||
      parsedCoWriters === "invalid"
    ) {
      error = INITIALS_RULE;
      return;
    }
    const nextClient = parsedClients[0] ?? null;
    const nextExtraClients = parsedClients.slice(1);
    const nextCoWriters = parsedCoWriters.filter((code) => code !== nextWriter);
    if (nextExtraClients.length > MAX_EXTRA || nextCoWriters.length > MAX_EXTRA) {
      error = `Use up to ${MAX_EXTRA} additional initials per role.`;
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
        coWriterInitials: nextCoWriters.length > 0 ? nextCoWriters : null,
        extraClientInitials: nextExtraClients.length > 0 ? nextExtraClients : null,
        ...(droppedUnassigned.length > 0 ? { dropUnassignedInitials: droppedUnassigned } : {}),
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
  {#if initialsGroups && initialsGroups.length > 4}
    <p class={`mt-1.5 ${SHEET_SMALL} text-ink-muted`} data-import-initials-raw-groups>
      Filename groups: {initialsGroups.join(" · ")}
    </p>
  {/if}
  {#if unassignedGroups.length > 0}
    <div class="mt-1.5 flex flex-wrap items-center gap-1.5" data-import-initials-unassigned>
      <span class={`${SHEET_SMALL} text-ink-muted`}>Unassigned:</span>
      {#each unassignedGroups as code (code)}
        <span class="inline-flex items-center gap-1 rounded bg-chrome px-1.5 py-0.5 text-[0.6875rem] leading-tight font-medium text-ink-secondary">
          <span>{code}</span>
          <button
            type="button"
            disabled={saving}
            aria-label={`Remove unassigned initials ${code}`}
            data-import-initials-drop-unassigned={code}
            onclick={() => dropUnassigned(code)}
            class="inline-flex size-3.5 items-center justify-center rounded-sm text-ink-muted hover:bg-primary-wash hover:text-ink disabled:opacity-40"
          >
            <XIcon size="0.625rem" aria-hidden="true" />
          </button>
        </span>
      {/each}
    </div>
  {/if}
  <form class="mt-2.5 flex flex-col gap-2.5" onsubmit={save} novalidate>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {#each SLOTS as slot, index (slot.key)}
        <div class="flex flex-col gap-1 rounded-md border border-line-soft bg-surface p-2" data-import-initials-slot={slot.key}>
          <label for={`initials-slot-${slot.key}`} class={`${SHEET_SMALL} text-ink-muted`}>{slot.label}</label>
          <Input
            id={`initials-slot-${slot.key}`}
            data-import-initials-input={slot.key}
            type="text"
            autocomplete="off"
            spellcheck="false"
            maxlength={slot.key === "client" ? 32 : 6}
            placeholder={slot.key === "client" ? "BM, JT" : "-"}
            bind:value={values[slot.key]}
            class="!h-7 w-full !rounded !px-1.5 !py-0 text-center !text-xs font-medium uppercase text-ink"
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

    {#if showCoWriters}
      <div class="flex items-center gap-2 rounded-md border border-line-soft bg-surface px-2.5 py-1.5" data-import-initials-cowriters>
        <label for="initials-slot-cowriters" class={`${SHEET_SMALL} shrink-0 text-ink-muted`}>Co-writers</label>
        <div class="min-w-0 flex-1">
          <Input
            id="initials-slot-cowriters"
            data-import-initials-input="cowriters"
            type="text"
            autocomplete="off"
            spellcheck="false"
            maxlength={32}
            placeholder="e.g. AL, KP"
            bind:value={coWritersText}
            class="!h-7 w-full !rounded !px-2 !py-0 !text-xs font-medium uppercase text-ink"
          />
        </div>
        {#if coWritersText.trim() === ""}
          <button
            type="button"
            onclick={() => {
              showCoWriters = false;
            }}
            class={`${SHEET_SMALL} text-ink-muted hover:text-ink`}
          >Hide</button>
        {/if}
      </div>
    {:else}
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          data-import-initials-add-cowriter
          onclick={() => {
            showCoWriters = true;
          }}
          class={`${SHEET_SMALL} text-ink-muted underline-offset-2 hover:text-ink hover:underline`}
        >+ Co-writer</button>
        <span class={`${SHEET_SMALL} text-ink-muted`}>Separate multiple initials with commas</span>
      </div>
    {/if}

    {#if clientMatches.length > 0}
      <p class={`${SHEET_SMALL} text-ink-secondary`} data-import-initials-client-matches>
        Section C match: {clientMatches.map((m) => `${m.code} - ${m.name}`).join(", ")}
      </p>
    {/if}

    {#if financialSectionCHint}
      <p class={`${SHEET_SMALL} text-warning-ink`} data-import-initials-financial-hint>
        {financialSectionCHint.code} matches Section C contact {financialSectionCHint.name} - shift left if this is a company contact.
      </p>
    {/if}

    {#if values.reviewer.trim() !== ""}
      <Checkbox
        data-import-initials-reviewer-in-progress
        bind:checked={inProgress}
        disabled={saving}
      >
        {#snippet label()}
          <span class={`${SHEET_SMALL} text-ink-secondary`}>Reviewer in progress (lowercase initials)</span>
        {/snippet}
      </Checkbox>
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
