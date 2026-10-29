<script lang="ts">
  /**
   * A company's website, optional (owner, 2026-10-29), in New company and
   * Edit company: the dialog frame's field styles, a short line on what
   * happens with it, and "Enter a website like hatchbetter.com." once the
   * field is left holding something that is not a website. The host checks
   * `invalid` before it saves; the server checks again.
   */
  import { formError, formField, formLabel } from "$lib/components/ui/formDialog";
  import { COMPANY_WEBSITE_INVALID, normalizeCompanyWebsite } from "../../../../shared/companyWebsite";

  let {
    value = $bindable(""),
    id,
    invalid = $bindable(false),
    onInput = undefined,
  }: {
    value?: string;
    id: string;
    /** Something is typed and it is not a usable website. */
    invalid?: boolean;
    onInput?: () => void;
  } = $props();

  let left = $state(false);
  $effect(() => {
    invalid = value.trim() !== "" && normalizeCompanyWebsite(value) === null;
  });
</script>

<div class="flex flex-col gap-1.5" data-filled={value.trim() ? "" : undefined}>
  <label for={id} class={formLabel}>Website</label>
  <input
    {id}
    bind:value
    type="text"
    inputmode="url"
    autocomplete="url"
    spellcheck="false"
    maxlength={500}
    placeholder="hatchbetter.com"
    data-company-website-field
    aria-invalid={left && invalid ? "true" : undefined}
    aria-describedby={`${id}-helper`}
    onfocus={() => (left = false)}
    onblur={() => (left = true)}
    oninput={() => onInput?.()}
    class={`field-control ${formField}`}
  />
  {#if left && invalid}
    <p role="alert" id={`${id}-helper`} class={formError} data-company-website-error>{COMPANY_WEBSITE_INVALID}</p>
  {:else}
    <p id={`${id}-helper`} class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" data-company-website-helper>
      Optional. Its home page and about page are read into the company's files.
    </p>
  {/if}
</div>
