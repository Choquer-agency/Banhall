<script lang="ts">
  /**
   * Round 2 avatar (rail identity 24px, collapsed rail 28px, identity menu
   * 32px, Settings photo 52px). Shows the profile photo when there is one,
   * otherwise initials on a tone. The boards use fir, teal and purple with no
   * stated rule; `avatarTone(seed)` picks one from the user id so a person
   * keeps the same colour everywhere (proposal, confirm with design).
   */
  import { avatarTone, initialsFor, type AvatarTone } from "./avatarTone";

  let {
    name = "",
    initials = undefined,
    imageUrl = null,
    size = 24,
    tone = undefined,
    seed = undefined,
    class: className = "",
  }: {
    name?: string;
    initials?: string;
    imageUrl?: string | null;
    size?: number;
    tone?: AvatarTone;
    /** Stable id used to pick a tone when `tone` is not set. */
    seed?: string;
    class?: string;
  } = $props();

  const resolvedTone = $derived(tone ?? avatarTone(seed ?? name));
  const letters = $derived(initials ?? initialsFor(name));
  const toneClass: Record<AvatarTone, string> = {
    fir: "bg-fir",
    teal: "bg-primary-selected",
    purple: "bg-avatar-purple",
  };
  const fontSize = $derived(size >= 48 ? 18 : size >= 32 ? 12 : size >= 28 ? 11 : 10);
</script>

<span
  data-avatar
  data-avatar-tone={imageUrl ? undefined : resolvedTone}
  aria-hidden="true"
  class={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-normal leading-none text-white ${imageUrl ? "bg-chrome" : toneClass[resolvedTone]} ${className}`}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:font-size={`${fontSize}px`}
>
  {#if imageUrl}
    <img src={imageUrl} alt="" class="h-full w-full object-cover" draggable="false" />
  {:else}
    {letters}
  {/if}
</span>
