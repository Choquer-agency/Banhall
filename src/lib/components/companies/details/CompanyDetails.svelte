<!--
  A company page's Details tab (2026-11-04, Paper "Details / List like
  Files, edit on hover"): two lists. Company: name, industry, usual year end
  and website (with how its read into the company's files went, and Read
  again). Record: client since, added by, last changed, and also known as
  (the names merged into it). Managers and Admins see a pencil on a company
  row's hover (or keyboard focus) that opens Edit company, and Read again,
  which reads the saved website again under the existing hourly limit.
-->
<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import { IconPencil, IconRegenerate } from "$lib/components/icons";
  import { industryLabel } from "$lib/industries";
  import { longDate } from "$lib/projects/projectCard";
  import { shortDate, yearEndLabel } from "$lib/companies/companies";
  import { companyWebsiteHost } from "../../../../../shared/companyWebsite";

  type Company = {
    clientId: string | null;
    name: string;
    industry?: string;
    industryFromProjects?: boolean;
    fiscalYearEndMonth?: number;
    fiscalYearEndDay?: number;
    fiscalYearEndFromProjects?: boolean;
    website?: string;
    websiteRead?: { status: "reading" | "read" | "failed"; reason?: string; finishedAt?: number } | null;
    clientSince?: number | null;
    createdByName?: string | null;
    updatedAt?: number | null;
    formerNames?: readonly { name: string; mergedAt?: number }[];
  };

  let {
    company,
    canEdit = false,
    onEdit = undefined,
  }: {
    company: Company;
    /** Managers and Admins: the pencils and Read again. */
    canEdit?: boolean;
    onEdit?: () => void;
  } = $props();

  const readAgain = useMutation(api.companyWebsite.readWebsiteAgain);
  let asking = $state(false);
  const reading = $derived(company.websiteRead?.status === "reading");

  async function onReadAgain() {
    if (!company.clientId || asking || reading) return;
    asking = true;
    try {
      await readAgain({ clientId: company.clientId as Id<"clients"> });
      toast.success("Reading the website again");
    } catch (caught) {
      const data = (caught as { data?: { message?: unknown } } | null)?.data;
      toast.error(typeof data?.message === "string" ? data.message : "The website could not be read again. Try again later.");
    } finally {
      asking = false;
    }
  }

  const yearEnd = $derived(yearEndLabel(company.fiscalYearEndMonth, company.fiscalYearEndDay));
  const websiteLine = $derived.by(() => {
    const read = company.websiteRead;
    if (!company.website || !read) return null;
    if (read.status === "reading") return "Reading the website...";
    if (read.status === "failed") return `The website could not be read: ${read.reason ?? "it could not be reached."}`;
    return read.finishedAt !== undefined ? `Read into files ${shortDate(read.finishedAt)}` : null;
  });

  const row = "group/detail flex min-h-[3.25rem] items-center gap-3.5 border-b border-line-soft p-2.5";
  const label = "w-[12.5rem] shrink-0 text-[0.8125rem] leading-[calc(16/13)] text-ink-muted max-sm:w-32";
  const value = "min-w-0 flex-1 text-[0.8125rem] leading-[calc(16/13)] text-ink";
  const sub = "text-xs leading-[calc(4/3)] text-ink-muted";
</script>

{#snippet pencil(field: string)}
  {#if canEdit && onEdit}
    <button
      type="button"
      data-details-edit={field}
      aria-label={`Edit ${field.toLowerCase()} in Edit company`}
      onclick={onEdit}
      class="flex size-8 shrink-0 items-center justify-center rounded-md bg-chrome text-ink opacity-0 transition-opacity group-hover/detail:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11 pointer-coarse:opacity-100"
    ><IconPencil size={15} strokeWidth={2} /></button>
  {/if}
{/snippet}

{#snippet borrowedValue(text: string | null, borrowed: boolean)}
  {#if text}
    <span class={borrowed ? "text-ink-muted" : ""} data-borrowed={borrowed ? "" : undefined}>{text}{#if borrowed}<span class="sr-only">{" from the newest project"}</span>{/if}</span>
  {:else}
    <span class="text-ink-muted">Not set</span>
  {/if}
{/snippet}

<div data-company-details class="flex flex-col">
  <div class="flex flex-col gap-1">
    <h2 class="font-serif text-2xl leading-[calc(4/3)] text-ink">Details</h2>
    <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">New projects for {company.name} start with these filled in.</p>
  </div>

  <section aria-labelledby="company-details-company" class="flex flex-col gap-2 pt-7" data-details-list="company">
    <h3 id="company-details-company" class="text-xs leading-[calc(4/3)] tracking-[0.06em] text-ink-secondary uppercase">Company</h3>
    <dl class="flex flex-col border-t border-line-soft">
      <div class={`${row} hover:bg-gray-50 focus-within:bg-gray-50`} data-details-row="name">
        <dt class={label}>Name</dt>
        <dd class={value}>{company.name}</dd>
        {@render pencil("Name")}
      </div>
      <div class={`${row} hover:bg-gray-50 focus-within:bg-gray-50`} data-details-row="industry">
        <dt class={label}>Industry</dt>
        <dd class={value}>{@render borrowedValue(company.industry ? industryLabel(company.industry) : null, company.industryFromProjects === true)}</dd>
        {@render pencil("Industry")}
      </div>
      <div class={`${row} hover:bg-gray-50 focus-within:bg-gray-50`} data-details-row="year-end">
        <dt class={label}>Usual year end</dt>
        <dd class={value}>{@render borrowedValue(yearEnd, company.fiscalYearEndFromProjects === true)}</dd>
        {@render pencil("Usual year end")}
      </div>
      <div class={`${row} hover:bg-gray-50 focus-within:bg-gray-50`} data-details-row="website">
        <dt class={label}>Website</dt>
        <dd class={`${value} flex flex-col gap-0.5`}>
          {#if company.website}
            <a
              href={company.website}
              target="_blank"
              rel="noopener noreferrer"
              data-details-website
              class="w-fit max-w-full truncate rounded-sm text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
            >{companyWebsiteHost(company.website)}</a>
            {#if websiteLine}
              <span role="status" class={sub} data-details-website-status={company.websiteRead?.status}>{websiteLine}</span>
            {/if}
          {:else}
            <span class="text-ink-muted">Not set</span>
          {/if}
        </dd>
        {#if canEdit && company.website && company.clientId}
          <button
            type="button"
            data-details-read-again
            disabled={asking || reading}
            onclick={() => void onReadAgain()}
            class="inline-flex h-[1.875rem] shrink-0 items-center gap-1.5 rounded-md bg-surface px-2.5 text-xs font-medium leading-[calc(4/3)] text-ink-secondary shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-60 motion-reduce:transition-none pointer-coarse:h-11"
          ><IconRegenerate size={13} strokeWidth={2} /> {reading ? "Reading..." : "Read again"}</button>
        {/if}
        {@render pencil("Website")}
      </div>
    </dl>
  </section>

  <section aria-labelledby="company-details-record" class="flex flex-col gap-2 pt-7" data-details-list="record">
    <h3 id="company-details-record" class="text-xs leading-[calc(4/3)] tracking-[0.06em] text-ink-secondary uppercase">Record</h3>
    <dl class="flex flex-col border-t border-line-soft">
      <div class={row} data-details-row="client-since">
        <dt class={label}>Client since</dt>
        <dd class={value}>{#if company.clientSince}{longDate(company.clientSince)}{:else}<span class="text-ink-muted">Not known</span>{/if}</dd>
      </div>
      <div class={row} data-details-row="added-by">
        <dt class={label}>Added by</dt>
        <dd class={value}>{#if company.createdByName}{company.createdByName}{:else}<span class="text-ink-muted">Not recorded</span>{/if}</dd>
      </div>
      <div class={row} data-details-row="last-changed">
        <dt class={label}>Last changed</dt>
        <dd class={value}>{#if company.updatedAt}{longDate(company.updatedAt)}{:else}<span class="text-ink-muted">Not recorded</span>{/if}</dd>
      </div>
      <div class={row} data-details-row="former-names">
        <dt class={label}>Also known as</dt>
        <dd class={`${value} flex flex-col gap-2`}>
          {#each company.formerNames ?? [] as former (former.name)}
            <span class="flex flex-col gap-0.5" data-details-former-name>
              <span>{former.name}</span>
              <span class={sub}>{former.mergedAt !== undefined ? `Merged into this company ${shortDate(former.mergedAt)}` : "An earlier name"}</span>
            </span>
          {:else}
            <span class="text-ink-muted">No other names</span>
          {/each}
        </dd>
      </div>
    </dl>
  </section>
</div>
