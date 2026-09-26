<script lang="ts">
  // I2 summary: ring, "Your preferences cover n of 6 areas", Edit
  // instructions and the On switch (writerProfiles.enabled, staged with Save).
  import Switch from "$lib/components/ui/Switch.svelte";
  import CoverageRing from "./CoverageRing.svelte";
  import { WRITING_AREA_COUNT, coverageHeading } from "$lib/settings/writingAreas";

  let {
    covered,
    enabled = $bindable(true),
    onEdit,
  }: { covered: number; enabled?: boolean; onEdit: () => void } = $props();
</script>

<section data-coverage-summary class="flex flex-wrap items-center gap-6 rounded-[14px] border border-line bg-surface px-6 py-[22px]">
  <CoverageRing {covered} total={WRITING_AREA_COUNT} />
  <div class="flex min-w-[16rem] flex-1 flex-col gap-[3px]">
    <h2 class="font-serif text-2xl leading-[30px] text-ink">{coverageHeading(covered)}</h2>
    <p data-coverage-subtitle class="text-sm leading-5 text-ink-secondary">
      {enabled
        ? "Banhall follows them in every new draft. House rules fill in the rest."
        : "Off. New drafts follow the house rules only."}
    </p>
  </div>
  <button
    type="button"
    data-edit-instructions
    onclick={onEdit}
    class="h-8 shrink-0 rounded-lg bg-chrome px-3.5 text-sm leading-5 font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  >Edit instructions</button>
  <div class="flex items-center gap-2.5 border-l border-line-soft pl-3">
    <label for="writing-preferences-on" class="text-[13px] leading-[18px] text-ink-secondary">On</label>
    <Switch id="writing-preferences-on" size="md" bind:checked={enabled} label="Use my writing preferences" />
  </div>
</section>
