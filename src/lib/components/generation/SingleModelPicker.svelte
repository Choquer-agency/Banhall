<!--
  Single-draft model picker: one slot card, same interaction as the compare
  slots (anchored popover with ModelSelectPanel). Always shows a selected
  model — "" resolves to the default (registry first), so the card renders
  in its active state from the start.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import ModelLogo from "./ModelLogo.svelte";
  import ModelSelectPanel from "./ModelSelectPanel.svelte";
  import { CANDIDATE_MODELS } from "../../../../shared/generationModels";
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";

  let {
    value = $bindable(""),
    size = "lg",
  }: {
    /** Model id, or "" for the default model. */
    value?: string;
    /** lg = 44px slot card (selection screens) · md = 36px inline control. */
    size?: "lg" | "md";
  } = $props();

  let open = $state(false);
  // "" resolves to the admin-set default model (falls back to registry first).
  const capabilitiesQ = useQuery(api.providerReadiness.getCapabilities, () => ({}));
  const effectiveId = $derived(
    value || capabilitiesQ.data?.defaultModel || CANDIDATE_MODELS[0].id
  );
  const selected = $derived(
    CANDIDATE_MODELS.find((m) => m.id === effectiveId) ?? CANDIDATE_MODELS[0]
  );
  const label = $derived(selected.label);
</script>

<div
  class={`group/card relative overflow-hidden rounded-lg border border-gray-200 bg-white text-sm transition-colors hover:border-gray-300 hover:bg-gray-50/60 ${
    size === "md" ? "h-9 w-40" : "h-11 w-44"
  }`}
>
  <Popover.Root bind:open>
    <Popover.Trigger
      aria-label={`Change model: ${label}`}
      class="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 text-left"
    >
      <ModelLogo provider={selected.provider} size={size === "md" ? "sm" : "md"} />
      <span
        class={`min-w-0 flex-1 truncate font-semibold tracking-tight ${size === "md" ? "text-xs" : "text-sm"}`}
        title={label}
      >
        {label}
      </span>
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
