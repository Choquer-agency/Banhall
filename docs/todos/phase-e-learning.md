# Phase E: writer memory and learning (plan, 2026-10-26, revised after review)

Part of `docs/todos/context-pipeline-mvp-push.md` (E1 to E3), under parts 5 and 6 of the first "2026-10-26" entry in `docs/product-domain.md`. That entry is the approved scope and privacy contract the 2026-08-17 learning amendment asked for. No workflow stage, transition or permission outside it is added, and no AI writes report prose: a suggestion becomes a preference only when its writer approves it.

Plan review, round 1: Claude Opus 5.5 (requested high; it reported running at low) and gpt-6-astra (medium). Round 2: Claude Opus 5.5 (requested high; it reported low). Round 3: gpt-6-astra (medium). Each said "go after changes". This version takes their changes.

## What is true today

- **Writer preferences are one free-text document per writer** (`writerProfiles.customInstructions`), edited on Writing preferences. An Admin can read and overwrite any writer's profile (`listProfiles`, `saveProfileForUser`). No AI suggests preferences.
- **Drafts freeze the requester's style** when they start (`resolveGenerationWriterSettings`, `buildStyleGuidance`: learned lessons first, the writer's text last), and Seeds read that frozen style. **Chat reads the sender's profile live** (`getProfileForGeneration`, `writerPreferencesBlock`), and sends nothing when the profile has no text. A settings document in the project's files replaces the saved profile for a draft; chat sends the profile anyway, and the settings document as a file.
- **Lesson sets** (`learningDigests`): `draft_style` and `qa_calibration`, built nightly on the `learning_digest` model, admitted per stream only across two or more writers and two or more projects (`admitStream`), published only by an Admin with a privacy confirmation (`selectDigest`). Drafting and post-QA read the published ones; chat does not.
- **Signals the lesson sets read:** section edits, chat card rewordings, chat answer votes, QA votes, blind scores, approved Brain feedback. **Not read:** Seed picks, rewordings and Feedback, reviewer decisions, review comments. Text is cleaned with `deidentify` (names on the project record) only.
- **Revoking a Brain source** erases it from search but leaves its feedback approved: new lesson sets keep reading it, and a published set drawn from it stays on.
- **Edit size** (`reportEditDistance`) is recorded at candidate selection, milestones and client publish. Chat applies and direct edits record nothing. The draft's `promptVersion` and `learningDigestIds` are on `generations`, reachable through `generationId`.
- **The release suite** (`scripts/seed-plan-eval.mjs`) makes ordinary "Release eval" projects as the user it runs as, and calls internal functions through `npx convex run` (`seedPlanEval:evalActor`). It refuses production.
- **No account deletion exists** (`convex/users.ts`).

## Order

1. **E2a. Brain withdrawal** first: small, stands alone, closes a live gap.
2. **E2b.** Seed and review signals with masked copies kept when written, chat reads the lesson set. Writer memory then reads the masked copies.
3. **E1a.** Writer memory data, the style-only check, suggestions.
4. **E1b.** The Saved preferences card, and use in drafts, Seeds and chat.
5. **E3.** Edit size by version, evaluation projects, `--compare`.

Each part: decision entry, gate, component suite, two reviewers, a live check on localhost.

## E2a. Removing a Brain source withdraws its lessons

- **The link.** A feedback item records the Brain source made from it (`brainFeedbackQueue.brainSourceId`, widened and indexed, set by `reviewFeedback`; a source that deduped into an existing one links that one, so several items can share a source). Removing a source for good (`removeSourcePermanently`, a pending or revoked source) withdraws its feedback exactly as revoking does, turns off a published set that drew on it, and moves the revision, before it clears the link.
- **A one-off pass** links older rows through `brainAuditLog`, withdraws the feedback of sources already revoked, and applies the published-set rule below, so today's gap closes too.
- **Revoking** (`revokeSource`), in the same mutation:
  - marks every linked feedback item withdrawn (`withdrawnAt`), so new lesson sets skip it;
  - turns off the published `draft_style` set when it admitted any of them (`admission.streams[].signalIds`). A set with no admission record, including the frozen legacy set, counts as drawn from every approved feedback item up to its `feedbackCutoff`, by the same time the build uses (the approval's audit time, else the item's creation);
  - records the turn-off as a `learningDigestSelections` row with no set and reason `source_withdrawn`; the Admin reviews page says why.
- **Fences.**
  - `saveDigest` re-checks, when a build saves its candidate, that none of the feedback it admitted was withdrawn meanwhile, and discards it if so.
  - `selectDigest` refuses to publish, or roll back to, a set that admitted withdrawn feedback, by the same rule.
  - A withdrawal moves a learning revision. Each candidate records the revision it was built at, and both freshness checks (`canDistill` and `saveDigest`'s dedupe) compare the cutoff and the revision together, so a rebuild with an earlier cutoff after a withdrawal is built and saved.
- **Drafts already running keep the set they froze.** New drafts get no set until an Admin publishes one.
- **Tests:** revoke turns the published set off; a legacy set by its cutoff; revoke during a build (the candidate is discarded); publish and roll back after a revoke are refused; the next build is saved without new feedback; the one-off pass withdraws an already revoked source's feedback.

## E1a. Writer memory: data, the style-only check, suggestions

### Data

- **`writerMemories`,** one row per preference: `userId`, `text` (at most 160 characters), `state` (`suggested`, `on`, `off`, `dismissed`), `origin` (`suggested` or `written`), `textKey` (a fingerprint of the folded text), `support` (how many of the writer's own signals backed a suggestion), `createdAt`, `decidedAt`, `updatedAt`. Indexes `by_userId_and_state`, `by_userId_and_textKey`.
- **No project, company or draft id on a row.** Erasing a project leaves its writer's approved preferences, which the check below keeps free of project facts.
- **Dismissed:** the text is kept, visible to nobody, for 90 days, only so a reworded copy is not suggested again; then it is cleared and only `textKey` stays. **Deleted:** the row goes at once.
- **A suggestion keeps its whole request while it is open:** the masked texts of every signal its request carried, not only the cited ones, with each signal's reference and project, in a side table (`writerMemorySources`, at most 12,000 characters per suggestion, in `PROJECT_SCOPED_TABLES`). Approval and every edit re-run the request checks against these texts; a decision deletes them. When any of its projects is erased, the suggestion is withdrawn with them.
- **Limits:** at most 30 approved (on or off) and 5 open suggestions per writer.
- **Access:** only its writer reads or changes a row. No Admin or Manager path, unlike the profile. `listProfiles`, `saveProfileForUser`, the Inputs band and every draft diagnostic never return a preference's text.
- **No account deletion exists**, so the page gets "Delete all saved preferences". Offboarding a writer has no deletion step today; the decision entry records the gap.

### The style-only check (`checkPreferenceText`)

Runs on every path that saves text: a suggestion, a writer's edit of a suggestion, its approval, a written preference, and an edit of an approved one. It refuses (and logs why, never the text) a preference that:

- **holds a placeholder-shaped token**, whatever the map (`[CLIENT_1]`, `PERSON_2`, an unknown `[CLIENT_999]`), by its own pattern, not `containsPlaceholderToken`;
- **holds an email, a web address or a phone-shaped number,** by its own patterns;
- **holds a number** other than one directly before a style unit (words, sentences, paragraphs, bullets, lines, characters, pages) or a Line number (242, 244, 246), so "Keeps sentences under 25 words" and "Keeps Line 244 short" stand and a year, amount, percentage or measure does not;
- **holds a capitalized word that is not the first word of a sentence, or a letter-and-number code** ("HydroFlex", "XR-200"), apart from a list of style words: Line, CRA, SR&ED, I, the names of languages and spellings (English, French, Canadian, British, American, Oxford);
- **quotes more than three words**, or quotes anything with a capital or a digit;
- **holds a name** from the firm's companies (current and former names), the firm's own names, and, for a suggestion, every project and every text in its request (project record, placeholder map, interview names);
- **for a suggestion, holds a word that its request's texts capitalize in the middle of a sentence and never write in lowercase** (the first word of a sentence, line, bullet, heading or quote does not count);
- **for a suggestion, holds a word of five or more letters from its request's texts that is neither in the app's own vocabulary** (its prompts, House Rules and plain-language rules) **nor in the texts of three or more companies in the request**, which catches lowercase project terms ("the flotation trials");
- **matches a preference the writer has or dismissed** (`textKey`, and the dismissed text while it is kept).

A test runs the check over a set of realistic style preferences (none may be refused) and of preferences carrying a company fact (each must be refused).

Every new or changed text that passes, a suggestion, a written preference or an edit, also gets a second, separate check: one short request asks the `learning_digest` model whether the text is only about how to write and names no company, product, project, person, place or fact ("Always say the pilot failed" is a fact). Anything but "style only" is refused. The answer is bound to the exact text saved (`checkedTextKey`), so a later edit is checked again. Tests cover lowercase facts with no name or digit.

### Suggestions

- **When.** A nightly job, for writers with new signals since their last run. A Seed sign-off asks for a run 10 minutes later, at most one a day. A per-writer lease (`writerMemoryRuns`) keeps two runs for one writer from overlapping.
- **What it reads, only the writer's own, newest first, at most 40 signals and 12,000 characters:**
  - Seed rewordings (the Seed's words and the edit, `seedSelections.editedBullets`, `editedBy`);
  - Seed picks and rejections (`select`, `deselect`, `skip`), as counts by the Seed's tag ("chose the conservative version 12 of 20 times");
  - Seed Feedback (`seedFeedbackRequests.instruction`, through the `feedbackRequested` event's `actorUserId`);
  - chat card rewordings (`proposalWordingEditEvents`) and the messages they typed in chat (`chatTurns.userId`, their prompt message);
  - section edits (`sectionEditEvents`, draft against approved text);
  - their approved preferences and profile text, so nothing is suggested twice.
- **New indexes** for these reads: `sectionEditEvents` by user and time, `seedSelections` by `editedBy` and `editedAt`, `seedDecisionEvents` by actor, kind and time, `chatTurns` by user and time.
- **Masking.** It reads the masked copies E2b keeps (its draft's frozen placeholder map, else its project's map, then the project record). This masks the names the app knows; other names can remain, which is why the check reads every text in the request. Chat messages and chat card rewordings are masked when read, a few per run.
- **The answer:** at most 3 suggestions, each citing the numbers of the signals that back it; a suggestion needs two or more different signals.
- **Fences:** the run saves nothing for a writer who is no longer active, and drops a suggestion whose signals' projects were erased meanwhile.
- **Evaluation projects** (E3) are never read.

## E1b. Writing preferences page, and use in drafts, Seeds and chat

### The page

- **A "Saved preferences" card** above the free-text editor:
  - suggestions first, each with Approve, Edit and Dismiss, and "From N of your edits";
  - approved preferences below, each with an on or off switch, Edit and Delete;
  - "Add a preference", and "Delete all saved preferences".
  - One line: "Drafts already made keep the preferences they used."
- The existing settings card pattern, bits-ui switch, design tokens, weight at most 500. Copy handles one ("1 saved preference used"). Names stay "Writer Profile", "Writing preferences" and "Saved preferences".

### Use

- **Which writer's:** the same writer whose profile applies today: the draft's requester for drafts and Seeds, the sender for chat.
- **Their own field, end to end.** Saved preferences are never mixed into the stored profile text, so settings-document matching (`writerSettings.ts`, `chatEvidence.ts`) is unchanged. `getProfileForGeneration` returns them beside the profile, so a writer with saved preferences and no profile text, or no profile row (which counts as on), still gets them. The degrade path carries them too.
- **Every reader of the writer's style gets them.** The profile text (`writerFlavor`) also drives first-person detection (`orderedGeneration.ts`, `postQa.ts`), wording-rule extraction, the Self-check's verdicts on the writer's settings, and QA's writer instructions. Each of these reads the profile text and the saved preferences together, so QA never flags a preference the writer approved. The settings-document match alone reads only the profile text.
- **Placement:** after the writer's own preferences text, in the order they were approved, in the same block of drafts' style guidance and chat's system text.
- **When they apply:** with the profile. Not when the profile is switched off (`enabled: false`). For drafts, not when a settings document replaces the profile (both are the writer's saved style). For chat, whenever chat sends the profile, as it does today with a settings document present. The decision entry states the difference.
- **Drafts freeze them,** text included, as their own field of the frozen style, with their ids and a fingerprint; Seeds, post-QA and retries read the frozen copy. The Brief's Inputs band says "3 saved preferences used" (a count, never the text).
- **No byte changes for a writer with no approved preference:** pinned requests for drafts, Seeds and chat stay byte for byte.
- **Copies:** a draft keeps the preferences it used in its frozen style, as it keeps the profile text, until the draft or its project is erased. No AI usage row stores prompt text.

## E2b. Learning from Step-by-step choices and reviews

- **New `draft_style` streams, each admitted on its own** (two or more writers and two or more projects in that stream; another stream's writers never count):
  - Seed rewordings, one per Seed per writer (the last edit);
  - Seed Feedback, one per request;
  - Seed choices (`select`, `deselect`, `skip`), counted by tag, and requests for new ideas;
  - reviewer returns, one per decision, with the note (approvals are counted);
  - review comments from internal reviewers, one per comment, with the text they were about when there is one. Client comments are left out: a client's words are client data (recorded as a narrowing of part 6).
- **Each signal names its actor** (the editor, the requester, the reviewer, the commenter), and is read within the build's window, newest first, at most 200 per stream, within a character budget per stream in the lesson-set prompt.
- **Masked copies kept when written,** as chat answer votes keep theirs (`snapshotReason`), in new fields or a signal table; the originals (Seed edits, review decisions, comments) are never changed. With the draft's frozen map when there is one, else the project's map, then the project record. Reviews and comments are rare, so building a project's map there is affordable; Seed and section signals read the draft's frozen map (one row). A one-off pass makes copies for older rows; a row whose project is gone is left out. Builds never build maps.
- **Chat reads the published `draft_style` set,** in its system text, in drafting's order and wording (`STYLE_GUIDANCE_SCAFFOLDS.learned` with its waiver clause first, the writer's text last), at most 10 rules. It changes only when a set is published, turned off or withdrawn. Each chat turn records the set it used (`chatTurns.learningDigestId`). `qa_calibration` stays out of chat: it calibrates QA findings, not writing. Pinned chat requests: with no set published (unchanged bytes) and with one.
- **Evaluation projects** are left out of every stream, including chat card rewordings (by project).
- **The digest history** stops saying "Seed-workflow generations are not included."

## E3. Proof

- **Edit size by version.**
  - The health view reads `promptVersion` and `learningDigestIds` through `generationId`; nothing is copied. Saved preferences used are added to the frozen style (E1b), so the view can split by them too.
  - New rows from chat applies and from direct edits (`reportEditDistance.trigger` widened with `chat_apply` and `edit`), each naming who edited (`editorUserId`; `writerUserId` stays the project owner). A chat apply carries the lesson set its chat turn used. Autosave never reads `reportEditDistance`: the first save of a burst writes a row in a small table keyed by report (`reportEditSizeDue`, not the report row) and schedules a recording 10 minutes later, which records the size of the report's latest revision if that revision has none. The last save of a burst is always recorded. Deduplicated by report and revision.
  - **Reading the contract:** part 6 says "each report edit's size is recorded". It is recorded per editing burst and at its end, not after every autosave. The decision entry asks the owner to confirm.
  - The Admin learning health view averages one reading per report per version, the latest, with counts, over the last 90 days.
- **Evaluation projects.** The release suite marks its projects as evaluation projects through an internal mutation (`projects.evaluation`, widened), refused on production as the script is. They are left out of learning, writer memory, edit size and Brain nomination.
- **`--compare lessons` and `--compare preferences`,** run separately. Each fixture runs twice on the same inputs and models, each arm on its own evaluation project: once as usual, once with the change. The change is set through an internal mutation, only on evaluation projects (no public option, no new permission), and a lesson set that admitted withdrawn feedback is refused:
  - lessons: a given lesson set (any saved candidate, published or not) against none; the report names the set;
  - preferences: the fixture's own list of preferences against none, never stored on the user's account; one fixture also has a settings document.
- **Not in this phase:** the blind test against Claude Projects (needs the owner's past cases and a judge).

## Decisions taken in this plan (for the owner)

- Saved preferences follow the profile: off when it is switched off, replaced with it by a settings document in drafts; chat keeps sending them with the profile.
- No Admin or Manager access to saved preferences, unlike the profile. Members see a count on the Inputs band.
- A number may stand only before a style unit.
- Edit size is recorded per editing burst and at its end, not after every autosave.
- Chat card rejections are not a learning signal; `qa_calibration` does not reach chat.
- Dismissed suggestion text is kept privately for 90 days so it is not suggested again.
