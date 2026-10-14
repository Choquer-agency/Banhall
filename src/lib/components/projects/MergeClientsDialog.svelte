<!--
  Merge clients (Paper W5; 2026-10-14 amendment, "Merge clients"). Managers
  and Admins pick the name to keep from the selected clients, or type a new
  one, and confirm. previewClientMerge counts the projects, reports a typed
  name that another client already uses (nameConflict) and a merge over the
  200 project cap (tooMany), and lists project numbers the merge makes appear
  twice in one fiscal year. Either refusal disables Merge clients.
-->
<script module lang="ts">
  export type MergeResult = { keptKey: string; keptName: string; moved: number };
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { RadioGroup } from "bits-ui";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { toast } from "svelte-sonner";
  import TeamDialog from "$lib/components/team/TeamDialog.svelte";
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
    const done = onMerged;
    try {
      const result = await mergeClients({
        keepKey,
        mergeKeys,
        ...(usingOther ? { name: typedName } : {}),
      });
      open = false;
      toast.success(`Merged ${clients.length} clients into ${result.keptName}.`);
      done?.({ keptKey: result.keptKey, keptName: result.keptName, moved: result.moved });
    } catch (error) {
      errorMessage = userErrorMessage(error, "These clients could not be merged. Try again.");
    } finally {
      busy = false;
    }
  }

  const radioCircle = "flex size-4 shrink-0 items-center justify-center rounded-full border";
</script>

<TeamDialog
  bind:open
  width={480}
  top={190}
  {busy}
  initialFocus={() =>
    document.querySelector<HTMLElement>(
      `[data-testid="merge-clients-dialog"] [data-merge-keep="${CSS.escape(defaultKeepKey(clients) ?? "")}"]`
    )}
  testId="merge-clients-dialog"
  title={`Merge ${clients.length} clients`}
  description={mergeIntroText(projectCount)}
>
  <div class="flex flex-col px-7 pb-1 pt-3">
    <RadioGroup.Root bind:value={choice} aria-label="Name to keep" class="flex flex-col">
      {#each clients as client (client.key)}
        <RadioGroup.Item
          value={client.key}
          data-merge-keep={client.key}
          class="flex h-10 w-full items-center gap-2.5 rounded-md text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:h-11"
        >
          {#snippet children({ checked })}
            <span aria-hidden="true" class={`${radioCircle} ${checked ? "border-fir" : "border-line"}`}>
              {#if checked}<span class="size-2 rounded-full bg-fir"></span>{/if}
            </span>
            <span class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-[1.125rem] text-ink ${checked ? "font-medium" : ""}`}>{client.name}</span>
            <span class="shrink-0 text-xs leading-4 text-ink-muted">{projectsLabel(client.projectCount)}</span>
          {/snippet}
        </RadioGroup.Item>
      {/each}
      <div class="flex h-11 items-center gap-2.5">
        <RadioGroup.Item
          value={OTHER}
          aria-label="Use a different name"
          data-merge-keep="other"
          onclick={() => queueMicrotask(() => otherInput?.focus())}
          class="flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:before:absolute pointer-coarse:before:size-11 pointer-coarse:before:content-[''] relative"
        >
          {#snippet children({ checked })}
            <span aria-hidden="true" class={`${radioCircle} ${checked ? "border-fir" : "border-line"}`}>
              {#if checked}<span class="size-2 rounded-full bg-fir"></span>{/if}
            </span>
          {/snippet}
        </RadioGroup.Item>
        <input
          bind:this={otherInput}
          bind:value={otherName}
          data-merge-other-name
          aria-label="Different client name"
          aria-invalid={usingOther && preview?.nameConflict ? "true" : undefined}
          placeholder="Use a different name"
          autocomplete="off"
          maxlength={200}
          onfocus={() => (choice = OTHER)}
          oninput={() => (errorMessage = null)}
          class="field-control h-8 min-w-0 flex-1 rounded-[0.4375rem] px-2.5 text-[0.8125rem] leading-[1.125rem] text-ink placeholder:text-ink-faint pointer-coarse:h-11"
        />
      </div>
    </RadioGroup.Root>

    <div class="flex flex-col gap-2 pb-4 pt-2">
      {#if preview && preview.nameConflict === null && !preview.tooMany}
        <p data-merge-summary class="rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-[1.0625rem] text-ink-secondary">
          {mergeSummaryText(preview.projectCount, preview.keptName, clients.length - 1)}
        </p>
      {/if}
      {#if preview && preview.numberCollisions.length > 0 && preview.nameConflict === null && !preview.tooMany}
        <ul data-merge-collisions class="flex flex-col gap-1 rounded-lg border border-warning-line bg-warning-surface px-3 py-2.5 text-xs leading-[1.0625rem] text-warning-ink">
          {#each preview.numberCollisions as collision (`${collision.fiscalYear}:${collision.projectNumber}`)}
            <li>{mergeCollisionText(collision)}</li>
          {/each}
        </ul>
      {/if}
      {#if preview?.nameConflict}
        <p role="alert" data-merge-error="name" class="rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger-ink-muted">
          {preview.nameConflict} is already a client. Select it in the client list to merge into it, or type another name.
        </p>
      {/if}
      {#if preview?.tooMany}
        <p role="alert" data-merge-error="too-many" class="rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger-ink-muted">
          This merge would move more than 200 projects. Merge fewer clients at a time.
        </p>
      {/if}
      {#if previewError}
        <p role="alert" data-merge-error="preview" class="rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger-ink-muted">{previewError}</p>
      {/if}
      {#if errorMessage}
        <p role="alert" data-merge-error="merge" class="rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] text-danger-ink-muted">{errorMessage}</p>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <div class="flex h-[3.75rem] items-center justify-end gap-2 border-t border-line-soft px-[1.375rem]">
      <button
        type="button"
        disabled={busy}
        onclick={() => (open = false)}
        class="h-8 rounded-[0.4375rem] px-3 text-[0.8125rem] leading-[1.125rem] text-ink-secondary hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 pointer-coarse:h-11"
      >Cancel</button>
      <button
        type="button"
        data-confirm-merge
        disabled={!canMerge}
        onclick={() => void confirm()}
        class="h-8 rounded-[0.4375rem] bg-fir px-3.5 text-[0.8125rem] leading-[1.125rem] font-medium text-white hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 pointer-coarse:h-11"
      >{busy ? "Merging..." : "Merge clients"}</button>
    </div>
  {/snippet}
</TeamDialog>
