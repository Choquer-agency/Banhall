# Assistant and page frame redesign

Owner go-ahead 2026-10-28. Source: Paper file "Banhall - Web App", page "Assistant + report, exploration". Rows built: 9 and 10 (page frame), 16 B (history button), 21 (shorten flow), 32 to 37 (Assistant edit flow).

Branch `feat/assistant-and-frame-redesign`, worktree `../Banhall-assistant`, cut from `fix/summary-self-check-linear` at 690a0b0c. The context-pipeline push keeps working in `../Banhall-selfcheck`; rebase onto it before merging.

## Owner answers (2026-10-28)

- Conversation switcher: row 16 B, the history clock button in the panel header.
- New conversation: O4, the "Get started" options panel in place of the message box.
- New-chat options are built by code from the report, and only shown when a section is over its CRA limit. Reading: one "Shorten Line N" option per over-limit section, plus "Something else…"; no panel when nothing is over. Picking an option sends it right away.
- "Assistant needs you" (the AI asks with numbered options) is for mid-chat AI suggestions only, not new conversations.
- Several Lines: one card per Line, each reviewed and accepted on its own. When two or more cards from one reply are still waiting, they sit in a grey tray with "Accept all" at the bottom right. Accept all is hidden when any waiting card has options. The tray goes away once fewer than two cards wait.
- The one-card-for-several-Lines pattern is dropped: the AI always splits edits by Line.
- Shorten flow: keep F1 (click the "words over" pill, then "Ask the Assistant to shorten it"); after that it uses the same chat and report steps as rows 32 and 34.
- Remove the Assistant link from the rail and the standalone Assistant screens (S10). The Assistant lives only in the project side panel. Rail: Projects, Companies, Team, spacer, Admin, Settings.
- Live AI test budget: $10.
- Record rows 21 and 32 to 37 as an amendment in `docs/product-domain.md`; the owner's answer is the approval.

## Visual spec (values read from Paper)

Tokens: primary #0DACA5, primary-selected #087A75, primary-wash #F1FAF9. Max weight 500.

Frame (rows 9 and 10)
- Page background #F2F2F2 (gray ramp). Global bar 52px: logo 76x34 at left (padding-left 12+2), right side bell button 30x30 (17px icon, ink-secondary) and account button (name 13/18 weight 500 ink, 12px chevron ink-muted), padding-right 20, gap 6.
- Body: rail 80px (padding 10 8 14, gap 6) then the card; body padding right 8, bottom 8, gap 4.
- Rail item 64px wide, column, gap 4: tile 40x36 radius 10 (active tile #E4E4E4), label 12/16 (active ink weight 500, others ink-secondary). Items: Projects, Companies, Assistant, Team, spacer, Admin, Settings.
- Card: white, radius 12, 1px line border, clip.
- Project top bar 52px, padding-inline 12, gap 8, bottom border line-soft: back button 30x30, "Projects /" muted, title ink weight 500, Export (outlined), Send for review (primary), "..." button.
- Toolbar 40px, padding-inline 20, gap 18, align end, bottom border line-soft: tabs Report, Sources with count; right side toggles (full width, details, Assistant, QA shield with score).
- Split: report scroll, 1px divider, Assistant panel 400px (padding 24 in, content 352px).

Chat cards
- Folded card: white, 1px line border, radius 12, shadow #16211F0A 0 1 2, padding 8 8 8 14, gap 10. Title 13/18 weight 500 ink ("Line 242"), optional subtitle "3 options" 12/16 muted. Review button: primary-selected fill, radius 7, height 30, padding-inline 12, 12/16 weight 500 white. Chevron button 28x28 (14px, ink-muted).
- Card under review: border #9FDCD8, shadow 0 0 0 3px primary-wash. Header padding 12: "Line 242" + "Recommended" pill (primary-wash fill, #C9E2DD border, radius 999, height 20, 12/16 weight 500 primary-selected), chevron up. Body (top border line-soft, padding 12 14, gap 8): "Option 1" 13/18 weight 500, pager (chevron left faint, "1 of 3" 12/16 muted, chevron right secondary), option text 14/22 weight 300 ink. Footer 44px (top border line-soft, padding 0 8 0 14, gap 8): "Stop review" outlined (line border, radius 7, height 28, padding 10), "Accept" primary-selected (height 28, padding 12).
- Accepted line: primary-wash fill, #C9E2DD border, radius 12, height 44, padding 0 8 0 12, gap 8: 12px check (primary-selected, stroke 2), "Line 242" 13/18 weight 500 ink, "Accepted" or "Option 1 accepted" 13/18 weight 500 primary-selected, chevron primary-selected. Opened accepted card always has an Undo button in its footer.
- Done line: plain 13/20 ink text after the cards, "Done. Option 1 is now in Line 242." (single version: "Done. Line 242 is updated."; Accept all: "Done. Lines 242 and 244 are updated.").
- Undo bar (above composer, bottom padding 8): gray-50 fill, line-soft border, radius 10, height 40, padding 0 6 0 12, gap 8: 14px check (primary-selected, stroke 2.4), "Line 242 updated" 13/18 ink, Undo button (white, line border, radius 7, height 28, padding 12, 12/16 weight 500). Holds only the latest accept.
- Accept all tray: gray-50 fill, line-soft border, radius 14, padding 6, gap 6, cards inside; last row right-aligned outlined "Accept all" (white, line border, radius 7, height 30, padding 12, 12/16 weight 500).
- Inline error (Claude style): gray-50 fill, line-soft border, radius 10, padding 10 12, gap 8; row: warning icon 14px ink-muted in a 16x19 slot, message 13/19 ink-secondary; action row padding-left 20: small button (white, line border, radius 6, height 26, padding 8, gap 6, 12px icon, 12/16 weight 500), e.g. "Version history". Undo blocked copy: "Couldn't undo. Line 242 was edited after you accepted it."
- After Undo: card back to "Line 242 / 3 options / Review", report back, chat line "Undone. Line 242 is back to how it was."

Report review (rows 34 and 35)
- Nothing shows in the report until Review is pressed. No left border, tint, outline or dimming on the paragraph.
- Show changes on: cut words #991B1B on #FEF2F2, line-through 1px, radius 3, padding-inline 2; new words #166534 on #DCFCE7, same shape.
- Show changes off: new words ink on #E3F5F3 (light teal), radius 3, padding-inline 2; cut words hidden.
- Review bar floating at the bottom of the report: ink fill, radius 12, height 48, shadow #10182838 0 10 28, padding 0 6 0 16, gap 8. "Option 1" 13/18 weight 500 white + "Recommended" pill (#0DACA538 fill, #7FE3DD text, height 18, padding 6); 1px #FFFFFF33 divider; Show changes switch (28x16, primary fill when on, 12px white knob) + label 13/18 white; divider; "Stop review" text button #D6E2E0 13/18 weight 500 (height 32, padding 12); "Accept" primary-selected (height 32, padding 14, 13/18 weight 500 white).

Options panel (row 37)
- Replaces the composer. Outer: primary-wash fill, #C9E2DD border, radius 16, padding 0 4 4. Header 38px, padding 8, gap 8: AI mark 20x20, label 13/18 weight 500 primary-selected ("Assistant needs you" when the AI asks; "Get started" for a new chat).
- Inner card: white, #DCEDEA border, radius 12. Question 13/18 ink-muted, padding 12 14 6. Options list padding 0 6 6, gap 2: row min-height 40, padding 8, gap 10, radius 8 (selected row gray-50 fill); number badge 22x22 radius 6 (selected: white with line-soft border; others gray-50 fill), 12/16 muted; text 14/20 ink ("Something else…" ink-faint; typing turns it into a text field).
- Footer 40px, top border line-soft, padding 0 10 0 14, gap 6: "Skip" + "esc" key chip (gray-50, radius 5, height 20, padding 6); spacer; "Select" + return key chip 24x20.
- After picking, the answer shows as the user's message and the AI carries on.

## Plan

Code map 2026-10-28 (gaps against the spec): no proposal options; one card can span Lines (multi-paragraph `proposeEdit`, `proposeBulkEdits`, `proposeReplacements`); no Review step (the per-card "Show changes" switch previews whole find/replace text, not word marks; the only bar is the BNH-30 one-by-one replacement stepper); applied cards read "Replaced in report" with inline Undo, the undo error shows on the card; no Accept all, tray, Done line or Undo bar; no structured AI question; starters fill the composer; the CRA meter is a plain heading span with no popover; no global top bar, the logo and account live in the rail, the bell is copied into each page bar.

Steps, one commit each, gate before each code commit:

1. Backend, one card per Line and options
   - `chatProposals`: add `section` (the Line the card edits), `options` (up to 3 versions of the same edit, Option 1 first and recommended), `appliedOption`.
   - Tools: `proposeEdit` takes up to 2 more versions; every edit tool splits its pairs by Line and saves one card per Line (report-wide find/replace becomes one card per Line, each applying inside its own Line only).
   - `applyProposal` takes the picked option; undo unchanged.
   - Prompt: one card per Line, options only when the writer would want to pick, best first.
2. Backend, the AI asks with options: an `askWriter` tool (question plus 2 to 4 options) that ends the turn; the panel reads the latest unanswered question.
3. Chat cards: folded card ("Line 242", "3 options", Review), card under review, accepted teal line with Undo in the opened footer, Done and Undone lines, Undo bar above the composer (latest accept only), inline Claude-style errors, Accept all tray (hidden when any waiting card has options).
4. Report review: word marks from `diffWords` in the editor, Show changes off highlight, the floating review bar, Stop review; replaces the per-card switch and the "Review individually" stepper.
5. Composer panels: "Assistant needs you" (AI question) and "Get started" (new chat, only when a Line is over its limit, one "Shorten Line N" option each, sends on pick); header history clock (row 16 B) and new-chat pencil.
6. Shorten flow: the over-limit pill ("35 words over"), its popover (word and line bars, "Ask the Assistant to shorten it", "Show the words past the limit"), the "Shortening" chip while that turn runs.
7. Frame (rows 9 and 10): global bar, fixed labelled rail, one white card, inner section sidebars, project top bar order. Waits on the owner's frame answers.
8. Docs: product-domain amendment, architecture.md, system-map, changelog; full gate, component suite, Opus 5.5 high review, live AI checks within $10, manual browser checks at the end.

My own calls to flag: Option 1 is always the recommended one; Review replaces the one-by-one replacement stepper; report-wide find/replace is split per Line.

## Progress (2026-10-28)

- Steps 1 to 6 and the docs are done: ebaf5311 (one card per Line, options), 586556da (askWriter), 017180dc (cards, Review, Undo bar, Accept all), 82e0a87d (options panel, Chat history), 70caf606 (shorten flow), d48d6cda (docs).
- Review: three rounds on Claude Opus 5.5, requested at high (round 3 reported low). Round 1 and 2 "ship after fixes" (0ecaa722, 30085825), round 3 "ship" (82c704f4 for its two small points).
- Gate at 30085825: all 9 steps, 8,198 unit tests, production build. Full component suite: 195 files, 2,013 tests.
- Waiting on the owner: approval to copy the dev data for the live AI check and the manual browser checks (`scripts/chat-live/run.mjs`, scenarios panel-basics, apply-undo, per-line-cards, options, ask-writer, within $10), and the six frame answers before step 7.
- Step 7, the page frame (2026-10-28): built on the owner's six answers. The global bar, the fixed labelled rail, one white card with the Projects, Team, Admin and Settings sidebars, Mod \ for the sidebar, the project top bar inside the card; the drawer below 1024px as before. Recorded as product-domain entry "2026-10-28 (ninth)", the design-system section "the page frame" and architecture.md section 4. Captures at 1440 by 900 in `.vitest-attachments/frame/`. Review: three rounds on Claude Opus 5.5, requested at high (rounds 2 and 3 reported below high), each "ship after fixes" and fixed; round 4 on the round 3 fixes pending.

## Step 7: the page frame (rows 9 and 10)

Owner answers 2026-10-28 ("build for now, we can always change"):
1. Admin and Settings get their own inner sidebar listing their pages (Admin: House rules, Tags, Brain and the rest of `ADMIN_RAIL_ROUTES`; Settings: Account, Notifications, Shortcuts, Writing).
2. The developer pages (Alerts, Feature requests) sit at the bottom of the Admin sidebar, for developers only.
3. The bell keeps opening What's new (`/changelog`), with its unseen dot.
4. The main rail is fixed (no resize, no collapse); Cmd+\ collapses the inner sidebar instead (remembered in this browser).
5. Pages with no inner sidebar in the boards (New project, What's new, Alerts, Feature requests, the project page) sit in the white card without one.
6. Below 1024px the slide-out drawer stays as today (`WorkspaceRail variant="drawer"`), with each page's own bar and hamburger.

Spec (desktop, 1024px and up):
- Page background `#F2F2F2` (new token, `--color-frame`); the Plane frame boards.
- Global bar across the full width, height 52 (S9 board draws 56; use 52 as on the later boards): logo (`BanhallLogo`, 76x34) at left with 14px inset; right side, gap 6, padding-right 20: the bell (30x30 button, 17px icon ink-secondary, unseen dot; links to What's new) and the account button (name 13/18 weight 500 ink, 12px chevron ink-muted, radius 8, height 30, padding-left 8) that opens `IdentityMenu` below it.
- Body under the bar: rail column 80px, then the card; body padding right 8, bottom 8.
- Rail: column, width 80, padding 10 8 14, gap 6. Item 64 wide, column, gap 4: tile 40x36 radius 10 (active tile fill `#E4E4E4`, new token `--color-frame-tile`), the item's 20px duotone icon; label 12/16 (active ink weight 500, others ink-secondary). Items: Projects, Companies, Team (team.view), spacer, Admin (settings.configure), Settings. No Home, no recent companies, no search, no resize, no collapse. Icons: the Paper boards' SVGs (Projects document with teal fold, Companies buildings, Team people, Admin shield with check, Settings gear).
- Card: white, radius 12, 1px line border, clip; holds an optional inner sidebar and the page.
- Inner sidebar (S9, S11): width 228, right border line-soft, padding 0 10 12. Header 64 high (padding 0 2 0 8): section title 16/20 weight 500 ink, collapse button 30x30 radius 8 (16px sidebar icon, ink-secondary). Primary action under it: full-width outlined button (white, line border, radius 8, height 32, 14px plus icon + label 13/18 weight 500 ink), e.g. "New project", "Invite people". Nav (padding-top 12, gap 2): rows height 32, radius 8, padding-inline 10, gap 10: 16px outline icon ink-secondary, label 13/18 ink-secondary, count 13 ink-muted at right; active row primary-wash fill, primary-selected label weight 500. A labelled group (padding-top 20): header row 28 (label 13/16 ink-muted, optional 14px search icon button) and rows height 30 (label 13/18 ink-secondary, count 12/16 ink-muted; active primary-wash, primary-selected weight 500).
  - Projects: New project, Home (`/my-work`), All projects (count), Companies (search, every company with its project count; selected company active).
  - Team: Invite people, People (count), Pending invites (count).
  - Admin: the admin pages; developers also get Alerts and Feature requests at the bottom.
  - Settings: Account, Notifications, Shortcuts, Writing.
- Page top bar inside the card, height 64, padding-inline 8 from the sidebar edge (S9 main: title 22/28 weight 500, count 15/20 muted, search field 300x36 radius 8 at right). The bell is no longer in page bars.
- Project page (S12, S13, P0): no inner sidebar. Top bar 52 high, padding-inline 12, gap 8, bottom border line-soft: back button 30x30 outlined (radius 7, line border, 15px arrow ink) on every width, "Projects /" 14/20 ink-muted, title 14/20 weight 500 ink, spacer, then gap 6: Export (outlined, 30 high, radius 7, padding 10, 14px download icon, 13/18 weight 500), Send for review (primary-selected, 30 high, radius 7, padding 12, 13/18 weight 500 white), "…" (30x30) last. Then the toolbar (40 high, padding-inline 20, gap 18, align end, bottom border line-soft) and the split, as today.
