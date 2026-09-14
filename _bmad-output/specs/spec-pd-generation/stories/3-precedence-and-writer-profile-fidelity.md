---
title: 'Precedence and Writer Profile fidelity'
type: 'feature'
created: '2026-09-11'
status: 'done'
baseline_revision: 'dc26ed2b75b80a3604a5d58731acb2648a5a58c9'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/_bmad-output/specs/spec-pd-generation/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-pd-generation/glossary.md'
  - '{project-root}/_bmad-output/specs/spec-pd-generation/touchpoints.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/product-domain.md'
warnings:
  - oversized
deferred:
  - summary: >-
      Story 4 surfaces for the settings record: the Brief rail's "No Writer Profile applied" line, the save banner, and a link to /settings/writing?fromGeneration=<id>.
    evidence: |-
      getGenerationWriterSettings and the page prefill exist, but nothing in src/ renders noProfileLine or links to the offer (final review pass). The intent defers story 4's Brief rail and save banner.
    location: >-
      convex/writerProfiles.ts getGenerationWriterSettings; src/routes/settings/writing/+page.svelte
    severity: medium
  - summary: >-
      Chat apply, research saves and the proposal-apply scrub still resolve only the saved Writer Profile, so a settings document's waivers stop at generation.
    evidence: |-
      convex/chatV2.ts:477 and convex/research.ts:716 call getEffectiveWriterStyle without a settings document (final review pass). The intent defers changing chat's profile resolution.
    location: >-
      convex/chatV2.ts:477; convex/research.ts:716
    severity: medium
  - summary: >-
      A structured Build Order and Self-check editor on the settings page; extraction from profile text is the only way to populate either today.
    evidence: |-
      Listed under the spec's Design Notes "Deferred on purpose", still open at the final review.
    location: >-
      src/routes/settings/writing/+page.svelte
    severity: low
---

<intent-contract>

## Intent

**Problem:** Writers keep a customized-settings document and supply it per project as Writer's Notes or an attachment, but only a saved Writer Profile reaches drafting. A settings document is read by the analyzer and nowhere else, so House Rules apply over it and nothing reports it. Precedence is also partly silent: an org-`enforced` category ignores a writer's waiver without a per-instruction record, and cap instructions written in free text are never measured.

**Approach:** AD-26 in full. `getEffectiveWriterStyle` stays the only place tiers are computed, with two changes:
- It also accepts a detected settings document and applies it as the Writer Profile for that generation. The document's House Rule waivers come from the existing PSOS-50 style classifier, cached per `(projectId, contentHash)`. Its Build Order and cap rules come from a deterministic extractor that runs identically on profile text.
- It reports each category's requested waiver, so an `enforced` category writes a `not_applied` / `org_enforced` row for the waiver it ignored.

One generation-entry resolver replaces `fetchWriterStyle` in both the one-shot pipeline and iterative. It records `generations.writerSettings`: state, source, and the save offer. A query exposes that record for story 4's "no Writer Profile applied" line and save banner. The settings page accepts the offer as a prefill. `docs/product-domain.md` gains one dated amendment: the four tiers, no silent tier, settings documents, and the effort ceiling.

## Boundaries & Constraints

**Always:**
- Precedence is Locked Rules > enforced Org Mode > Writer Profile > House Rules. `off` waives for everyone. A tier is computed only in `getEffectiveWriterStyle` (`categoryOutcomes[].tier`); `convex/lib/selfCheckRules.ts` copies it and never recomputes it.
- No tier applies silently. Every section keeps its Writer Profile row, which reads "no Writer Profile applied (disabled|missing)" when none applies. Every requested waiver an org `enforced` mode overrides gets its own `not_applied` / `org_enforced` row. Every cap rule, extracted or stored, is measured, clipped to the Locked caps, and reported (the existing `tier: conflict` shape).
- A settings document qualifies only when all of these hold:
  - it is a frozen `project_document` `generationSources` row;
  - `uploaderRole` is present (the column holds only writer, manager or admin, so absent means client trust and never qualifies);
  - its file name or first non-empty line matches the settings-title pattern (Design Notes).
  At most one is applied. Writer's Notes (`writer_notes:` label) come before other attachments; within a group, frozen row order decides.
- The applied text is the frozen content, trimmed and sliced to `MAX_INSTRUCTIONS_CHARS` (`shared/writerProfileLimits.ts`), with truncation recorded.
- A document whose trimmed, whitespace-normalized text equals an enabled saved profile's `customInstructions` means `matchesProfile`. The saved profile then applies unchanged (source `profile`) and no offer is made.
- A document that differs from the saved profile replaces it for that generation. Its source is `writer_notes` or `attachment`, and the Writer Profile row says the saved profile was superseded.
- For the same settings the three supply paths produce identical `OrderedProfileContext`, `writerFlavor` and `styleOverrides`, and so identical Compliance Note rows. Same settings means: saved profile `customInstructions` equals the document text, the profile's toggles equal the classifier's addressed categories, and `buildOrder`/`selfCheckRules` are unset.
- Cap and Build Order extraction runs on the effective instruction text, profile or document. It fills only what the source does not hold structurally: `buildOrder === undefined`, `selfCheckRules === undefined`. An explicitly stored `[]` stays empty.
- The classifier runs at most once per `(projectId, contentHash)`. It is labelled `generation:settings`, with an AD-27 allowance of 1, recorded and never enforced. A cache hit makes no call.
- A resolver failure never fails generation. It degrades to today's saved-profile read, and the reason is logged to the generation progress log.
- Follow `convex/_generated/ai/guidelines.md`: validators on every function, `by_x_and_y` index names, no unbounded arrays, and `internal*` functions for scheduler and action-only work.

**Block If:**
- Implementing any piece would change a Locked Rule: the 242/244/246 skeleton, the caps s242 50/350, s244 100/700, s246 50/350, or no-fabrication. That is an Ask First amendment. HALT `locked rule change required`. Open Question 1 (Larry's Section 246 document) changes nothing here; a request above a cap is clipped and reported.

**Never:**
- Auto-save a settings document into a profile. The offer only prefills the settings page.
- Let a client-trust document become instructions.
- Change `iterative`'s gate, `applyProposal`, or report prose paths.
- Mix generation state into `projects` (AD-2).
- Hand-edit `convex/_generated/`.
- Use `test.skip` or vacuous tests.
- Build story 4's Brief rail or save banner UI, or change chat's profile resolution (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Profile only, all `writer_choice` | Enabled profile; each category waived with a contradicting instruction | Every category effective (waived). Category rows read "instruction waived via override…", tier `none`. House Rule text omitted from style guidance | — |
| Category `enforced` + profile waiver | Mode `enforced`, toggle on | House Rule applies. Category row `applied`, `org_enforced`. Extra row `Writer Profile waiver: <label>`, `not_applied`, `org_enforced`, reason "org-enforced: this House Rule applies regardless of the Writer Profile" | — |
| Settings in Writer's Notes, no profile | Internal `writer_notes` doc "PD Writing Customized Settings…" | Applied as profile: `profileState: applied`, source `writer_notes`, one `generation:settings` call, analysis cached, offer present | Classifier fails → text still applied with no waivers; `waiverAnalysis: failed`; category rows read "…the settings document could not be analysed for waivers" |
| Same settings as attachment | Internal `other` doc | Rows identical to the profile and Writer's Notes paths | — |
| Rerun, same document | Cached analysis | Zero `generation:settings` calls | — |
| Client-uploaded settings doc | `uploaderRole` absent | Not applied; saved profile rules as before | — |
| Doc differs from enabled profile | Both present | Doc applies; `savedProfileSuperseded: true`; Writer Profile reason names the supersession | — |
| Doc equals enabled profile | Same text | Profile applies (its toggles); `matchesProfile: true`; no offer | — |
| No profile, no doc / disabled | — | `profileState` missing or disabled on every section. Query line "No Writer Profile applied — House Rules in full." | — |
| Cap above Locked | Text "Line 246: no more than 80 lines." | Extracted rule. Row `tier: conflict`, "cap met at N/50 lines (rule asked 80; the Locked cap applies)" or over-cap wording | — |
| Build Order in text | "Build order: 246, 242, 244" | Chain runs 246 → 242 → 244 | Partial or invalid → `resolveBuildOrder` fallback reason |

</intent-contract>

## Code Map

- `convex/writerProfiles.ts:335-384`: `getEffectiveWriterStyle`. Add an optional `settingsDocument` argument `{text, supplyPath: "writer_notes"|"attachment", addressedCategories: StyleOverrideKey[] | null}`, where `null` means the analysis failed. Also add `requested` to each outcome, `settingsSource`, `savedProfileSuperseded`, `matchesProfile` and `profileReason`, and apply extraction. `:393-415` `getProfileForGeneration` keeps its shape and null contract. `:423-438` `getGenerationProfileContext` passes the new optional fields through. `convex/writerProfiles.ts` imports nothing from `convex/ai/`. It is a query/mutation module and must not pull in the provider stack.
- `convex/lib/orderedChain.ts:90-107`:
  - `categoryOutcomeValidator` gains `requested: v.optional(v.boolean())`.
  - `orderedProfileContextValidator` gains `profileReason: v.optional(v.string())` and `waiverAnalysisFailed: v.optional(v.boolean())`. `categoryReason` reads the second one to word the failed-analysis case.
  - All are optional, so already-scheduled chain payloads still validate.
  - Reuse `resolveBuildOrder` (`:119`), `selfCheckRuleValidator` (`:48`) and `MAX_SELF_CHECK_RULES` (`:40`).
- `convex/lib/selfCheckRules.ts`:
  - `:138-148` `categoryReason`: add the failed-analysis wording.
  - `:182-194` profile row: use `profile.profileReason ?? "Writer Profile applied"`.
  - `:215-224`: after each category row, emit the `waiver:<category>` row when `requested && !effective`.
  - `:243-310`: cap rows unchanged; extracted rules flow through here.
- `convex/lib/settingsDocument.ts` (new, pure, imports `shared` only):
  - `SETTINGS_TITLE_PATTERN`, `isSettingsTitle(candidate)` (the title-only rule in Design Notes), `detectSettingsDocument(sources)`, `normalizeSettingsText`.
  - `settingsSupplyLabel(supplyPath)`: "in Writer's Notes" or "in an attachment". It is the one phrase used by the progress log, `profileReason` and the prefill notice.
  - `generationSources.uploaderRole` holds only internal roles (`convex/schema.ts:1519-1522`), so presence is the trust check.
  - The label format is `${category}:${fileName}` (`convex/generations.ts:518`, split at `:910-923`).
- `convex/lib/settingsExtraction.ts` (new, pure): `extractSettingsRules(text) → {buildOrder?: string[]; selfCheckRules: SelfCheckRule[]}`. The grammar and golden examples are in Design Notes.
- `convex/ai/styleAnalysis.ts`:
  - Export `ANALYSIS_TOOL_SCHEMA` (`:78`) and the system text as a named constant, so the generation classifier reuses `buildStyleAnalysisPrompt` (`:55`) and `styleAnalysisSchema` (`:42`) verbatim.
  - Correct "five WAIVABLE house-style categories" (`:69`) to "six".
  - `analyzeMyInstructions` (`:113`) keeps its behaviour otherwise.
- `convex/ai/writerSettings.ts` (new; a helper module that registers no Convex functions of its own):
  - `resolveGenerationWriterSettings(ctx, {generationId, projectId, requestedBy, clientFor, log})`.
  - Steps: candidate query → classify on cache miss (`generation:settings`, `generateStructured` with `attempts: 1`, `submit_style_analysis`; a failure is not cached) → record analysis → effective-style query → record `generations.writerSettings`, including the document's `addressedCategories` when a document applied with an analysis.
  - `SETTINGS_CLASSIFIER_VERSION` is `settingsClassifierVersion(inputs)` applied to the real inputs. `settingsClassifierVersion` is an exported pure function that returns a stable string hash of every input that decides the classifier's answer: the system text, the user template with an empty document (`buildStyleAnalysisPrompt("").user`, which carries the House Rule and Locked catalogs), `ANALYSIS_TOOL_SCHEMA`, the tool name, tool description, `maxTokens` and `inputCharLimit` from `STYLE_ANALYSIS_REQUEST`, and the classifier model id. The constant is passed as an argument to the candidate query and to `recordSettingsAnalysis`, and nowhere else.
  - Failures of the cache write and the record write are caught individually and never discard an already-classified document.
  - Every `console.error` in the resolver logs the raw error object beside its reason code, so server logs keep the message and stack. Writer-facing progress-log text still carries only the normalized reason.
  - The classifier-failure progress-log line says the document's instructions apply with no Writer Profile waivers. It never says every House Rule is in force, because categories an org set to `off` stay waived.
  - Returns `{writerFlavor?, styleOverrides?, orderedContext}`. Any other throw degrades to `fetchWriterStyle` plus `readOrderedProfileContext` semantics.
- `convex/ai/writerStyle.ts:18-49`: `fetchWriterStyle`. Keep it only as the degrade path inside the resolver.
  - Its callers, `pipeline.ts:715` and `iterative.ts:181`, switch to the resolver.
  - Its two progress-log lines become exported constants that the resolver's applied-style log reuses, so the two cannot drift.
- `convex/ai/pipeline.ts:751-764`: `generateReport` uses the resolver's three outputs and keeps the existing log lines. Add one log line for an applied settings document. `:392-412` `readOrderedProfileContext` stays the `generateCandidate` fallback (`:938`). If it moves, `pipeline.ts` keeps re-exporting it (`convex/ai/promptProgram.test.ts:22` imports it from `./pipeline`), with a comment that says where it now lives.
- `convex/ai/iterative.ts:181,209`: iterative start uses the resolver's `writerFlavor`/`styleOverrides`. The frozen `styleGuidance` keeps its shape.
- `convex/ai/instrument.ts:45-85`: add `"settings"` to `GENERATION_CALL_SLOTS` and `settings: 1` to `GENERATION_SLOT_ALLOWANCES`.
- `convex/ai/promptProgram.ts`: declare `calls.settingsAnalysis` (system text, request, schema) beside `calls.brief`, so a classifier prompt change moves `promptVersion`. The topology arrays are unchanged. Update the manifest-key list in `tests/aiUsage.test.ts`, and add a `promptScaffolds.test.ts` pin like `calls.brief`.
- `convex/schema.ts`:
  - `generations`: add optional `writerSettings: v.object({profileState, source: profile|writer_notes|attachment|none, generationSourceId?, projectDocumentId?, fileName?, matchesProfile, savedProfileSuperseded, waiverAnalysis: profile|cached|analyzed|failed|none, truncated, addressedCategories?: v.array(styleCategoryValidator)})` near `briefId`/`productionOrder`. `addressedCategories` is bounded at 6 entries.
  - New `settingsDocumentAnalyses` `{projectId, contentHash, classifierVersion, addressedCategories: v.array(styleCategoryValidator), analyzedAt}` with index `by_projectId_and_contentHash_and_classifierVersion`. It carries `projectId` for AD-19; no registry file exists yet.
- `convex/writerProfiles.ts` (functions):
  - `internalQuery getSettingsDocumentCandidate({generationId, userId?, classifierVersion})` returns `{document | null, matchesProfile, cachedAddressed | null}`.
  - `internalMutation recordSettingsAnalysis({projectId, contentHash, classifierVersion, addressedCategories})` is idempotent per key and the only writer of the table.
  - `internalQuery getGenerationWriterStyle({userId?, settingsDocument?})` returns `EffectiveWriterStyle`.
  - Public `query getGenerationWriterSettings({generationId})`, with the auth pattern of `convex/complianceNotes.ts:16-26`. It returns `null` for a missing or legacy record. Otherwise it returns `{profileState, source, fileName?, matchesProfile, savedProfileSuperseded, waiverAnalysis, noProfileLine, offer: {supplyPath, fileName, text, truncated, addressedCategories: StyleOverrideKey[] | null} | null}`.
  - `offer.addressedCategories` is `generations.writerSettings.addressedCategories` exactly as recorded at resolution, or `null` when it is absent. The query never reads the analysis cache.
- `convex/generations.ts`: `internalMutation recordWriterSettings({generationId, writerSettings})` is the only writer of the field. It patches `generations` only, never `projects` (AD-2).
- `src/lib/settingsPrefill.ts` (new, pure):
  - `settingsPrefillOverrides({offer, modes, current})` returns `current` with every `offer.addressedCategories` entry whose org mode is `writer_choice` turned on. It never turns one off, never touches a governed category, and leaves `current` unchanged when there are no categories. This mirrors the Analyze rule at `+page.svelte:120-126`.
  - `settingsPrefillNotice(offer)` builds its copy with `settingsSupplyLabel`, for example "Loaded from PD Writing Customized Settings.docx in Writer's Notes. Review, then save to your Writer Profile.". It adds "Only the first 75,000 characters were loaded." when `offer.truncated` is set, using `MAX_INSTRUCTIONS_CHARS`.
  - `settingsPrefillDecision(input)` is the one place the page's prefill is decided, and it is pure. It returns `{kind: "idle" | "wait" | "apply" | "unavailable" | "kept-edits" | "unchanged", text?, overrides?, notice?}` from `{fromGeneration, prefilledFor, seeded, modesLoaded, profileError, modesError, query: {data, error}, userEdited, currentText, currentOverrides, modes}`:
    - no param, or `prefilledFor === fromGeneration`: `idle`;
    - `profileError`, `modesError` or `query.error`: `unavailable`;
    - seed or modes not loaded, or query pending: `wait`;
    - query `null` or no offer: `unavailable`;
    - `userEdited`, meaning the draft already differs from the seed: `kept-edits`, with the notice "Your unsaved edits were kept; the settings document was not loaded.";
    - the offer's text and resulting overrides both equal the draft: `unchanged`, with no notice;
    - otherwise `apply`, with the text, the overrides and `settingsPrefillNotice`.
    
    The unavailable notice is "That generation's settings document could not be loaded."
- `src/routes/settings/writing/+page.svelte:36-63,120-126,143`:
  - Read the optional `?fromGeneration=<id>` from `page.url` (`$app/state`). The query stays `"skip"` until the user is authenticated and the param is present.
  - One `$effect` feeds `settingsPrefillDecision` and applies its result. `apply` sets the draft and overrides, so the page is dirty and Save is enabled. Any result except `wait` and `idle` sets `prefilledFor = fromGeneration`, so a later `fromGeneration` value is decided again.
  - The effect holds no other logic. Notices use body type and the `ink-secondary` token, with no new controls. The existing Analyze and Save flow is unchanged.
- `docs/product-domain.md`: a new amendment after the 2026-09-01 skeleton amendment (`:1385-1438`). It restates the PSOS-50 precedence sentence (`:1354-1356`) as four tiers and follows the process at `:1776-1784`.
- Tests and harness to reuse:
  - `convex/writerProfiles.test.ts:13-32`: `setup()`, `houseStyle.setModes`.
  - `convex/writerProfiles.test.ts:405-424`: the tier-copied pattern.
  - `convex/ai/promptProgram.test.ts:27-38,99-126,145-262`: the SDK mock, `fixture`, `runCandidates`, `drainChain`.

## Tasks & Acceptance

**Execution:**
- [ ] `convex/lib/settingsDocument.ts` and `convex/lib/settingsExtraction.ts`, plus `*.test.ts` for each:
  - detection by file name (including `_`/`-` separators) and by first line;
  - a typographic apostrophe;
  - client trust ignored; Writer's Notes preferred; truncation; non-settings ignored;
  - every positive and negative title example, and every golden and negative extraction example, in Design Notes;
  - a segment with no section, a segment with two sections, and the 20-rule limit.
- [ ] `convex/lib/orderedChain.ts` and `convex/lib/selfCheckRules.ts`: the optional validator fields, the waiver row, the profile reason, and the failed-analysis reason.
- [ ] `convex/schema.ts` and `convex/generations.ts`: `generations.writerSettings` (with `addressedCategories`), `settingsDocumentAnalyses` (with `classifierVersion`), and `recordWriterSettings`. This comes before `writerProfiles.ts`, which reads the new table.
- [ ] `convex/writerProfiles.ts`: the `getEffectiveWriterStyle` extension and the four functions in the Code Map. No import from `convex/ai/`.
- [ ] `convex/ai/styleAnalysis.ts`, `convex/ai/writerSettings.ts`, `convex/ai/writerStyle.ts`, `convex/ai/instrument.ts`, `convex/ai/promptProgram.ts`, `convex/ai/pipeline.ts`, `convex/ai/iterative.ts`: the resolver, the classifier version, the shared log constants, the slot, the manifest entry, and both call sites.
- [ ] `src/lib/settingsPrefill.ts` and `src/routes/settings/writing/+page.svelte`: the pure helpers and decision, and the thin page wiring from `?fromGeneration`.
- [ ] `docs/product-domain.md`: one dated amendment, "2026-09-11 — Four-tier style precedence, no silent tier, settings documents, and the effort ceiling". It records:
  - the tier table, including a row for `off` (waived for everyone), and that an `off` category's Compliance Note rows carry `tier: org_enforced` because the organization decided it;
  - no silent tier: the waiver rows, the Writer Profile row, and `generations.writerSettings`;
  - settings-document detection, the title-only rule and the trust floor, and that the document applies as the Writer Profile for that generation;
  - supersede versus match;
  - classifier caching (versioned) and the `generation:settings` slot;
  - extraction and Locked clipping, with Open Question 1 recorded: Section 246 caps stay Locked;
  - the effort ceiling: the Dump is the maximum required input, and nothing requires a writer-authored artifact;
  - the affected scope: SPEC-pd-generation story 3, CAP-6 and CAP-8, building on PSOS-49/50;
  - migration impact: widen-only optional fields, one new table, no backfill;
  - the tests, including `src/routes/settings/writing/settingsPrefill.component.test.ts`;
  - approval, by reference to the SPEC-pd-generation Constraints.
  
  Where it says who writes the new records, it says "database writer" and names the two internal mutations.
- [ ] Tests, never skipped:
  - `convex/writerProfiles.test.ts`:
    - six categories × `writer_choice`/`enforced`: effective, the category rows, the waiver row, and the House Rule text absent or present through `buildStyleGuidance`;
    - cap clipping from profile text;
    - mixed stored fields: a profile storing only `buildOrder` still gets its text's extracted cap rules, and one storing only `selfCheckRules` still gets its text's extracted Build Order; the stored field wins in each;
    - disabled or missing profile reported;
    - `matchesProfile` and supersede;
    - a client-trust document ignored;
    - a cached analysis at another `classifierVersion` not served;
    - `getGenerationWriterSettings`: auth (an outsider gets `null`), `noProfileLine`, and an offer whose `truncated` and `addressedCategories` come from the record even when the cache table is empty.
  - `convex/ai/writerSettings.test.ts`, on the `promptProgram.test.ts` harness:
    - the three supply paths drive `single` through the chain and compare `complianceNotes.listForGeneration` rows;
    - one `single` generation with a profile waiving all six categories and one category `enforced`, asserting the chain payload's frozen `styleOverrides` and the category and waiver rows from `listForGeneration` (AC 2);
    - exactly one `generation:settings` call, then zero on a rerun;
    - a classifier failure still completes, after exactly one attempt;
    - a document equal to the enabled profile: no classifier call, no cache row, and `writerSettings` `{source: "profile", matchesProfile: true, waiverAnalysis: "profile"}`;
    - an over-length document records `truncated: true` and the truncation log line;
    - a throwing `recordSettingsAnalysis` still applies the classified document's flavor and waivers, and the record keeps `addressedCategories`;
    - a client-uploaded settings document beside an enabled saved profile: the document is not applied, the saved profile rules as before (`source: "profile"`, its flavor, `savedProfileSuperseded: false`), and there is no classifier call;
    - `settingsClassifierVersion`: changing any one of its inputs changes the result, and `SETTINGS_CLASSIFIER_VERSION` equals it applied to the real inputs;
    - the progress log: `APPLYING_WRITER_STYLE_LOG` and the `waivingHouseRulesLog(...)` line when flavor and waivers apply, the supersede suffix when a document supersedes the saved profile, and the classifier-failure line's wording.
  - `convex/ai/instrument.test.ts`:
    - the `settings` slot and its allowance;
    - `summarizeSlotUsage({"generation:settings": 2})` reports `overrun: ["settings"]`;
    - building a `generation:settings` client after a recorded overrun still succeeds (recorded, never enforced).
  - `convex/ai/promptScaffolds.test.ts`: editing the classifier system text changes the computed `promptVersion`.
  - `src/lib/settingsPrefill.test.ts`, in the `src` vitest project:
    - every `settingsPrefillDecision` branch listed in the Code Map, including a new `fromGeneration` after an earlier one was decided;
    - overrides: only `writer_choice` categories are turned on, none is turned off, and `null` categories leave them as they are;
    - notice copy for Writer's Notes, for an attachment, with truncation, and when unavailable.
  - `src/routes/settings/writing/settingsPrefill.component.test.ts`, modelled on `src/routes/project/new/newProjectPrefill.component.test.ts` (`__setPageUrl`, `__setQueryData`), run by `npm run test:component`. It renders the page at `/settings/writing?fromGeneration=<id>` and proves AC 5 at the page:
    - with a seeded profile and an offer, the preferences field holds the offer text, the offer's `writer_choice` categories are ticked, the "Loaded from …" notice shows and Save is enabled, and no save mutation is called;
    - the applied notice stays after the effect re-runs;
    - with unsaved edits already in the draft when the offer arrives, the edits are kept and the kept-edits notice shows.
  - `convex/ai/writerSettings.test.ts`: a resolver failure's `console.error` receives the raw error object.

**Acceptance Criteria:**
- Given the same settings supplied three ways (an enabled saved profile, internal Writer's Notes, and an internal attachment), when a `single` generation runs the chain for each, then `complianceNotes.listForGeneration` returns rows identical in `section, paragraphIndex, source, instruction, outcome, tier, reason, repaired`.
- Given every category is `writer_choice` and a profile's instructions contradict all six categories with the waivers on, when a generation runs, then all six categories are waived in its frozen `styleOverrides`, and each category row reads as waived via override. With a category `enforced`, that House Rule applies and a `not_applied` / `org_enforced` waiver row names it.
- Given settings text asking Line 246 for 80 lines, when section 246 is checked, then its rule row is reported at the 50-line Locked cap with `tier: conflict`, and no Locked cap changes.
- Given no profile, or a disabled one, and no settings document, when a generation completes, then every section's Writer Profile row reads "no Writer Profile applied (missing|disabled)", and `getGenerationWriterSettings` returns `noProfileLine: "No Writer Profile applied — House Rules in full."`.
- Given a settings document applied from Writer's Notes that differs from the saved profile, when the writer opens `/settings/writing?fromGeneration=<id>`, then:
  - the preferences field is prefilled with the document text;
  - the document's analysed `writer_choice` waivers are pre-ticked;
  - Save is enabled;
  - nothing is saved until the writer saves.
- Given a second generation with the same settings document, when it runs, then `aiUsage` records no `generation:settings` call for it.

## Spec Change Log

### 2026-09-11 — Review loop 1: bad_spec loopback

**Triggering findings (bad_spec; the code followed this spec, and the spec was wrong):**
- `[high]` The settings-title pattern's bare `pd settings` alternative matches proportional-derivative controller-gain files, which are common in SR&ED control projects. An internal attachment named "PD settings.xlsx" would supersede the writer's saved profile.
- `[medium]` The pattern accepted only a straight apostrophe, so a title typed as "Writer’s settings" (Word autocorrect) was missed.
- `[medium]` The cap grammar tested the upper-bound cue once per segment and then took the first number. "Section 242: at least 200 words, at most 300 words" was read as `maxWords: 200`.
- `[medium]` `(\d{1,4})` read "1,500 words" as 500.
- `[medium]` The save offer carried only text. Saving the prefill without Analyze made the next generation `matchesProfile` with empty toggles, so House Rules the document had waived came back.
- `[medium]` The classifier cache was keyed without a classifier version. After a prompt or schema change (which moves `promptVersion`), old waivers kept being served.

**Amended (outside the intent-contract):**
- Design Notes: a new title pattern with negative examples; a new extraction grammar with lower-bound, trailing-cue, thousands and per-line Build Order rules.
- Code Map, Tasks and ACs: the offer carries `truncated` and `addressedCategories`, and the page pre-ticks `writer_choice` waivers; `classifierVersion` is on the cache row and its index.
- Patch findings are carried into this amendment so they survive the loopback:
  - the classifier uses `attempts: 1` (the worst case inside `generateReport`'s 600 s action);
  - "five" is corrected to "six" in the classifier prompt;
  - one `settingsSupplyLabel` phrase replaces three wordings;
  - an accurate comment on the `readOrderedProfileContext` re-export;
  - the page handles an error or `null` for `fromGeneration`;
  - resolver tests for the match case, truncation and a failed cache write.

**Known-bad states avoided:**
- A controller spreadsheet becoming the writer's instructions.
- A lower bound shortening a section.
- A comma-grouped cap read as a smaller number.
- Saved settings silently losing their waivers.
- Stale waivers after a classifier change.

**KEEP (worked well in attempt 1; must survive re-derivation):**
- The module seams: `convex/lib/settingsDocument.ts`, `convex/lib/settingsExtraction.ts`, `convex/ai/writerSettings.ts` (with `resolve` and `degrade`), `src/lib/settingsPrefill.ts`.
- `getEffectiveWriterStyle` is the single tier computation, with `requested`, `profileReason` and `waiverAnalysisFailed`, and the exact row wording in the I/O matrix.
- `SECTION_PATTERN`'s guard that a cap number equal to a section number is never read as a second section.
- The six-category `test.each` in `convex/writerProfiles.test.ts`.
- The end-to-end three-supply-path test in `convex/ai/writerSettings.test.ts` on the `promptProgram.test.ts` harness.
- `recordSettingsAnalysis` is idempotent and `recordWriterSettings` is the sole writer.
- The `settings` slot has an allowance of 1, with the `calls.settingsAnalysis` manifest entry and its `promptScaffolds` pin.
- `fetchWriterStyle` survives only as the degrade path.
- The product-domain amendment text.
- Attempt 1 passed the full gate (2275 tests). Its diff was saved for reference during this run at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-103112-7f42-worktrees-3/a5b21e2e-4101-4b02-8ccd-cb10b41854ae/scratchpad/story3.diff`. Reuse its unchanged parts, and apply every amendment above.

### 2026-09-11 — Review loop 2: bad_spec loopback

**Triggering findings (bad_spec; attempt 2 followed this spec, and the spec was wrong or ambiguous):**
- `[medium]` The title pattern matched anywhere in a first line, so a Writer's Notes note opening "Remember the client's writing preferences are formal…" became the Writer Profile and superseded the saved profile.
- `[medium]` The cues `under` and `within`, with no check on what follows the unit, turned prose into caps: "Section 244 describes work under 40 lines of code" produced a 40-line cap. The Self-check then repairs, which shortens the section, and this applies to legacy saved profiles as well.
- `[medium]` A per-item limit such as "each experiment at most 100 words" or "100 words per paragraph" became a whole-section cap.
- `[medium]` The Code Map said the offer's categories were "read from the cached analysis at the current version, recorded at resolution time". Attempt 2 read the cache at query time. As a result, a failed cache write or a classifier-version change dropped the waivers the generation had actually applied, and the query module imported the AI provider stack to get the version constant.
- `[low]` A negated cue ("not under 200 words") was read as a maximum.
- `[low]` A Build Order line that also states a cap ("Build order: 246, 242, 244; line 246 max 30 lines") counted 246 twice, so the order fell back and the cap was dropped.
- `[low]` The classifier version hashed only the system text and schema. It left out the user-template catalogs and the model, which also decide the answer.

**Amended (outside the intent-contract):**
- Design Notes: the title-only rule, the adjacent-cue cap grammar with `of`, per-item and negation exclusions, the bounded Build Order run, and new negative goldens.
- Code Map: `generations.writerSettings.addressedCategories` is recorded at resolution and is the offer's only source. `writerProfiles.ts` imports nothing from `convex/ai/`. The classifier version covers every classifier input.
- Patch findings carried in so they survive the loopback:
  - the page's prefill logic moves into the pure `settingsPrefillDecision` (covering a query or modes error, kept unsaved edits, once per `fromGeneration`, and no notice when nothing changed);
  - two strengthened tests: the overrun is recorded but not refused, and a classifier prompt edit moves `promptVersion`;
  - the amendment's tier table places `off`, and its "writer" wording is clarified;
  - the two progress-log lines are shared constants;
  - an end-to-end AC 2 run covering all six categories.

**Known-bad states avoided:**
- Ordinary notes superseding a saved profile.
- Prose or per-item numbers shortening a section through repair.
- An offer that loses the waivers its generation applied.
- A query bundle carrying the provider SDK.
- The page overwriting unsaved edits, or waiting forever on an error.

**KEEP (worked well in attempt 2; must survive re-derivation):**
- Everything in loop 1's KEEP list.
- Attempt 2's versioned cache (`classifierVersion` in the row and the index).
- The `attempts: 1` classifier.
- "six" in the classifier prompt.
- `settingsSupplyLabel`.
- `settingsPrefillOverrides`, and the offer carrying `truncated` and `addressedCategories`.
- The resolver's per-write try/catch.
- The three resolver tests: match, truncation, failed cache write.
- The typographic-apostrophe and `_`/`-` file-name normalization.
- The thousands-separator number grammar.
- The golden examples that still hold.
- Attempt 2 passed the full gate (2306 tests). Its diff was saved for reference during this run at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-103112-7f42-worktrees-3/a5b21e2e-4101-4b02-8ccd-cb10b41854ae/scratchpad/story3-r2.diff`. Start from it, and apply every loop 2 amendment.

### 2026-09-11 — Review loop 3: bad_spec loopback

**Triggering findings (bad_spec; attempt 3 followed this spec, and the spec was wrong):**
- `[medium]` The cap-number pattern read part of a decimal, or of a period- or space-grouped number, as a cap. Run against attempt 3's extractor, "Line 246: 2.5 lines max" produced a 5-line cap and "Line 244: 1.500 words max" a 500-word cap, so the Self-check repair would cut the section.
- `[medium]` Rule 7 placed lower-bound cues only before the number. A trailing one was chained as a maximum: "at most 40 lines and 300 words minimum", "…300 words at least" and "…300 words or more" each produced a 300-word cap from a minimum.

**Amended (outside the intent-contract):**
- Design Notes: rule 5 ignores ambiguous numbers (decimals and period- or space-grouped runs). Rule 7 adds trailing lower-bound cues, which also block the `and` / `,` chain. New golden and negative examples.
- Code Map: `settingsClassifierVersion(inputs)` is pure and exported, and the hash also covers the tool name, description and `maxTokens`.
- Tasks: tests for the classifier version and for a client-trust document beside an enabled saved profile. The amendment says an `off` category's rows carry `tier: org_enforced`.
- Patch findings carried in so they survive the loopback:
  - the classifier version covers the tool name, description and `maxTokens`;
  - a test that each classifier input moves the version;
  - the client-trust end-to-end test seeds an enabled saved profile and shows it rules as before;
  - the amendment's `off` wording.

**Known-bad states avoided:**
- A decimal or foreign-grouped number becoming a tiny cap that shortens a section through repair.
- A minimum read as a maximum.
- Stale cached waivers after a tool name, description or token-limit change.

**KEEP (worked well in attempt 3; must survive re-derivation):**
- Everything in loop 1's and loop 2's KEEP lists.
- The title-only rule implementation: normalization, the filler set, and the "at most one other token" check, with every positive and negative example tested.
- The adjacent-cue cap grammar (cue directly before, trailing upper-bound cue, `and` / `,` chain), the `of` exclusion, the per-item clause exclusion, leading negation, and the bounded Build Order run (at most three section numbers directly after the cue).
- `generations.writerSettings.addressedCategories`, recorded at resolution and deduped in `recordWriterSettings`, as the offer's only source. `writerProfiles.ts` imports nothing from `convex/ai/`.
- `APPLYING_WRITER_STYLE_LOG` and `waivingHouseRulesLog()` in `writerStyle.ts`, shared with the resolver.
- The pure `settingsPrefillDecision` and its exhaustive tests. The page's effect only feeds it and applies the result.
- The end-to-end AC 2 run (six categories, one enforced: frozen `styleOverrides`, 18 category rows, 3 waiver rows); the overrun test that makes a real `generation:settings` call after an overrun; the prompt-edit `promptVersion` test.
- The fixture file names renamed to "Writing settings" in `convex/writerProfiles.test.ts`.
- The amendment text.
- Attempt 3 passed the full gate (2332 tests in 174 files). Its delta over the recovery base (`dc26ed2`) is saved at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-120649-26de-worktrees-3/87f4c27e-436d-4ec7-9497-e89d75b325f5/scratchpad/story3-r3-delta.diff`, and the full story diff over `36a234d` at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-120649-26de-worktrees-3/87f4c27e-436d-4ec7-9497-e89d75b325f5/scratchpad/story3-r3-full.diff`. Start from the recovery base plus that delta, then apply every loop 3 amendment.

### 2026-09-11 — Review loop 4: bad_spec loopback

**Triggering findings (bad_spec; attempt 4 followed this spec, and the spec was wrong):**
- `[medium]` Rule 4 checked for a per-item cue only inside the cap's own comma clause. "Section 244: each paragraph, no more than 100 words" produced a 100-word cap for the whole section (probe run against attempt 4's extractor).
- `[medium]` The grammar had no notion of a limit on part of a section. "Section 244: keep sentences under 25 words", "Line 244: at most 100 words in the first paragraph", "Section 242: opening under 50 words" and "Section 246: bullets of no more than 20 words" each produced a whole-section cap (25, 100, 50 and 20 words), which the Self-check repair would enforce.

**Amended (outside the intent-contract):**
- Design Notes: rule 4 becomes a whole-segment scope check that runs before the clause split and wins over every later rule. A per-item cue, a sub-unit noun or a part-of-section word anywhere in the segment gives no cap. Loops 1 to 3 each found one more false-cap shape, so this closes the class rather than the instance. New negative examples.
- Code Map: the resolver's server logs keep the raw error.
- Tasks and Verification: a component test for the page's `fromGeneration` prefill, and `npm run test:component`.
- Patch findings carried in so they survive the loopback:
  - the page component test, proving AC 5 at the page on the existing route harness;
  - the raw error in the resolver's `console.error` lines.

**Known-bad states avoided:**
- A sentence, paragraph, bullet or opening limit becoming a whole-section cap that cuts the section through repair.
- A per-item cue in an earlier clause being ignored.
- Resolver failures logged with no message or stack.

**KEEP (worked well in attempt 4; must survive re-derivation):**
- Everything in the KEEP lists of loops 1, 2 and 3.
- Loop 3's ambiguous-number rule (decimals and period- or space-grouped runs are never caps) and the trailing lower-bound cues that block the chain, with their golden and negative tests.
- `settingsClassifierVersion` (tool name, description and `maxTokens` included) and its per-input test.
- The client-trust test beside an enabled saved profile.
- The amendment's `off` wording and the rest of the amendment text.
- Attempt 4 passed the full gate (2351 tests in 174 files). Its delta over the recovery base (`dc26ed2`) is saved at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-120649-26de-worktrees-3/87f4c27e-436d-4ec7-9497-e89d75b325f5/scratchpad/story3-r4-delta.diff`, and the full story diff over `36a234d` at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-120649-26de-worktrees-3/87f4c27e-436d-4ec7-9497-e89d75b325f5/scratchpad/story3-r4-full.diff`. Start from the recovery base plus that delta, then apply every loop 4 amendment.

### 2026-09-11 — Review loop 5: bad_spec loopback

**Triggering finding (bad_spec; attempt 5 followed this spec, and the spec contradicted the intent's matrix):**
- `[low]` The matrix row "Build Order in text" says a partial or invalid Build Order gets the `resolveBuildOrder` fallback reason. Design Notes rule 1 required at least two section numbers, so "Build order: 246 first." produced no Build Order and no reason: the writer's instruction was dropped without a note (the attempt's test asserted `buildOrder` undefined).

**Amended (outside the intent-contract):**
- Design Notes: rule 1 passes a run of one or more section numbers to `resolveBuildOrder`, so a one-section run falls back with its reason. New golden example.
- Code Map: the classifier version also hashes `inputCharLimit`; the classifier-failure progress-log line no longer claims every House Rule is in force.
- Tasks: tests for mixed stored fields and for the writer-facing progress-log lines; the amendment's tests list names the page component test.
- Patch findings carried in so they survive the loopback:
  - `inputCharLimit` in the classifier version;
  - the classifier-failure log wording;
  - the amendment's tests list;
  - the mixed stored-field tests;
  - the progress-log assertions.

**Known-bad states avoided:**
- A one-section Build Order instruction ignored with no reason.
- Stale cached waivers after the classifier's input limit changes.
- A progress-log line saying every House Rule applies while `off` categories stay waived.

**KEEP (worked well in attempt 5; must survive re-derivation):**
- Everything in the KEEP lists of loops 1 to 4.
- Loop 4's whole-segment scope check (per-item cues, sub-unit nouns and part-of-section words) with its negative and per-word tests.
- The raw error in every resolver `console.error`, with the degrade test's check that the raw error is logged and stays out of the progress log.
- `src/routes/settings/writing/settingsPrefill.component.test.ts`, proving AC 5 at the page.
- Attempt 5 passed the full gate (2414 tests in 174 files) and `npm run test:component` (587 tests in 78 files). Its delta over the recovery base (`dc26ed2`), including the new component test as a new-file diff, is saved at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-120649-26de-worktrees-3/87f4c27e-436d-4ec7-9497-e89d75b325f5/scratchpad/story3-r5-delta.diff`. A copy of the component test is at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-120649-26de-worktrees-3/87f4c27e-436d-4ec7-9497-e89d75b325f5/scratchpad/r5-untracked/src/routes/settings/writing/settingsPrefill.component.test.ts`, and the full story diff over `36a234d` is at `/private/tmp/claude-501/-Users-johnnynguyen-Documents-Repos-Banhall--bmad-loop-runs-20260911-120649-26de-worktrees-3/87f4c27e-436d-4ec7-9497-e89d75b325f5/scratchpad/story3-r5-full.diff`. Start from the recovery base plus that delta, then apply every loop 5 amendment.

## Review Triage Log

### 2026-09-11 — Review pass
- intent_gap: 0
- bad_spec: 6: (high 1, medium 5, low 0)
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 17: (high 0, medium 3, low 14)
- addressed_findings:
  - `[high]` `[bad_spec]` Title pattern's bare `pd settings` matches controller-gain files. The pattern is amended in Design Notes and the code is reverted for re-derivation.
  - `[medium]` `[bad_spec]` Typographic apostrophe not matched. Pattern amended.
  - `[medium]` `[bad_spec]` Cap grammar took a lower bound as the maximum. Grammar amended to bind each number to its cue.
  - `[medium]` `[bad_spec]` "1,500 words" read as 500. Grammar amended to accept thousands separators.
  - `[medium]` `[bad_spec]` The text-only offer lost the document's waivers on save. The offer now carries `addressedCategories`, and the page pre-ticks `writer_choice` waivers.
  - `[medium]` `[bad_spec]` The classifier cache served stale waivers after a classifier change. `classifierVersion` added to the row and its index.
  - `[medium]` `[patch]` Two structured classifier attempts inside `generateReport` could exceed the 600 s action. Carried into the amendment as `attempts: 1`.
  - `[low]` `[patch]` The classifier prompt said "five" categories. Carried: corrected to "six".
  - `[low]` `[patch]` Three different supply-path phrasings. Carried: `settingsSupplyLabel`.
  - `[low]` `[patch]` Stale comment on the `readOrderedProfileContext` re-export in `pipeline.ts`. Carried: an accurate comment.
  - `[low]` `[patch]` A malformed or stale `fromGeneration` gave no feedback. Carried: the unavailable notice.
  - `[low]` `[patch]` Truncation not surfaced in the offer or notice. Carried: `offer.truncated` and the notice copy.
  - `[low]` `[patch]` Missing resolver tests (match case, truncation, failed cache write). Carried into the Tasks.
- Rejected:
  - Concurrent double classification: one active generation per project (AD-5), and compare mode shares one resolver run.
  - `lockedConflicts` not persisted: the profile path does not persist them either, and the model Self-check judges free-text instructions.
  - The offer visible to internal non-requesters: project reads are firm-wide (D1), and the prefill only fills the viewer's own draft.
  - Extraction on legacy profiles: intended, and recorded in the amendment.
  - The `+52` source bound; the AD-19 cascade (no registry exists, divergence #43); iterative computing an ordered context it does not use; no changelog entry (the changelog is generated from commits).
  - The self-referenced amendment approval: the SPEC Constraints require this amendment.
  - The title line kept in the instructions; client-side navigation between two `fromGeneration` values; the resolver's double-read race (a sub-second window).
  - No browser test for the page (its logic is in tested pure helpers).
  - Open Question 1 not examined: the document has not landed, and nothing depends on it.
  - UI surfaces owned by story 4 per `stories.yaml`.
  - Differing analyzer context across supply paths (the success criterion is the Compliance Notes).

### 2026-09-11 — Review pass (loop 2)
- intent_gap: 0
- bad_spec: 7: (high 0, medium 4, low 3)
- patch: 5: (high 0, medium 1, low 4)
- defer: 0
- reject: 20: (high 0, medium 3, low 17)
- addressed_findings:
  - `[medium]` `[bad_spec]` Title pattern matched anywhere in a first line. The title-only rule is now in Design Notes, and the code is reverted for re-derivation.
  - `[medium]` `[bad_spec]` `under` and `within` made prose into caps. The cue must now be adjacent to the number, and a unit followed by `of` is not a cap.
  - `[medium]` `[bad_spec]` Per-item limits became section caps. A clause with `each`, `per` or `every` gives no cap.
  - `[medium]` `[bad_spec]` Offer categories were rebuilt from the cache, and the query module imported `convex/ai/`. The categories are now recorded on `generations.writerSettings`, with no `convex/ai/` import.
  - `[low]` `[bad_spec]` Negated cue read as a maximum. Negation now rule-based.
  - `[low]` `[bad_spec]` A Build Order line with a cap double-counted a section. The Build Order is now read as a bounded run of section numbers.
  - `[low]` `[bad_spec]` Classifier version missed inputs. It now hashes the template catalogs and the model.
  - `[medium]` `[patch]` Untested page effect and its edge cases (error wait, overwritten edits, once per `fromGeneration`). Carried: the pure `settingsPrefillDecision`, exhaustively tested.
  - `[low]` `[patch]` Two tests weaker than their names. Carried: overrun recorded, not refused; prompt edit moves `promptVersion`.
  - `[low]` `[patch]` Amendment tier table missing `off`, and ambiguous "writer" wording. Carried.
  - `[low]` `[patch]` Duplicated progress-log strings. Carried: shared constants.
  - `[low]` `[patch]` AC 2 checked by direct calls rather than a generation run. Carried: an end-to-end run covering all six categories.
- Rejected:
  - Any internal uploader's document superseding the requester's profile: this is the trust floor as designed, and it is reported.
  - The offer reaching non-requesters (D1).
  - The truncation copy: accurate, because both cuts start at the beginning.
  - The `+52` bound; `reasonOf` using provider codes, because writer-facing text never carries raw provider strings.
  - A classifier timeout under the AD-9 per-call budget, with single attempt.
  - The degrade path misreporting when two reads fail; the double-read race; old cache rows and the AD-19 cascade.
  - Iterative not applying the Build Order, which matches the saved-profile behaviour there.
  - The approval wording and the changelog, as in loop 1.
  - The re-export kept for its test importer.
  - UTF-16 surrogate slicing; extra compare and iterative runs over shared code.
  - Stored structured fields surviving a prefill save: no UI sets them.
  - Story-4 UI and editor surfaces.
  - Prompts differing across supply paths.
  - Awaiting the classifier before the analyzer.
  - A merged waiver union on save, which is the Analyze rule and is confirmed by Save.

### 2026-09-11 — Review pass (loop 3)
- intent_gap: 0
- bad_spec: 2: (high 0, medium 2, low 0)
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 21: (high 0, medium 2, low 19)
- addressed_findings:
  - `[medium]` `[bad_spec]` Decimal and period- or space-grouped numbers read as caps ("2.5 lines max" gave 5 lines). Rule 5 amended; the code is reverted for re-derivation.
  - `[medium]` `[bad_spec]` A trailing lower-bound cue was chained as a maximum ("…and 300 words minimum" gave a 300-word cap). Rule 7 amended.
  - `[low]` `[patch]` The classifier version omitted the tool name, description and `maxTokens`. Carried into the Code Map.
  - `[low]` `[patch]` No test showed the classifier version moves with its inputs. Carried: a `settingsClassifierVersion` test.
  - `[low]` `[patch]` The client-trust end-to-end test seeded no saved profile, so "saved profile rules as before" was not shown. Carried.
  - `[low]` `[patch]` The amendment did not say `off` rows carry `tier: org_enforced`. Carried.
- Rejected:
  - The classifier's worst case under SDK retries: the per-slot bound is already documented in `convex/ai/providers.ts`, the analyzer and brief slots share it, and the classifier is optional.
  - The candidate query's read volume: `getGenerationInput` already reads the same bounded rows with their content.
  - A titled client style guide, or another internal user's document, applying: the title rule and trust floor as designed, and reported.
  - The offer reaching non-requesters (D1); the `+52` bound; the double-read race; iterative's Build Order; extraction on legacy profiles and in chat reads; the degrade path's state; the AD-19 cascade and old cache rows; uncached failures (the spec does not cache a failure).
  - Saving a prefill over a disabled profile (the writer's disable is kept); the Writer Profile row not naming a document over a missing profile (the identical-rows rule); whitespace-only prefill differences; the unavailable notice wording (specified).
  - No browser test for the page effect (its decision is pure and exhaustively tested); the resolver-failure test not being end-to-end (the resolver returns instead of throwing).
  - The source-row ownership check; the `clientFor` duplication; a pre-generation warning (story 4 UI).
  - `promptVersion` moving for every generation (required by the manifest entry); classifier agreement assumed by fixtures.

### 2026-09-11 — Review pass (loop 4)
- intent_gap: 0
- bad_spec: 2: (high 0, medium 2, low 0)
- patch: 2: (high 0, medium 1, low 1)
- defer: 0
- reject: 26: (high 0, medium 2, low 24)
- addressed_findings:
  - `[medium]` `[bad_spec]` A per-item cue in an earlier comma clause was ignored ("each paragraph, no more than 100 words" gave a 100-word section cap). Rule 4 is now a whole-segment check; the code is reverted for re-derivation.
  - `[medium]` `[bad_spec]` Limits on part of a section became section caps (sentences, a first paragraph, an opening, bullets). Rule 4's sub-unit and part-of-section lists close the class.
  - `[medium]` `[patch]` The page's `fromGeneration` effect had no test, so AC 5 was proven only through the pure helper. Earlier passes rejected this as costly; the existing route harness (`newProjectPrefill.component.test.ts`) makes it a small, surface-anchored test. Carried into the Tasks and Verification.
  - `[low]` `[patch]` The resolver's `console.error` lines logged only a reason code. Carried: the raw error is logged too.
- Rejected:
  - Any internal uploader's document applying to the requester, and style-guide titles qualifying: the trust floor and title rule as designed, and reported.
  - The prefill's waiver union with current toggles: the Analyze rule, shown on the page and confirmed by Save.
  - "Truncated" wording after a reservation cut: a frozen row cut at 200,000 characters is always over the 75,000 limit, so the notice is accurate.
  - The double-read race; concurrent generations (AD-5); the degrade record and its derived state; the Writer Profile row not naming a document over a missing profile (the identical-rows rule).
  - Classifying when every mode is `enforced` or `off` (the offer still needs the categories); the `+52` bound; the AD-19 cascade and old cache rows; the unchecked `generationSourceId` (internal-only writer).
  - No UI link to the offer, and the Brief line (story 4); progress-log copy; duplicated frontend types; the amendment's approval (the SPEC Constraints require it); extraction on legacy profiles (intended and recorded).
  - Coverage asks for compare mode, `off` waivers, iterative degrade, the race, a missing generation, and synchronous-looking async tests; a transient query error fixing `prefilledFor` (specified behaviour).
  - The intent auditor's surface notes: the cache key over the applied text and classifier version (specified); style guidance checked through `buildStyleGuidance`; the match, truncation and resolver-failure cases checked on the resolver rather than a full run; the over-cap wording.

### 2026-09-11 — Review pass (loop 5)
- intent_gap: 0
- bad_spec: 1: (high 0, medium 0, low 1)
- patch: 5: (high 0, medium 0, low 5)
- defer: 0
- reject: 24: (high 0, medium 2, low 22)
- addressed_findings:
  - `[low]` `[bad_spec]` A one-section Build Order ("Build order: 246 first.") gave no Build Order and no fallback reason, against the matrix's "Partial or invalid → `resolveBuildOrder` fallback reason". Rule 1 amended; the code is reverted for re-derivation.
  - `[low]` `[patch]` The classifier version omitted `inputCharLimit`. Carried into the Code Map.
  - `[low]` `[patch]` The classifier-failure progress-log line claimed every House Rule is in force, which is wrong when an org sets a category to `off`. Carried into the Code Map.
  - `[low]` `[patch]` The amendment's tests list omitted the page component test. Carried into the Tasks.
  - `[low]` `[patch]` No test stored exactly one of `buildOrder` and `selfCheckRules`, so the per-field fill was unproven. Carried into the Tasks.
  - `[low]` `[patch]` The applied-style, waiver and supersede progress-log lines were never asserted. Carried into the Tasks.
- Rejected:
  - The offer reaching internal non-requesters (D1), and any internal uploader's document or a style-guide title applying (the trust floor and title rule as designed).
  - The double-read race; the classifier's worst case under SDK retries (the documented per-slot bound); the degrade path's two reads and its record; a transient query error fixing `prefilledFor` (specified).
  - Iterative's Build Order and caps, and chat and research not applying a document (deferred by the spec); the AD-19 cascade and old cache rows; the `+52` bound's comment.
  - Missed cap phrasings ("less than", "not more than") and the plural-possessive title: conservative misses, the accepted direction.
  - The Brief line and offer link (story 4); the Writer Profile row not naming a document over a missing profile (the identical-rows rule); the unreachable `"failed"` fallback; the amendment's approval; `settingsSupplyLabel`'s placement (specified); the page keeping `fromGeneration`; the re-export kept for its test importer.
  - Coverage asks for compare mode, a throw after classification, a throwing log, page notices beyond AC 5, and iterative attribution.
  - The intent auditor's surface notes: the versioned cache key and uncached failures (specified); the conservative extractor; dropped `lockedConflicts`; checks one layer below the chain; extraction on legacy profiles (intended and recorded).

### 2026-09-11 — Review pass (loop 6, final)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 3: (high 0, medium 2, low 1)
- reject: 25: (high 0, medium 2, low 23)
- addressed_findings:
  - `[medium]` `[patch]` `getGenerationWriterSettings` neither declared nor returned `waiverAnalysis`, which the Code Map lists and story 4 needs. The query now returns it, and the query tests and the supersede test expect it.
  - `[low]` `[patch]` Nothing pinned the classifier's `attempts: 1`: the failure test's plain error fails fast whatever the attempt count. A new run whose classifier returns no tool call asserts one classifier call and one `generation:settings` usage row. It fails with `attempts: 2` (mutation-checked).
  - `[low]` `[patch]` The amendment's filler-word list did not match the Design Notes (it omitted `doc`, `SRED` and month names). Corrected in `docs/product-domain.md`.
- Deferred (per the intent's Never list and the Design Notes' "Deferred on purpose"): the story 4 Brief line, save banner and offer link; chat and research applying a settings document; a structured Build Order and Self-check editor.
- Rejected:
  - Missed extractions ("Build order is: …", "per section", heading-structured documents, titles beyond the rule): the conservative direction the Design Notes accept.
  - The double read of the saved profile; the classifier's worst case under SDK retries (the documented per-slot bound); concurrent generations (AD-5); the candidate query's read volume (the same bounded rows `getGenerationInput` reads).
  - The offer reaching internal non-requesters (D1); the prefill merging waivers (the Analyze rule, confirmed by Save); the classifier's `lockedConflicts`; the deletion cascade and old cache rows.
  - `fromGeneration` kept in the URL, a stale notice, and a transient query error fixing `prefilledFor` (specified behaviour); extraction on every read (intended and recorded); the classifier version's hash scheme.
  - Coverage asks beyond the matrix (iterative degrade, `off` waivers, a foreign `fromGeneration`, the double read).
  - The intent auditor's surface notes: the "five" to "six" prompt fix and `promptVersion` moving (both required); the over-cap wording and checks one layer below the chain; the component test running in its own CI job; the legacy-payload fallback.

### 2026-09-11 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 0
- reject: 16: (high 0, medium 0, low 16)
- addressed_findings:
  - `[low]` `[patch]` A classifier-failure progress-log regex in `convex/ai/writerSettings.test.ts` hardcoded the fixture file name instead of interpolating the `FILE` constant the rest of the file uses, risking silent drift if the fixture is renamed. Now built from `FILE`.
  - `[low]` `[patch]` `isTitleFiller`'s possessive-token check (`convex/lib/settingsDocument.ts`) used `\w`, which is ASCII-only, so an accented possessive name (e.g. "José's") was not exempted from the one-non-filler-token budget the way an ASCII name ("Larry's") was, unlike the function's own Unicode-aware token extraction. Now uses `\p{L}\p{N}`, matching the sibling regex; a golden example added to `settingsDocument.test.ts`.
  - `[low]` `[patch]` The `recordSettingsAnalysis throwing...` test in `convex/ai/writerSettings.test.ts` spied on `console.error` but never asserted on the captured calls, so the KEEP-listed requirement that every resolver `console.error` logs the raw error object was unverified for the cache-write-failure branch, unlike its two sibling `console.error` sites in the same file. Added the same assertion pattern used at those sites.
- Rejected:
  - The ambiguous-number guard reading "Section 242 300 words max" as no cap: already documented in Design Notes rule 5 and its own golden negative example — the accepted conservative direction, not a new gap.
  - "summary"/"overview" as part-of-section words dropping "a summary of the work, at most 40 lines": already an explicit golden negative example, the accepted conservative direction.
  - `off`-mode `tier: org_enforced` untested at the AC-2 end-to-end run: unit-tested pre-existing at `writerProfiles.test.ts:362`; the end-to-end run's scope (six categories, one enforced) is spec-directed and this exact coverage ask was already rejected in loop 5.
  - The tier table's unnumbered `off` row reading as a fifth tier: the adjacent prose immediately clarifies it is not, so this is cosmetic and already mitigated.
  - Component test DOM queries against the global `document` rather than a scoped container: the established, working convention already used by the pre-existing `newProjectPrefill.component.test.ts` this file was modelled on.
  - No page-level test for navigating between two different `fromGeneration` values: the exact coverage ask already rejected in loop 1 ("client-side navigation between two `fromGeneration` values").
  - Deferred items lacking a futur-board ticket reference; `status: done` with no attached follow-up ticket: process bookkeeping outside this workflow's scope, not a code defect.
  - Two residual-risk notes (story 4/chat/research gaps; iterative's Build Order and caps) not cross-referencing each other: stylistic, not a defect.
  - `settingsClassifierVersion` hashing via `JSON.stringify`, which would miss an `undefined`-valued property or function on the static tool-schema object: no realistic trigger for a declarative JSON schema, and the version already covers 8 real inputs with a per-input test.
  - The oversized story doc continuing to grow: already flagged via the existing `warnings: [oversized]` frontmatter, not a new condition.
  - The filler-word list in `docs/product-domain.md` risking future drift from the code constant: currently in sync (verified); a speculative future-maintenance suggestion, not a current defect.
  - The negation regex's `(not|never)` prefix applying to every upper-bound cue rather than only `under`/`within`/`below`/`less than`: produces at most a conservative missed cap (never a false cap), matching the extractor's stated accepted-miss philosophy throughout; no observable behavioral defect.
  - A Build Order cue on the same line as a cap losing the cap's section reference when the cap segment doesn't restate its own section number: pre-existing extractor characteristic already implicit in the one existing golden example (which restates "line 246"), not introduced by this loop's one-section-run fix.
  - "Section 242: at most 40 lines and 300 words minimum" being governed by a trailing lower-bound cue rather than the preceding "at most": explicitly documented in Design Notes rule 7 and covered by two golden examples: the finding was factually incorrect.
  - `readSettingsAnalysis` and `sha256` as possible dead code: both are live call sites (`writerProfiles.ts:590,647,672`; used throughout `convex/`).
  - The intent auditor's scope note that this diff excludes `convex/schema.ts`, `selfCheckRules.ts`, `pipeline.ts`, `iterative.ts`, `styleAnalysis.ts`, `instrument.ts`, `promptProgram.ts` and `tests/aiUsage.test.ts`: those files were already part of the recovery base (`dc26ed2`) itself; this diff is the delta of loops 3-6 on top of it, by design of the workflow's baseline-revision scoping, not a gap in what was implemented.

## Design Notes

**Settings-title rule.** A candidate is either the file name, with its extension removed and `_`/`-` turned into spaces, or the first non-empty line, up to 200 characters. Normalize it first: `’` becomes `'`, then lowercase it and strip leading `#`, `*`, `-`, bullets and list numbering. The candidate is a settings title only when both of these hold:

1. It contains a match of
   ```
   \b(customi[sz]ed (pd )?(writing )?settings|pd writing (customi[sz]ed )?settings|writing (settings|preferences)|writer'?s? (settings|profile|preferences)|writing style (settings|guide))\b
   ```
2. With that match removed, it has at most one remaining token outside the filler set. The filler set is: `pd`, `sr&ed`, `sred`, `my`, `our`, `the`, `a`, `for`, `of`, `and`, `document`, `doc`, `file`, `final`, `draft`, `copy`, `version`, `updated`, `latest`, `rev`, any token matching `^v?\d+$`, any all-digit or date token, and any possessive `\w+'s`. Punctuation separates tokens.

Pasted Writer's Notes have the file name "Writer's notes (pasted)", which fails condition 1, so only their first line decides.

Matches:
- "PD Writing Customized Settings"
- "PD_Writing_Customized_Settings_2026-09.docx"
- "Larry's PD Writing Customized Settings"
- "Customised settings"
- "Writer’s settings"
- "Writing preferences - Tracy (final)"
- "# Writing preferences"

Non-matches:
- "PD settings.xlsx"
- "PD controller settings"
- "Kp/Kd PD settings for the actuator"
- "Remember the client's writing preferences are formal"
- "Changed the controller style settings"
- "Style settings v3"
- "Test settings log"

**Extraction grammar** (deterministic, conservative: a missed cap is reported nowhere, but a false cap shortens a section).

1. **Build Order** is read per line, before any other split. A line containing `build order|drafting order|generation order|order of (drafting|generation)` gives a Build Order from the run of section numbers that directly follows the cue.
   - The run may be separated by `,`, `;`, `/`, `→`, `->`, `>`, `then`, `and`, and whitespace.
   - The run stops at the first other token, and the rest of the line goes on to cap extraction.
   - A run of one or more section numbers is the raw list, and it always goes through `resolveBuildOrder`. A one-section run ("Build order: 246 first.") is partial, so it falls back to the default order with `resolveBuildOrder`'s reason, which the progress log reports. A cue with no section number directly after it gives no Build Order.
2. **Segments.** Split every line, or the rest of a Build Order line, on `;` and at sentence ends.
3. **One section per segment.** A segment is considered only if it names exactly one section with `(?:line|section|s|§)?\s*(242|244|246)`. Keep the guard that a cap number equal to a section number is never read as a second section.
4. **Whole-section scope only.** A cap binds a whole section, so a segment that talks about any part of a section gives no cap at all. This check runs on the whole segment, before any clause split, and wins over every later rule. The segment gives no cap when it contains, anywhere:
   - a per-item cue: `each`, `per`, `every`, `apiece`;
   - a sub-unit noun: `sentences?`, `paragraphs?`, `bullets?`, `points?`, `items?`, `experiments?`, `examples?`, `headings?`, `sub-?sections?`, `tables?`, `figures?`, `lists?`, `steps?`, `quotes?`, `quotations?`, `phrases?`, `titles?`, `captions?`, `clauses?`;
   - a part-of-section word: `first`, `last`, `opening`, `intro`, `introduction`, `conclusion`, `summary`, `overview`, `start`, `end`, `beginning`.

   Missing a real cap is the accepted cost: "Section 242: a summary of the work, at most 40 lines" gives no cap. After this check, split the segment into clauses on a comma followed by whitespace; clauses matter only for the `and` / `,` chain in rule 6.
5. **Cap numbers.** A number is `(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)(?!\d)` followed by `\s*(words?|lines?)\b`. Strip commas; values of 0 or over 9999 are ignored. A unit followed by `of` (for example "40 lines of code") is never a cap.
   - **Ambiguous numbers are never caps.** Before cap matching, find every decimal (`\d+\.\d+`) and every period- or space-grouped digit run (`\d{1,3}(?:[. ]\d{3})+`). No part of such a run is a cap number: "2.5 lines" is not a 5-line cap, and "1.500 words" and "1 500 words" are not 500-word caps. Comma grouping ("1,500") stays the one accepted thousands form.
   - This applies to cap numbers only. Section detection (rule 3) and the Build Order run (rule 1) read the text as before. So "Section 242 300 words max" names section 242 but yields no cap, which is the conservative direction.
6. **Which numbers count.** A number counts as a maximum only when one of these holds:
   - it directly follows an upper-bound cue, allowing only an optional `a total of` or `of` in between;
   - its unit is directly followed by a trailing cue (`max(imum)?`, `or (less|fewer)`, `at most`);
   - it directly follows `and` or `,` after a number that already counted.

   The upper-bound cues are `max(imum)?`, `at most`, `no more than`, `up to`, `not (to )?exceed`, `limit(ed)? (to|of)`, `cap(ped)? at`, `under`, `within`, `below`, `≤` and `<=`.
7. **Negation.** `not` or `never` directly before `under`, `below`, `within` or `less than` makes that phrase a lower bound. A number governed by a lower-bound cue is ignored. The lower-bound cues are `at least`, `min(imum)?`, `no fewer than`, `no less than`, `more than`, `over`, `≥`, `>=`, and the negated forms above.
   - A lower-bound cue can also trail the unit. A number whose unit is directly followed by `min(imum)?`, `at least` or `or more` is governed by that cue.
   - A governed number is ignored even where rule 6 would otherwise count it, including through the `and` / `,` chain. A governed number never counted, so it does not continue a chain.
8. **Which rule is kept.** The first maximum for each unit wins. The rule's `instruction` is the trimmed segment, up to 500 characters. Keep the first 20 rules.

Golden examples:
```
"Line 246: no more than 80 lines."                         → {section:"246", maxLines:80}
"Section 244 should be at most 600 words"                  → {section:"244", maxWords:600}
"242 — max 40 lines and 300 words"                         → {section:"242", maxLines:40, maxWords:300}
"Section 242: at least 200 words, at most 300 words"       → {section:"242", maxWords:300}
"Line 244: no more than 1,500 words"                       → {section:"244", maxWords:1500}  (clipped to 700 at check time)
"Line 244: 650 words maximum."                             → {section:"244", maxWords:650}
"Build order: 246, 242, 244"                               → buildOrder ["246","242","244"]
"Build order: 246; 242; 244"                               → buildOrder ["246","242","244"]
"Build order: 246 first."                                  → buildOrder ["246"]  (resolveBuildOrder falls back to 242 → 244 → 246 with its reason)
"Build order: 246, 242, 244; line 246 max 30 lines"        → buildOrder ["246","242","244"] + {section:"246", maxLines:30}
"Section 242: at most 40 lines and 300 words minimum"      → {section:"242", maxLines:40}
"Section 242: max 40 lines and 300 words or more"          → {section:"242", maxLines:40}
```
Negative examples (no rule):
```
"Section 244: up to 3 experiments, 100 words each"
"Section 244: each experiment at most 100 words"
"Line 244: 100 words per paragraph"
"Section 244 describes work under 40 lines of code"
"Line 244: not under 200 words"
"Keep paragraphs under 120 words."
"Line 246: 2.5 lines max"
"Line 244: 1.500 words max"
"Line 244: 1 500 words max"
"Line 244: no more than 1.500 words"
"Section 242: 300 words at least"
"Section 244: each paragraph, no more than 100 words"
"Section 244: keep sentences under 25 words"
"Line 244: at most 100 words in the first paragraph"
"Section 242: opening under 50 words"
"Section 246: bullets of no more than 20 words"
"Section 242: a summary of the work, at most 40 lines"
```

**Why classify at generation, cached.** Writer Profile precedence for a document means its instructions beat House Rules wherever it legislates. PSOS-49 settles that by waiving categories before the prompt is assembled, never inside the prompt. A saved profile gets its waivers from the same classifier at save time, through the settings page's Analyze flow, and the document path reuses that classifier.
- **Cost:** a document costs one small, single-attempt call the first time a given classifier version sees it, and nothing after that. The call is recorded under AD-27 like every other slot.
- **What is recorded:** the generation stores the categories it applied, so the save offer carries them. Saving the prefill keeps the document's waivers, pre-ticked under the Analyze rule and confirmed by the writer's Save.

**Supersede.** AD-26 says the document is "applied as the profile for that generation". A differing saved profile does not merge with it. Merging would break the identical-notes guarantee and blur which settings governed.

**Deferred on purpose.** Each goes to `deferred` if still open at review:
- The Brief-rail save banner and the "no Writer Profile applied" line. Story 4 consumes `getGenerationWriterSettings`.
- Chat and the proposal-apply scrub applying a project's settings document. Chat resolves the saved profile only.
- A structured Build Order / Self-check editor on the settings page. Extraction populates both from text.

## Verification

**Commands:**
- `npx vitest run convex/lib/settingsDocument.test.ts convex/lib/settingsExtraction.test.ts convex/writerProfiles.test.ts convex/ai/writerSettings.test.ts convex/ai/instrument.test.ts convex/ai/selfCheck.test.ts convex/ai/promptProgram.test.ts convex/ai/promptScaffolds.test.ts convex/ai/styleAnalysis.test.ts tests/aiUsage.test.ts src/lib/settingsPrefill.test.ts`. Expected: all pass.
- `npx tsc --noEmit -p convex/tsconfig.json`. Expected: 0 errors.
- `bash scripts/loop-verify.sh`. Expected: every step green, including the discovery guard and the build.
- `npm run test:component`. Expected: all pass, including `src/routes/settings/writing/settingsPrefill.component.test.ts`.

**Manual checks:**
- `grep -rn 'fetchWriterStyle(' convex --include='*.ts'`: no generation entry point calls it directly; only the resolver's degrade path does.
- `grep -rn 'settingsDocumentAnalyses\|writerSettings:' convex --include='*.ts' | grep -v _generated`: inserts and patches happen only in `recordSettingsAnalysis` and `recordWriterSettings`.
- `grep -n 'from "\./ai/' convex/writerProfiles.ts` returns nothing.
- `convex/lib/lineLimits.ts` is unchanged.

## Auto Run Result

Status: done

**Summary.** AD-26 is implemented as specified. `getEffectiveWriterStyle` is still the only place tiers are computed. It accepts a detected settings document and applies it as the Writer Profile for that generation, reports each category's requested waiver (an `enforced` category writes a `not_applied` / `org_enforced` waiver row), and runs a deterministic, conservative cap and Build Order extractor on profile or document text. Caps above the Locked caps are clipped and reported as `tier: conflict`, and no Locked cap changes (Open Question 1 changes nothing). One resolver (`convex/ai/writerSettings.ts`) replaces `fetchWriterStyle` in the one-shot pipeline and iterative, classifies a document at most once per `(projectId, contentHash, classifierVersion)` under `generation:settings`, and records `generations.writerSettings`. `getGenerationWriterSettings` exposes the record and the save offer, the settings page prefills from `?fromGeneration=<id>` without saving, and `docs/product-domain.md` carries the dated four-tier amendment. This is a follow-up review pass, triggered by the prior pass's `followup_review_recommended: true`. It found three low-severity test/code-quality nits, all patched, and no `bad_spec` or `intent_gap`.

**Files changed this pass** (on top of the story's full change set, unchanged from the prior pass's summary):
- `convex/ai/writerSettings.test.ts` — the classifier-failure regex now interpolates the `FILE` constant instead of hardcoding the fixture name; the cache-write-failure test now asserts the raw error was logged, matching its two sibling `console.error` tests.
- `convex/lib/settingsDocument.ts` — `isTitleFiller`'s possessive-token check now matches Unicode letters/digits (`\p{L}\p{N}`), not just ASCII `\w`, consistent with the function's own token-extraction regex.
- `convex/lib/settingsDocument.test.ts` — a golden example ("José's PD Writing Customized Settings") pinning the Unicode possessive fix.

**Review findings (this pass).** Four review layers (blind hunter, edge-case hunter, verification-gap, intent-alignment auditor) ran in parallel against the diff since the recovery base (`dc26ed2`). Patches applied: 3, all low severity (a hardcoded test fixture name, an ASCII-only possessive regex, a missing raw-error assertion). Deferred: 0. Rejected: 16 — mostly findings already covered by an existing golden/negative example or an existing unit test, one exact repeat of a coverage ask already rejected in an earlier loop, and two factually incorrect claims (one behavior already documented and tested, one "dead code" claim contradicted by live call sites). No `bad_spec` or `intent_gap`.

**Follow-up review recommendation:** `false`. This pass patched high 0, medium 0, low 3; score 3 × 0 + 1 × 3 = 3, below the threshold of 5.

**Verification.**
- The spec's targeted vitest set: 11 files, 313 tests pass (2 more than the prior pass, from the new golden example and the new assertion).
- `npx tsc --noEmit -p convex/tsconfig.json`: 0 errors.
- `bash scripts/loop-verify.sh`: exit 0, all 9 steps, 2419 tests in 174 files, svelte-check clean, build OK, both uploader harnesses green.
- `npm run test:component`: 78 files, 587 tests pass (unchanged — no component test was touched this pass).
- Manual checks: only the resolver's degrade path calls `fetchWriterStyle`; only `recordSettingsAnalysis` and `recordWriterSettings` write the new records; `convex/writerProfiles.ts` imports nothing from `./ai/`; `convex/lib/lineLimits.ts` is unchanged.

**Residual risks** (carried from the prior pass; none of this pass's findings changed them):
- The extractor is deliberately conservative: some real caps and Build Orders (for example "Build order is: …", "per section", heading-structured documents) are not extracted, and nothing reports what was extracted.
- The classifier's worst-case latency rests on the documented per-slot provider bound (`convex/ai/providers.ts`), not a shorter per-call timeout.
- Iterative applies a document's flavor and waivers only, not its Build Order and caps; the offer is visible to every internal project member (D1).
- Open Question 1 (Section 246 settings document) has not landed; Section 246's caps stay Locked regardless.

