# Extract: how PD generation works today (codebase, 2026-09-09)

Source: Explore subagent over the repo at HEAD c55014f. Facts only, with citations.

## 1. Generation pipeline
- Program modes: `single`, `compare`, `iterative` (`convex/ai/promptProgram.ts:222-249`).
- `iterative` is ordered with per-section human review: analyzer → section242-human-review → approved-prior-section-context → section244-human-review → section246-human-review → redraft-with-writer-guidance → assemble-approved-sections → post-terminal-qa-and-chronology (`:235-248`).
- `single`/`compare`: analyzer → [242, 244, 246] in parallel → compression → QA + chronology (`:250-260`). Sections are not generated in a writer-prescribed order.
- Self-check exists after generation: QA and chronology agents with two-attempt repair (`:336-353`; `convex/ai/postQa.ts:1-14`).
- `compare` mode's only selection step is `human-candidate-selection` between whole candidates (`:229-234`).
- NOT FOUND: any pre-draft planning stage (storyline, claim exclusion list, findings confidence map, glossary) or per-section multi-option selection.

## 2. Input precedence
- Generation context order: WRITER'S NOTES (highest) > previous-year reports > scoping notes > background research > other (`convex/ai/prompts.ts:833-847`); chat mirrors it (`:857-873`).
- Overall rule precedence: locked CRA tier > org mode > writer toggle > house default (`docs/product-domain.md:1358-1360`).
- House style = six waivable categories incl. `reportSkeleton` (added 2026-09-01) (`shared/styleOverrides.ts:22-28`; `docs/product-domain.md:1385-1437`). Locked, never overridable: the 242/244/246 skeleton, CRA line/word limits (`convex/lib/lineLimits.ts:15-18`: s242 50 lines/350 words, s244 100/700, s246 50/350), no-fabrication.
- Writer profile applies only when `profile.enabled` (`convex/writerProfiles.ts:222-224`); org `houseStyle.modes` writer_choice|enforced|off resolve against the writer's toggle (`:206-211`; `shared/styleOverrides.ts:80-99`).
- Larry (lrinaldo@) reported "customized settings silently overridden" on 2026-08-23; that drove PSOS-49/50 (`docs/product-domain.md:1276-1279`).

## 3. Chat editing contract
- "Exactly one edit tool per change request" (`convex/ai/prompts.ts:953`); tools `makeProposeEdit` (`convex/ai/chatAgentV2.ts:37`) and `makeProposeBulkEdits` (`:114`, `:270`) backed by `convex/lib/passageEdits.ts` (unique, non-overlapping targets). Bulk edits arrived in PR #8 (d13abe7), documented `docs/product-domain.md:1791`.
- History window: latest 30 non-tool rows (`chatAgentV2.ts:250-256`); evidence budget 12 documents / 60k tokens / 5k tokens per document (`convex/ai/chatEvidence.ts:81-87`).

## 4. Attachments
- Allowed: txt, md, markdown, pdf, docx, msg, eml, mbox, xlsx, xls, csv, png, jpg, jpeg, webp, gif (`shared/documentStatus.ts:24-40`). No DWG/DXF/CAD; deferred as backlog (`spec-uploader-root-prefix.md:36`).
- No 40-document limit exists. Effective cap: 12 documents into chat evidence (`chatEvidence.ts:86`) and analyzer/generation context (`convex/ai/trustedContext.ts:185`), admin-configurable (`appSettings.ts:26,122,152-155`).

## 5. Models
- Chat is fixed to Anthropic Sonnet (`chatAgentV2.ts:279`; `shared/generationModels.ts:1`).
- Generation candidates: Sonnet 5, Opus 4.8, Haiku 4.5, `openai/gpt-5.6-sol` "GPT-5.6 Sol" via OpenRouter (`shared/generationModels.ts:29-56`). Picking Sol for a draft does not change the chat model.

## 6. Evaluation machinery
- QA agent scores against a rubric (`convex/ai/qaAgent.ts:116`); blocking QA gate CAP-8 since 2026-09-04 (`docs/product-domain.md:1605-1613`).
- `scripts/chat-behavior-eval.mjs`: opt-in live-model eval of bulk-edit reliability on synthetic fixtures.
- NOT FOUND: any compare-to-reference-PD evaluator, convergence score, or writer-level quality metric.

## 7. Sept 8 intake findings vs PR #8 (d13abe7)
1. Bulk editing vs one-tool contract — ADDRESSED (`proposeBulkEdits`, `passageEdits.ts`).
2. Conditional profile / silent fallback — ADDRESSED (lookup failure now stops the reply, `docs/product-domain.md:1789`).
3. Incomplete context (12 docs, ~20k chars/doc, 30-row history, cut notices not user-facing) — NOT addressed.
4. Injection fixtures never hit a real model; disclosure policy — PARTIALLY (policy added `:1793`; fixtures still in-process).
5. searchBrain privacy — PARTIALLY (explicit per-message enable, `:1793`).

## 8. Domain doc anchors
- Generation lifecycle `docs/product-domain.md:34`; PSOS-49 writer profile `:1268-1320`; PSOS-50 governance modes `:1321-1384`; reportSkeleton waiver `:1385-1437`; Sept 8 chat amendment `:1787-1795`.
