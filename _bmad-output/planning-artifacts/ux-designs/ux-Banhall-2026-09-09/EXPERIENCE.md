---
name: Banhall PD generation
status: final
created: 2026-09-09
updated: 2026-09-09
sources:
  - ../../prds/prd-Banhall-2026-09-09/prd.md
  - ../../../specs/spec-pd-generation/SPEC.md
  - ../../../specs/spec-pd-generation/user-journeys.md
  - ../../../specs/spec-pd-generation/glossary.md
---

# Banhall PD generation — Experience Spine

## Foundation

Desktop-first responsive web. SvelteKit 2 with Svelte 5 runes, Tailwind, bits-ui/shadcn-svelte primitives and the internal Ledger Paper system; `DESIGN.md` is the visual identity reference and names the token delta. Nothing here is a new route; the containers already exist. Vocabulary is the spec glossary, verbatim. Behavioural delta only; where the existing component already does it, this spine says so and stops.

| Container | File | This work adds |
|---|---|---|
| Report workspace | `src/lib/components/project/CurrentProjectPage.svelte` | A third `railView` value in the right-docked resizable rail |
| Editor | `src/lib/components/editor/Editor.svelte` | A Compliance line under each section-end marker |
| QA rail | `qa/QARailPanel.svelte` → `editor/QAScorePanel.svelte` | A Compliance section per drafted section |
| Generation progress | `generation/GenerationProgress.svelte` | Sections in Build Order with states; Stop after this section |
| Chat panel | `chat/AgentChatPanel.svelte` → `AssistantTurn.svelte` → `ProposedEditCard.svelte` | Inventory checklist artifact; Completion Report rows; missing-facts reply; Reference PD Suggestion |
| New project page | `src/routes/project/new/+page.svelte` (`CONTEXT_CATEGORIES` rows) | Storyline slot; reference-pd-mark on Previous PD |
| Writer settings | `src/routes/settings/writing` | Prefill target of "Save to your Writer Profile" |

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Storyline slot | New project page, context section, beside Writer's Notes | Optional writer-supplied Storyline; empty means the system derives one |
| Brief rail view | Report workspace rail toggle "Brief"; default view while generating | Inputs (context inclusion, profile status, settings offer) and the four Brief groups; edit or leave |
| Storyline question | Top of the Brief rail, when raised | Choose between the Storyline claim and a section's stronger evidence |
| Generation progress | Report workspace while generating | Sections arriving in Build Order, ungated; stop after any section |
| Compliance line | End of each section in the Editor | Applied / not applied per instruction, reasons, expandable |
| Compliance section | QA rail, after per-section scores | The same notes, all sections at once |
| Deviation Inventory | Chat, on request ("list the deviations") | Every paragraph against the profile, plus the writer's own corrections; one action |
| Coordinated Revision | Chat, after the Inventory action or a typed list | One Proposal with a Completion Report per item; existing apply flow |
| Reference PD compare | Chat Suggestion when a Reference PD is marked | Differences as an Inventory offered as a Coordinated Revision |
| Missing facts reply | Chat, when the writer asks how to improve or converge | Concrete Proposal, or the facts the draft lacks as client questions; never a document request |
| Admin comparisons *(spine-only)* | `/admin/comparisons` `[ASSUMPTION: admin route]` | Record Paired Comparison results; table of records |

→ Composition references: `mockups/key-report-workspace-brief-rail.html` (Brief rail view, generation progress, Storyline question), `mockups/key-editor-compliance-line.html` (Compliance line), `mockups/key-chat-coordinated-revision.html` (Coordinated Revision, Missing facts reply). Spine wins on conflict. Spine-only surfaces: Storyline slot, Compliance section, Deviation Inventory, Reference PD compare, Admin comparisons.

Modal depth: none added. The Brief never opens as a dialog. Below `lg` the rail is the existing sheet.

## Voice and Tone

Microcopy. Counts and verbs; name the rule or the fact; the tool proposes, the writer decides.

| Do | Don't |
|---|---|
| "Compliance · 5 applied · 1 not applied" | "Compliance check passed ✓" |
| "Not applied — Locked Rule: CRA line limit for 246 (50 lines). Applied up to the limit." | "Sorry, we couldn't apply your instruction." |
| "Blocked — the transcript does not give the date of the second trial. Ask the client." | "Unable to complete this item." |
| "Conflicting — would exceed the 244 word cap (700). Alternative: move the yield table to 246." | "This change is not allowed." |
| "Checked 6 rules, repaired 1." | "AI has verified this section!" |
| "Nothing deviates from your settings." | "Great job, no issues found!" |
| "12 of 14 documents in context · cap 12" | "Some documents were skipped." |
| "Your customized settings were found in Writer's Notes. Save to your Writer Profile?" | "We detected a settings file. Would you like to import it now?" |
| "Use the section's evidence" / "Keep the Storyline" | "Accept" / "Reject" |
| "No Writer Profile applied — House Rules in full." | "Profile disabled." |

Never "AI", never an exclamation mark, never "successfully". The Storyline question is a question, not an alert.

## Component Patterns

Behavioural. Visual specs in `DESIGN.md.Components`.

| Component | Where | Behavioural rules |
|---|---|---|
| brief-rail | Report workspace rail | Third `railView` value `brief`. While `isGenerating` it is the rail's default view and fills in as the Brief derives; afterwards the rail remembers the writer's last choice. Groups are Disclosures; Inputs and Storyline open by default, the rest closed `[ASSUMPTION: default open state]`. Editing any entry reveals "Regenerate with this Brief"; leaving the rail untouched changes nothing. When inputs change (a Transcript added or removed) the Brief re-derives and each group header shows "N added · N removed" with the changed rows marked; unchanged inputs reuse the stored Brief and show nothing. Never blocks generation, apply, or navigation. |
| brief-entry | Brief groups | Click or Enter on the text opens inline edit; blur or Cmd/Ctrl+Enter saves; Esc reverts. A saved edit flips the origin-chip to *edited* and is recorded with its magnitude. A Claim Exclusion row always shows its eligibility reason chip; editing the text does not clear the reason. The source-chip opens the passage in a popover; it never navigates away from the report. |
| origin-chip | Every brief-entry, the Storyline group header | Read-only. *writer* when supplied on the New project page or typed into an empty Storyline; *derived* by default; *edited* after any save. |
| source-chip | Brief entries, Storyline question, Inventory rows | Existing Source primitive. Click opens the cited passage (Transcript or Supporting Document) in a popover with the passage highlighted; Esc closes; focus returns to the chip. Entries from a condensed digest show "digest" in the chip. |
| storyline-question | Top of the Brief | Appears when a Self-check finds section evidence stronger than the Storyline's basis. Both sides cite sources. "Use the section's evidence" rewrites the Storyline claim (origin becomes *edited*) and offers "Regenerate with this Brief"; "Keep the Storyline" dismisses and records the choice. Generation continues in either case; the question never pauses drafting. `aria-live="polite"` announces its arrival. |
| generation-section-row | GenerationProgress | Sections listed in Build Order (profile) or 242 → 244 → 246. States queued · drafting · checking · shown; a section becomes readable in the Editor at *shown*. "Stop after this section" finishes the current section, runs no further ones, and leaves the Brief and Compliance lines as generated for the sections already shown. No approve step; `IterativeStepper` is untouched for iterative mode. |
| compliance-line | Editor, under each section-end marker | Collapsed by default. Toggle by click or Enter/Space on the line. Expanded well lists every relevant profile instruction with a status pill — status-pill-applied, or for *not applied* the pill chosen by tier (missing fact → status-pill-blocked; Locked Rule, org-enforced, conflict → status-pill-conflicting) — and the reason naming the tier: Locked Rule · org-enforced · conflict · missing fact. A section with no relevant instruction shows one line, "Compliance · no profile instructions for this section", not expandable. Instruction rows are not editable here. Line count and word count stay on the marker above; the line never restyles prose. |
| compliance-section | QAScorePanel | Same rows as the expanded compliance-line, one band per section, rendered after the per-section score breakdown and before flags. Clicking a row scrolls the Editor to that section end (`locateSectionParagraph`). |
| inclusion-row | Brief Inputs band | One row per attached document, status included · condensed · not included, listed in attachment order (the trust-order display is v1.1 per the PRD). The band header shows the count and the cap. Clicking a document opens it in FilesPanel behaviour (existing). A document *not included* is never described as used anywhere else on the surface. |
| save-settings-banner | Brief Inputs band | Shown when a settings document is detected in Writer's Notes or an attachment and no matching profile exists. "Save to your Writer Profile" opens the existing settings page with the text prefilled; dismiss hides it for this project. Never a modal; never blocks. |
| storyline-slot | New project page | A CategoryRow beside Writer's Notes, weight Highest. Optional; empty is normal. Its text seeds the Brief with origin *writer*. Character limit shared with Writer's Notes `[ASSUMPTION]`. |
| inventory-checklist | Chat artifact | Produced on request. Every paragraph of the draft appears exactly once: paragraphs with a Deviation are rows in the Rule group (locator, the profile rule, the Deviation) built from stored Compliance Notes; paragraphs that match are collapsed under one Disclosure, "N paragraphs match your settings", each listed with its rule when opened. Content rows are added by the writer via "Add a correction" (locator picker + free text). Deviation and Content rows are checked by default; unchecking removes an item from the action. "Bring all N into alignment" counts checked rows only and sends one request that yields one Coordinated Revision. The Reference PD compare produces the same artifact with a "Reference" group instead of "Rule". |
| completion-row | Coordinated Revision card | N rows, one per item, above the diff; status resolved · blocked · conflicting with the reason. Blocked names the missing fact and its source; conflicting quotes the Locked Rule and offers the alternative as text. Rows are read-only. The card's existing actions (Replace, Review one by one, Reject, Edit wording, Show in doc) are unchanged; apply remains human. |
| status-pill-resolved | completion-row | Text "resolved" always present; tooltip carries the full reason when the row is truncated. |
| status-pill-blocked | completion-row, compliance-line (missing fact) | Text "blocked" or "not applied" always present; the row names the missing fact. |
| status-pill-conflicting | completion-row, compliance-line (Locked Rule, org-enforced, conflict) | Text "conflicting" or "not applied" always present; the row quotes the rule. |
| status-pill-applied | compliance-line | Text "applied"; no tooltip needed; rows are quiet. |
| missing-facts-reply | Chat | When the writer asks how to improve or converge, the reply is either a Proposal (existing card) or this: the facts the draft lacks, each as a question for the client, drawn from unresolved Confidence Map entries. "Copy questions for the client" copies the list as plain text. The reply never asks the writer for a Storyline, Claim Exclusions, a Confidence Map or Glossary Terms. |
| reference-pd-mark | New project page, FilesPanel | Checkbox on a Previous PD row; at most one document per project is marked; marking a second unmarks the first with a one-line notice. When marked, chat shows the Suggestion "Compare to my reference PD"; the result is an inventory-checklist with a "Reference" group offered as a Coordinated Revision. Differences that would breach a Locked Rule appear as conflicting rows. |
| comparisons-form *(spine-only)* | `/admin/comparisons` | Admin only. Record saves one comparison; required fields are enforced inline; the development flag defaults off; the table lists records newest first and computes SM-1 and SM-2 excluding development projects. No editing of a saved record; a wrong record is re-entered and the old one marked void `[ASSUMPTION]`. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Generating | Report workspace | Rail defaults to Brief; Inputs band populates first, then Storyline (a writer-supplied Storyline shows immediately), then the other groups as derived; progress rows move queued → drafting → checking → shown. |
| Brief with nothing derived | Brief rail | Transcript text empty or unreadable: groups show "Nothing to derive yet — add a transcript" in body, ink-muted; Inputs band still lists documents with their statuses. |
| No Writer Profile | Brief Inputs, Compliance line | Inputs shows "No Writer Profile applied — House Rules in full."; Compliance lines show only Locked Rules and House Rules outcomes. |
| Settings document detected | Brief Inputs | save-settings-banner. |
| Over budget | Brief Inputs | Rows marked condensed / not included; header shows "N of M documents in context · cap N"; Confidence Map entries from a digest carry "digest" on their source-chip. |
| Storyline question pending | Brief rail | Callout at top; a count pill on the rail toggle ("Brief · 1") `[ASSUMPTION: toggle badge]`. Drafting continues. |
| Stopped after a section | Generation progress, Editor | Remaining rows read "not generated"; Compliance lines exist only for shown sections; "Generate the rest" secondary action `[ASSUMPTION]`. |
| Zero Deviations | Chat | Inventory renders one line: "Nothing deviates from your settings." and the Content group with "Add a correction". |
| Blocked-only Completion Report | Chat | The card has no diff; rows list each blocked item and its missing fact; a single "Copy questions for the client" ghost action `[ASSUMPTION]`. |
| Stale proposal | Chat | Existing ProposedEditCard `stale` state; unchanged. |
| Inputs changed since the last Brief | Brief rail | Group headers show "N added · N removed"; changed rows carry added/removed markers; "Regenerate with this Brief" is not shown (the re-derivation already ran). |
| No profile instructions for a section | Compliance line | "Compliance · no profile instructions for this section"; not expandable; the QA rail band for that section says the same. |
| Reference PD marked | New project page, FilesPanel, Chat | Row shows the "reference" chip; chat shows the Suggestion. Unmarked: no Suggestion, and a typed request to compare answers with "Mark a Previous PD as your reference first." |
| Missing facts | Chat | missing-facts-reply with 1–N questions; zero missing facts yields a Proposal instead, never an empty list. |
| Comparisons table empty | `/admin/comparisons` | "No comparisons recorded." above the form; SM lines read "—". |
| Rail below `lg` | Report workspace | Existing sheet behaviour; the Brief view is reachable through the same toggle. |

## Interaction Primitives

- **Disclosure everywhere.** Brief groups, the compliance-line, compliance-section bands: bits-ui Disclosure; Enter/Space toggles; chevron mirrors state.
- **Inline edit.** Brief entries: click/Enter to edit, blur or Cmd/Ctrl+Enter to save, Esc to revert. No edit/view mode toggle for the rail.
- **Rail resize.** Existing `role="slider"` divider with arrow keys; minimum width holds the Brief legible.
- **Live regions.** `aria-live="polite"`: "Section 244 is ready", "Storyline question raised", "Coordinated Revision ready — 16 items". Never assertive.
- **One primary action per surface.** "Bring all N into alignment" (Inventory), "Regenerate with this Brief" (rail, after an edit), "Use the section's evidence" (question).
- **Banned:** modals for the Brief; any gate before the first section is shown; colour-only status; hover-only affordances for edit; drag anywhere; auto-apply of any Proposal.

## Accessibility Floor

Behavioural; contrast pairs live in `DESIGN.md.Colors` (all lagoon-meaning text uses `{colors.primary-selected}` on white; blocked uses the existing AA `[GAP:]` pair).

- WCAG 2.2 AA on every surface here; 44px targets for rail toggles, disclosure headers, checklist rows and banner buttons.
- Every status pill and origin-chip carries its word; screen readers read "resolved", never a colour.
- The rail is a landmark (`aside` with `aria-label="Brief"`); groups are headings so a reader can jump between Inputs, Storyline, Claim Exclusions, Confidence Map, Glossary Terms.
- Source popovers trap focus and return it to the chip on close.
- The compliance-line is a button with `aria-expanded`; the expanded well is `aria-controls` linked.
- Generation progress rows announce state changes politely; nothing steals focus while a writer is editing prose.

## Responsive & Platform

| Breakpoint | Behaviour |
|---|---|
| `≥ lg` | Editor plus right rail (chat / qa / brief). Compliance lines full column width. |
| `< lg` | Rail becomes the existing sheet; the Brief view is one of its tabs. Chat cards stack; completion-rows wrap reason under locator. |
| Print / export | Compliance lines, Brief and chat artifacts never print; the DOCX export is prose only (existing). |

## Inspiration & Anti-patterns

- **Lifted from Sudowrite's Story Bible:** a persistent, editable reference that governs generation — the Brief is that, kept beside the draft, never a form to fill first.
- **Lifted from the existing QA rail:** structured findings beside the report, expandable rows, no prose decoration. Compliance lines extend this register to the section end.
- **Improved on ChatGPT canvas per-suggestion accept:** the Completion Report accounts for every item in one card before the writer applies; nothing silently drops.
- **Rejected — Copilot's Keep / Discard / Regenerate as the compliance model:** it hides *why*; a Compliance line always names the rule and the tier.
- **Rejected for the default — gating on Brief approval:** a required checkpoint before the first section is the interruption the PRD forbids (SM-C4); the gated path stays `iterative`. An optional per-writer gate is PRD Open Question 5 and is not designed here.
- **Rejected — inline compliance in the prose** (highlights, margin badges): the report column is the writer's reading surface; findings live beside it.
- **Rejected — numeric self-scores as the headline:** the QA gauge remains for QA; Brief and Compliance surfaces show counts and rules, never a grade.

## Key Flows

### UJ-1 — Larry, first draft for a 1300-hour project
1. New project page: Larry drops the Transcript, types the title, attaches two spreadsheets, and pastes his own storyline into the Storyline slot beside Writer's Notes. Picks Sol. Generates.
2. The report workspace opens with the rail on Brief. Inputs shows "3 of 3 documents in context · cap 12" and his profile as applied. The Storyline group shows his text with the *writer* chip immediately.
3. Claim Exclusions, Confidence Map and Glossary Terms fill in with source-chips. He opens Glossary Terms, clicks one term, edits it, saves; "Regenerate with this Brief" appears — he leaves it.
4. Generation progress lists 242 → 244 → 246 in his Build Order; 242 turns *shown* and appears in the Editor with "Compliance · 5 applied · 0 not applied" beneath it.
5. **Climax:** 246 arrives with "Compliance · 4 applied · 1 not applied". He expands it: "Not applied — Locked Rule: CRA line limit for 246 (50 lines). Applied up to the limit." One vocabulary end to end; zero writer-authored documents.
- Failure: the Transcript exceeds the budget. Inputs shows the Transcript as *condensed*; Confidence Map entries from the digest carry "digest" chips; the draft still arrives.

### UJ-2 — Larry, sixteen Deviations in one pass
1. In chat he asks for the deviations. An Inventory checklist arrives: 14 Deviation rows in the Rule group, each "244 ¶3 — paragraph rule: open with the uncertainty", and "9 paragraphs match your settings" collapsed beneath.
2. He clicks "Add a correction" twice, picks the paragraphs, types the two content fixes. 16 rows, all checked.
3. He presses "Bring all 16 into alignment".
4. One Coordinated Revision card returns: 16 completion-rows above the diff — 14 resolved, 1 blocked ("the transcript does not give the date of the second trial. Ask the client."), 1 conflicting ("would exceed the 244 word cap (700). Alternative: move the yield table to 246.").
5. **Climax:** every item is accounted for in one card. He presses Replace; the existing apply flow runs; the second draft is materially closer to his Reference PD.
- Failure / edge: he asks "how can I help you converge?" — the reply lists the two missing facts as client questions, never a request for a document.

### UJ-3 — Tracy, three Transcripts, no Writer Profile
1. She drops three Transcripts and generates without a Storyline.
2. The Brief derives one Storyline across the three; the Confidence Map lists the points where the interviews disagree, each with three source-chips.
3. Inputs shows "No Writer Profile applied — House Rules in full."
4. **Climax:** a coherent draft from three voices with the disagreements visible in the rail instead of averaged away; she edits in the Editor and never opens ChatGPT.
- Failure: one Transcript is unreadable — its inclusion-row reads *not included* with the existing could-not-read status; the Brief derives from the other two and says so.

### UJ-4 — Michael runs the Paired Comparison
1. Michael has the ChatGPT and Banhall drafts for a project; a colleague strips both to plain text.
2. Larry rates blind and counts Deviations and Corrections-to-acceptable by hand for both.
3. Michael opens `/admin/comparisons` and records project, models, judge, preference, counts and the development flag.
4. **Climax:** the table shows the set; SM-1 and SM-2 read from it, excluding development projects. No mock for this surface; it is a form and a table on the existing admin chrome.

### UJ-5 — Larry, a 150-hour project in an afternoon
1. One short Transcript, no Storyline typed, his profile.
2. The Brief derives the Storyline (*derived* chip); sections arrive in his Build Order.
3. One Inventory, one Coordinated Revision, Replace.
4. **Climax:** an acceptable PD after one Coordinated Revision, with ChatGPT unopened.
- Failure: a Storyline question is raised on 244 — the callout appears at the top of the Brief with both sides; he presses "Use the section's evidence" and "Regenerate with this Brief"; the second run reuses everything else.
