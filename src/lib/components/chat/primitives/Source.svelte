<script lang="ts">
  import type { Snippet } from "svelte";
  import { setSourceContext } from "./sourceContext";

  interface Props {
    href: string;
    children?: Snippet;
  }

  let { href, children }: Props = $props();
  let open = $state(false);
  setSourceContext(() => href);

  function handleFocusOut(event: FocusEvent & { currentTarget: HTMLSpanElement }) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      open = false;
    }
  }
</script>
<span
  role="group"
  class={`source-root relative inline-flex ${open ? "source-open" : ""}`}
  onmouseenter={() => (open = true)}
  onmouseleave={() => (open = false)}
  onfocusin={() => (open = true)}
  onfocusout={handleFocusOut}
>
  {@render children?.()}
</span>

<style>
  :global(.source-root.source-open > .source-content) {
    pointer-events: auto;
    visibility: visible;
    transform: translateY(0);
    opacity: 1;
  }
</style>
