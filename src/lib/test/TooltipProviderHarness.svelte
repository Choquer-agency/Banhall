<script lang="ts">
  // Renders a component inside the app's Tooltip.Provider (the root layout
  // supplies it in the app), for component tests of tooltip-bearing panels.
  import type { Component } from "svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";

  let { panel: Panel, panelProps = {} }: { panel: Component<any>; panelProps?: Record<string, unknown> } = $props();
</script>

<Tooltip.Provider>
  <Panel {...panelProps} />
</Tooltip.Provider>
