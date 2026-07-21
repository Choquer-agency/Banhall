<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  interface Props {
    open?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    open = $bindable(false),
    class: className,
    children,
  }: Props = $props();
</script>

<details bind:open class={cn("chain-step group/step", className)}>
  {@render children?.()}
  <div class="chain-step-connector grid h-5 grid-cols-[1rem_minmax(0,1fr)_1rem] gap-x-2 group-open/step:h-2" aria-hidden="true">
    <span class="mx-auto h-full w-px bg-primary/20"></span>
  </div>
</details>
