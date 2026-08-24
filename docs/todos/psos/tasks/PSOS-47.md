# PSOS-47 — September writer-flow hardening slice

## Work control

- **Status:** `ready`
- **Phase:** P11 — August 20 meeting-directed release policy
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** August 20, 2026 meeting (re-engagement + September team rollout)
- **Progress note:** Process ticket. It does not add features. It constrains what may ship to writers through September so upload, processing, and editing stay usable while costing stays admin-only.

> This is a queue-policy ticket. Do not treat it as a license to skip the one-active-ticket rule or to implement costing.

## Problem

Michael’s team is eager (Larry at the 20-project cap; Tracy already in with PDs). Visual churn and in-flight bugs break production writing. He asked for a version his team can treat as set. Bryce agreed: spend the next month making the current writer component bulletproof, then add features; costing can be a separate surface only Michael/admin can see.

There is no feature-flag / release-candidate toggle in the app today.

## Policy (approved in meeting)

1. **Writer-facing freeze theme:** uploading documents, processing documents, and editing the report. Game-breaking and process-breaking bugs in that path outrank new dashboard chrome.
2. **Costing / accounting** stays behind existing admin-only tools until PSOS-31–34, matching Michael’s “access page like my admin panel” request. Do not expose a second writer homepage for costing in this slice.
3. **No full-app version fork.** Bryce’s page/access-basis control is the agreed mechanism, not a parallel production site. A true RC toggle is out of scope unless product reopens it.
4. **Team loop-in:** September. Expect bug reports; schedule them ahead of net-new writer features (except PSOS-42, which unblocks Tracy’s current files).
5. **Visual change:** avoid drive-by layout/font moves on the writer path during the slice; Carbon-style panic is the failure mode Michael named.

## Acceptance criteria

- [ ] Queue README records this slice: writer-path bugs and PSOS-42/43/44 may proceed; PSOS-31–34 remain not started for writer exposure; PSOS-48 stays deferred.
- [ ] Financial/costing UI, if any work begins, is Admin-gated and does not appear in the writer project wizard.
- [ ] September team onboarding is not blocked on grouping collapse (PSOS-38) or live interview coaching (PSOS-48).
- [ ] When the slice ends, a short note in this ticket lists remaining writer-path defects vs new-feature work.

## Transcript evidence

- **02:34–04:02 / 04:36–06:23:** Continue engagement; want a stable team version; Bryce: page-basis access, next month bulletproof this component.
- **06:23–08:53:** Performance reviews show eagerness; Larry 20-project cap; prioritize upload / process / edits; costing as later admin-gated beta.
- **07:26–07:31:** Team involvement in September.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-08-20 | Control blast radius by surface (writer vs admin), not by a second deployed version. | Matches Bryce’s page-basis proposal; Michael accepted. | Michael Obregon, Bryce Choquer |
