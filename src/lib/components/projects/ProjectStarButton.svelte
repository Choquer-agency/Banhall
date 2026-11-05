<!--
  The star on a project (2026-11-02): a person's private flag on the
  projects they are working on. A toggle button with `aria-pressed`; its
  name stays the same whichever way it is set (the pressed state says
  which), and the tooltip reads "Star project" or "Unstar project". The
  host passes the saved state; while the save is on its way the button
  shows the new state, and a refusal puts it back with a toast.

  `card`: 24px in a card's stage band, outlined and shown on hover, focus
  and touch screens until starred, then filled yellow (`star`) and always
  shown; on touch
  screens the hit area grows to 44px without moving the band. `bar`: 30px
  in the project top bar, always shown, 44px on touch screens.
-->
<script lang="ts">
  import { StarIcon } from "phosphor-svelte";
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { userErrorMessage } from "$lib/errors";

  let {
    projectId,
    projectTitle,
    starred,
    variant = "card",
    class: className = "",
  }: {
    projectId: string;
    projectTitle: string;
    /** The saved state. */
    starred: boolean;
    variant?: "card" | "bar";
    class?: string;
  } = $props();

  const setStar = useMutation(api.projects.setProjectStar);
  /** The state being saved, shown until the save settles. */
  let pending = $state<boolean | null>(null);
  const shown = $derived(pending ?? starred);
  /** Starring plays a short pop (owner, 2026-11-05); unstarring just fades. */
  let popping = $state(false);

  async function toggle(event: MouseEvent) {
    // The card's title link covers the card; the star is its own action.
    event.preventDefault();
    event.stopPropagation();
    if (pending !== null) return;
    const next = !shown;
    pending = next;
    popping = next;
    try {
      await setStar({ projectId: projectId as Id<"projects">, starred: next });
    } catch (error) {
      toast.error(
        userErrorMessage(
          error,
          next
            ? "Could not star the project. Check your connection and try again."
            : "Could not remove the star. Check your connection and try again."
        )
      );
    } finally {
      pending = null;
    }
  }

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy";
  const variantClass = $derived(
    variant === "bar"
      ? `size-[1.875rem] rounded-[0.4375rem] hover:bg-primary-wash pointer-coarse:size-11 ${shown ? "text-star" : "text-ink-secondary hover:text-ink"}`
      : `relative z-10 size-6 rounded-md hover:bg-white/70 pointer-coarse:before:absolute pointer-coarse:before:-inset-[0.625rem] pointer-coarse:before:content-[''] ${
          shown
            ? "text-star"
            : "text-ink-muted opacity-0 hover:text-ink focus-visible:opacity-100 group-hover/project:opacity-100 group-focus-within/project:opacity-100 pointer-coarse:opacity-100"
        }`
  );
</script>

<button
  type="button"
  aria-pressed={shown}
  aria-label={variant === "card" ? `Star ${projectTitle}` : "Star project"}
  title={shown ? "Unstar project" : "Star project"}
  data-project-star={projectId}
  data-starred={shown ? "true" : "false"}
  onclick={toggle}
  class={`flex shrink-0 items-center justify-center transition-[color,background-color,opacity] duration-200 ease-out motion-reduce:transition-none ${focusRing} ${variantClass} ${className}`}
>
  <span
    class={`flex ${popping ? "star-pop" : ""}`}
    data-star-pop={popping ? "true" : undefined}
    onanimationend={() => (popping = false)}
    aria-hidden="true"
  >
    <StarIcon size={variant === "bar" ? "0.9375rem" : "0.875rem"} weight={shown ? "fill" : "regular"} aria-hidden="true" />
  </span>
</button>
