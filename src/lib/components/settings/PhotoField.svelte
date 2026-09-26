<script lang="ts">
  /**
   * Settings photo (I1): 52px avatar with a 22px remove badge when there is a
   * photo, "Change photo", and the rule line. The choice is staged; the page
   * saves it with the rest of the form.
   */
  import { XIcon } from "phosphor-svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import { PHOTO_HINT, PHOTO_TYPES, photoProblem, type StagedPhoto } from "$lib/settings/photo";

  let {
    name,
    seed = undefined,
    currentUrl = null,
    staged = $bindable({ kind: "none" }),
    disabled = false,
  }: {
    name: string;
    seed?: string;
    currentUrl?: string | null;
    staged?: StagedPhoto;
    disabled?: boolean;
  } = $props();

  let input: HTMLInputElement | null = $state(null);
  let problem = $state<string | null>(null);

  const shownUrl = $derived(
    staged.kind === "file" ? staged.previewUrl : staged.kind === "remove" ? null : currentUrl
  );

  function release(photo: StagedPhoto) {
    if (photo.kind === "file") URL.revokeObjectURL(photo.previewUrl);
  }

  function pick(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    (event.currentTarget as HTMLInputElement).value = "";
    if (!file) return;
    problem = photoProblem(file);
    if (problem) return;
    release(staged);
    staged = { kind: "file", file, previewUrl: URL.createObjectURL(file) };
  }

  function remove() {
    problem = null;
    release(staged);
    staged = currentUrl ? { kind: "remove" } : { kind: "none" };
  }
</script>

<div data-photo-field class="flex flex-col gap-2">
  <div class="flex flex-wrap items-center gap-3.5">
    <div class="relative size-[52px] shrink-0">
      <Avatar {name} {seed} imageUrl={shownUrl} size={52} />
      {#if shownUrl}
        <button
          type="button"
          data-photo-remove
          aria-label="Remove photo"
          onclick={remove}
          {disabled}
          class="absolute -top-1 left-[34px] flex size-[22px] items-center justify-center rounded-full border border-line bg-surface text-ink-secondary shadow-sm transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-['']"
        >
          <XIcon size={11} weight="bold" aria-hidden="true" />
        </button>
      {/if}
    </div>
    <button
      type="button"
      data-photo-change
      onclick={() => input?.click()}
      {disabled}
      class="inline-flex h-8 items-center rounded-md bg-chrome px-3.5 text-sm font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
    >Change photo</button>
    <span class="text-xs leading-4 text-ink-muted">{PHOTO_HINT}</span>
    <input
      bind:this={input}
      type="file"
      accept={PHOTO_TYPES.join(",")}
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      onchange={pick}
      data-photo-input
    />
  </div>
  {#if problem}
    <p role="alert" data-photo-problem class="text-xs leading-4 text-danger-ink-muted">{problem}</p>
  {/if}
</div>
