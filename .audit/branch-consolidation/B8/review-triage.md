# B8 parent review triage

All three fresh Astra6 medium reviewers completed with exit0. Edge returned `[]`; gap found no gaps. Twelve blind findings evaluated independently; parent patches are trivial evidence/test refinements with no additional product change.

| Finding | Severity / route | Resolution |
| --- | --- | --- |
| Test both sides of sm breakpoint | low / reject | Existing sm contract is reused literally; requested390/1440 cases and responsive computed minima exercise mobile and desktop outcomes. No new breakpoint policy or demonstrated boundary defect. |
| Narrower/crowded header | low / reject | Suggested broader coverage beyond requested viewport matrix; no overlap or clipped control demonstrated. Existing title truncation/layout contracts unchanged. |
| Hit-test every rectangle edge | low / reject | Geometry measures the actual anchor, not a wrapper; no overlay or hit interception is introduced or observed. Additional unrelated interaction matrix not required for this scoped minimum-size fix. |
| Mobile accessible name missing | low / reject | Unchanged sr-only sm:hidden span supplies New project name; existing getByRole exact-name assertion runs at390 and1440. Blind diff omitted surrounding preserved span. |
| Desktop width lacks baseline | low / patch | Parent restored exact baseline header temporarily, reran the existing corrected header tests with diagnostic output, captured121.671875x32 desktop and41x32 mobile, then restored current source in finally. Baseline mobile fails as expected. Desktop exactly matches repaired worker bounds. Added maintained desktop computed minWidth/minHeight0px assertions without hardcoding font-dependent width. |
| Header alignment/clipping/focus-ring | low / reject | Additional visual checks suggested without a demonstrated defect. Parent gate retains current shell/focus/pointer tests; header49px and responsive structure unchanged. No claim of exhaustive visual audit. |
| DOM order does not prove CSS order | low / reject | SPEC expressly recovers DOM-order assertions; no visual-order guarantee inferred from them. Product rail CSS is unchanged. |
| SVG existence not exact icon identity | low / reject | SPEC requests one SVG for each exact nine-destination anchor; current rendering and roles stay unchanged. Existing icon/color assertions retained. No demonstrated wrong mapping. |
| Distinct colors not semantic mapping | low / reject | Pre-existing test unchanged and not a new defect. This batch preserves it and adds exact destination/one-icon checks only. |
| Batch-specific recurring console output | low / patch | Removed console.info from maintained test after archiving before/after bounds. No diagnostic noise in ordinary future runs. |
| Final gate pending | low / patch | Parent reruns affected suites after test patches, then canonical component-enabled Node24 gate before acceptance. |
| Ignored evidence not durable | low / patch | Explicit archive manifest admits full logs/diffs/source hashes with this local commit; final committed-object verifier follows at final admission. |

No intent gap, bad specification or new proven pre-existing defect; native ledger unchanged. Parent-owned final hashes identify the small test patch separately from worker evidence. Desktop comparison is evidence for this exact change; it does not mandate a universal intrinsic text width.
