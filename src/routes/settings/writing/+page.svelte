<script lang="ts">
  // /settings/writing (round 2, I2): how many areas the writer's
  // instructions cover, a Preview with and without them, the instructions,
  // what they cover, and where the writer's preferences win over the house
  // rules. Everything is staged and saved together from the save bar.
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import SettingsSaveBar from "$lib/components/settings/SettingsSaveBar.svelte";
  import CoverageSummaryCard from "$lib/components/settings/writing/CoverageSummaryCard.svelte";
  import StylePreviewCard from "$lib/components/settings/writing/StylePreviewCard.svelte";
  import InstructionsCard from "$lib/components/settings/writing/InstructionsCard.svelte";
  import CoverageList from "$lib/components/settings/writing/CoverageList.svelte";
  import PreferenceWinsGrid from "$lib/components/settings/writing/PreferenceWinsGrid.svelte";
  import InstructionsEditorDialog from "$lib/components/settings/writing/InstructionsEditorDialog.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { useQuery, useMutation, useConvexClient } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { page } from "$app/state";
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { settingsPrefillDecision } from "$lib/settingsPrefill";
  import { previewMyStyleRef, type StylePreviewVariant } from "$lib/settings/stylePreviewApi";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { MAX_INSTRUCTIONS_CHARS } from "../../../../shared/writerProfileLimits";
  import {
    STYLE_OVERRIDE_KEYS,
    DEFAULT_HOUSE_RULE_MODES,
    normalizeStyleOverrides,
    styleOverridesEqual,
    type StyleOverrides,
  } from "../../../../shared/styleOverrides";

  const auth = useAuth();
  const client = useConvexClient();
  const profileQ = useQuery(api.writerProfiles.getMyProfile, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const saveMyProfile = useMutation(api.writerProfiles.saveMyProfile);

  // The draft, re-seeded from the server while the writer has not edited it:
  // an admin editing this profile from /admin/users shows up live unless the
  // writer is mid-edit (their draft wins until save).
  let customInstructions = $state("");
  let overrides = $state<StyleOverrides>(normalizeStyleOverrides());
  let enabled = $state(true);
  let seed = $state<{ text: string; overrides: StyleOverrides; enabled: boolean } | null>(null);
  const dirty = $derived(
    seed !== null &&
      (customInstructions !== seed.text ||
        enabled !== seed.enabled ||
        !styleOverridesEqual(overrides, seed.overrides))
  );
  $effect(() => {
    if (profileQ.data === undefined) return;
    const serverText = profileQ.data?.customInstructions ?? "";
    const serverOverrides = normalizeStyleOverrides(profileQ.data?.styleOverrides);
    // A writer with no profile yet starts On: saving preferences means use them.
    const serverEnabled = profileQ.data?.enabled ?? true;
    const serverChanged =
      seed === null ||
      serverText !== seed.text ||
      serverEnabled !== seed.enabled ||
      !styleOverridesEqual(serverOverrides, seed.overrides);
    if (serverChanged && !untrack(() => dirty)) {
      customInstructions = serverText;
      overrides = { ...serverOverrides };
      enabled = serverEnabled;
      seed = { text: serverText, overrides: serverOverrides, enabled: serverEnabled };
    }
  });

  let editorOpen = $state(false);
  let saving = $state(false);
  const tooLong = $derived(customInstructions.length > MAX_INSTRUCTIONS_CHARS);

  // PSOS-50: org governance of each category. "enforced" and "off" lock the
  // switch; the writer's own saved choice stays underneath.
  const modesQ = useQuery(api.houseStyle.getModesForMe, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const modes = $derived(modesQ.data ?? DEFAULT_HOUSE_RULE_MODES);

  // Story 3 (CAP-8): ?fromGeneration=<id> accepts that generation's save
  // offer as a prefill; nothing is saved until the writer saves. The decision
  // lives in the pure settingsPrefillDecision; this effect feeds it and
  // applies its result, once per fromGeneration value.
  const fromGeneration = $derived(page.url.searchParams.get("fromGeneration"));
  const writerSettingsQ = useQuery(api.writerProfiles.getGenerationWriterSettings, () =>
    auth.isAuthenticated && fromGeneration
      ? { generationId: fromGeneration as Id<"generations"> }
      : "skip"
  );
  let prefilledFor = $state<string | null>(null);
  let prefillNotice = $state("");
  $effect(() => {
    const decision = settingsPrefillDecision({
      fromGeneration,
      prefilledFor,
      seeded: seed !== null,
      modesLoaded: modesQ.data !== undefined,
      profileError: profileQ.error,
      modesError: modesQ.error,
      query: { data: writerSettingsQ.data, error: writerSettingsQ.error },
      userEdited: dirty,
      currentText: customInstructions,
      currentOverrides: overrides,
      modes,
    });
    if (decision.kind === "idle" || decision.kind === "wait") return;
    prefilledFor = fromGeneration;
    if (decision.kind === "apply") {
      customInstructions = decision.text;
      overrides = decision.overrides;
    }
    prefillNotice = decision.kind === "unchanged" ? "" : decision.notice;
  });

  // "What they cover": the stored analysis of the saved text. Locked-rule
  // conflicts come from the latest run on this page (not stored).
  type StyleAnalysis = FunctionReturnType<typeof api.ai.styleAnalysis.analyzeMyInstructions>;
  const coverage = $derived(profileQ.data?.coverage ?? null);
  const covered = $derived(
    coverage ? STYLE_OVERRIDE_KEYS.filter((key) => coverage.categories[key].addressed).length : 0
  );
  let checking = $state(false);
  let checkError = $state("");
  let conflicts = $state<StyleAnalysis["lockedConflicts"]>([]);

  /**
   * Analyse the SAVED text and store it as coverage. Pre-ticks the areas it
   * covers, only where the org leaves the choice to the writer, and never
   * un-ticks a manual choice. Waits for the real modes: pre-ticking against
   * the defaults could tick a waiver for a category the org enforces.
   */
  async function checkCoverage(text: string) {
    if (checking || modesQ.data === undefined) return;
    checkError = "";
    checking = true;
    try {
      const result = await client.action(api.ai.styleAnalysis.analyzeMyInstructions, {
        text,
        persist: true,
      });
      for (const key of STYLE_OVERRIDE_KEYS) {
        if (result.categories[key].addressed && modes[key] === "writer_choice") {
          overrides[key] = true;
        }
      }
      conflicts = result.lockedConflicts;
    } catch (cause) {
      checkError = userErrorMessage(cause, "Your instructions could not be checked. Try again.");
    } finally {
      checking = false;
    }
  }

  // Preview: fetched per variant and kept until the saved profile changes.
  let variant = $state<StylePreviewVariant>("preferences");
  type PreviewState =
    | { kind: "loading" }
    | { kind: "ready"; paragraphs: string[] }
    | { kind: "limit"; message: string }
    | { kind: "error" };
  let previews = $state<Partial<Record<StylePreviewVariant, PreviewState>>>({});
  let previewGeneration = 0;

  async function loadPreview(which: StylePreviewVariant) {
    const generation = previewGeneration;
    previews[which] = { kind: "loading" };
    try {
      const result = await client.action(previewMyStyleRef, { variant: which });
      if (generation !== previewGeneration) return;
      previews[which] =
        result.status === "ready"
          ? { kind: "ready", paragraphs: result.paragraphs }
          : { kind: "limit", message: result.message };
    } catch {
      if (generation === previewGeneration) previews[which] = { kind: "error" };
    }
  }

  $effect(() => {
    if (!auth.isAuthenticated || seed === null) return;
    const which = variant;
    if (untrack(() => previews[which]) === undefined) void loadPreview(which);
  });
  const preview = $derived<PreviewState>(previews[variant] ?? { kind: "loading" });

  async function handleSave() {
    if (saving || tooLong || !dirty || !seed) return;
    saving = true;
    const textChanged = customInstructions.trim() !== seed.text.trim();
    try {
      await saveMyProfile({ customInstructions, enabled, styleOverrides: { ...overrides } });
      seed = { text: customInstructions.trim(), overrides: { ...overrides }, enabled };
      customInstructions = customInstructions.trim();
      toast.success("Writing preferences saved. New drafts use them.");
      // The saved profile changed, so the samples are out of date.
      previewGeneration += 1;
      previews = {};
      if (textChanged) void checkCoverage(customInstructions);
    } catch (cause) {
      toast.error(userErrorMessage(cause, "Could not save your writing preferences."));
    } finally {
      saving = false;
    }
  }

  function discard() {
    if (!seed) return;
    customInstructions = seed.text;
    overrides = { ...seed.overrides };
    enabled = seed.enabled;
  }
</script>

<svelte:head><title>Writing preferences - Settings</title></svelte:head>

{#if profileQ.data === undefined}
  <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
{:else}
  <div data-writing-preferences class="flex flex-col gap-6">
    <CoverageSummaryCard {covered} bind:enabled onEdit={() => (editorOpen = true)} />

    <div class="flex flex-col items-start gap-6 lg:flex-row">
      <StylePreviewCard bind:variant {preview} onRetry={() => void loadPreview(variant)} />
      <div data-writing-side class="flex w-full shrink-0 flex-col gap-3.5 lg:w-[380px]">
        <InstructionsCard text={customInstructions} notice={prefillNotice} onEdit={() => (editorOpen = true)} />
        <CoverageList
          categories={coverage?.categories ?? null}
          {modes}
          {conflicts}
          {checking}
          canCheck={Boolean(seed?.text.trim()) && modesQ.data !== undefined}
          error={checkError}
          onCheck={() => void checkCoverage(seed?.text ?? "")}
        />
      </div>
    </div>

    <PreferenceWinsGrid bind:overrides {modes} />

    <SettingsSaveBar
      {dirty}
      {saving}
      disabled={tooLong}
      idleText="No changes yet. Changes apply to new drafts only."
      saveLabel="Save preferences"
      onSave={handleSave}
      onDiscard={discard}
    />
  </div>
{/if}

<InstructionsEditorDialog bind:open={editorOpen} bind:value={customInstructions} />
