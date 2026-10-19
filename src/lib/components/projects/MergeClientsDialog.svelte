<!--
  Merge clients (Paper W5; 2026-10-14 amendment, "Merge clients"). Managers
  and Admins pick the name to keep from the selected clients, or type a new
  one, and confirm. previewClientMerge counts the projects, reports a typed
  name that another client already uses (nameConflict) and a merge over the
  200 project cap (tooMany), and lists project numbers the merge makes appear
  twice in one fiscal year. When that check hit its read bound
  (collisionCheckIncomplete) the dialog says so. Either refusal disables
  Merge clients.
-->
<script module lang="ts">
  export type MergeResult = { keptKey: string; keptName: string; moved: number };
</script>

<script lang="ts">
  // Merge clients (Paper W5; 2026-10-14 amendment, "Merge clients"; the
  // shared FormDialog frame since Paper Z7m, 2026-10-19). The person picks
  // the name to keep, or types another, and confirms.
  import { untrack } from "svelte";
  import { RadioGroup } from "bits-ui";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { toast } from "svelte-sonner";
  import FormDialog from "$lib/components/ui/FormDialog.svelte";
  import { formCancel, formError, formField, formLabel, formPrimary } from "$lib/components/ui/formDialog";
  import { userErrorMessage } from "$lib/errors";
  import {
    defaultKeepKey,
    mergeCollisionText,
    mergeIntroText,
    mergeSummaryText,
    type ClientEntry,
  } from "$lib/projects/clientList";
  import { api } from "../../../../convex/_generated/api";

  let {
    open = $bindable(false),
    clients,
    onMerged = undefined,
  }: {
    open?: boolean;
    /** The selected clients, two or more. */
    clients: ClientEntry[];
    onMerged?: (result: MergeResult) => void;
  } = $props();

  const OTHER = "__other__";

  const auth = useAuth();
  const mergeClients = useMutation(api.clients.mergeClients);

  let choice = $state("");
  let otherName = $state("");
  /** The typed name previewClientMerge was last asked about. */
  let settledName = $state("");
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let otherInput: HTMLInputElement | null = $state(null);

  // Each opening starts from the client with the most projects.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      choice = defaultKeepKey(clients) ?? "";
      otherName = "";
      settledName = "";
      errorMessage = null;
      busy = false;
    });
  });

  $effect(() => {
    const next = otherName.trim();
    if (!open) return;
    const timer = setTimeout(() => (settledName = next), 250);
    return () => clearTimeout(timer);
  });

  const usingOther = $derived(choice === OTHER);
  const keepKey = $derived(usingOther ? (defaultKeepKey(clients) ?? "") : choice);
  const mergeKeys = $derived(clients.filter((client) => client.key !== keepKey).map((client) => client.key));
  const typedName = $derived(otherName.trim());
  const nameReady = $derived(!usingOther || (typedName !== "" && settledName === typedName));

  const previewQ = useQuery(api.clients.previewClientMerge, () =>
    open && auth.isAuthenticated && keepKey && mergeKeys.length > 0
      ? { keepKey, mergeKeys, ...(usingOther && settledName ? { name: settledName } : {}) }
      : "skip"
  );
  const preview = $derived(nameReady ? previewQ.data : undefined);
  const previewError = $derived(
    previewQ.error ? userErrorMessage(previewQ.error, "This merge could not be checked. Try again.") : null
  );
  const fallbackCount = $derived(clients.reduce((total, client) => total + client.projectCount, 0));
  const projectCount = $derived(previewQ.data?.projectCount ?? fallbackCount);

  const canMerge = $derived(
    !busy &&
      nameReady &&
      preview !== undefined &&
      !previewError &&
      preview.nameConflict === null &&
      !preview.tooMany
  );

  const projectsLabel = (count: number) => (count === 1 ? "1 project" : `${count} projects`);

  async function confirm() {
    if (!canMerge || !preview) return;
    busy = true;
    errorMessage = null;
    // Read everything before the await: once the merge lands, the client
    // list updates and the host may shrink `clients` or unmount this dialog.
    const done = onMerged;
    const count = clients.length;
    const args = { keepKey, mergeKeys: [...mergeKeys], ...(usingOther ? { name: typedName } : {}) };
    try {
      const result = await mergeClients(args);
      open = false;
      toast.success(`Merged ${count} ${count === 1 ? "company" : "companies"} into ${result.keptName}.`);
      done?.({ keptKey: result.keptKey, keptName: result.keptName, moved: result.moved });
    } catch (error) {
      errorMessage = userErrorMessage(error, "These companies could not be merged. Try again.");
    } finally {
      busy = false;
    }
  }

  const keptLabel = $derived(
    usingOther ? typedName : (clients.find((client) => client.key === keepKey)?.name ?? "")
  );
  const option =
    "flex h-10 w-full items-center gap-2.5 rounded-lg border bg-gray-50 px-3 text-left outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
  const errorBox = "rounded-lg border border-danger-line bg-danger-surface px-3 py-2.5 text-sm leading-5 text-danger-ink-muted";
</script>

{#snippet radio(checked: boolean)}
  <span
    aria-hidden="true"
    class={`flex size-4 shrink-0 rounded-full bg-surface ${checked ? "border-[0.3125rem] border-primary-selected" : "border-[1.5px] border-gray-300"}`}
  ></span>
{/snippet}

{#snippet footer()}
  <button type="button" disabled={busy} onclick={() => (open = false)} class={formCancel}>Cancel</button>
  <button type="button" data-confirm-merge disabled={!canMerge} onclick={() => void confirm()} class={formPrimary}>
    {busy ? "Merging..." : keptLabel ? `Merge into ${keptLabel}` : "Merge companies"}
  </button>
{/snippet}

<FormDialog
  bind:open
  {busy}
  initialFocus={() =>
    document.querySelector<HTMLElement>(
      `[data-testid="merge-clients-dialog"] [data-merge-keep="${CSS.escape(defaultKeepKey(clients) ?? "")}"]`
    )}
  testId="merge-clients-dialog"
  title={`Merge ${clients.length} companies`}
  description={mergeIntroText(projectCount)}
  {footer}
>
  <div class="flex flex-col gap-3.5">
    <div class="flex flex-col gap-1.5">
      <span class={formLabel} id="merge-keep-label">Name to keep</span>
      <RadioGroup.Root bind:value={choice} aria-labelledby="merge-keep-label" class="flex flex-col gap-1.5">
        {#each clients as client (client.key)}
          <RadioGroup.Item
            value={client.key}
            data-merge-keep={client.key}
            class={`${option} ${choice === client.key ? "border-primary-selected" : "border-line-soft hover:border-primary"}`}
          >
            {#snippet children({ checked })}
              {@render radio(checked)}
              <span class="min-w-0 flex-1 truncate text-sm leading-5 text-ink">{client.name}</span>
              <span class="shrink-0 text-[0.8125rem] leading-4 text-ink-muted">{projectsLabel(client.projectCount)}</span>
            {/snippet}
          </RadioGroup.Item>
        {/each}
        <div class="flex items-center gap-2.5">
          <RadioGroup.Item
            value={OTHER}
            aria-label="Use a different name"
            data-merge-keep="other"
            onclick={() => queueMicrotask(() => otherInput?.focus())}
            class="relative flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:before:absolute pointer-coarse:before:size-11 pointer-coarse:before:content-['']"
          >
            {#snippet children({ checked })}
              {@render radio(checked)}
            {/snippet}
          </RadioGroup.Item>
          <input
            bind:this={otherInput}
            bind:value={otherName}
            data-merge-other-name
            aria-label="Different company name"
            aria-invalid={usingOther && preview?.nameConflict ? "true" : undefined}
            data-changed={usingOther ? "" : undefined}
            placeholder="Use a different name"
            autocomplete="off"
            maxlength={200}
            onfocus={() => (choice = OTHER)}
            oninput={() => (errorMessage = null)}
            class={`field-control ${formField} min-w-0 flex-1`}
          />
        </div>
      </RadioGroup.Root>
    </div>

    {#if preview && preview.nameConflict === null && !preview.tooMany}
      <p data-merge-summary class="text-[0.8125rem] leading-[1.125rem] text-ink-muted">
        {mergeSummaryText(preview.projectCount, preview.keptName, clients.length - 1)}
      </p>
    {/if}
    {#if preview && preview.numberCollisions.length > 0 && preview.nameConflict === null && !preview.tooMany}
      <ul data-merge-collisions class="flex flex-col gap-1 rounded-lg bg-gap-bg px-3 py-2.5 text-sm leading-5 text-gap-text">
        {#each preview.numberCollisions as collision (`${collision.fiscalYear}:${collision.projectNumber}`)}
          <li>{mergeCollisionText(collision)}</li>
        {/each}
      </ul>
    {/if}
    {#if preview?.collisionCheckIncomplete && preview.nameConflict === null && !preview.tooMany}
      <p data-merge-collisions-incomplete class="rounded-lg bg-gap-bg px-3 py-2.5 text-sm leading-5 text-gap-text">
        Some project numbers could not be checked. Look for repeated numbers after the merge.
      </p>
    {/if}
    {#if preview?.nameConflict}
      <p role="alert" data-merge-error="name" class={errorBox}>
        {preview.nameConflict} is already a company. Select it in the company list to merge into it, or type another name.
      </p>
    {/if}
    {#if preview?.tooMany}
      <p role="alert" data-merge-error="too-many" class={errorBox}>
        This merge would move more than 200 projects. Merge fewer companies at a time.
      </p>
    {/if}
    {#if previewError}
      <p role="alert" data-merge-error="preview" class={errorBox}>{previewError}</p>
    {/if}
    {#if errorMessage}
      <p role="alert" data-merge-error="merge" class={formError}>{errorMessage}</p>
    {/if}
  </div>
</FormDialog>
