# Q8 root review disposition

All three fresh Astra6 medium reviewers completed before root collected findings. Edge reviewer returned an empty list. The gap reviewer identified a real-SDK verification gap, now addressed with actual SDK/application/Convex execution and HTTP-only replacement. No deployment or external provider call was made.

| Finding | Severity | Category | Disposition |
| --- | --- | --- | --- |
| Blind1: legacy peer explanation | low | patch | Replaced obsolete adapter explanation with explicit retention/removal condition. Complete installed-tree check has no required-peer problems; no current conflict is invented. Frozen scope preserves the flag. |
| Blind2: whole peer graph | medium | patch | Root npm ls --all --json exits0, problems empty. Exact numeric command receipt retained. |
| Blind3: production React | medium | patch | Isolated npm ci --omit=dev --ignore-scripts preserves lock and installs React19.2.8; auth/React peer listing passes. Whole omit-dev source tree still reports11existing Svelte peer references because Svelte is dev tooling. This is not the full source build installation or a whole production-tree health claim. |
| Blind4: live auth/session lifecycle | medium | reject | No auth route/policy change; real cookie serializer and adapter extraction verified. Live login/refresh/logout requires deployment/session integration beyond this bounded dependency change. Local checks are explicitly not live authentication proof. |
| Blind5: SDK coverage | medium | patch | Two permanent tests run installed SDK0.91.1 through instrumentedAnthropic/generateStructured with only HTTP stubbed; serialized tool request, decoded structured result/usage and401error verified. Direct path is nonstreaming and has no caller signal; no invented feature coverage. |
| Blind6: hostile sanitization | medium | patch | Actual MessageContent hostile HTML/link input, separate opt-in Mermaid and actual DOMPurify pass with external requests blocked. Finite boundary checks, not complete exploit proof or production SVG enablement. |
| Blind7: xmldom consumer | medium | patch | Actual Mammoth DOCX/XML consumer returns decoded valid text and rejects malformed XML. Same parser dependency, Node buffer entry; not every upload/parser case. |
| Blind8: built chat import | medium | patch | Current emitted project-route module containing chat imports in a real browser, with recorded Kit public bootstrap globals and all external requests blocked. Nonempty exports/no pageerrors; module evaluation only, no authenticated interactive chat claim. |
| Blind9: spec checklist | low | patch | Root completes tasks and actual review links at unit acceptance. Final cold combined gate still controls release. |
| Blind10: verification owner | medium | patch | Earlier Q8 eight-stage and separate522browser runs belong to the ephemeral implementation worker. Root final gate is a separate pending condition, not inferred by combining those runs. |
| Blind11: reproducible fixtures | low | patch | Exact stored/restored paths and hashes supplied in root-restore-map.json, commands/caveats in root-reproduce.md; runtime follow-up has dedicated cache. |
| Blind12: future dependency checks | low | patch | Added concise AGENTS guidance for npmci/whole-peer/audit/lock review, aligned Tiptap, real SDK boundary tests and cold optimizer proof. This is update policy, not a new automatic advisory monitor or CI audit gate. |
| Gap1: mocked SDK message path | medium | patch | Same required action as blind5. Real tool_use decoding and usage persistence now tested;91focused unit tests and Svelte check pass. |

All raw failed fixture/observer/browser attempts remain retained. Review patch required no application production-code change. Only two real-SDK tests, npmrc rationale and AGENTS verification guidance were added after the initial implementation; root final source hashes identify the candidate. No intent_gap, bad_spec or new deferred work.

Pending before shipping: the root must run VERIFY_COMPONENT=1 bash scripts/loop-verify.sh with an explicitly fresh canonical optimizer cache and preserve source/index bytes. Any failure must be fixed and reverified. User authorization for commit/push/normal merge is conditional on that final evidence. No current cold pass is claimed here.
