# Astra high-effort follow-up review

Reviewed PR #6 (`201e46b..657add2`) using three fresh reviewers explicitly configured as `gpt-6-astra` with `high` reasoning effort. The reviewers covered BMAD blind, edge-case, verification-gap and acceptance layers. They inspected the diff and surrounding code without reading the earlier review conclusions. Model attribution describes the requested tool configuration; served-model metadata is unavailable.

## Findings and corrections

| Finding | Correction and verification |
|---|---|
| Three BMAD specification headers were invalid YAML | Quoted the six context paths. All three failed `js-yaml` parsing before and parse successfully after the change. |
| Retrying a failed module import could repeat a cached rejection | Replaced the misleading retry with an explicit **Reload page** action and an unsaved-changes notice. A production Svelte harness serves a real HTTP 503, restores HTTP 200, proves same-document import remains rejected without another request, then verifies the real reload action recovers the tool. |
| Cancelled chat uploads left unfinished receipts and retained owner-specific selections | Clear receipts, retry files, selected files, attachment pills and file-input state when the exact project/report owner changes. Six component tests cover cancellation, selection, retry, completed-receipt retention and preservation of the text draft. |
| Cancelled replacement uploads could still report late failures or retain an old confirmation | Check ownership before recording a late failure; discard the previous project's staged confirmation and picker target. Tests exercise late success/no original deletion, late rejection/no failure side effects, owner changes, unmount, actual worker reading, successful replacement and dedupe. |
| Unchanged-owner rerenders could cancel an active extraction | Track a stable derived owner in the shared extraction scope. The new pending-replacement test failed before the change and passes afterward. Live owner checks still reject genuinely stale completion. |
| Deferred logs and filing errors lacked recovery guidance | Added explicit instructions to reload and tests for the error state and subsequent subscription recovery. The readiness summary remains visible. |

The existing layout already attempts automatic reload on Vite preload errors, limited to once per ten seconds. The new manual recovery covers failures that persist during that throttle. It does not automatically discard user state. The production harness executes the current layout handler with its throttle active, confirms the draft is preserved until the user clicks reload, and verifies successful tool state remains mounted across close/reopen.

The replacement pipeline's first combined focused run also included two intentionally failing, unfinished chat regression cases. Those failures were retained as before-fix evidence; both were corrected before the complete final verification run. They are not described as a successful combined run.

## Verification

All nine canonical steps passed: zero Convex/Svelte typecheck errors or warnings, 2,090 unit tests across 158 files, discovery guard, production build, both uploader harnesses (50 PowerShell and 18 bash checks), and 580 browser component tests across 76 files. The production module-recovery probe also passed. Independent Astra high reinspection of changes implemented by other agents found no remaining actionable source issues. [Follow-up evidence](astra-high-evidence.json) records the verified source hashes and results.

Focused production recovery can be repeated with:

```sh
node scripts/performance/lazy-module-recovery.mjs
```

It generates local evidence under `.audit/astra-high-review`, including screenshots and request results. The ordinary repository command remains:

```sh
VERIFY_COMPONENT=1 bash scripts/loop-verify.sh
```

## Boundaries

The original performance samples and source hashes in [evidence.json](evidence.json) describe implementation commit `ded9a7f`, merged as `657add2`. They are historical measurements, not fresh timing claims for these recovery corrections. Streaming reconstruction and usage-query behavior were unchanged by this follow-up.

Signed-in production navigation latency, field INP and live backend latency remain unmeasured. Reduced static bundle size alone does not prove faster route readiness. This is a stated evidence limit, not a demonstrated regression.
