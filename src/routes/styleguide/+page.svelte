<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Badge from "$lib/components/ui/Badge.svelte";
  import Input from "$lib/components/ui/Input.svelte";

  // Living styleguide — renders straight from the token system in layout.css.
  // Canonical written reference: docs/design-system.md.

  const surfaces = [
    { name: "canvas", cls: "bg-canvas", hex: "#F9FCFB", role: "App background (ledger paper)" },
    { name: "white / card", cls: "bg-white", hex: "#FFFFFF", role: "Content surfaces" },
    { name: "chrome", cls: "bg-chrome", hex: "#EAF2F1", role: "Wells, hovers, pills" },
  ];
  const brand = [
    { name: "navy (fir)", cls: "bg-navy", hex: "#0A3A38", role: "App bar, emphasis text" },
    { name: "primary (lagoon)", cls: "bg-primary", hex: "#0DACA5", role: "Actions, links, focus" },
    { name: "primary-dark", cls: "bg-primary-dark", hex: "#0A8A84", role: "Action hover" },
    { name: "primary-light", cls: "bg-primary-light", hex: "#45CFC9", role: "Accents on dark" },
    { name: "primary-wash", cls: "bg-primary-wash", hex: "#F1FAF9", role: "Hover fills on light" },
  ];
  const ramp = [
    { step: "900", cls: "bg-gray-900", role: "Ink — headings, primary text" },
    { step: "800", cls: "bg-gray-800", role: "Ink" },
    { step: "700", cls: "bg-gray-700", role: "Secondary text" },
    { step: "600", cls: "bg-gray-600", role: "Secondary text" },
    { step: "500", cls: "bg-gray-500", role: "Muted — captions, meta" },
    { step: "400", cls: "bg-gray-400", role: "Faint — placeholders, icons" },
    { step: "300", cls: "bg-gray-300", role: "Disabled" },
    { step: "200", cls: "bg-gray-200", role: "Borders (line)" },
    { step: "100", cls: "bg-gray-100", role: "Hairline dividers" },
    { step: "50", cls: "bg-gray-50", role: "Wash" },
  ];
  const statuses = ["draft", "generating", "review", "client_review", "final"];
</script>

<div class="flex flex-1 flex-col bg-canvas">
  <AppNav breadcrumbs={[{ label: "Styleguide" }]} />
  <PageBar backHref="/dashboard" backLabel="Back" />

  <main class="mx-auto w-full max-w-5xl flex-1 px-6 pt-12 pb-10">
    <h1 class="text-display">Design system</h1>
    <p class="mt-1 max-w-xl text-body">
      “Ledger paper” — a pale-teal working surface with ruled lines, one deep-fir
      app bar, a single lagoon accent, and a teal-cast neutral ramp. Written
      reference: <code class="text-data">docs/design-system.md</code>.
    </p>

    <!-- Type -->
    <h2 class="text-label mt-12">Type roles</h2>
    <div class="card mt-3 divide-y divide-gray-100">
      {#each [["text-display", "Page titles — DM Sans 700, tight"], ["text-title", "Card & section titles — 600"], ["text-body", "Default UI copy — 400, secondary ink"], ["text-label", "EYEBROWS, COLUMN HEADERS — 600 CAPS"], ["text-data", "Numbers · ids · 2026-07-02 · QA 88/100 — mono, tabular"]] as [cls, sample] (cls)}
        <div class="flex items-baseline gap-6 px-5 py-4">
          <code class="text-data w-28 flex-shrink-0 text-gray-500">.{cls}</code>
          <span class={cls}>{sample}</span>
        </div>
      {/each}
      <div class="flex items-baseline gap-6 px-5 py-4">
        <code class="text-data w-28 flex-shrink-0 text-gray-500">font-serif</code>
        <span class="font-serif text-[15px] leading-relaxed">Report prose — Georgia, reserved for the document editor and report previews.</span>
      </div>
    </div>

    <!-- Color -->
    <h2 class="text-label mt-12">Surfaces & brand</h2>
    <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {#each [...surfaces, ...brand] as c (c.name)}
        <div class="card overflow-hidden">
          <div class={`h-14 ${c.cls} border-b border-gray-100`}></div>
          <div class="px-3 py-2">
            <p class="text-sm font-medium text-gray-900">{c.name}</p>
            <p class="text-data text-gray-500">{c.hex}</p>
            <p class="mt-1 text-xs text-gray-500">{c.role}</p>
          </div>
        </div>
      {/each}
    </div>

    <h2 class="text-label mt-10">Neutral ramp (teal-cast — remaps Tailwind gray-*)</h2>
    <div class="card mt-3 overflow-hidden">
      <div class="flex h-12">
        {#each ramp as r (r.step)}
          <div class={`flex-1 ${r.cls}`} title={`gray-${r.step} — ${r.role}`}></div>
        {/each}
      </div>
      <div class="grid grid-cols-2 gap-x-6 gap-y-1 px-5 py-3 sm:grid-cols-3">
        {#each ramp as r (r.step)}
          <p class="text-xs text-gray-600"><code class="text-data">{r.step}</code> — {r.role}</p>
        {/each}
      </div>
    </div>

    <!-- Components -->
    <h2 class="text-label mt-12">Core components</h2>
    <div class="card mt-3 space-y-6 px-5 py-5">
      <div class="flex flex-wrap items-center gap-3">
        <Button>Primary action</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#each statuses as s (s)}
          <Badge status={s} />
        {/each}
      </div>
      <div class="max-w-xs">
        <Input id="sg-input" label="Field label" placeholder="Placeholder text…" />
      </div>
    </div>

    <!-- Rules of use -->
    <h2 class="text-label mt-12">Rules of use</h2>
    <div class="card mt-3 px-5 py-4">
      <ul class="list-disc space-y-1.5 pl-5 text-body">
        <li>Reach for a type role before any ad-hoc <code class="text-data">text-*</code> size.</li>
        <li>Text hierarchy: ink (900) → secondary (600/700) → muted (500) → faint (400). Never darker text below lighter text in the same block.</li>
        <li>One accent per view — lagoon is for the primary action; everything else stays neutral.</li>
        <li>Content lives on white <code class="text-data">.card</code> surfaces; the ledger canvas is never a content background.</li>
        <li>Numbers, dates, ids, scores → <code class="text-data">.text-data</code> (mono, tabular).</li>
        <li>Standard pages use <code class="text-data">AppNav</code>; only the report workspace gets a custom header.</li>
      </ul>
    </div>
  </main>
</div>
