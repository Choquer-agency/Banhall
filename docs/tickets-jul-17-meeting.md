# Ticket drafts — Jul 17, 2026 meeting (Michael, Emily, Bryce, Johnny)

Paste each into futur-board. Format mirrors existing BNH tickets (Intent /
Acceptance Criteria / Phases / transcript excerpt). Items already shipped or
covered by an existing ticket are listed at the bottom for reference.

---

## 1. Excel & flexible input support (transcript optional)

**Status note: xlsx/xls/csv upload shipped Jul 19 (commit 74e219c). Remaining scope = making the transcript optional.**

### Intent
Portfolios get highly variable client input — sometimes only an Excel sheet, engineering drawings, photos, or a single email, with no interview at all. The wizard currently requires a transcript before a report can be generated. Accept spreadsheets as context (done) and allow project creation/generation with no transcript so writers aren't blocked on these edge cases.

### Acceptance Criteria
- ~~.xlsx/.xls/.csv files upload and parse into readable context~~ (shipped)
- A project can be created and a report generated with no transcript, as long as at least one context document exists
- Generation prompt degrades gracefully when no transcript is present (no empty "interview" section confusing the model)
- Image uploads (drawings/photos) accepted and stored for reference even if text extraction is not possible yet

### Phases
- [ ] Make transcript optional in the new-project wizard and generation pipeline
- [ ] Prompt handling for transcript-less generation
- [ ] Accept image uploads as stored reference files

### Transcript excerpt
> Emily: "she was finding that in trying to bypass some of the other upload requirements and just do an Excel thing, she couldn't actually generate a report… sometimes I will literally just get engineering drawings… and there's nothing else."
> Michael: "sometimes we actually might not have a transcript… I think we want to open up that flexibility."

---

## 2. Single-page upload flow (merge transcript + supporting docs steps)

### Intent
Writers upload engineering documents into the transcript field because the two-step wizard hides the supporting-document slots on the next screen. Merge both steps into one page showing every input slot at once.

### Acceptance Criteria
- Transcript and all supporting-document categories appear on one page
- Existing category structure (previous PDs, scoping notes, writer notes, background, etc.) preserved
- No behavior change to what gets sent to generation

### Phases
- [ ] Combine wizard steps into a single scrollable page
- [ ] Re-test duplicate-project flow against the merged layout

### Transcript excerpt
> Bryce: "What about just combining the two windows, and make it one long window?"
> Michael: "opening this to a singular window will help with some of these weird, different edge cases."

---

## 3. Transcript field: .docx-only + stop rendering as text log

### Intent
Transcripts come from Teams as .docx. Restrict the transcript upload to .docx (with copy-paste fallback for the rare Google Meet case), and stop converting uploaded files into a visible text blob — keep them as file chips. Prevents drawings-in-transcript-field garbage.

### Acceptance Criteria
- Transcript upload accepts .docx only; other types rejected with a pointer to supporting-doc slots
- Copy-paste transcript entry still available
- Uploaded files display as file name chips, not extracted text
- Extraction still happens under the hood for generation

### Phases
- [ ] Restrict transcript field to .docx + paste fallback
- [ ] Replace text-log rendering with file chip display

### Transcript excerpt
> Michael: "we literally manually go download transcript… it's a docx file." / "nobody's reading it. If it just stays as the file, I think that's probably fine."
> Bryce: "So why don't we just only accept docx?"

---

## 4. QA panel regenerate / rescan button

### Intent
Some projects end up with no QA panel (generation error, or project predates the feature) — e.g. Canadian Valley Growers. Add a button to (re)generate the QA panel on demand.

### Acceptance Criteria
- "Regenerate QA" button visible on the report editor when a QA panel is missing or stale
- Runs the same QA scan as generation-time; replaces prior results
- Errors surface to the user instead of failing silently

### Phases
- [ ] Backend action to run QA scan on an existing report
- [ ] Button + loading/error states in the editor

### Transcript excerpt
> Michael: "it didn't generate the QA panel, whether that was because of error or before. So just maybe like a regenerate QA panel somewhere to just recapture that."

---

## 5. Interactive QA suggestions (accept / bypass per item)

### Intent
QA self-audit currently lists findings; writers want to act on each one inline. Each suggestion gets a control: view the suggested fix, integrate it in one click, or bypass it. Builds on BNH-19 (diff view) and BNH-56 (snapshots) rather than duplicating them.

### Acceptance Criteria
- Each QA finding shows an accept/bypass control
- Accept shows the suggested change (prompt or direct edit) before applying
- Applied changes go through the existing suggestion/diff flow so they can be reviewed and reverted
- Bypassed findings are marked and don't nag again for that version

### Phases
- [ ] Per-finding suggested-fix generation
- [ ] Accept/bypass UI on the QA panel
- [ ] Wire accepted fixes through the existing suggestion apply/revert flow

### Transcript excerpt
> Emily: "checkboxes next to the suggested edits that you can either click and choose to integrate, or bypass… post-integration, it'd be nice to see the older version of the report as well."
> Michael: "if you could click that sort of suggestion, and it would give you a suggested prompt for how to fix it… okay, boom, I'm just going to integrate that."

---

## 6. Track changes since version R# (extends BNH-19)

### Intent
Word-style track changes anchored to named versions: pick a baseline ("show changes since R4") and see all edits since as strikethrough/additions; view a single person's contribution as a range (R2→R3). Depends on BNH-56 named snapshots.

### Acceptance Criteria
- User selects any prior version as the diff baseline
- Diff renders Word-style: removals struck through, additions highlighted
- Can view changes between two arbitrary versions (e.g. R2→R3 = one writer's edits)
- Works alongside the existing AI-suggestion diff toggle from BNH-19

### Phases
- [ ] Version-to-version diff computation over snapshots
- [ ] Baseline picker UI ("show changes since…")
- [ ] Range view between two versions

### Transcript excerpt
> Michael: "show all track changes since version R4… Let's say Emily did a bunch of edits and then Larry did a bunch of edits and I want to see just Emily's edits, I could go show track changes from R2 to R3."

---

## 7. Model stats page + score comments (extends BNH-15)

### Intent
Writers now see model names. Add a one-sentence comment box when scoring an output, and a per-model stats page: average score, selection rate, and an AI summary of comments (Amazon-review style) to help the team converge on a model.

### Acceptance Criteria
- Scoring UI includes an optional one-sentence comment field
- Per-model page: average score, times chosen, recent comments
- AI-generated summary of comments per model
- Accessible from the model name shown on outputs

### Phases
- [ ] Comment field on scoring, stored with the score
- [ ] Aggregate stats queries per model
- [ ] Stats page with AI comment summary

### Transcript excerpt
> Michael: "when people are scoring it, maybe we can put a text box there… like the Amazon AI summary of the comments… that's how we'll probably get that unifying, where we're all on the same page regarding a model."

---

## 8. Highlight-to-research (web search from the PD)

### Intent
Writers leave XXX blanks for facts they must research externally (e.g. standard raspberry plant height). Let them highlight text in the PD and ask the assistant to research and fill it in with web search, instead of leaving the app. Reverse direction of BNH-25 (chat→document); this is document→chat.

### Acceptance Criteria
- Highlighting text in the PD offers a "research this" action into chat
- Chat can use web search to answer and propose an insertion/replacement
- Proposed text goes through the normal suggestion approve/reject flow
- Sources shown for researched claims

### Phases
- [ ] Selection → chat action from the PD editor
- [ ] Web search tool in the chat agent
- [ ] Researched answer → suggestion flow with source display

### Transcript excerpt
> Emily: "It would be nice if I could highlight a piece of writing and get it to do the research to insert what I'm trying to say."
> Michael: "if you were to highlight and select the text in the PD version, that then becomes intractable to the chat log."

---

## 9. In-app changelog

### Intent
Non-early-adopter writers hit changed behavior with no context ("every time I try, it's not working"). Publish a changelog in-app — AI-generated summaries per deploy are fine — so anyone can see what's new and what was fixed since they last looked.

### Acceptance Criteria
- Changelog page listing dated entries (features + bug fixes)
- New-entries indicator since the user's last visit
- Low-friction authoring: generate draft entries from commit history, editable before publish

### Phases
- [ ] Changelog storage + page
- [ ] AI draft generation from commits
- [ ] Unseen-entries badge

### Transcript excerpt
> Michael: "some kind of quick summary about changelogs, even if they're AI generated… for somebody who's a non-early adopter… they can look through the different things that are added."

---

## 10. Stable/dev channel rollback

### Intent
When the latest deploy breaks, writers are dead in the water. Give them a known-good fallback. Honest constraint: single Convex prod deployment means true per-user version pinning isn't realistic — the practical shape is a staging environment where new work lands first, with prod promoted only when verified, plus fast rollback of the prod deploy.

### Acceptance Criteria
- New features verified on staging before prod promotion
- Documented one-command rollback of prod to the previous deploy
- Writers told (via changelog, ticket 9) when prod was rolled back and why

### Phases
- [ ] Staging environment + promotion workflow
- [ ] Rollback runbook
- [ ] Version indicator in-app (footer/settings)

### Transcript excerpt
> Michael: "say we have a stable version 1.1… maybe you have a writer who wants to actually generate a PD, they can roll back to 1.1 because they know that's working."

---

## 11. Public feature-request board (extends BNH-38)

### Intent
Flag submissions are private; writers can't see each other's ideas, so duplicates and silo'd frustration. Make submitted feature requests visible to all writers.

### Acceptance Criteria
- Feature-request list visible to all logged-in writers (bugs can stay private)
- Writers see existing requests before submitting (dedupe by visibility)
- Optional: writers can +1 an existing request

### Phases
- [ ] Public listing view of feature requests
- [ ] Surface existing requests in the submit flow
- [ ] +1 / me-too support

### Transcript excerpt
> Emily: "It'd be nice to have that slush section. So even if someone else has a duplicate idea, it's like, oh, someone already suggested that."
> Bryce: "we could build this out where after you submit it, everyone could see it."

---

## 12. Add OpenAI/ChatGPT models — BLOCKED

### Intent
Writers' current workflows live in ChatGPT; having GPT models selectable in-app matters for adoption and for the model comparison (ticket 7 / BNH-15). Blocked on an OpenAI API key from Lauren (Bryce emailing her).

### Acceptance Criteria
- GPT model(s) selectable in single, compare, and section-by-section modes
- Same scoring/logging as existing models

### Phases
- [ ] Obtain API key (Lauren — external)
- [ ] Provider integration in the generation pipeline
- [ ] Add to model picker

### Transcript excerpt
> Michael: "can we get ChatGPT, is there something that we need from Lauren to get ChatGPT as a model in there?"
> Bryce: "I have a couple things I'm going to email her about, so I'll do that after this call."

---

# Already covered — do not create

- **Streaming edits error (Emily)** — fixed, commit 38a8701; pushed Jul 19.
- **Larry's 29-doc stress test / 3G Marine hang** — fixed Jul 19 (commit 3727397): extraction cap, PDF parse deadline, per-file failure isolation, stuck-project recovery.
- **Excel upload** — shipped Jul 19 (commit 74e219c); remaining flexibility scope folded into ticket 1.
- **Writing-preference character limit** — removed Jul 19 (commit 0552385).
- **Writer accounts / invites** — existing BNH-50; Michael wants this prioritized now (he invites via admin account).
- **Track-changes basics** — existing BNH-19 (in progress) + BNH-56 snapshots; ticket 6 extends them.
- **Bug/feature flag selector** — existing BNH-38 (ready for review); ticket 11 extends it.
