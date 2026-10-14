<script lang="ts">
  /**
   * Client on New project (boards E1, W7 and W8; 2026-10-14 amendment, "Pick
   * a client on New project"). The list holds the saved clients and the
   * company names with no client row yet (`clients.listClients`). Typing
   * filters it; text that names a listed client (same key) is "picked".
   * Text that names nothing shows "No client named ..." and, when the page
   * allows it, a New client row that hands the typed name back.
   */
  import { Combobox } from "bits-ui";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { IconChevronDown, IconPlus } from "$lib/components/icons";
  import { api } from "../../../../convex/_generated/api";
  import {
    listedClientFor,
    matchingClients,
    mergeClientOptions,
    type ClientOption,
  } from "$lib/clients/clientOptions";

  const NEW_CLIENT_VALUE = "\u0000new-client";

  let {
    id = "clientName",
    value = $bindable(""),
    clients = undefined,
    extraClients = [],
    picked = $bindable(null),
    loading = $bindable(true),
    onPick = undefined,
    onNewClient = undefined,
    placeholder = "Client name",
    class: className = "",
    inputClass = "h-9 rounded-lg pl-2.5 pointer-coarse:h-11",
  }: {
    id?: string;
    value?: string;
    /** Options to show instead of `clients.listClients` (tests). */
    clients?: readonly ClientOption[];
    /** Clients this page added or chose since the list loaded. */
    extraClients?: readonly ClientOption[];
    /** The listed client the text names, or null. */
    picked?: ClientOption | null;
    /** True until the list has loaded. */
    loading?: boolean;
    /** Called when the listed client the text names changes (null for none). */
    onPick?: (client: ClientOption | null) => void;
    /** Offers New client for text that names no listed client. */
    onNewClient?: (typedName: string) => void;
    placeholder?: string;
    class?: string;
    /** Height, radius and left padding of the field (36px on desktop, 44px on the phone, H2). */
    inputClass?: string;
  } = $props();

  const auth = useAuth();
  const clientsQ = useQuery(api.clients.listClients, () =>
    clients === undefined && auth.isAuthenticated ? {} : "skip"
  );
  const listLoaded = $derived(clients !== undefined || clientsQ.data !== undefined);
  const options = $derived(
    mergeClientOptions((clients ?? clientsQ.data?.clients ?? []) as readonly ClientOption[], extraClients)
  );

  let open = $state(false);
  let inputRef = $state<HTMLInputElement | null>(null);

  const typed = $derived(value.trim());
  const matched = $derived(listLoaded ? listedClientFor(options, value) : null);
  const matches = $derived(matchingClients(options, value));
  // Text that names nothing, once the list is in (never while it loads).
  const noMatch = $derived(listLoaded && typed !== "" && !matched && matches.length === 0);
  const hasContent = $derived(matches.length > 0 || noMatch);

  // The page reads whether the text is a listed client, and hears when it
  // changes (a pick, a prefill that turns out to be listed, or a new name).
  let lastPickedKey: string | null = null;
  $effect(() => {
    const current = matched;
    loading = !listLoaded;
    picked = current;
    const key = current?.key ?? null;
    if (key === lastPickedKey) return;
    lastPickedKey = key;
    onPick?.(current);
  });

  // bits-ui's input is uncontrolled: keep it showing `value` when the value
  // changes from outside (a prefill) and the writer is not typing in it.
  $effect(() => {
    const input = inputRef;
    if (!input || document.activeElement === input) return;
    if (input.value !== value) input.value = value;
  });

  function choose(next: string) {
    if (!next) return;
    if (next === NEW_CLIENT_VALUE) {
      const name = typed;
      open = false;
      onNewClient?.(name);
      // Keep the typed name in the field, whatever the row wrote there.
      queueMicrotask(() => {
        if (inputRef && inputRef.value !== value) inputRef.value = value;
      });
      return;
    }
    value = next;
    if (inputRef) inputRef.value = next;
    open = false;
  }
</script>

<Combobox.Root type="single" bind:open value="" onValueChange={choose}>
  <div class={`relative ${className}`}>
    <Combobox.Input
      {id}
      bind:ref={inputRef}
      defaultValue={value}
      {placeholder}
      aria-label="Client"
      autocomplete="off"
      data-client-picked={matched ? "true" : undefined}
      oninput={(event) => {
        value = event.currentTarget.value;
        open = hasContent;
      }}
      onfocus={() => (open = hasContent)}
      class={`field-control w-full pr-8 text-sm text-ink placeholder:text-ink-faint ${inputClass}`}
    />
    <Combobox.Trigger
      aria-label="Show clients"
      class="absolute top-1/2 right-[0.3125rem] flex size-6 -translate-y-1/2 items-center justify-center text-ink-faint"
    >
      <IconChevronDown size={14} strokeWidth={1.8} />
    </Combobox.Trigger>
  </div>
  <Combobox.Portal>
    <Combobox.Content
      sideOffset={4}
      data-client-suggestions
      class="z-[150] max-h-72 w-[var(--bits-combobox-anchor-width)] overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-menu"
    >
      <Combobox.Viewport class="max-h-64 overflow-y-auto">
        {#if noMatch}
          <!-- W8: nothing by that name; New client takes the typed text. -->
          <div class="flex flex-col gap-0.5 px-2 pt-2 pb-1.5" data-client-no-match>
            <p class="text-[0.8125rem] leading-[1.125rem] text-ink">No client named {typed}</p>
            <p class="text-xs leading-[1.0625rem] text-ink-muted">
              {onNewClient ? "Check the spelling, or add it as a new client." : "Check the spelling."}
            </p>
          </div>
          {#if onNewClient}
            <div class="my-1 h-px bg-line-soft" aria-hidden="true"></div>
            <!-- The label is what bits-ui writes into the field on choosing
                 the row, so the typed name stays there. -->
            <Combobox.Item
              value={NEW_CLIENT_VALUE}
              label={typed}
              data-new-client-option
              class="flex h-8 cursor-default items-center gap-2 rounded-md bg-primary-wash px-2 text-[0.8125rem] leading-[1.125rem] font-medium text-primary-selected outline-none data-highlighted:bg-chrome pointer-coarse:h-11"
            >
              <IconPlus size={14} strokeWidth={2} class="shrink-0" />
              New client
            </Combobox.Item>
          {/if}
        {:else}
          {#each matches as client (client.key)}
            <Combobox.Item
              value={client.name}
              label={client.name}
              data-client-option={client.key}
              class="flex min-h-8 cursor-default items-center rounded-md px-2 text-[0.8125rem] leading-[1.125rem] text-ink outline-none data-highlighted:bg-primary-wash pointer-coarse:min-h-11"
            >
              {client.name}
            </Combobox.Item>
          {/each}
        {/if}
      </Combobox.Viewport>
    </Combobox.Content>
  </Combobox.Portal>
</Combobox.Root>
