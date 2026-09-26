<script lang="ts">
  /**
   * Client on New project (board E1): free text with suggestions from the
   * recorded client names. Picking a suggestion fills the name; typing a new
   * one keeps it as typed (D7: names are never merged automatically).
   */
  import { Combobox } from "bits-ui";
  import { IconChevronDown } from "$lib/components/icons";

  let {
    id = "clientName",
    value = $bindable(""),
    suggestions,
    placeholder = "Client name",
    class: className = "",
    inputClass = "h-9 rounded-lg pl-2.5 pointer-coarse:h-11",
  }: {
    id?: string;
    value?: string;
    suggestions: readonly string[];
    placeholder?: string;
    class?: string;
    /** Height, radius and left padding of the field (36px on desktop, 44px on the phone, H2). */
    inputClass?: string;
  } = $props();

  let open = $state(false);
  let inputRef = $state<HTMLInputElement | null>(null);

  const matches = $derived.by(() => {
    const query = value.trim().toLocaleLowerCase("en-CA");
    const unique = [...new Set(suggestions.map((name) => name.trim()).filter(Boolean))];
    return unique
      .filter((name) => !query || name.toLocaleLowerCase("en-CA").includes(query))
      .filter((name) => name !== value.trim())
      .slice(0, 8);
  });

  // bits-ui's input is uncontrolled: keep it showing `value` when the value
  // changes from outside (a prefill) and the writer is not typing in it.
  $effect(() => {
    const input = inputRef;
    if (!input || document.activeElement === input) return;
    if (input.value !== value) input.value = value;
  });
</script>

<Combobox.Root
  type="single"
  bind:open
  value=""
  onValueChange={(next) => {
    if (!next) return;
    value = next;
    if (inputRef) inputRef.value = next;
    open = false;
  }}
>
  <div class={`relative ${className}`}>
    <Combobox.Input
      {id}
      bind:ref={inputRef}
      defaultValue={value}
      {placeholder}
      aria-label="Client"
      autocomplete="off"
      oninput={(event) => {
        value = event.currentTarget.value;
        open = matches.length > 0;
      }}
      onfocus={() => (open = matches.length > 0)}
      class={`field-control w-full pr-8 text-sm text-ink placeholder:text-ink-faint ${inputClass}`}
    />
    <Combobox.Trigger
      aria-label="Show recorded clients"
      class="absolute top-1/2 right-[5px] flex size-6 -translate-y-1/2 items-center justify-center text-ink-faint"
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
        {#each matches as name (name)}
          <Combobox.Item
            value={name}
            label={name}
            class="flex min-h-8 cursor-default items-center rounded-md px-2 text-[13px] leading-[18px] text-ink outline-none data-highlighted:bg-primary-wash pointer-coarse:min-h-11"
          >
            {name}
          </Combobox.Item>
        {/each}
      </Combobox.Viewport>
    </Combobox.Content>
  </Combobox.Portal>
</Combobox.Root>
