# Context pipeline and company files: MVP push

Written 2026-10-22. **Status: plan only, nothing built yet.** None of the decisions below are recorded in `docs/product-domain.md` yet, so no code should start on company files, writer memory or Azure until that entry is approved.

Code line numbers are as of 2026-10-22 (`origin/main` at bbbb2710) and will drift.

## Goal

By the MVP, Banhall should:

- read every file a writer adds (documents, scans, photos, emails, spreadsheets, transcripts) and find the right part when drafting or chatting;
- keep files at company level, so every PD for that company can use them;
- learn from writers' picks, edits, feedback and chat, and prove it is getting better;
- write better PDs than a writer using ChatGPT or Claude Projects with the same files.

Storing files at company level won't beat ChatGPT on its own, since ChatGPT and Claude Projects already store and reuse files. Banhall wins by writing better reports, showing where every claim came from, and proving it improves.

## Why now

Emily's "Sign off and generate PD" failure on October 9 was Banhall refusing its own check before calling the AI, not the AI failing. Doubling the limit (e6e287d4) buys time: roughly 20 picks in one step hits it again. The same pattern repeats across the AI steps: fixed size limits while the data keeps growing.

With 10 to 50 times more files, these break next:

1. **Chat stops working for a project with about 40 large documents.** Every message reads every document's full text but uses only 12 (`convex/chatV2.ts:3202`).
2. **Uploads slow down and fail.** Each upload reads every existing document to check for duplicates (`convex/documents.ts:136`).
3. **The documents list loads every document's full text** and keeps it updating live, only to show sizes (`convex/documents.ts:252`).
4. **With 30 documents, about 18 are left out of drafting**, chosen by upload order, not relevance (`convex/lib/briefEvidence.ts:64`, `convex/ai/trustedContext.ts:205`).
5. **A Brief with more than 30 entries, or a step with about 20 picks, is refused at sign-off** (`convex/lib/seedRevisions.ts:745`, `:990`).
6. **A dense stretch of transcript silently loses the end of its facts** (`convex/ai/transcriptFactsAgent.ts:183`).
7. **Large AI answers time out.** Requests wait for the whole answer and give up at 240 seconds (`convex/ai/providers.ts:121`).
8. **Bulk-importing past reports from OneDrive brings in empty files**, because the server can't read PDFs (`convex/ingestionSync.ts:160`).

## Are we ready to start?

**Yes for week 1.** Week 1 is code fixes and writing down decisions, and needs no new accounts. Later weeks need the items below.

| Needed | Who | Blocks | Status |
|---|---|---|---|
| Approve the `docs/product-domain.md` entry (company files, permissions, writer memory, Azure OCR) | Owner | All company-file, writer-memory and Azure work | Not drafted |
| Decide the 30-entry Brief limit: check in batches instead of refusing | Owner | Week 1 sign-off fix | Raised to 64 on 2026-10-22 (branch `fix/summary-self-check-linear`); batches come with the split |
| Log the agent into Convex (`npx convex dev`) so it can check data and account flags | Owner | Company backfill dry run | Not done |
| Run the company backfill (`api.clients.backfillClients`): dry run on dev, then prod | Admin | Week 2 company files | Not run as of 2026-10-14; check |
| Create the Azure account and free OCR resource (steps below) | Owner | Week 2 scan reading | Not done |
| Give the go to build the company page (Paper Z8) | Owner | Week 2 company file upload | Designed, not built |
| Add a card to the Voyage account | Owner | Bulk import of past reports into the Brain | `docs/the-brain.md` says no card, capped at 3 requests a minute (BNH-17); may be out of date |
| 50 to 100 test pages for the OCR side-by-side: made-up, public, or from a client who agrees | Owner | OCR test | Not gathered |
| 20 to 50 real past cases (inputs plus the final approved PD) and someone to judge a blind test | Owner, senior writer | Week 4 proof | Not gathered |
| Check whether client agreements limit which outside services may see their files | Owner | Sending real client files to Azure | Unknown |
| BNH tickets in futur-board | Agent | Tracking | Not created |

Start new branches from `origin/main`. PR #29 (saved companies and the Projects redesign) merged on 2026-10-22, so the company records this plan builds on are already in main. The local `main` branch is behind.

## Decisions made (2026-10-22)

| Area | Decision |
|---|---|
| Files that contain text | Free libraries on the Convex server. No AI writes the text writers quote. |
| Scans and pictures | Azure Document Intelligence, Canada Central. Read by default, Layout for pages with tables. Free tier (F0) to start, paid (S0) later. |
| Search by meaning | Keep Voyage for the Brain (embeddings and reranking). Convex has no embedding model or reranker; its AI Gateway serves chat models only, with embeddings "coming soon". |
| Project and company file search | Start with Convex keyword search. Add Voyage only if tests show the AI missing evidence. |
| Labels and short context notes | Claude Haiku 5.5 |
| Company files: who can add | Consultant, Manager, Admin |
| Company files: who can remove or archive | Manager, Admin. Developer and Owner accounts are covered through their Admin role (decision 48). Every change is logged. |
| Writer memory | Yes. The AI suggests a saved preference, the writer approves it, and it stays private to that writer. |
| Across companies | Company files, company facts and writer memory never reach another company. The Brain and the two firm-wide lesson sets stay as they are. |
| "Translate" | Means understanding and using the files. No French translation. |

Company files replace decision 60 (2026-09-26, "Not now. Files stay per project"), so the new entry must say so.

## Still open

1. **Do any clients require Canadian data residency?** Claude runs in the US or globally only, so full residency isn't reachable while Claude drafts. If yes, it's a bigger change: a new Convex deployment in Canada (30% extra; an existing deployment can't move).
2. **Should the AI describe charts and images?** Descriptions would be stored separately and marked "AI description, not quotable".
3. **Accept audio files?** Azure Speech in Canada Central is the candidate. Its retention terms aren't confirmed.
4. **Anthropic's batch service:** half price for labels and context notes, but it keeps data for 29 days. Acceptable?
5. **The 30-entry Brief limit** (see the table above).

## Azure setup

You need a phone number and a credit or debit card (not prepaid). Use the firm's own Microsoft work account, so the firm owns the billing and the client data.

### 1. Create the account

1. Go to [azure.microsoft.com/free](https://go.microsoft.com/fwlink/?linkid=2227353&clcid=0x409&l=en-us) and choose **Try Azure for free**.
2. Sign in with the firm's Microsoft work account.
3. Verify the phone, then add the card. Azure places a temporary $1 hold that it reverses, and doesn't charge at signup.
4. The account comes with $200 of credit for 30 days. The free OCR tier doesn't use it.

### 2. Switch to pay-as-you-go right away

A free trial account is disabled after 30 days unless you upgrade. Upgrading costs nothing while you only use the free tier.

1. In [portal.azure.com](https://portal.azure.com), search **Subscriptions**, open the new one, and choose **Upgrade**.
2. Add a safety alert: search **Cost Management**, open **Budgets**, choose **Add**, and set $5 a month with an email alert.

### 3. Create the OCR service

1. In the portal, choose **Create a resource**, search **Document Intelligence**, then choose **Create**. The form may be titled "Create Form Recognizer".
2. Fill in the form:

   | Field | Value |
   |---|---|
   | Subscription | the one you just upgraded |
   | Resource group | Create new: `banhall-ai` |
   | Region | **Canada Central** |
   | Name | `banhall-docintel` (it becomes part of the web address; if taken, try `banhall-docintel-ca`) |
   | Pricing tier | **Free F0** |

3. Leave the other tabs as they are. Choose **Review + create**, wait for **Validation Passed**, then choose **Create**.
4. When it says **Your deployment is complete**, choose **Go to resource**.
5. If **Free F0** isn't offered, the subscription probably already has a free one for this service (not confirmed for this service).

### 4. Find the key and address, but don't send them yet

1. On the resource, open **Keys and Endpoint**.
2. You'll see an **Endpoint** (a web address), **Key 1** and **Key 2**.
3. **Don't paste the key into chat, email or Slack.** When the agent wires it up, it opens a private box for the key. The key is stored only in Convex's environment settings, never in the code.
4. If a key is ever exposed, press **Regenerate** on that key.

### Free tier limits

| Limit | Value |
|---|---|
| Pages per month | 500 |
| Pages per request | 2 |
| File size | 4 MB |
| Speed | 1 request per second |

Banhall sends only picture pages, one at a time, so this covers development, the side-by-side test and early use. For production, switch the same resource to **Standard S0**: about $1.50 per 1,000 pages with Read, $10 with Layout.

**Until the `docs/product-domain.md` entry approves Azure, test only with made-up or public documents.**

## Work plan

Each item here touches `docs/architecture.md` sections 4, 6, 7 or 8, or rule 2. Update that file in the same change.

### P0: stop the outages (before MVP volume)

- [ ] **1. Move each document's full text off its database row.** Keep size, word count and a file fingerprint on the row; put the text in file storage or a separate table. Find duplicates by fingerprint, as transcripts already do. Fixes failures 1 to 3.
- [ ] **2. Make the sign-off check's answer the same size no matter how many picks.** First half done on branch `fix/summary-self-check-linear` (2026-10-22, third entry in `docs/product-domain.md`): no merged-id echo, an answer ceiling apart from the budget, 64 Brief checks. Still to do: the batches, streaming, and listing each merged group once in the input.
  - Stop repeating merged ids (`seedRevisions.ts:990`); the server already knows them.
  - Return only short numbers, pass or fail, and the failures.
  - Run it in batches (one per step, or a fixed number of items), reusing the transcript-section pattern.
  - Do the same for the 30-entry limit: batch instead of refuse. Needs the owner decision and a `docs/product-domain.md` entry.
- [ ] **3. When an answer is too long, retry as smaller batches**, not "write shorter" at the same limit (`convex/ai/structured.ts`, `OutputLimitError`).
- [ ] **4. Take each limit from the model's real maximum** instead of a hard-coded number, and stream the large calls.
- [ ] **5. Show writers which documents were left out more clearly.** The Inputs band already tracks it.

### P1: make evidence searchable (core of the MVP)

- [ ] **6. Read every file once, on the server**, including PDFs. Store the cleaned text, pieces split along the document's structure, and labels (see "How each file gets read").
- [ ] **7. Search over file pieces, limited to the company and project.** Convex keyword search first; Voyage vectors only if tests show misses. If vectors are added: Convex vector search runs only in actions, returns at most 256 results, and filters match exact values only, so store a combined key such as `clientId|projectId`.
- [ ] **8. Give drafting and chat a short list of every file, plus tools to search and read pieces on demand**, instead of loading 12 documents up front. The fact-finding step still goes through every piece. `docs/ai-architecture-plan.md:166` already calls for this.
- [ ] **9. Keep source links all the way through.** Anthropic's citation feature can't be combined with its strict JSON answer format, so keep Banhall's own quote fields in the structured steps.
- [ ] **10. Lighter evidence snapshots.** Each run copies all evidence text into `generationSources`; saving a fingerprint and parser version per file would be much lighter. This touches rule 2 ("every draft traces to exact inputs"), so discuss with the owner first.

### P2: prove it at scale

- [ ] **11. Test at the largest real cases and beyond:** 50 documents of 400k characters each, a 3-hour transcript, 20 picks in one step, a 46-entry Brief, every check failing at once. Record each AI answer's size and why it stopped, per step.
- [ ] **12. Measure request size with Anthropic's token count endpoint** instead of guessing 4 characters per token.
- [ ] **13. Brain improvements:** add company and fiscal-year filters; compare `voyage-4-large` and `voyage-context-4` against `voyage-3-large` (now legacy) on our own searches before switching; run bulk enrichment through Anthropic's batch service if question 4 is approved.
- [ ] **14. Don't use Anthropic's Files API for client files.** It isn't eligible for zero data retention, and it stores files rather than searching them.

## How each file gets read

No AI writes quotable text. Banhall checks every quote by exact match against the stored text, and an AI asked to "clean" a document can reword a sentence or change a digit.

| File | Tool | Runs on | Cost | What it keeps |
|---|---|---|---|---|
| PDF with real text | unpdf 1.9.1 (PDF.js 6.4) | Convex server | free | Text page by page, plus where each page starts |
| Scanned page, photo, image-only slide | Azure Document Intelligence: Read for plain pages, Layout for tables | Azure, Canada Central | $1.50 or $10 per 1,000 pages | Every word with a confidence score and its position |
| Word | mammoth 1.13, then turndown 7.2 to Markdown | Convex | free | Headings, lists, tables, footnotes |
| Interview transcripts | Today's parser (version 9) | unchanged | free | Speakers, timestamps, turns |
| Excel or CSV | SheetJS CE 0.20.3 (from SheetJS's own site; the npm copy is stuck at 0.18.5) | Convex | free | Sheet name, cell address, value, formula |
| .eml and .mbox | postal-mime 4.1 | Convex | free | Date, From, To, CC, body. Each attachment is read as its own file. |
| Outlook .msg | msgreader 1.29 | Convex | free | Same, plus emails embedded inside |

A page goes to Azure when it has under about 30 characters of text, shows garbled characters, or is mostly image.

| AI job | Model |
|---|---|
| Labels when folder and file name don't say (document type, fiscal year, title, 2-line summary) | Claude Haiku 5.5, about $0.001 per file |
| Short context note on each searchable piece | Haiku 5.5, reusing the whole document across calls (the Brain's method) |
| Describing a chart or handwritten table (if question 2 is approved) | Sonnet 5.5, Opus 5.5 for hard cases. Stored separately, marked not quotable. |

Every AI call keeps the decision 26 name placeholders.

**What gets stored per file:**

1. The original file (already stored today).
2. The raw reading, saved in file storage and never changed: pages, words, cells or turns, positions, OCR confidence, tool name and version.
3. The cleaned text in file storage as one string (citations need one exact string), plus a map of where each page, sheet range, email part or transcript turn starts.
4. Searchable pieces: 400 to 800 tokens, split along headings and pages; tables in groups of rows with the header repeated; transcripts in whole speaker turns (300 to 600 tokens) with times and speakers.
5. Labels on the file's row: company, fiscal year, document type, page count, fingerprint, parser version, whether OCR was used, count of low-confidence words.

**Upgrading a parser creates a new version instead of overwriting.** Old text stays, so saved quotes and past drafts keep matching. Files already frozen into a draft are never re-read.

**Convex limits to design around:** server actions get 512 MiB and 10 minutes; a database row is capped at 1 MiB, so text goes in file storage; the search component stores labels per file, not per piece, so page and time details need a side table; read files through a queue with time limits, since mammoth can hang on unusual Word files.

**Licences to avoid:** MuPDF and PyMuPDF (paid licence or open-sourcing Banhall), Marker and Surya (free only under US$5M funding or revenue), MinerU (public credit required when run as a service), pandoc-wasm (GPL).

**OCR side-by-side test:** run 50 to 100 pages (scans, tables, slides, handwriting) through Azure Read and Layout, Mistral OCR 4.1 and Docling. Count wrong digits, names and dates against hand-checked text. About a day of work and a few dollars.

## Company files: what changes

| Piece | Change |
|---|---|
| Storage | A new table of company files linked to `clients`, text in file storage, its own search |
| Company links | Link every existing project to its company first (the backfill), then decide what happens to projects with no company |
| Starting a draft | Copy company files into the draft's evidence as their own source kind in `generationSources`, so every draft still traces to exact inputs (rule 2) |
| How the AI treats them | A new label, roughly "about this company, but not this project or year", ranked below current-year evidence. They don't count as the current source decision 42 requires. |
| Name placeholders | Add the names in company files to the list swapped out before AI calls (decision 26) |
| Chat | Reach company files through search and read tools only, never loaded in full on every message |
| Inputs band | Show which company files fed a draft |
| Permissions | Add: Consultant, Manager, Admin. Remove or archive: Manager, Admin. Logged. |
| Merging companies | Move files to the company that's kept |
| Privacy | Keep company files out of the Brain and the lesson sets; search them only within their own company |

**Risks:**

- **Files can attach to the wrong company.** Companies match by name and near-duplicates aren't merged automatically. Retyping a project's company name moves it into another company's files without warning.
- **Past reports imported from OneDrive keep client names.** Feeding company files into the Brain would widen that exposure.
- **Convex's per-request read limit** is already strained by documents, so company files must live in file storage and be searched, not loaded whole.

## Learning: what's missing

What exists: two firm-wide lesson sets refreshed nightly (`qa_calibration`, `draft_style`), admitted only across 2 or more writers and 2 or more projects, published by an Admin; hand-filled writer profiles; the Brain.

Missing, most important first:

1. **Step by step choices are never learned from.** Picks, rewrites and rejections are the richest signal and are used only inside that run.
2. **No writer memory.** Writers re-teach preferences every time. Publishing a personal lesson set is blocked in `convex/learning.ts` until the privacy decision is recorded.
3. **No company memory.** `clients` holds only name, fiscal year and industry, and the AI never reads it.
4. **No proof of improvement.** Edit size isn't split by lesson-set or prompt version; there's one made-up test case and no with-and-without comparison.
5. **Chat doesn't learn and doesn't read the lesson sets.** Rejected suggestions are forgotten when the conversation ends.
6. **Final outcomes are dropped:** reviewer approve or return decisions, writer review comments, CRA results.
7. **Removing a Brain source doesn't remove lessons drawn from it.** Fix before the loops grow.

Rules any new loop keeps: the AI only proposes and a person applies (`chatProposals` and `applyProposal`); an Admin approves anything entering the Brain or a lesson set; every AI call is metered. Current Claude models can't be fine-tuned by customers, so improvement comes from better prompts, memory and examples, checked against test cases.

## Four-week plan

If week 1 starts Monday, October 26, week 4 ends Friday, November 20.

| Week | Work |
|---|---|
| 1 | Record decisions in `docs/product-domain.md` and `docs/architecture.md`. P0 items 1 and 2: stop chat, upload and the documents list from reading every file's full text, and fix the sign-off check's growing answer. Company backfill dry run. |
| 2 | Server reading (libraries, plus the Azure free tier). Company files table and storage. Upload on the company page (Paper Z8). Keyword search over file pieces. |
| 3 | Company files copied into each draft's evidence and searchable in chat; shown in the Inputs band. Step by step choices feeding the lesson sets. Chat reading the lesson sets. |
| 4 | Writer memory (AI suggests, writer approves, private). The test-case set and a blind test against Claude Projects with the same files. Edit size shown by version. |

If it slips, move writer memory to the next month. Keep the test cases: they're what proves Banhall beats ChatGPT.

## Facts worth keeping

- **Claude:** current models have 1M context and 128K output. Haiku 5.5 is $0.10 / $0.50 per million tokens. Processing runs in the US (1.1x price) or globally. The batch service keeps data 29 days. The Files API isn't eligible for zero data retention. Citations can't be combined with strict JSON output.
- **Convex:** Node actions get 512 MiB, 10 minutes and 5 MiB of arguments. Rows are capped at 1 MiB. Vector search returns at most 256 results with up to 16 filters, from actions only. No embedding model, no reranker. A Canada region exists at 30% extra; deployments can't move.
- **Azure Document Intelligence:** Read $1.50 and Layout $10 per 1,000 pages (Canada Central). Input deleted within 24 hours. Confidence score per word.
- **Mistral OCR 4.1:** $4 per 1,000 pages, US or EU, confidence per block only. The challenger in the side-by-side test.
- **Voyage:** about $0.12 per million tokens for `voyage-4-large` (third-party listing). Retention terms not checked; check before sending raw project files.

## Sources

- Azure: [Create a Document Intelligence resource (updated 2026-10-19)](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/create-document-intelligence-resource), [account options](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account), [service limits](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/service-limits), [pricing](https://azure.microsoft.com/en-us/pricing/details/ai-document-intelligence/), [Layout](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout?view=doc-intel-4.0.0), [data privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/document-intelligence/data-privacy-security)
- Claude: [models](https://platform.claude.com/docs/en/models/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [data residency](https://platform.claude.com/docs/en/manage-claude/data-residency), [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting), [citations](https://platform.claude.com/docs/en/build-with-claude/citations), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing), [Files](https://platform.claude.com/docs/en/build-with-claude/files)
- Anthropic research: [Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval), [Effective context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), [Demystifying evals](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
- Convex: [vector search](https://docs.convex.dev/search/vector-search), [text search](https://docs.convex.dev/search/text-search), [limits](https://docs.convex.dev/production/state/limits), [regions](https://docs.convex.dev/production/regions), [AI Gateway](https://docs.convex.dev/ai-gateway/overview), [convex/rag](https://github.com/get-convex/rag)
- Parsers: [unpdf](https://github.com/unjs/unpdf), [mammoth.js](https://github.com/mwilliamson/mammoth.js), [SheetJS](https://docs.sheetjs.com/docs/csf/cell/), [postal-mime](https://github.com/postalsys/postal-mime), [Docling chunking](https://docling-project.github.io/docling/concepts/chunking/)
- OCR comparison: [Mistral OCR 4.1](https://docs.mistral.ai/models/ocr-4-1), [OmniDocBench](https://github.com/opendatalab/OmniDocBench)
- Voyage: [voyage-context-4](https://blog.voyageai.com/2026/06/29/voyage-context-4/), [voyage-4-large listing](https://vercel.com/ai-gateway/models/voyage-4-large/about)
- Competitors: [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt), [ChatGPT memory](https://help.openai.com/en/articles/8590148-memory-in-chatgpt), [Claude Projects](https://support.claude.com/en/articles/9517075-what-are-projects), [Claude Projects search](https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects)
- Privacy: [Canadian AI privacy principles](https://www.priv.gc.ca/en/privacy-topics/technology/artificial-intelligence/gd_principles_ai/), [OPC de-identification](https://www.priv.gc.ca/en/opc-news/news-and-announcements/2024/de-id_20241011/)
