<!--
  Single-draft model picker: one slot card, same interaction as the compare
  slots (anchored popover with ModelSelectPanel). Always shows a selected
  model — "" resolves to the default (registry first), so the card renders
  in its active state from the start.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import ModelLogo from "./ModelLogo.svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import ModelSelectPanel from "./ModelSelectPanel.svelte";
  import { defaultModelIdFor, pickerModels } from "$lib/modelPicker";
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";

  let {
    value = $bindable(""),
    size = "lg",
  }: {
    /** Model id, or "" for the default model. */
    value?: string;
    /** lg = 44px slot card (selection screens), md = 36px inline control,
     *  field = New project's full-width 36px select with the AI mark (E1). */
    size?: "lg" | "md" | "field";
  } = $props();

  let open = $state(false);
  // "" resolves to the writing role's current model (model catalog).
  const capabilitiesQ = useQuery(api.providerReadiness.getCapabilities, () => ({}));
  const effectiveId = $derived(value || defaultModelIdFor(capabilitiesQ.data));
  const selected = $derived(
    pickerModels(capabilitiesQ.data).find((m) => m.id === effectiveId) ??
      pickerModels(capabilitiesQ.data)[0]
  );
  const label = $derived(selected.label);
</script>

<div
  data-model-picker={size}
  class={size === "field"
    ? "relative h-9 w-full overflow-hidden rounded-md border border-line bg-surface text-sm transition-colors hover:bg-primary-wash pointer-coarse:h-11"
    : `group/card relative overflow-hidden rounded-lg border border-gray-200 bg-white text-sm transition-colors hover:border-gray-300 hover:bg-gray-50/60 ${
        size === "md" ? "h-9 w-40" : "h-11 w-44"
      }`}
>
  <Popover.Root bind:open>
    <Popover.Trigger
      aria-label={`Change model: ${label}`}
      class="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 text-left"
    >
      {#if size === "field"}
        <AuroraMark size={16} />
        <span class="min-w-0 flex-1 truncate text-sm text-ink" title={label}>{label}</span>
        <svg class="h-3 w-3 shrink-0 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      {:else}
        <ModelLogo provider={selected.provider} size={size === "md" ? "sm" : "md"} />
        <span
          class={`min-w-0 flex-1 truncate font-semibold tracking-tight ${size === "md" ? "text-xs" : "text-sm"}`}
          title={label}
        >
          {label}
        </span>
      {/if}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        side="bottom"
        align="start"
        sideOffset={6}
        class="z-[120] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
      >
        <ModelSelectPanel
          value={effectiveId}
          onSelect={(next) => {
            value = next;
            open = false;
          }}
        />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
</div>
