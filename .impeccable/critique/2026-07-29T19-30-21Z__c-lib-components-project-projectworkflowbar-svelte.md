---
target: project workflow bar
total_score: 24
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-07-29T19-30-21Z
slug: c-lib-components-project-projectworkflowbar-svelte
---
# Project workflow bar critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Loading/errors/toasts exist, but sighted loading resembles empty and errors offer no retry. |
| 2 | Match system / real world | 3 | Stage, Owner, With, Due are correct domain terms; mobile removes the Owner label. |
| 3 | User control and freedom | 3 | Dialogs cancel cleanly, but the permanent desktop bar cannot collapse and stale recovery requires close/reopen. |
| 4 | Consistency and standards | 3 | Strong semantics and native controls; Stage is duplicated and the strip uses CRM-like field chrome. |
| 5 | Error prevention | 3 | Server authority, transition prerequisites, OCC and typed errors are strong. |
| 6 | Recognition rather than recall | 2 | Em dashes are ambiguous and mobile “On hold · Admin Writer” conflates accountability with current handoff. |
| 7 | Flexibility and efficiency | 2 | Rare governance actions occupy persistent space; no compact/personalized property display. |
| 8 | Aesthetic and minimalist design | 1 | Half of the four-column bar is guaranteed empty before PSOS-12; tablet becomes two rows. |
| 9 | Error recovery | 2 | Plain-language stale copy exists, but there is no direct retry/rebase and note drafts may be lost. |
| 10 | Help and documentation | 2 | Transition dialogs explain prerequisites, but the compact surface does not teach Owner vs With. |
| **Total** |  | **24/40** | **Acceptable — sound domain foundation, significant IA refinement required.** |

## Design Specificity Verdict

The component is product-specific in semantics but category-interchangeable in presentation. Its correct Owner/With distinction, conservative legacy fallback, authorization and OCC handling are tailored to Banhall. The equal bordered field cells, initials avatar, permanent text-link maintenance actions, and empty database-like properties could be transplanted into HubSpot, Salesforce or ClickUp unchanged. That presentation conflicts with Banhall’s report-first “Ledger paper” thesis.

The deterministic detector returned zero mechanical findings for both Svelte targets, and the Svelte autofixer returned no issues. The problems are therefore primarily information architecture, visual hierarchy, responsive allocation and a few semantic/accessibility gaps that static pattern detection does not flag.

## Overall Impression

The backend and workflow semantics are unusually disciplined. The visible bar spends too much permanent viewport on them. The single biggest opportunity is to preserve immediate workflow access while eliminating the dedicated four-field tier and withholding With/Due until they represent a real current handoff.

## What’s Working

1. Owner and With are separate concepts and are never inferred from each other.
2. Server-derived authority, shared transition rules, expected-version capture and immutable audit behavior are strong.
3. Native buttons, semantic dl/dt/dd markup, 44px heights, reduced motion, truthful “Legacy status only,” explicit overdue text and keyboard-capable dialogs are solid foundations.

## Priority Issues

### P1 — Permanent workflow chrome undermines the report-first workspace
The bar is outside the internal report scroller in a fixed h-screen shell, so it taxes every editor, generation, failure and selection state. At 768–1023px it becomes a two-row grid. Stage is already visible in AppNav. Replace the dedicated tier with a compact workflow disclosure integrated into existing PageBar/action chrome.

### P1 — Text tokens miss WCAG AA for small normal text
Measured on white: primary 2.81:1, primary-dark 4.22:1 and ink-muted 4.25:1. The 11px labels and 12px lagoon action labels require 4.5:1. Use primary-selected or darker ink for text; reserve brighter lagoon for non-text accents/fills.

### P1 — Mobile summary erases the Owner/With distinction
“On hold · Admin Writer” does not say whether Admin Writer is accountable Owner or current holder. Use “On hold · Owner: Admin Writer” now. After work items ship, prioritize “With: … · Due …” when a blocking handoff exists and keep Owner in expanded details.

### P2 — With and Due are guaranteed empty but receive half the hierarchy
The backend currently returns null for both. Showing em dashes is storage-truthful but product-ambiguous and trains users to ignore the area. Omit these fields until PSOS-12 creates a validated current handoff. Then present With and Due as one coherent Next action object.

### P2 — Governance actions are too persistent and too vague
“Change” and “Transfer” are rare maintenance actions but receive equal permanent lagoon prominence. Move them into workflow details and use explicit names: “Change stage” and “Transfer ownership.” Add contextual accessible names if the visible labels remain short.

### P2 — Loading, errors and conflict recovery need hardening
Loading looks identical to empty, mobile hides error detail behind expansion, there is no retry, and stale recovery asks users to close/reopen. Use visible skeleton/status treatment, a retry/review-latest action, and preserve notes/selections when refreshing authority/version data.

## Persona Red Flags

**Alex (Power user):** The permanent strip reduces editing space for every session, including maximized mode and generation flows. Rare Owner transfer controls remain visible while frequent report work is displaced.

**Sam (accessibility-dependent):** 11–12px primary/ink-muted text misses AA; “Change” and “Transfer” are weak in a button list; aria-controls references an absent collapsed node; mobile unavailable details are hidden until expansion.

**Casey (distracted mobile user):** The collapsed line is compact and has a 44px target, but it ambiguously labels the person. Expanded content can consume most of a short phone viewport for two real values and two empty values.

## Minor Observations

- `.text-data` is intended for numbers, IDs, dates and scores, not stage labels or human names.
- The chevron should be explicitly aria-hidden.
- Long names truncate without a recovery affordance.
- Relative due text will not refresh across midnight without a reactive clock.
- There is no ProjectWorkflowBar integration test for mobile summary, authority gating, errors or stale recovery.

## Questions to Consider

- Does workflow need to be always accessible, or always occupy its own row? Those are different requirements.
- Before a real handoff exists, what decision can a user make from seeing With — and Due —?
- When a handoff exists, should the bar answer the more operational question first: “Who has the next action, and when is it due?”

## Recommended End State

### Now, before PSOS-12
- Remove the permanent four-slot strip.
- Keep the Stage badge in AppNav as the sole primary state.
- Add one 44px “Workflow details” disclosure inside PageBar or its action overflow.
- Expanded surface shows Stage, Owner, migration warning and explicit secondary actions.
- Omit With and Due completely.
- On mobile, use “Owner: Admin Writer,” never an unlabeled person name.

### After PSOS-12
- Promote a real blocking handoff conditionally: “With: Priya Shah · Due Aug 12.”
- Group With, Due, instructions and handoff action under “Next action.”
- Keep Owner separate as durable accountability.
- If no current handoff exists, omit its compact summary unless absence itself requires action.
- Use one context-specific primary workflow action; keep stage/ownership maintenance secondary.

## Acceptance Criteria

- Exactly one primary Stage display above the report.
- No permanent four-slot or tablet two-row tier.
- Workflow access adds no dedicated persistent vertical row.
- With/Due absent before PSOS-12 and conditional after it.
- Every compact person reference says Owner or With.
- Small normal text reaches 4.5:1 contrast.
- Explicit action labels and accessible names.
- Visible loading, retryable errors and note-preserving stale recovery.
- Tests at 320, 375, 768, 1024 and short-height desktop, plus keyboard, screen reader, 200% zoom and long-name coverage.

## Platform Evidence

- Linear lets views show/hide properties and keeps assignee as accountable ownership even when work is delegated to an agent.
- Jira separates primary description fields from context fields and supports “hide when empty” for less-important fields.
- Asana places assignee/due date in a task details pane rather than a permanent application-wide band.
- ClickUp mobile conditionally shows activated/populated details and uses a dedicated Details surface; its denser desktop field bar is the closest analogue and the least suitable model for Banhall’s report-first workspace.
