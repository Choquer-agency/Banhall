# Independent BMAD review triage

Root ran three independent review layers. Edge-case review returned `[]`; verification-gap review returned `No verification gaps found.` Blind review supplied ten coverage suggestions, with no established production defect.

| Blind finding | Severity | Route | Decision and evidence |
| --- | --- | --- | --- |
| 1. Oracle lacks category identity | low | patch | Extended independent marker oracle through closing category bracket. Both generation metadata matrices now compare delimiter direction and genuine category identities against benign output. This is stronger evidence without demanding equality of intentionally different filenames. |
| 2. Exact multiline body comparison absent | low | reject | Sanitizer is applied only to filenames and labels, never body bytes. Existing marker/body/budget regressions and fixture corpus exercise content containment. The new tests assert real body positions and raw provenance. No changed data path can selectively mutate or duplicate body content; duplicating whole payload preservation coverage does not test this correction. |
| 3. Whole benign output snapshot absent | low | reject | Broad snapshots couple this small sanitizer repair to unchanged scaffold wording. Existing assembly tests assert genuine wrapper and guidance bytes; added benign builder test verifies exact document block and multipart heading bytes at this repair's boundary. |
| 4. Ordinary transcript-label bytes unasserted | low | patch | Added real multipart transcript case with Unicode prose and mixed two-character dash runs, asserting the exact emitted heading and body. |
| 5. Mixed two-character threshold unasserted | low | patch | Same benign builder case preserves ASCII/em-dash and minus/U+2010 pairs in both filename and transcript heading; supplements per-dash single/double helper cases. |
| 6. Tabs/zero-space corpus variants absent | low | reject | Production metadata sanitizer has no keyword/whitespace branch: it collapses dash runs independent of following characters. Existing body neutralization grammar remains untouched. Varying keyword whitespace would not distinguish an alternative defect in the changed operation; current independent oracle already accepts those alternatives. |
| 7. Longer homogeneous Unicode run absent | low | patch | Added four em dashes to both generation metadata matrices and chat matrix, supplementing existing longer mixed run. |
| 8. Other document categories absent | low | reject | All categories use the same documentBlock -> sanitizeFileName call. Existing assembly and trust tests cover category ordering, client/internal trust, and writer-note demotion. This repair has no category-specific path; duplicating the Unicode matrix across categories adds no defect discrimination. |
| 9. Folded Unicode metadata lacks builder case | low | reject | Existing real-builder tests sanitize Unicode line separators/newline+delimiter tails. The new direct helper test combines Unicode separators and a Unicode dash forgery, while both real metadata entry points are exercised by the dash matrix. foldLines and both call sites remain unchanged. No untested changed composition branch exists. |
| 10. Chat has only one dash representative | low | patch | Expanded existing real-chat filename test to all supported homogeneous runs, mixed and longer runs. This verifies the moved shared behavior at its second caller without introducing another implementation helper. |

Totals: intent_gap 0, bad_spec 0, patch 5 (all low), defer 0, reject 5. No production fix beyond the independently reviewed shared sanitizer correction was needed. No ledger changes made.

Final focused verification is recorded in `review-green.log`; full native verification is held for root. The repair specification remains `in-review`, not done.
