# Independent review triage

All four independent review layers launched before collection/triage. The fourth launch initially hit the platform concurrency limit; it launched immediately when the blind reviewer returned. No reviewer model override was used.

Review input: review.diff (archived losslessly as review.diff.gz), baseline 438edf107a85d443480a3027fe8d19e0f9195106, plus listed actual audit artifacts. Input contains one incidental historical keyboard screenshot identified for cleanup.

| Finding | Decision | Severity | Reason / action |
| --- | --- | --- | --- |
| Multiple failed sends in one unsaved conversation separate across created threads (blind, edge, verification) | patch | medium | Guard another unsaved chat send until retry or dismissal resolves the first; test UI and handler. |
| Optimistic send stays outside scrolled viewport (blind, intent) | patch | medium | Scroll origin after local insertion, before transport resolution. |
| Older failure rendered below newer durable prompt/answer (blind) | patch | medium | Preserve visible placement using captured durable position, without injecting synthetic durable rows. |
| Removed dismissal leaves permanent local/displaced historical errors (blind, edge) | patch | medium | Restore scoped dismiss with no transport side effect. |
| Unbounded unsaved conversation previews (blind) | patch | low | Bound and normalize label, handle unbroken words. |
| Identical unsaved conversation labels (blind) | patch | low | Stable distinct cue and accessible selection test. |
| Keyboard focus lost when retry button removed (blind) | patch | medium | Retain useful focus through retry/failure without stealing later focus. |
| Historical screenshot changed despite evidence statement (blind, intent) | patch | low | Restore incidental historical images and prevent test recapture into historical audit path. |
| Sending label while persisted page catches up (blind) | reject | low | Correctly represents unfinished local-to-durable handoff; no user consequence demonstrated. |
| Matching user row via actual streaming projection (blind) | reject | low | Stream protocol constructs assistant replies; existing persisted-only source check and negative non-user case cover applicable identity contract. |
| Tests do not execute third-party paginated subscription lifecycle/live backend (blind, intent) | reject | low | CAP-6 explicitly names component tests; current tests exercise real panel/helper over controlled transport. Evidence states that limit. No concrete production failure identified. |
| Publication-first temporary duplicate until mutation result (intent) | reject | medium | Local request cannot be safely joined until existing mutation supplies exact messageId. Epic forbids backend signature/module changes; text guessing would violate identity. The implementation converges once both observations are available. Record transient limitation explicitly. |

No intent gap or bad spec found. The identified runtime fixes are local patches under the existing contract; no domain permission or backend transition is introduced. Duplicate claims with identical actions count once. Planned total: eight patches (five medium, three low), zero deferred, four rejected (one medium, three low). Follow-up score: 18.
