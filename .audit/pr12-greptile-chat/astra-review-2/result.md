1. **High: Brief source lookups can still exceed the transaction limit.** `convex/chatV2.ts:1447`  
   The scan reserves `1 MiB + 4096` before each iterator read and charges every scanned row, including filtered rows. That correctly bounds the walk. However, afterward it reads up to 20 distinct `generationSources` documents without reserving capacity. `charge()` only accounts after the read; it never prevents one. These rows contain full source content. A roughly 7 MiB scanned prefix plus 20 sources of 500 KiB exceeds 16 MiB, even with negligible current project documents. The existing byte test uses one small source and misses this scenario.

   **Suggested fix:** reserve before each source lookup, retaining questions with unavailable labels when capacity runs out. Add a `transactionLimits: true` regression combining large Brief entries with distinct large sources. Also account for `selectedCandidateRunId()` reads at line 1286 and `chatEvidenceBudget()` reads at line 1556, which currently bypass accounting.

2. **Medium: skipped alignment still produces false paragraph-specific findings.** `convex/lib/deviationInventory.ts:488`  
   With 500 reference paragraphs and the same draft plus one inserted first paragraph, the 250,500-pair comparison is skipped. Every draft paragraph becomes unaligned, so the structural loop attaches a finding to paragraph 501 claiming it has no reference counterpart. It actually matches reference paragraph 500 exactly. The section-level skip notice does not neutralize that actionable, incorrect finding.

   **Suggested fix:** when `skipped`, report only the section-level count difference and alignment limitation. Do not assign missing-counterpart claims to individual paragraphs. Test unequal-length sections above the bound; the current 3,000-by-3,000 test cannot expose this.

3. **Medium: the claimed Brief baseline reproduction is unsupported by its log.** `.audit/pr12-greptile-chat/evidence.md:142`  
   The evidence says the Brief query failed with a read-limit error on `fb15c59`. In `review-fix/before.raw.log:24`, it instead fails with **“Wrote too much data”** while inserting fixture entries. The query never runs. Both logged read-limit failures concern document scans.

   **Suggested fix:** run the corrected, separately seeded Brief test against `fb15c59`, preserve its actual query failure, and correct the evidence statement.

The four original findings are therefore **partially resolved**:

- **Byte bounds:** the walks are bounded, but whole-query safety is not established.
- **Incomplete Brief notice:** resolved for empty lists and zero known omissions, with relevant evidence-construction tests.
- **Reference auto-selection:** resolved; incomplete scans require explicit selection, and comparison outcomes carry the limitation.
- **Quadratic matrix:** removed. The streaming best-two calculation preserves deterministic tie rejection and mutual-best selection. The normalized-identical fast path is deterministic, including duplicate paragraphs. The 250,000-pair cutoff is correctly applied, but its structural fallback has finding 2.

The `projectDocuments.collect()` at `convex/chatV2.ts:1499` is a **pre-existing High availability risk**, not introduced by this diff. The original finding specifically targeted the expanded document and Brief walks, so I would track that collection separately. Charging it afterward cannot protect it, nor can it justify claiming every whole query stays within limits. The preceding generation reads and subsequent proposal reads likewise remain capable of exhausting capacity before the Brief walk.

I found no new prompt-injection path in unpaired or skipped sections: unpaired excerpts retain marker neutralization and DATA labeling; skipped notices interpolate only fixed section identifiers.

Reviewed source and stored logs only; no tests rerun or files changed. The logs report 127 focused tests and 2,667 full-suite tests passing.

ACCEPT_WITH_FIXES