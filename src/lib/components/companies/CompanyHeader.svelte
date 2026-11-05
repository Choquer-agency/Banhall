<!--
  A company page's header (2026-11-04, Paper "Profile / Overview"): the
  company's name (the page's h1), then its website host as a link that opens
  a new tab, its industry and "Client since <Month YYYY>", each shown only
  when known; on the right the Banhall people on its projects, up to three
  initials, then "<n> people on this company".
-->
<script lang="ts">
  import { companyWebsiteHost } from "../../../../shared/companyWebsite";
  import { industryLabel } from "$lib/industries";
  import { clientSinceLabel, teamCountLabel } from "$lib/companies/companies";

  let {
    name,
    website = undefined,
    industry = undefined,
    industryFromProjects = false,
    clientSince = null,
    team = [],
  }: {
    name: string;
    website?: string;
    industry?: string;
    /** The industry shown is the newest project's (none saved): muted. */
    industryFromProjects?: boolean;
    clientSince?: number | null;
    team?: readonly { id: string; name: string; initials: string }[];
  } = $props();

  // Three fixed tones from the design tokens, in order (Paper draws teal, blue, amber).
  const TONES = [
    "bg-primary-highlight text-fir",
    "bg-role-admin text-role-admin-ink",
    "bg-warning-soft text-warning-ink",
  ] as const;
  const shown = $derived(team.slice(0, 3));
  const since = $derived(clientSinceLabel(clientSince));
</script>

<div data-company-header-top class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
  <div class="flex min-w-0 flex-col gap-2.5">
    <!-- The page's one h1; focusable from script only (a rename, a closed note). -->
    <h1
      data-page-title
      tabindex="-1"
      class="min-w-0 break-words text-[1.875rem] font-medium leading-[1.2] tracking-[-0.025em] text-ink outline-none"
    >{name}</h1>
    {#if website || industry || since}
      <ul data-company-meta class="flex flex-wrap items-center gap-x-[1.125rem] gap-y-1.5 text-sm leading-[calc(9/7)]">
        {#if website}
          <li class="flex min-w-0 items-center gap-1.5">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="size-[0.9375rem] shrink-0 text-primary-selected">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              data-company-website
              class="min-w-0 truncate rounded-sm text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
            >{companyWebsiteHost(website)}</a>
          </li>
        {/if}
        {#if industry}
          <li class="flex items-center gap-1.5" data-company-industry data-borrowed={industryFromProjects ? "" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true" class="size-[0.9375rem] shrink-0 text-ink-muted">
              <path d="M3 21V10l6 3V10l6 3V6l6 3v12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class={industryFromProjects ? "text-ink-muted" : "text-ink-secondary"}>{industryLabel(industry)}{#if industryFromProjects}<span class="sr-only">{" from the newest project"}</span>{/if}</span>
          </li>
        {/if}
        {#if since}
          <li class="flex items-center gap-1.5" data-company-client-since>
            <svg viewBox="0 0 24 24" aria-hidden="true" class="size-[0.9375rem] shrink-0 text-ink-muted">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
              <path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="text-ink-secondary">{since}</span>
          </li>
        {/if}
      </ul>
    {/if}
  </div>
  {#if team.length > 0}
    <div data-company-team class="flex shrink-0 items-center gap-2.5 pt-1.5">
      <ul class="flex" aria-label="People on this company">
        {#each shown as member, index (member.id)}
          <li
            title={member.name}
            data-company-team-member={member.id}
            class={`flex size-[1.875rem] shrink-0 items-center justify-center rounded-full border-2 border-surface text-[0.625rem] font-medium leading-[1.2] ${TONES[index % TONES.length]} ${index > 0 ? "-ml-2" : ""}`}
          ><span aria-hidden="true">{member.initials}</span><span class="sr-only">{member.name}</span></li>
        {/each}
      </ul>
      <span class="text-[0.8125rem] leading-[calc(16/13)] text-ink-muted" data-company-team-count>{teamCountLabel(team.length)}</span>
    </div>
  {/if}
</div>
