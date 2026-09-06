# B10 parent review triage

Three fresh Astra6 medium reviewers completed with exit0. Edge returned []; gap found no gaps. Each of the thirteen blind findings was evaluated independently.

| Finding | Severity / route | Resolution |
| --- | --- | --- |
| Approved amendment omits defensive ready:false | low / reject | The task preserves exact historically approved policy text with only two stale reference repairs. The canonical SPEC and 25 observations explicitly preserve defensive false. Current real getAccess returns true or throws; no newly changed false behavior or authority to rewrite historical policy. |
| Fail-closed describes current fallback | low / reject | Amendment explicitly limits exposure and retains server capability checks. Current UI is a rollback surface, not an authorization grant. Preserved text is not an exhaustive security claim. |
| Historical deletion statement lacks replacement auth proof | low / reject | The historical rollout/cohort tests were retired. Current convex/workspaceRollout.test.ts retains five real endpoint tests: authorized admin/writer/manager, rejection of unauthenticated/anonymous/roleless identities, and ignoring a leftover disabled rollout row. It remains unchanged and participates in the parent full gate. No backend-auth conclusion is based on browser stubs. |
| Full gate outstanding | medium / patch | Parent runs the required component-inclusive gate after all source patches, tracked-test staging and independent review. Gate receipt is a separate acceptance prerequisite. |
| Helpers accept a matching call amid extras | medium / patch | Assert exactly one requested goto, complete options, pathname and parameter key/value multiplicities. Preserve the stricter assertion after diagnosing the partial-router fixture below. |
| Waits for any call before matching | low / patch | Poll specifically for expected pathname, then settle Svelte tick before inspecting complete call list. |
| Missing same-origin assertion | medium / patch | Resolve expected URL against actual page.url and compare origins. |
| No destination mount / full bounce proof | medium / reject | These component fixtures intentionally prove source-route requested navigation, not a live SvelteKit destination transition. Explicitly document this limit. Baseline and candidate both show the same two calls only when the shared navigation stub changes URL while retaining DashboardPage. No production routing regression is established; source routing is unchanged. |
| Restore component-level ready:false | low / reject | Frozen matrix explicitly retains this defensive state in pure cases; real server returns true or throws. Data-to-state gate wiring is unchanged. The replacement error fixtures now exercise the live failure shape; no changed false conversion or missing stated acceptance demonstrated. |
| Add preview-to-override same mount | low / reject | Additional transition beyond the specified loading-to-override/error/recovery matrix. Existing test executes subscription suppression and recovery on one mount; production reactive wiring unchanged. No demonstrated defect. |
| Add pending-to-authenticated and logout | low / reject | Broader auth-transition expansion than this dead-branch removal. Required pending-to-signed-out path executes; auth/query effects remain unchanged. No demonstrated regression. |
| Add richer dashboard success params | low / reject | Canonical URL construction is unchanged; preserved success tests cover view removal, other param preservation and default route. Existing richer repeated/Unicode fallback and link matrices execute. No altered reverse-direction behavior demonstrated. |
| Truth-table expected tuple | low / patch | Use a fixed four-state tuple, preventing accidental missing or misaligned expectations. |

No intent gap, bad specification or confident unrelated production defect; no native ledger change. Parent applied trivial patches because ephemeral implementation context cannot be resumed.

## Navigation fixture investigation

The stricter call-count assertion first failed (31/32 browser cases pass), retained in parent-patched.json and logs. A temporary diagnostic executed the same test against candidate and exact baseline 8511662cb8fd9748d02f413c633bf21b5cdec9ee source, restoring all files in finally. Both produced /projects?layout=board followed by /my-work?layout=board, each replaceState:true, and both exited1. parent-navigation-comparison.json retains exact command, observed calls and log hashes.

The shared goto stub updates page.url without unmounting DashboardPage. The old page recomputes its target when view disappears. Scoped beforeEach now makes the goto spy resolve without mutating URL. This tests the requested navigation at the component boundary, matching its ownership, while explicit same-mount URL changes still use __setPageUrl. Shared stubs, production effects and backend remain untouched. No destination-route mount or end-to-end absence-of-bounce claim is made.

The final patched commands pass:25 pure observations,32 Chromium cases across3 files and diff check, with exact receipts in parent-patched-final.json. Failed instrumentation and baseline-comparison receipts remain retained.

## Policy preservation

Independent policy-audit-final-conclusion.md proves every pre-existing domain byte is preserved and exactly two historical line references are converted to surviving section names. The raw strict comparison exited1 solely for those permitted substitutions and is retained as such. No rewritten historical approval, permission or later QA/privacy/diversity policy is introduced.
