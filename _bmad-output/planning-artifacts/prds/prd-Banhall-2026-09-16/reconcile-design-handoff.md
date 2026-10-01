# Reconciliation — input-design-handoff.md (and chat brief) → prd.md / addendum.md

Subagent reconciliation, 2026-09-16. Gaps only.

## Dropped / weakened

1. "support undo for destructive changes" (input L115) → absent (FR-29 persistence only; FR-11/13/14 retention, not undo). **High.** Add an undo FR for deselect-all, Skip, Seed Edit, Regenerate-supersede.
2. Generation settings `style, position, targetLength` (L108) → FR-21 shows length target, model, Writer Profile; `position` deferred (OQ-3), `style` silently re-mapped. **High.** State the mapping explicitly.
3. "send … generation settings with each suggestion request" (L112) → in §4.2 prose, not FR-8 consequences. **Medium.**
4. "vary both in content and presentation" (chat brief) → FR-6 covers positioning only; presentation variance absent. **Medium.**
5. "Consider including sentiment tags or categories" → FR-6 hard-closes six values; the exploratory framing contradicted. **Medium.** Tag the closed set as an assumption; OQ for a second axis.
6. "keep final approval bar visible during card scrolling" (Screen 2) → only FR-37 narrow. **Medium.** Desktop consequence too.
7. "prior feedback" as context → FR-8 narrows to same Subsection. **Medium.**
8. Provenance "without overwhelming"; Edit/Feedback visible not hover-only → addendum only. **Low.** Promote.
9. Screen 3 "single-column, generous spacing" → narrative only. **Low.**
10. "Import transcript before workflow begins" → implied, not stated. **Low.**
11. Handoff says mockups are not final copy → PRD fixes literal labels as testable. **Low.** Mark copy indicative.

## Beyond input, untagged

12. 25-word bullet cap. **Medium.** Tag.
13. Feedback ≤ 300 chars. **Low.** Tag.
14. ≥2 distinct Tags per Batch; 1–2 Tags per Seed; auto-regenerate on single-Tag. **Medium.** Tag.
15. Unsupported Seed treated like Writer's Notes. **Medium.** Tag; fabrication-adjacent.
16. Prefetch. **Medium.** Tag or move to addendum.
17. FR-8 arithmetic (≥1 Seed per 244 Selection, ≤5). **Medium.** Tag.
18. FR-12 original auto-deselected, Revised inherits selection. **Medium.** Tag; destructive (ties to 1).
19. FR-16 one experiment per Selection in prose. **Low.** Tag.
20. Explicit Skip and reversibility. **Low.** Tag.
21. FR-13 in-flight collapsing; FR-21 browser-back; FR-38 44px. **Low.** Tag or addendum.
22. §4.8 learning events — cite the spine (AD-12/AD-13) as basis. **Low.**
