## Findings

- **Medium — `convex/generations.ts:1017,1068`: Settings reads remain outside a proven transaction budget.** The reservation covers one maximum-size document, but `analyzerContextBudget` reads four. Their `value` fields are unrestricted strings (`convex/schema.ts:2375`); `readPositiveInt` validates only after reading them. Thirteen approximately 1,000,000-byte sources plus four approximately 1,000,000-byte settings exceed the [16 MiB read limit](https://docs.convex.dev/production/state/limits), despite every individual document being valid. Whitespace-padded numeric settings also pass parsing. The original fixture is fixed, but the whole-transaction guarantee still depends on an unenforced assumption.
  
  **Suggested fix:** Read and account for settings before walking sources, or reserve four maximum-size documents. Add a transaction-limited regression with large settings.

- **Medium — `convex/lib/contextInclusion.ts:158` and `src/lib/components/brief/BriefRail.svelte:232`: Frozen-source truncation is not honestly disclosed in the UI.** No frontend code consumes `sourcesTruncated`. The new transcript-only regression returns a partial transcript list, but the UI says only “Not every document could be listed.” When frozen documents are omitted, `inclusionHeader` also presents `documentsInContext` as an exact numerator although it is now a lower bound.
  
  **Suggested fix:** Consume `sourcesTruncated`, explicitly disclose incomplete transcript/source coverage, and qualify both document counts when frozen sources are incomplete. Add component coverage for partial transcripts and partial included-document counts.

## Verification

- The three reads before budget creation are generation, user, and project; all are subsequently charged. Shared collection accounting, headroom checks, lookahead, and iterator cleanup are sound.
- The previous duplication finding is resolved. `learningHealthReads` preserves its constants, return shapes, snapshot fields, and truncation labels. Its unchanged 31 tests pass in the recorded logs.
- `transactionLimits: true` is enabled. Before logs reproduce both original query throws; their baseline Convex blobs also match `efd7b18`. After logs report 63 targeted tests passing.
- `recordContextBudget`’s get/patch loop and `reserveGeneration`’s `take(50)` are unchanged, pre-existing risks. The adjusted fixture isolates this query; it does not establish full-pipeline safety.
- Tests were not rerun under the read-only restriction. Recorded broader checks report 2,650 unit tests, 641 component tests, and successful type checks.

REJECT