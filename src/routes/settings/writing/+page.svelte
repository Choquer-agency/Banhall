<script lang="ts">
  // /settings/writing: personal style instructions + house-style waivers.
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { useQuery, useMutation, useConvexClient } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { LockSimpleIcon, ArrowsOutSimpleIcon } from "phosphor-svelte";
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import { MAX_INSTRUCTIONS_CHARS } from "../../../../shared/writerProfileLimits";
  import {
    STYLE_OVERRIDE_KEYS,
    STYLE_OVERRIDE_META,
    DEFAULT_HOUSE_RULE_MODES,
    normalizeStyleOverrides,
    styleOverridesEqual,
    type StyleOverrides,
  } from "../../../../shared/styleOverrides";

  const PLACEHOLDER =
    "e.g. Prefer short declarative sentences. Lead each iteration with the hypothesis tested. Avoid the passive voice in the work narrative.";

  const auth = useAuth();
  const profileQ = useQuery(api.writerProfiles.getMyProfile, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const saveMyProfile = useMutation(api.writerProfiles.saveMyProfile);

  // Writing preferences, same non-dirty re-seed: an admin editing this
  // user's flavor from /admin/users shows up here live unless the user is
  // mid-edit (their draft wins until save).
  let customInstructions = $state("");
  let overrides = $state<StyleOverrides>(normalizeStyleOverrides());
  let prefSeed = $state<{
    text: string;
    overrides: StyleOverrides;
  } | null>(null);
  const overridesEqual = styleOverridesEqual;
  // Dirty = the draft differs from the seeded server snapshot; Save stays
  // disabled until something actually changed.
  const dirty = $derived(
    prefSeed !== null &&
      (customInstructions !== prefSeed.text ||
        !overridesEqual(overrides, prefSeed.overrides))
  );
  $effect(() => {
    if (profileQ.data === undefined) return;
    const serverText = profileQ.data?.customInstructions ?? "";
    const serverOverrides = normalizeStyleOverrides(profileQ.data?.styleOverrides);
    const serverChanged =
      prefSeed === null ||
      serverText !== prefSeed.text ||
      !overridesEqual(serverOverrides, prefSeed.overrides);
    if (serverChanged && !dirty) {
      customInstructions = serverText;
      overrides = { ...serverOverrides };
      prefSeed = { text: serverText, overrides: serverOverrides };
    }
  });

  // Expanded editor: the inline textarea stays short; the dialog edits the
  // same bound value full-height.
  let editorOpen = $state(false);
  // Autofocus lands the caret at the end and scrolls a long draft to the
  // bottom; open at the top instead so the user reads from the start.
  function focusAtStart(el: HTMLTextAreaElement) {
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    });
  }

  let saving = $state(false);
  let saved = $state(false);
  let error = $state("");
  const preferencesTooLong = $derived(
    customInstructions.length > MAX_INSTRUCTIONS_CHARS
  );

  // PSOS-50: org-level governance of each house-style category. "enforced"
  // and "off" lock the toggle's DISPLAYED state; the writer's own underlying
  // choice in `overrides` is preserved and still what gets saved.
  const modesQ = useQuery(api.houseStyle.getModesForMe, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const modes = $derived(modesQ.data ?? DEFAULT_HOUSE_RULE_MODES);

  // "Analyze my instructions": classify the free-text preferences against
  // the five categories, pre-tick the writer-choice waivers it addresses,
  // and report what will/won't apply. Transient page state, not persisted.
  type StyleAnalysis = FunctionReturnType<
    typeof api.ai.styleAnalysis.analyzeMyInstructions
  >;
  const client = useConvexClient();
  let analyzing = $state(false);
  let analysis = $state<StyleAnalysis | null>(null);
  let analysisError = $state("");

  function truncateExcerpt(excerpt: string): string {
    return excerpt.length > 140 ? `${excerpt.slice(0, 140).trimEnd()}…` : excerpt;
  }

  async function handleAnalyze() {
    // Wait for the real governance modes: pre-ticking against the
    // DEFAULT_HOUSE_RULE_MODES fallback could tick (and later persist) a
    // waiver for a category the org has set to "enforced".
    if (analyzing || !customInstructions.trim() || modesQ.data === undefined) return;
    analysisError = "";
    analyzing = true;
    try {
      const result = await client.action(
        api.ai.styleAnalysis.analyzeMyInstructions,
        { text: customInstructions }
      );
      // Only turn waivers ON, and only where the writer still has the choice
      // (never untick a manual selection, never touch governed categories).
      for (const key of STYLE_OVERRIDE_KEYS) {
        if (result.categories[key].addressed && modes[key] === "writer_choice") {
          overrides[key] = true;
        }
      }
      analysis = result;
    } catch (cause) {
      analysisError = userErrorMessage(cause, "Could not analyze your instructions.");
    } finally {
      analyzing = false;
    }
  }

  async function handleSave() {
    if (saving || preferencesTooLong || !dirty) return;
    error = "";
    saved = false;
    saving = true;
    try {
      // Saving here always turns the profile on: a writer saving preferences
      // wants them used. Admins keep the per-user off switch on /admin/users.
      await saveMyProfile({ customInstructions, enabled: true, styleOverrides: { ...overrides } });
      prefSeed = { text: customInstructions, overrides: { ...overrides } };
      saved = true;
      setTimeout(() => (saved = false), 2500);
    } catch (cause) {
      error = userErrorMessage(cause, "Could not save your writing preferences.");
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Writing preferences · Settings</title></svelte:head>

{#if profileQ.data === undefined}
  <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
{:else}
  <div class="divide-y divide-line-soft">
  <section class="settings-row">
    <div class="settings-row-heading">
      <h2 class="text-title">Writing preferences</h2>
      <p class="mt-1 text-sm text-ink-muted">
        Describe how you like to write and every report you generate will
        follow it. The CRA line length limits always apply. House style rules
        and the default report skeleton apply too, unless you tick one below
        to let your instructions take over. Check what applies reads your
        instructions and ticks the rules they cover for you.
      </p>
    </div>
    <div class="settings-row-form max-w-4xl!">
      <div>
        <div class="flex items-center justify-between gap-2">
          <label for="style-instructions" class="text-label">Your style instructions</label>
          <Button type="button" variant="ghost" size="xs" class="gap-1.5" onclick={() => (editorOpen = true)}>
            <ArrowsOutSimpleIcon size={14} weight="bold" aria-hidden="true" />
            Open editor
          </Button>
        </div>
        <textarea
          id="style-instructions"
          rows={5}
          bind:value={customInstructions}
          placeholder={PLACEHOLDER}
          class="field-control mt-2 block min-h-24 w-full resize-y rounded-lg px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint"
        ></textarea>
        <span
          class={`mt-1 block text-right text-xs ${preferencesTooLong ? "text-red-600" : "text-ink-faint"}`}
          aria-live={preferencesTooLong ? "polite" : "off"}
        >
          {customInstructions.length.toLocaleString()} / {MAX_INSTRUCTIONS_CHARS.toLocaleString()} characters
        </span>
      </div>

      <div class="mt-5">
        <!-- Label left, Check action right on one row. -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-label">Rules your instructions can replace</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            class="gap-1.5"
            onclick={handleAnalyze}
            disabled={analyzing || !customInstructions.trim() || modesQ.data === undefined}
          >
            {#if analyzing}
              <Spinner size="sm" class="h-3.5 w-3.5" />
            {/if}
            {analyzing ? "Checking…" : "Check what applies"}
          </Button>
        </div>
        <div class="mt-3 flex flex-col gap-3">
          {#each STYLE_OVERRIDE_KEYS as key (key)}
            {@const mode = modes[key]}
            <div>
              {#if mode === "writer_choice"}
                <Checkbox
                  bind:checked={overrides[key]}
                  labelText={STYLE_OVERRIDE_META[key].label}
                />
                <p class="ml-[26px] mt-0.5 max-w-2xl text-xs text-ink-faint">
                  {STYLE_OVERRIDE_META[key].description}
                </p>
              {:else}
                <!-- Governed by the org: the checkbox shows the FORCED
                     state and is not bound to `overrides`; the writer's
                     own choice is preserved underneath and still saved. -->
                <Checkbox checked={mode === "off"} disabled>
                  {#snippet label()}
                    <span class="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                      {STYLE_OVERRIDE_META[key].label}
                      {#if mode === "enforced"}
                        <LockSimpleIcon size={13} weight="bold" aria-hidden="true" class="text-ink-faint" />
                      {/if}
                    </span>
                  {/snippet}
                </Checkbox>
                <p class="ml-[26px] mt-0.5 max-w-2xl text-xs text-ink-faint">
                  {mode === "enforced"
                    ? "Your organization always enforces this rule."
                    : "Disabled for everyone by your organization."}
                </p>
              {/if}
            </div>
          {/each}
        </div>

        {#if analysis}
          <div role="status" class="mt-4 rounded-lg border border-line-soft bg-canvas px-4 py-3">
            <p class="text-xs font-semibold text-ink-secondary">
              What your instructions cover
            </p>
            <ul class="mt-2 flex flex-col gap-1.5">
              {#each STYLE_OVERRIDE_KEYS as key (key)}
                {@const category = analysis.categories[key]}
                {#if category.addressed && modes[key] === "enforced"}
                  <li class="flex items-baseline gap-1.5 text-xs text-ink-muted">
                    <LockSimpleIcon size={12} weight="bold" aria-hidden="true" class="flex-none translate-y-px" />
                    <span>Covered, but your organization always enforces {STYLE_OVERRIDE_META[key].label}</span>
                  </li>
                {:else if category.addressed && (modes[key] === "off" || overrides[key])}
                  <li class="flex items-baseline gap-1.5 text-xs text-ink">
                    <span aria-hidden="true" class="flex-none font-semibold text-primary">✓</span>
                    <span>Will apply: your instructions replace {STYLE_OVERRIDE_META[key].label}</span>
                  </li>
                {:else if category.addressed}
                  <!-- Addressed, but the writer left this override unticked
                       (the house rule still governs). Never report an
                       addressed category as "Not addressed". -->
                  <li class="flex items-baseline gap-1.5 text-xs text-ink-muted">
                    <span aria-hidden="true" class="flex-none">–</span>
                    <span>Covered, but {STYLE_OVERRIDE_META[key].label} is unticked, so the house rule still applies</span>
                  </li>
                {:else}
                  <li class="flex items-baseline gap-1.5 text-xs text-ink-faint">
                    <span aria-hidden="true" class="flex-none">–</span>
                    <span>Not covered: {STYLE_OVERRIDE_META[key].label}</span>
                  </li>
                {/if}
              {/each}
            </ul>
            {#if analysis.lockedConflicts.length}
              <div class="mt-3 rounded-lg bg-amber-50 px-3 py-2">
                <p class="flex items-baseline gap-1.5 text-xs font-semibold text-amber-800">
                  <LockSimpleIcon size={12} weight="bold" aria-hidden="true" class="flex-none translate-y-px" />
                  These parts conflict with CRA-locked rules and will be ignored:
                </p>
                <ul class="mt-1.5 flex flex-col gap-1">
                  {#each analysis.lockedConflicts as conflict, index (index)}
                    <li class="text-xs text-amber-800">
                      “{truncateExcerpt(conflict.excerpt)}”
                      <span class="text-amber-700"> ({conflict.rule})</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        {/if}
        {#if analysisError}
          <p role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {analysisError}
          </p>
        {/if}
      </div>

      <div class="mt-4 flex items-center justify-end gap-3">
        {#if saved}
          <span role="status" class="text-xs text-primary">Preferences saved</span>
        {/if}
        <Button size="sm" onclick={handleSave} disabled={saving || preferencesTooLong || !dirty}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      </div>

      {#if error}
        <p role="alert" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      {/if}
    </div>
  </section>
  </div>
{/if}

<Dialog.Root bind:open={editorOpen}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>{#snippet child({ props, open: isOpen })}{#if isOpen}<div {...props} transition:overlayFade class="fixed inset-0 z-[130] bg-[#052A28]/80"></div>{/if}{/snippet}</Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[130] flex items-end sm:items-center sm:justify-center sm:p-4">
      <Dialog.Content forceMount>{#snippet child({ props, open: isOpen })}{#if isOpen}
        <div {...props} transition:modalPop class="pointer-events-auto flex h-[90dvh] w-full flex-col rounded-t-2xl bg-white p-5 shadow-xl sm:h-[80dvh] sm:max-w-3xl sm:rounded-xl">
          <Dialog.Title class="text-title">Your style instructions</Dialog.Title>
          <Dialog.Description class="mt-1 text-sm text-ink-secondary">
            This is the same draft as the settings page. Close the editor, then save your preferences.
          </Dialog.Description>
          <textarea
            aria-label="Your style instructions"
            use:focusAtStart
            bind:value={customInstructions}
            placeholder={PLACEHOLDER}
            class="field-control mt-4 block min-h-0 w-full flex-1 resize-none rounded-lg px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint"
          ></textarea>
          <div class="mt-3 flex items-center justify-between gap-3">
            <span class={`text-xs ${preferencesTooLong ? "text-red-600" : "text-ink-faint"}`}>
              {customInstructions.length.toLocaleString()} / {MAX_INSTRUCTIONS_CHARS.toLocaleString()} characters
            </span>
            <Dialog.Close>
              {#snippet child({ props })}
                <Button {...props} size="sm" variant="secondary">Back to settings</Button>
              {/snippet}
            </Dialog.Close>
          </div>
        </div>
      {/if}{/snippet}</Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
