# Code research: mixed feedback stream diversity

Read-only production-code research, 2026-09-04. Baseline verified with `git rev-parse HEAD`: `e581d51ca47b0652e0df5221a07ece6f5806333d`, worktree `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion`. All relative file anchors below refer to that worktree and commit unless explicitly identified as paused-story material. No tests, production edits, deployment, or orchestration state changes. This digest is the only authored artifact.

Read AGENTS.md, .factory/AGENTS.factory.md, generated Convex guidelines, and typescript-best-practices/SKILL.md before code inspection. The latter's referenced type-system-discipline skill was not found in the three local skill roots searched; no TypeScript was changed.

## Decision boundary

`_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/SPEC.md:36-38` requires at least two distinct writers and two projects **per source stream**, but does not say whether an underdiverse stream vetoes otherwise qualifying streams. `docs/ai-architecture-plan.md:273-281` requires diversity, exact signal IDs, and no single-writer/project firm-wide learning without explicit exception. It also does not pick a mixed-stream policy. No explicit exception for approved writer feedback is established by those requirements.

The paused story is outside this baseline at `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-learn-chat/.bmad-loop/runs/20260904-133944-0158/worktrees/4/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/4-digest-diversity-gate-and-signal-provenance.md`. Its Design Notes explicitly document both interpretations and mark planning blocked. Treat that as proposed work, not implemented behavior.

## Actual implementation

- `convex/ai/learning.ts:30-35`: minimum is five **aggregate signal rows**, window 500 per query, at most ten generated rules. There is no writer or project diversity gate.
- QA filter at `:123-131`: admit a non-null vote or a non-null changed severity override. Five meaningful rows suffice today, even from one writer/project.
- Draft style at `:216-241`: four streams are independently queried and pooled: candidate comments, section edits, proposal wording edits, approved writer feedback. Candidate bare scores do not count. Sum must reach five; no requirement for five in each stream.
- `convex/learning.ts:99-116`: section edit ratio must be at least 0.05. `:129-151`: approved writer feedback requires a nonempty trimmed suggested rule or body of at least 40 characters (`convex/brain.ts:661`). Pending/rejected rows never count. Proposal writes ignore unchanged wording (`convex/chatV2.ts:683`).
- `convex/ai/learning.ts:133-165,243-305`: freshness compares maximum admitted signal timestamp with the latest **generated** global candidate, not the published digest. At or below previous cutoff is a no-op. Each candidate is a redistillation of the rolling window, not just rows after cutoff. Empty model rule output saves nothing.
- `convex/learning.ts:223-224`: save has a second transactional cutoff guard. `:240-243` only persists kind, content, aggregate sourceCount, cutoff, model and creation time. Exact input IDs and per-producer counts are not implemented (`convex/schema.ts:1786-1798`).
- `convex/learning.ts:34-37,54-57,78-81,103-108,132-141`: windows use descending creation order and take 500 **before** most meaningful-signal filters. They are not an age-expiring window, and are not sorted by updatedAt/approval time. Sparse old rows can remain indefinitely; older updated or newly approved rows can fall outside the cap.
- CAP-7's chat answer feedback stream is proposed in SPEC.md:48-50; no `chatAnswerFeedback` or `convex/chatFeedback.ts` implementation was found in this baseline. It should inherit an explicitly chosen policy, rather than silently add a new veto condition.

## Producer identity and project attribution

| Stream | Persisted authoritative actor/project | Caveat |
| --- | --- | --- |
| QA | `convex/reviews.ts:205-209,248-255` writes access user._id and target.projectId | Schema userId is string (`schema.ts:1599,1610`), not proof every legacy string is a validated existing user. |
| Candidate comments | `convex/generations.ts:3030-3033,3079-3087` writes access user._id and candidate.projectId | Schema userId is string (`schema.ts:787,794`). |
| Proposal wording edits | `convex/chatV2.ts:691-698` writes editor user._id and proposal.projectId | Schema userId is Id<users>; no need to infer project ownership. |
| Section edits | `convex/generations.ts:2094-2106` writes current caller if present and generation.projectId | userId remains optional in `schema.ts:1782`; anonymous/legacy absence must not become a synthetic writer. |
| Approved writer feedback | `convex/brain.ts:642-650` writes fromUserId=user._id and optional projectId | Reviewer at `:680-683` is a separate person and not the signal producer. |

All five query projections currently discard source `_id`, producer and project metadata (`convex/learning.ts:38-46,58-63,89-93,109-116,147-152`). Diversity cannot be correctly computed by the action without retaining metadata through this internal boundary.

Projectless Brain feedback is a supported current input, not merely corrupt legacy data: `convex/brain.ts:591-624` permits neither projectId nor reportId for an active writer/manager/admin. Report-only submission derives and stores the actual report project at `:617-621`. No arbitrary project can be invented for general feedback. For historic report-only rows, a verified report relationship could be a separate policy decision; current producer cannot guarantee all history was normalized. Unknown writer/project must not count as a distinct writer/project. Counting approvers, project creators, project display names, or row IDs as distinct writers would manufacture diversity.

A further explicit decision is needed when a stream has enough known writers/projects plus some unattributed rows: merely excluding null from distinct sets still admits the unattributed rows to model input. Safer proposed semantics are to remove unattributed rows before diversity evaluation and record them as excluded; do not present that as approved yet.

## Strongest objection to omitting failed streams

Omission can systematically suppress rare but valuable corrective evidence and make the candidate look broader or more representative than it is. This is concrete here: the approved-writer suffix at `convex/ai/learning.ts:205-211` explicitly weights admin-vetted items above raw scores/edits and says a suggestedRule may contribute even once. A rare approved correction can contradict a common raw-score pattern. If its entire stream is excluded for lack of diversity, the model never sees that contradiction and could recommend the opposite rule. Approval is not currently an exemption from CAP-4, but the tradeoff deserves disclosure.

This is also a deliberate behavior change to a supported path: `convex/learning.test.ts:548-616` submits projectless feedback as one writer, approves it, asserts four rows do nothing, the fifth generates, repeat does nothing, and sixth approval generates again. These are existing tests read from source, not tests run during this research. An omit policy would make that stream ineligible until real attribution/diversity changes. An all-stream veto also excludes its learning and additionally blocks unrelated qualifying streams.

Possible mitigation to discuss, not implement: show which streams/rows were omitted and why alongside admitted provenance so administrators can assess representativeness and known exclusions. Do not quietly treat approved general guidance as a diversity exception. Its alternative route already exists: `convex/brain.ts:686-719` nominates approved feedback into a **pending** Brain source for separate source curation and approval; that is not digest publication.

## Starvation assessment (inference from actual windows and independent streams)

- **All configured streams must qualify:** any unused feature yields an empty stream forever; healthy comments cannot generate until writers also use sections, proposal edits, and Brain feedback across two writers/projects. Adding CAP-7 would introduce another cold-start dependency. No source contract says each workflow must be used.
- **Every nonempty meaningful stream must qualify:** one lone section edit or one projectless approved item can veto six qualifying comments. Because queries have a count cap rather than time expiry, a dormant sparse stream's lone event never ages out merely as time passes. Infinite starvation is possible absent future events in that stream or separate eligibility policy. A zero-signal filtered row should not activate this veto, if this option is chosen.
- **Omit failed streams:** qualified streams can generate, while sparse streams remain unused until qualified. This avoids unrelated-stream starvation, but has the evidence-selection objection above. Omitted rows must not count toward the five-row minimum, sourceCount, provenance, prompt blocks, or cutoff. Otherwise it becomes a bypass or false freshness accounting.
- If no stream qualifies or admitted total is below five, both legitimate interpretations produce no model call and no candidate; published guidance remains unchanged.

## Freshness and privacy details the policy must preserve

Cutoff must come from **actual admitted rows**, not all fetched rows. Otherwise an excluded event at time 300 can advance a comments-only candidate beyond comments at 100; later valid input at 200 can be skipped. Updating only omitted streams should not trigger re-distillation of identical admitted inputs. The current scalar cutoff does not represent membership changes independently of timestamps: if an excluded stream becomes eligible only through attribution repair on older rows, it can remain behind a newer other-stream cutoff. This is a known edge to state explicitly, not a reason to silently redesign freshness during this decision.

All current prompt serialization strips only updatedAt and spreads the remaining fields (`convex/ai/learning.ts:151-155,263-295`). Merely adding sourceId/userId/projectId to query results would therefore send attribution to the model. Proposed provenance must stay in a server-side envelope, with an explicit prose-field projection for the provider prompt.

Privacy is best effort, not guaranteed by diversity: proposal text is scrubbed at read boundary (`convex/learning.ts:70-93`), section text is scrubbed on write (`convex/generations.ts:2094-2105`). QA text, candidate comments and approved writer feedback are sliced but not deidentified in the inspected input paths (`convex/reviews.ts:225`, `convex/generations.ts:3028,3089`, `convex/brain.ts:626-648`, `convex/learning.ts:38-63,147-149`). The prompt privacy instruction at `convex/ai/learning.ts:92-96` is therefore not evidence that every source stream is actually scrubbed. Missing project still permits contact-pattern scrubbing, but loses name scrubbing (`convex/lib/deidentify.ts:34-40`; regression source `convex/learning.test.ts:412-430`). Metadata separation should preserve existing protection without claiming complete anonymity.

Publication remains a separate human decision: `convex/learning.ts:214-243` freezes legacy selection before first new candidate; `:305-355` requires settings.configure, expected selection, matching global digest, and explicit privacyReviewed=true. `:191-199` selects published guidance, with compatibility behavior only before first selection. New candidate generation must never publish. Existing published guidance does not automatically disappear when current feedback fails diversity.

## Proposed acceptance examples for a decision, not approval

1. Six candidate comments spanning W1/W2 and P1/P2 plus one W1/P1 section edit: omission => comments-only model input, six IDs, sourceCount=6, cutoff=max(comment times); veto => zero model calls and candidates. This is the decisive mixed-stream example.
2. Four diverse candidate comments plus one underdiverse edit: omission => no generation because admitted aggregate is four. Never use the omitted row to reach five.
3. Three diverse candidate comments plus two diverse edits: admitted aggregate five; generation is possible. Do not invent a five-row per-stream minimum.
4. One writer across two projects, or two writers across one project: affected stream fails. Two separately failing streams cannot pool identities/projects to qualify.
5. Five single-writer/projectless approved feedback items alone: no generation under the new strict per-stream policy, despite existing baseline behavior. With six diverse comments, omitted feedback cannot leak through the special approved-rule suffix or influence cutoff/counts.
6. Five rows include two fully attributed writers/projects plus an unattributed legacy section row: explicitly choose whether unattributed row is excluded before counting; no missing-value sentinel can supply diversity.
7. A diverse comments-only candidate already exists; only an omitted stream changes: no duplicate model call or candidate. When that stream gains qualifying newly timestamped evidence, include its exact admitted IDs on the next candidate.
8. An excluded row has the latest timestamp: stored cutoff still equals latest admitted row. Later admission must not be blocked by a cutoff advanced using excluded data.
9. Empty streams, cleared QA feedback, bare scores, <0.05 edits, unapproved/nonpromotable writer feedback do not contribute counts or diversity. No qualifying aggregate means no provider call.
10. Provider request contains only admitted textual/score payloads, no source IDs, project IDs, producer IDs, names added for provenance, or omitted rows. Admin history exposes exact admitted IDs and producer counts; legacy metadata is visibly unavailable rather than fabricated.
11. Candidate save leaves production selection unchanged; publish still requires authorized privacy-reviewed selection. Rollback, disable, and personal-digest isolation continue to work.

Recommendation for the parent synthesis: omission is the more operationally coherent proposal for independent optional streams, provided exclusions are explicit and all admission-derived values use the same eligible set. It is a recommendation, not a decision already granted by the spec, implementation, or external evidence.
