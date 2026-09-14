1. **High — Row bounds do not prevent Convex read-limit failures.** [convex/chatV2.ts:1251](/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/pd-review-2/convex/chatV2.ts:1251)  
   The document walk reads full `content` fields in one query transaction. For example, 400 attachments containing 50 KiB each exceed Convex’s 16 MiB read limit before reaching the 1,000-row bound. The query throws instead of returning `documentScanTruncated`. `for await` does not create separate transactions, even when an action invokes the query. The expanded Brief scan has the same byte-budget concern. [Convex transaction limits](https://docs.convex.dev/production/state/limits#transactions)  
   **Suggested fix:** use byte-limited pagination with transaction headroom and explicit incomplete-scan metadata; preferably query reference-document metadata through an appropriate index. Add transport/platform-limit evidence beyond the small-content fixtures.

2. **Medium — An incomplete Brief scan can still look complete or absent.** [convex/ai/chatEvidence.ts:254](/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/pd-review-2/convex/ai/chatEvidence.ts:254)  
   With 2,000 non-question entries followed by an unresolved question, the query returns `questions: []`, `{ count: 0, exact: false }`. `buildChatTurnRequest` drops the metadata because the question list is empty. With up to 20 questions in that prefix, the block renders but suppresses the warning because `count === 0`. Both cases silently conceal an incomplete scan.  
   **Suggested fix:** render an incomplete-scan notice whenever `exact === false`, including empty lists and zero known omissions. Test both cases through `getChatContextV2` and evidence construction.

3. **Medium — Document truncation is ignored when selecting a reference automatically.** [convex/chatV2.ts:1279](/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/pd-review-2/convex/chatV2.ts:1279), [convex/ai/chatAgentV2.ts:303](/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/pd-review-2/convex/ai/chatAgentV2.ts:303)  
   If one readable PD appears within the first 1,000 documents and another follows, the query returns `resolved`, bypassing the normal multiple-reference choice. The successful tool response discards the truncation flag. The `unreadable`, `unparsed`, and `ambiguous` responses also omit it; `unknown_name` still opens with an authoritative absence claim before qualifying the scan.  
   **Suggested fix:** propagate the scan limitation through every response. Require explicit selection when an incomplete scan cannot establish uniqueness, and phrase unknown-name results as “not found among scanned documents.”

4. **Medium — Alignment allocates an unbounded quadratic score matrix.** [convex/lib/deviationInventory.ts:249](/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/pd-review-2/convex/lib/deviationInventory.ts:249)  
   A section containing 3,000 short paragraphs on each side creates nine million scores, roughly 72 MB of numeric storage before array overhead and word bags. Such text can fit within document-size limits, while the matrix alone exceeds the documented 64 MiB Convex action memory allocation. Runtime also grows with every paragraph pair and its word-bag size. [Convex function limits](https://docs.convex.dev/production/state/limits#functions)  
   **Suggested fix:** retain only each row’s and column’s best two candidates, and bound total comparison work with an explicit fallback notice. Add a large-section regression.

Other checks:

- Dice multiset scoring, mutual-best selection, threshold checks, and tie rejection are logically correct and deterministic. Identical duplicated paragraphs lose pairing, but remain visible as neutralized DATA without invented count-based differences. I consider that consistent with conservative alignment, though an exact-identical-section fast path would improve it.
- Rule/content ID generation remains unchanged. Reference IDs move when their corrected paragraph anchors move; identical inputs remain deterministic.
- The omission line is first within its block, but it does **not** survive an exhausted total budget or a cut inside that line. This overlaps existing **DW-139**, rather than constituting a newly introduced regression. System-prompt bytes remain unaffected.
- `before.raw.log` demonstrates behavioral failures for insertion, deletion, reordering, and ambiguity; `after.raw.log` records 115 passing tests. The bound-specific baseline tests are weaker evidence because their imported bound is `undefined` before the change. I did not rerun tests.
- All four requested files at `738331e` are byte-identical to `55011ea`. There is no independent later-stack implementation conflict in those files, but `738331e` lacks both fixes.
- No new report-prose mutation path was introduced. Working tree remained clean.

ACCEPT_WITH_FIXES