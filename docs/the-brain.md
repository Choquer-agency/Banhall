# The Brain — reference notes

Curated, governed cross-project knowledge base (RAG) behind SR&ED report
generation and the chat assistant. Ticket: **BNH-10**. Last updated 2026-07-02.

## Architecture (one paragraph)

`@convex-dev/rag` owns the vector index (Voyage `voyage-3-large`, 1024d, hybrid
search; provider: first-party `@ai-sdk/voyage`). Our own reactive tables own
**governance**: nothing is retrievable until an admin approves it, revoking
unlearns it (deleted from the index), and every change lands in an audit log.
Each entry's `importance` = the writer's tier (shapes the wide first-stage
net), and the tier is blended back in after reranking
(`rerankScore × (0.6 + 0.4·tier)`), so stronger writers rank higher at equal
relevance end-to-end.

**A good PD is a good PD.** Everything lives in ONE namespace (`brain`), so the
Brain helps every generation — no industry required. Setting an industry on a
project is the *perk*, not the requirement: it narrows retrieval to
same-industry exemplars via a filter. (Changed 2026-07-02 from
namespace-per-industry; CRA rejection letters will still get their own separate
negative-signal namespace.)

- Ingestion/retrieval code: `convex/ai/brain/{embeddings,rag,ingest,retrieve}.ts`
- Governance API: `convex/brain.ts`
- Admin dashboard: `/admin/brain` (direct URL, admin role only)
- Tables: `brainSources`, `brainFeedbackQueue`, `brainAuditLog`

## Seed corpus (imported + approved 2026-07-02)

10 submitted PDs — 5 writers × {Abundant, Sparse} source-info conditions.
Source: `~/Downloads/Sample PD's/<Writer>/<Abundant|Sparse> Info/Submitted PD/`.

| # | Company (FY end) | Writer | Tier | Industry | Info |
|---|---|---|---|---|---|
| 1 | Acuity Insights (2025-03) | Tracy | 1.0 | software | Abundant |
| 2 | 2525483 Ontario / Net-Atelier (2024-06) | Tracy | 1.0 | software | Sparse |
| 3 | Pacific Coast Terminals (2025-12) | Larry | 0.7 | manufacturing | Abundant |
| 4 | Northern Equity Partners (2025-09) | Larry | 0.7 | manufacturing | Sparse |
| 5 | iSSi (2025-08) | Orel | 0.7 | software | Abundant |
| 6 | DealerMine (2024-12) | Orel | 0.7 | software | Sparse |
| 7 | Insporos Technologies (2025-06) | Emily | 0.7 | life-sciences | Abundant |
| 8 | Denbow Transport (2025-07) | Emily | 0.7 | manufacturing | Sparse |
| 9 | Beacon Brewing (2026-02) | Eniko | 0.4 | manufacturing | Abundant |
| 10 | JRT Nurseries (2025-12) | Eniko | 0.4 | life-sciences | Sparse |

### Conventions locked in by this import

- **Writer tiers** (`writerTier` → RAG `importance`): Tracy **1.0** (gold
  standard) · Larry / Emily / Orel **0.7** · other writers (incl. Eniko) **0.4**.
  Change any entry's weight in `/admin/brain` → expand row → Weight → Save
  (re-ingests automatically).
- **Industry values** (exact strings — the project-page Industry dropdown and
  Brain filters share them): `software` · `manufacturing` · `life-sciences`.
  Set per project on the project header (Industry dropdown). Optional —
  unset = retrieval across all industries.
- Judgment calls made at import (revocable): Beacon Brewing → manufacturing,
  Denbow wastewater → manufacturing, Insporos seed-sensing → life-sciences,
  Eniko → 0.4.
- `craOutcome` left unset (submission outcomes unknown). CRA rejection letters
  are a SEPARATE negative-signal namespace (BNH-18), never mixed in here.

## How to add more knowledge

**Bulk (CLI):**
1. Fill `data/brain-seed.json` (array; copy `data/brain-seed.example.json`).
   Required per entry: `title`, `industry`, `content`, `writerTier`.
   `approve: true` = straight into the Brain; omit/false = pending queue.
2. `node scripts/seed-brain.mjs --dry-run` → sanity check.
3. `node scripts/seed-brain.mjs` → imports; embeds run in background
   (serially — ~10 docs takes a few minutes).
4. Re-running is safe: dedup by content hash.

`data/brain-seed.json` is **gitignored** — real PDs are client-confidential,
never commit them. Only the `.example.json` template is tracked.

**One-off (admin UI):** pending imports appear in `/admin/brain` → Queue →
review full text → Approve.

## Governance cheat-sheet (`/admin/brain`)

| Action | Effect |
|---|---|
| Approve | Embeds + becomes retrievable (audit-logged) |
| Reject / Revoke | Unlearned — deleted from the vector index, row kept for history |
| Weight + Save | Changes writer tier, re-ingests with new importance |
| Writer feedback tab | Approve/reject writer-submitted rules (BNH-39 conduit) |
| Audit log tab | Every action, actor, reason, timestamp |

Status dot on approved rows: ● = embedded & retrievable, ◌ = still embedding.

## Where retrieval is wired

- **Generation pipeline** (`convex/ai/pipeline.ts`): a cheap Haiku pre-pass
  distills the transcript into a 4-part **retrieval brief** (problem /
  uncertainty / work / advancement — `convex/ai/brain/query.ts`), then FOUR
  section-scoped retrievals run sequentially (Voyage rate limits punish
  bursts): analyzer gets problem-matched exemplars (k=4), and each of
  242/244/246 gets exemplars of ITS OWN section (k=3). Falls back to the old
  `title + transcript.slice(0,2000)` query if the brief fails. Fails safe:
  Brain errors never break generation, but they DO log honestly — the
  progress log distinguishes "no similar reports" from "Brain unreachable".
- **Provenance (flywheel):** every generation stores which exemplars fed it —
  `generations.brainProvenance` (per-section entryId/sourceId + raw
  search/rerank scores + final blended score) and `brainRetrievalBrief` (the
  Haiku brief JSON). This is the substrate for exemplar-usefulness analytics
  and revocation forensics.
- **Post-edit distance (flywheel north star):** selecting a candidate freezes
  the untouched AI draft as a `reportSnapshots` row (`reason: "generated"`);
  `reports.postEditDistance` diffs it against the current report (word-multiset
  similarity + unchanged-paragraph ratio). Falling PED over time = the system
  is actually improving; sustained >40–50% = fix prompts/retrieval.
- **Chat assistant** (agent chat): `searchBrain` tool — only fires when the
  writer explicitly asks to reference past projects/reports. Same
  reference-patterns framing; reports infra failures honestly instead of
  claiming "no knowledge".

## Verification snapshot (2026-07-02)

- **10/10 imported, approved, embedded (with Contextual Retrieval), retrievable.**
- Unfiltered retrieval verified (cross-industry ranked set) and industry-filtered
  verified (manufacturing → Larry + Emily only).
- **Full e2e generation proven** on a no-industry project: pipeline pulled 4
  exemplars ("all industries"), all 3 candidate models completed in parallel
  (QA 82/88/87), generation reached awaiting_selection.
- Spot-check any time:
  `npx convex run ai/brain/retrieve:retrieveBrainContext '{"query":"...","k":2}'`

## Retrieval quality stack (P2, live since 2026-07-02)

1. **Section-scoped queries** from the Haiku retrieval brief — raw transcripts
   retrieve on greetings/client names; report-register queries retrieve the
   rhetorical patterns drafters actually need (Skill-KNN/STORM finding).
2. **Contextual Retrieval** (`BRAIN_CONTEXTUAL=1`): each chunk embedded with a
   Haiku-generated blurb situating it in its parent PD (cached-prefix, ~nil
   cost; cuts retrieval failures ~35–49%).
3. **Hybrid search** casts a 30-chunk net (vector + text, writer-weighted).
4. **Voyage `rerank-2.5` cross-encoder** re-scores a 12-wide slate
   (`maxRetries: 1`; any rerank error falls back to vector order), then:
   **relevance floor** 0.35 (zero exemplars beats misleading ones), **writer
   tier blended back in** (`score × (0.6 + 0.4·tier)` — rerank alone is
   tier-blind), **≤2 chunks per source PD** (diversity; applies on the
   fallback path too).
5. Exemplars reach the **analyzer AND the 242/244/246 section drafters** as
   reference patterns (structure/voice/CRA phrasing only — facts forbidden),
   each consumer getting exemplars matched to its section.

Still open in P2: Citations API in the drafters (deep output-shape change,
deferred to its own pass — bump `@anthropic-ai/sdk` first).

**⚠ Voyage billing:** the Voyage org has NO payment method on file → hard
limit of 3 requests/min + 10K tokens/min. That caused the seed-day 429s and
throttles rerank today. Add a payment method before any bulk import (BNH-17)
or the 4-retrievals-per-generation flow will regularly fall back to
vector-order.

## Generation fan-out (fixed 2026-07-02, found during Brain e2e)

Candidates used to run sequentially inside one Convex action — the 10-minute
action limit killed long-transcript generations mid-model and stranded them in
"running"/"generating" forever. Now each candidate model runs as its own
scheduled action (`ai/pipeline.generateCandidate`), and
`generations.finalizeCandidate` atomically flips the generation when the last
one lands. ~3× faster wall-clock. Stranded runs from the old code:
`npx convex run generations:failStaleGenerations '{"olderThanMinutes":30}'`.

## Ingestion throttling (fixed 2026-07-02)

The 10-PD seed initially lost 7 embed jobs to Voyage 429 rate limits (parallel
burst). All embedding now drains through a Workpool (`embedPool`,
`maxParallelism: 1`, 6 retries with exponential backoff from 15s) — bulk
imports of any size are safe, just slow-and-steady. See `embedPool` in
`convex/brain.ts`.

Utility: `npx convex run brain:requeueAllApprovedEmbeds` re-embeds everything
through the pool (unlearning old entries first) — for index-shape migrations
like namespace or embedding-model changes.
