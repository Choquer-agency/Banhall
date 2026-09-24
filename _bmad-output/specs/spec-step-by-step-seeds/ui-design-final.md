# Step-by-step seeds: final UI contract

Status: approved by the owner on 2026-09-24 and shown to clients. This document is the single source of truth for the look, layout, copy and motion of the Step-by-step flow and the report page around it. It replaces every earlier visual or interaction description in story 5-6 and in the spec. Where it conflicts with an older description, this document wins.

Source of truth for pixels: Paper file "Banhall - Web App" (https://app.paper.design/file/01KZSAT0XG2V6B477C0KAPJFEK), page **Final screens**. Screen numbers below match the board names on that page. The old page "Home variants · Colored icons" is an archive of explorations and is not a reference.

Behaviour and data rules stay where they are: PRD `prd-Banhall-2026-09-16/prd.md` (FR-1 to FR-45), `SPEC.md` (CAP-1 to CAP-19), the architecture spine and `docs/product-domain.md`. This contract only says how they look and move.

## 1. Global rules

- **Tokens.** Use the design tokens in `src/routes/layout.css` (`--color-ink`, `--color-ink-secondary`, `--color-ink-muted`, `--color-line`, `--color-line-soft`, `--color-canvas`, `--color-chrome`, `--color-primary`, `--color-primary-selected`, `--color-primary-wash`, `--color-fir`, `--color-gray-50`, `--color-gap-bg`, `--color-gap-text`). No ad-hoc hex except the fixed palettes named below.
- **Type.** Serif (`--font-serif`) for report titles, Section titles and step titles; sans for everything else; mono only for small section eyebrows in the plan ("Section 242"). Maximum weight 500.
- **Copy.** Plain hyphen is the only dash. Never use the middle dot as a separator; use commas, parentheses or spacing. Plain, specific words (dashfix and copywriting skills; `shared/humanProse.ts`).
- **Buttons.** Primary: `--color-primary-selected` fill, white text, radius 8, 36px tall. Secondary: `--color-chrome` fill, ink text, radius 8, 36px, **no border** anywhere (top bar Export and Cancel generation, Regenerate, Back to plan, Later, Keep reviewing, Review summary).
- **AI mark.** Every AI surface uses the Aurora conic mark: rounded square (radius 30% of size, min 4px), `conic-gradient(from 210deg at 50% 50%, #2FD2C4, #58BBF3, #8438FF, #E879F9, #86E3DA, #2FD2C4)` with a soft white glint (`radial-gradient(circle at 28% 22%, rgba(255,255,255,0.55) 0%, transparent 38%)`), white sparkle (the shipped `ChatIcon` path) at 60% of the size, shadow `0 2px 10px 1px #8438FF33`. Used on: Assistant toggle, Assistant header, "Ask assistant" in the selection toolbar, "Tell it what to change" in the seed menu, the sign-off modal model row, the writing pill, the reading ring. The What's new rail item uses a megaphone, not a sparkle.
- **Score bands (QA).** 80 and up green (`#16A34A` bar, chip `#DCFCE7` / `#15803D`), 60 to 79 orange (`#F59E0B` bar, chip `#FFEDD5` / `#C2410C`), below 60 red (`#DC2626` bar, chip `#FEE2E2` / `#B91C1C`). The QA score chip always shows its band colour.
- **Seed tag palette.** Conservative `#DCFCE7`/`#15803D`, Aggressive `#FEE2E2`/`#B91C1C`, High-level `#EFF6FF`/`#1447E6`, Detailed `#FAF5FF`/`#7E22CE`, Technical `#D5F3F1`/`#087A75`, Alternative angle `#FFFBEB`/`#B45309`.
- **Motion.** Opacity and transform only; everything stops under `prefers-reduced-motion`.

## 2. Shell (all screens)

- Left rail: Banhall workspace header, Home, Projects, Companies; "Other": What's new (megaphone, counter), Settings; identity at the bottom ("Jordan Ellis / Consultant, sample workspace"). Collapsed rail = icons only (1.2).
- Top bar: page icon, "Projects /" breadcrumb, project title; right side bell, then the page actions (report page: Export secondary, Send for review primary; seed stage: Cancel generation secondary).
- Panel toolbar: tabs on the left (active tab: ink text with a 2px `--color-primary-selected` underline); toggles on the right in this order: Full width (report only), divider, Details (i), Assistant (Aurora mark), QA (shield + score chip). Active toggle: 26px tile, `#E9F1EF` fill, fir icon.
- Tabs by mode: Step-by-step run shows Plan, Summary, Report, Sources (Plan and Summary get a small check when done; Summary shows "Ready" when sign-off is possible). Finished one-shot reports show Report, Sources.

## 3. Step-by-step plan (3.1, 3.2, 3.5, 3.6, 3.7)

- **Outline (left, 300px):** header "Outline" with a progress ring and "n of 13"; group labels 242 / 244 / 246; single-line rows (state icon + title only; counts faint on the right): empty ring untouched, dashed ring optional, ring with dot open, filled check approved, dashed ring with dash skipped. Active row: primary-wash fill. Footer: one full-width primary "Approve and continue" (disabled until a seed is ticked). A reopened step shows "Confirm and approve" (primary) above "Review summary" (secondary), stacked full width.
- **Step header:** mono eyebrow "Section 244" plus chips ("Select all that apply" for multiple, green "Approved" when approved); serif title; one-line purpose; helper line with an info glyph (what to do, plus that underlined words are quoted). Regenerate (secondary) at the right of the header, "Previous batch" as quiet text beside it when one exists. No per-card regenerate and no dashed "different angle" placeholder card.
- **Seed cards (two 412px columns; one column below 1024):** checkbox, one or two tag pills, one or two bullets. Quoted phrases carry a solid teal underline (exact) or dotted primary-light underline (paraphrase); hovering shows a card with the quote, "Priya, line 18" and "Open in transcript". Footer: pencil (Edit) and bubble (feedback), 28px tiles with tooltips. Selected card: `--color-primary-light` border, `#F7FCFB` fill, no "Selected" word, footer icons hidden until hover.
- **Edit:** the pencil puts the whole card in edit mode (fields, primary border); the pencil becomes a filled primary check and an outlined cross; Enter saves, Esc cancels. No word counter; past 25 words or one sentence a quiet "Long for a seed" note shows and Save still works. An edited bullet loses its underlines and shows a small revert icon ("Restore original wording").
- **Feedback menu (196px):** "REVISE THIS SEED" small caps, rows More specific, Shorter, Different angle, Plainer language, divider, Aurora mark row "Tell it what to change…". Revised seeds nest under the original on canvas background with "Withdraw feedback".
- **Tablet 1024 (3.5):** collapsed icon rail, outline 240px, one card column. **Phone 390 (3.6):** back chevron top bar, segmented Outline n/13 | Seeds switch, one column, bottom bar with a regenerate icon and "Approve and continue" (44px targets).

## 4. Summary review (3.3)

- Reading document, 760px column, no jump list; sticky Section headings.
- Section heading: mono "Section 242" eyebrow over a 24/30 serif title; no counts, no "Open in plan".
- Rows: subsection label (14px, 500) with tag pills in a 200px column; bullets with the same underline and hover-quote behaviour as the plan; hover tints the row gray-50 and shows a white pencil tile; editing matches section 3 (primary field with a wash ring, "Enter to save, Esc to cancel", "Long for a seed" note, check and cross).
- Sign-off bar (sticky bottom, 68px): green check + "Ready to sign off", amber "2 edited by hand ›" pill (jumps to the first hand edit), spacer, the model name ("Claude Fable 5.1") and, only after a regeneration, a "Version 2" chip with a tooltip; "Back to plan" secondary; "Sign off and generate PD" primary. Not ready: amber dot, "1 step still open" with a link to it, Sign off disabled.

## 5. Sign-off confirm (3.4)

- Scrim near-black fir `#041413` at 98% opacity over the summary.
- Modal 536px, radius 16, header padding 26/24/20/28: "Sign off and generate the PD?" and "We will draft sections 242, 244 and 246 from this plan. Once you sign off, the plan is locked and later changes happen in the report."
- Rows: green check "All 13 steps decided"; amber revert icon "2 seeds edited by hand" with "They are drafted as written, not quoted from the interview."; Aurora mark "Written by Claude Fable 5.1". Canvas note: "Takes about three minutes. You can leave this page; we will let you know when the draft is ready."
- Footer: "Keep reviewing" (secondary) and "Sign off and generate PD" (primary). Nothing starts until the primary button is pressed.

## 6. Writing (4.1 to 4.3)

- Tabs Plan ✓, Summary ✓, Report (active), Sources. No top-bar cancel; the pill's Stop is the only cancel.
- **Status pill** (top centre of the Report tab): Aurora mark, "Writing section 244", "55%, about 1 minute left", Stop (secondary). Progress is the 2px border filling left to right in the Aurora gradient (`#2FD2C4`, `#58BBF3`, `#8438FF`, `#E879F9`) with a small bright glint travelling to the leading edge (translateX, 1.4s) and a faint violet glow; the unfilled border is `#E1E9E7`. Driven by per-Section run status, not tokens.
- **Report:** title, then each Section with its 12px sans label ("242 Technological uncertainty") and serif question. Finished Sections: paragraphs fade in and rise 4px (300ms ease-out, 60ms stagger, max 5). Section being written: 3 to 4 skeleton lines with a shimmer band (translateX loop, 1.6s). Queued Sections: faint heading and faint lines. Skeleton style is **grey** (`#E8EEED` with a lighter band) by default; **Aurora** (tinted lines with a violet band) is kept behind a test flag (4.2). Never mix the two.
- **Reading (4.3):** scrolling into the report collapses the pill into a 48px circle in the bottom right: white inside, Aurora mark, and the border as a conic progress ring. Scroll up or hover to reopen (200ms).
- **Stop:** confirmation first; keeps drafted Sections, marks the rest "Not drafted", skips QA (FR-43).

## 7. Draft ready and QA (4.4, 4.5)

- **Draft ready (4.4):** the pill becomes a toast with the full Aurora border: Aurora check tile (the mark with a white check), "Your draft is ready", small spinner "QA is checking it", close (×). The border drains right to left over 5s, pauses on hover, then the toast fades. Export and Send for review return to the top bar.
- **QA running:** the QA toggle shows a gray-50 fill and a small Aurora spinner. No popover or tooltip.
- **QA finished (4.5):** bottom-right notification, 340px, radius 14, no icon. Header band (padding 10/12/10/20, divider below): "QA finished" / "Just now", the overall score as a band chip ("78"), close. Body (16/20/18/20): one row per Section (mono number, name, 64x3 band bar, plain score), then "Later" (secondary) and "Open QA" (primary). Stays until opened or dismissed. The QA toggle shows the band chip, plus a small pink `#E879F9` dot until QA is opened.

## 8. Report page (2.1, 2.2) and layout (row 5)

- **2.1:** report editor (block handle, selection toolbar with Paragraph, B, I, U, link, "Ask assistant" with the Aurora mark; `[GAP: …]` highlight; conditional limit meter "96 / 100 lines, 668 / 700 words" only near a limit) with the Assistant panel (400px) on the right; Twenty-style hairline resize divider.
- **2.2:** QA open on the side (400px), mirroring `QAScorePanel`: "78/100" quiet line with a band bar, Sections list, CRA compliance chips ("Why, how, why intact"), language flags, client follow-ups.
- **Full width (5.3 to 5.5):** a toolbar toggle (↔) switches the report between a centred 660px reading column and full width (fills the panel with 48px side padding in the split, 96px when report-only). Persist per browser.
- **Assistant full screen (5.6):** the Assistant header's expand control hides the report and centres the conversation in a 720px column; the control becomes collapse. The full-width toggle is hidden here.
- **Details (5.1, 5.2; board 5.1y, owner chose V1 on 2026-09-24):** the i toggle opens a 400px right panel "Details". No project title or client; the page already shows both.
  - **Status card** (canvas fill, `--color-line-soft` border, radius 12, padding 14): one line "[stage chip] with [avatar] Name", where Name is the current handoff assignee (`projects.currentHandoffId`). With no open blocking handoff, show the stage chip alone, never the Owner and never a placeholder. Below it, two secondary buttons: Change stage and Hand off (arrow icon). No due date and no "since" line.
  - **Facts** (104px label column, 34px rows): Industry; Fiscal year on one line as "2026 (June 30, 2026)" (year from `fiscalYearEnd`, full date in muted ink in brackets) with a calendar icon always visible; Science code as the CRA label with the code in muted mono ("Mechanical engineering 2.03.01", from `shared/craScienceCodes.ts`); Project number; Owner. A hairline, then Created (date) and Edited (relative time) in secondary ink, read only. The other facts edit in place on hover where the user has permission.
  - **Fiscal year picker (A2):** a calendar popover opened on the year-end date, with month navigation, quick picks Mar 31, Jun 30, Sep 30 and Dec 31, and the line "The fiscal year takes the year of its end date."
  - **Science code picker (A3):** a searchable list grouped by field, the code in muted mono before the name, a check on the current code. Group headers show the field name only (the part of the data's group label after the separator).
  - **Change stage (B1 to B3):** a menu under the button lists all eleven stages grouped In progress, Done and Paused, with the current stage checked and a muted hint where a move asks for something. Edge rules come from `findWorkflowTransition`: edges that require a note (On hold, Abandoned, leaving Delivered or Abandoned) turn the card into an inline reason step ("Why is it on hold?", Cancel, primary confirm) instead of a dialog; Delivered asks for the outcome the same way; the internal-review completion edges keep their review decision step; a stage whose requirement cannot be met yet (Submitted while `promoted_branch` fails closed) is shown disabled with a short reason; users without authority see Change stage disabled. A plain move applies at once: the chip updates in place, a bottom toast "Moved to Internal review" fades after a few seconds, and Edited reads "Just now".
  - **Hand off (C1 to C3):** the panel switches to a "Hand off" view with a back arrow. Fields: To (searchable team list, the current user last so they can take a project back), Stage (defaults to the next In progress stage; keeping the current stage is allowed), Note (optional). Helper line "Sam sees it under With you on their home page." Buttons Cancel and primary Hand off. No due date. Picking a different stage is the user's confirmation of the stage change (product-domain: a handoff may offer the stage change with user confirmation; stage and work item stay separate records, written together, each under its own permission rule). The work item `kind` is derived from the chosen stage: internal_review gives internal_review; edits or revisions give revision; intake or interview_complete give interview_followup; ready_for_delivery or delivered give delivery_prep; any other stage gives other. `dueAt` stays in the schema, but this UI neither sets nor shows it. After handing off, the card reads "[Internal review] with Sam Chen", the note sits below in secondary ink with a 2px hairline on its left, and a toast says "Handed off to Sam Chen".
  - **Popover (5.2):** 360px, notch to the i button: the status line, Fiscal year, Science code, Owner, Edited, and "Open all details".

## 9. Home (1.1, 1.2)

- "With you" and "Recently opened" tables (Name, Client, Stage, Last edited) and a "Continue working" column with the last project ("Resume report") and the company's documents. Copy uses commas, not dots ("R1, 3 proposals waiting for you to apply").

## 10. Not in this contract

- Superseded boards X.1 to X.3 (older report layouts) are replaced by row 5.
- Board 5.1x (Details directions D1 to D7) is history. On board 5.1y, rows A to C are the reference for the Details states; row D keeps V2 and V3 as unchosen alternatives to V1.
- The seed-card and summary exploration boards on the archive page are history only.
