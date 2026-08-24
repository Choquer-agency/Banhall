# PSOS-44 — New project from client + fiscal-year folder

## Work control

- **Status:** `ready`
- **Phase:** P11 — August 20 meeting-directed writer flow
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** August 20, 2026 meeting
- **Progress note:** Wizard already reads `?client=` and `?fye=YYYY-MM-DD`. Fiscal folders do not pass fiscal year-end; list view has no create action on the folder.

> Work this ticket independently after every dependency is complete or explicitly waived. Preserve the one-active-ticket rule.

## Problem

Creating another PD for an existing client/year still requires re-typing client name and fiscal year. Michael asked that the New project action, when started from a fiscal folder (example: 3GA Marine / Fiscal 2025), prefill both fields.

## Current code

- `src/routes/project/new/+page.svelte` prefills client and `fye` from query params (2026-08-11).
- `ProjectsBoard` appends only `?client=` via `newProjectClientName`.
- `ProjectsClientGroup` list presentation has no New project control on the fiscal-year header.
- Comment in `ProjectsClientGroup.svelte` currently says creation stays in the repository toolbar rather than repeating on every client row — this ticket adds a **fiscal-folder** action, not a duplicate on every client heading.

## Product outcome

From a recorded fiscal-year folder, one control opens `/project/new?client=…&fye=YYYY-MM-DD` using the folder’s recorded client name and a real fiscal year-end date from that group (not a year-only guess). Unrecorded fiscal folders do not invent a date.

## Acceptance criteria

- [ ] Recorded fiscal-year folder exposes a New project control (list and lane presentations).
- [ ] Wizard opens with client name and fiscal year-end already filled; both remain editable.
- [ ] Prefill uses an actual `fiscalYearEnd` present on projects in that folder, formatted `YYYY-MM-DD`.
- [ ] Unnamed clients and “Fiscal year not set” folders do not send a fake `fye`.
- [ ] Duplicate-from-project prefill still wins when `from=` is present.
- [ ] Keyboard and ≥44px target; accessible name includes client and fiscal label.
- [ ] Component tests cover href construction and the no-date case.

## Dependencies and boundaries

- **Out of scope:** durable `clients` / `claimPeriods` (PSOS-31); auto-assigning the next project number.

## Transcript evidence

- **28:00–28:23:** Michael: same as New project, but pull in 3GA Marine and Fiscal 2025. Johnny: recalled the note; will add it.
