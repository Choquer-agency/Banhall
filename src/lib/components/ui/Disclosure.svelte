<script lang="ts">
  // Shared animated disclosure body (2026-08-08 amendment). The HOST keeps
  // the trigger button (aria-expanded + aria-controls pointing at this
  // region's `id`, chevron per design-system rule 7 — see DisclosureChevron);
  // this primitive owns the truthful open/close mechanics:
  // - animated enter AND exit ≥300ms via grid-template-rows 0fr↔1fr (the
  //   sanctioned intrinsic-height disclosure — no width/height animation,
  //   no content snap while only a chevron animates);
  // - reduced motion collapses to (near-)instant;
  // - during the exit the collapsing body is `inert` (not tabbable, hidden
  //   from AT), and once the exit settles the content UNMOUNTS entirely —
  //   the DOM stays truthful for closed sections exactly like the previous
  //   `{#if open}` bodies.
  import type { Snippet } from "svelte";

  let {
    id,
    open,
    children,
  }: {
    /** DOM id the host trigger references via aria-controls. */
    id: string;
    open: boolean;
    children: Snippet;
  } = $props();

  let grid: HTMLDivElement | null = $state(null);
  // Children stay mounted while open OR while the exit animation runs.
  // `rendered` is DERIVED so opening mounts the body in the same flush as
  // the host's state change (focus-after-open handlers keep working).
  let closing = $state(false);
  // Intentional initial-value capture: sections that mount closed have
  // nothing to animate out until they open once.
  // svelte-ignore state_referenced_locally
  let hasOpened = open;
  const rendered = $derived(open || closing);

  $effect(() => {
    if (open) {
      hasOpened = true;
      closing = false;
      return;
    }
    // Never-opened sections have nothing to animate out — stay unmounted.
    if (!hasOpened) return;
    closing = true;
    const el = grid;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      closing = false;
    };
    // transitionend on the grid wrapper ends the exit; the timer is the
    // reduced-motion / no-transition fallback so content never lingers.
    const timer = window.setTimeout(finish, 400);
    const onEnd = (event: TransitionEvent) => {
      if (event.target === el && event.propertyName === "grid-template-rows") finish();
    };
    el?.addEventListener("transitionend", onEnd);
    return () => {
      window.clearTimeout(timer);
      el?.removeEventListener("transitionend", onEnd);
    };
  });
</script>

<div
  bind:this={grid}
  class="disclosure"
  data-disclosure
  data-open={open ? "" : undefined}
>
  {#if rendered}
    <div {id} inert={!open} class="disclosure-body">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .disclosure {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .disclosure[data-open] {
    grid-template-rows: 1fr;
  }
  .disclosure-body {
    min-height: 0;
    /* Hidden at rest AND during motion: the growing/shrinking track clips
       its content so enter/exit both read as one continuous reveal. */
    overflow: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .disclosure {
      transition: none;
    }
  }
</style>
