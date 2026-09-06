---
title: Load report tools when needed
type: refactor
created: 2026-09-06
status: done
baseline_commit: 201e46bd72c89ac2d59ad41022102b88b3f8433f
review_loop_iteration: 0
context:
  - {project-root}/AGENTS.md
  - {project-root}/docs/svelte-migration.md
---
<frozen-after-approval reason="User authorized implementing audited performance improvements">
## Intent
Reduce first-report code loading and avoid initializing an assistant the user has never opened. Preserve both report cohorts, loading/error behavior, access gating, and state after a tool has been opened. User has authorized implementation and push without further approval.
## Boundaries & Constraints
Always keep currentWhileLoading=false and cohort selection in WorkspaceGate. Lazy imports must occur only for the selected cohort. Wait for stored chat preference before activating chat. On mobile, hidden preview assistant must not mount until Agent or focus view actually exposes it; desktop defaults open unless remembered closed. Once mounted, preserve its instance through close/reopen or pane changes. Keep active responses, composer drafts, pending highlight/research and review feedback intact. Never change domain permissions or editing semantics. Do not change unrelated parser or streaming helper files. No new backend/schema.
## I/O & Edge-Case Matrix
| Scenario | Input | Expected | Error |
|---|---|---|---|
| Access pending | no cohort decision | neither report imports/mounts | neutral workspace loading |
| Cohort decision | Current or Preview | selected module only | import failure offers retry |
| Closed assistant | persisted desktop closed or mobile report first | no assistant-only imports/subscriptions | ordinary report remains usable |
| First use | open chat, Agent or focus view | loading then functional assistant | retry import failure |
| Reopen | draft or active response already present | same mounted instance, state preserved | no duplicate send |
| Disclosure | closed/open Logs or filing evidence | only useful header summary until open; details retained after first open | loading/count truthful |
</frozen-after-approval>
## Code Map
- src/routes/project/[id]/+page.svelte eagerly imports both report cohorts. WorkspaceGate owns selection and access.
- CurrentProjectPage.svelte and PreviewProjectPage.svelte in src/lib/components/project eagerly import AgentChatPanel and optional QA/history/candidate panels.
- Preview chatOpen defaults true; persisted setting restoration must finish first. Visibility includes desktop min-width1024, mobile Agent pane, or focus mode.
- LogsPanel: listProjectLog can wait for disclosure; do not fabricate zero count before data exists.
- FilingReadinessPanel: readiness summary must remain live; evidence/provenance/docs may wait for first disclosure open.
- src/routes/project/[id]/projectRoute.component.test.ts asserts wrappers before dynamic component load; strengthen with actual query activation.
- .audit/performance-audit-20260906/bundles.json and measure-bundles.mjs baseline static route graph; after measurement must include route shell plus selected dynamic cohort, not report misleading shell-only savings.
## Tasks & Acceptance
- [x] Add selected-cohort dynamic loading with loading/error/retry UI.
- [x] Lazy assistant activation for both report variants, latched once visible, no stale/duplicate instances.
- [x] Split existing conditional expensive panels where safe; defer closed detail subscriptions while preserving header information.
- [x] Verify cohorts and assistant lifecycle in real browser component tests, including closed/mobile startup, visible activation, reopen draft/response retention and pending action delivery.
- [x] Produce rerunnable bundle comparison recording static shell, each selected-cohort closure, and optional-tool closures separately.
Acceptance: Given pending access, no project queries mount. Given each cohort selection, correct report renders and the other module is absent from the initial graph. Given never-opened assistant, assistant-only queries remain skipped. Given reopened assistant, state survives. Given optional panels, all open paths function and failure recovery is actionable.
## Spec Change Log
## Verification
Run required browser component baseline before component edits. Run focused changed and existing route/review-feedback/intake suites after changes. Record outputs under .audit/performance-improvements. Parent runs full canonical and component gates and production build after sequential units. Do not commit or push from this subtask. Report unmet acceptance explicitly; do not count shell-only byte reduction as full report speedup.

## Final Verification

All nine steps of `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` passed on the final implementation: 2,090 unit tests, 562 browser component tests, both typechecks, discovery guard, production build and both uploader harnesses. Focused independent review findings were resolved and reinspected. Final sequential benchmark results, source hashes, limitations and reproduction commands are committed in [performance evidence](../../docs/performance-improvements-2026-09-06/README.md).

## Suggested Review Order

**Selected report**

- Keep access gating before loading either report cohort.
  [+page.svelte:6](../../src/routes/project/[id]/+page.svelte#L6)

- Load on first activation and retain the mounted tool thereafter.
  [LazyModule.svelte:13](../../src/lib/components/ui/LazyModule.svelte#L13)

**Assistant lifecycle**

- Activate only a visible assistant after restoring preferences.
  [PreviewProjectPage.svelte:1765](../../src/lib/components/project/PreviewProjectPage.svelte#L1765)

**Details**

- Keep readiness live while deferring unopened evidence queries.
  [FilingReadinessPanel.svelte:30](../../src/lib/components/evidence/FilingReadinessPanel.svelte#L30)

**Verification**

- Verify mobile startup, assistant drafts, pending actions, and optional tools.
  [ReportLoading.component.test.ts:1](../../src/lib/components/project/ReportLoading.component.test.ts#L1)

- Measure each complete report cohort, including default desktop assistant.
  [report-bundles.mjs:33](../../scripts/performance/report-bundles.mjs#L33)
