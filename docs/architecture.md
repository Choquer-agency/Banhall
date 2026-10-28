# How Banhall works

The one map of the web app: what the parts are, how they connect, and where to look when something changes or breaks. Start at section 1 and read down; each section zooms in on one box from the section before.

Last checked against the code at commit `fc016a6f` on branch `feat/clients-and-projects-redesign`, 2026-10-21. When a change moves a box or an arrow, update this file in the same change (see section 12).

Deeper references, when you need them: `docs/product-domain.md` (the binding rules for workflow and permissions), `docs/system-map.md` (the 2026-09-03 audit, with risks and open questions), `docs/the-brain.md`, `docs/design-system.md`.

**Colour key used in every diagram**

| Colour | Means |
| --- | --- |
| Yellow | People |
| Blue | The web app in the browser (`src/`) |
| Green | The Convex backend (`convex/`) |
| Purple | AI services outside our code |
| Grey | Other outside tools and services |
| Red | A person must act before anything moves on |
| Dashed | Exists on paper but blocked or not built yet |

---

## 1. The big picture

```mermaid
flowchart TD
  classDef person fill:#FFF4DC,stroke:#B7791F,color:#1F1F1F
  classDef web fill:#E3EEFF,stroke:#3567C8,color:#1F1F1F
  classDef server fill:#E2F4EA,stroke:#2E8555,color:#1F1F1F
  classDef ai fill:#F1E6FF,stroke:#7E4BC4,color:#1F1F1F
  classDef outside fill:#EEEEEE,stroke:#777777,color:#1F1F1F

  staff["Consultants, Managers, Admins<br/>email and password"]:::person
  client["Client reviewer<br/>share link, no login"]:::person
  uploader["OneDrive uploader<br/>scripts/client-uploader"]:::outside

  subgraph WEB["Web app on Vercel"]
    pages["Pages and components<br/>SvelteKit + Svelte 5"]:::web
    proxy["Sign-in proxy<br/>/api/auth"]:::web
  end

  subgraph CVX["Convex backend"]
    fns["Server functions<br/>convex/*.ts"]:::server
    db[("Database<br/>126 tables")]:::server
    files[("File storage")]:::server
    bg["Background work<br/>scheduled actions, crons"]:::server
  end

  subgraph AI["AI services"]
    claude["Anthropic Claude"]:::ai
    orr["OpenRouter"]:::ai
    voy["Voyage"]:::ai
  end

  staff --> pages
  client --> pages
  pages -- "live data" --> fns
  pages --> proxy --> fns
  uploader -- "POST /ingestion/upload" --> fns
  fns --> db
  fns --> files
  fns -- "long jobs" --> bg
  bg --> claude
  bg --> orr
  bg --> voy
```

Claude drafts, chats and checks. OpenRouter carries the GPT and Gemini models, web search, and a fallback route to Claude. Voyage powers Brain search.

Five facts explain most of the app:

1. **The browser keeps no data of its own.** Every screen subscribes to Convex queries. When a row changes, every open screen that reads it updates on its own, with no refresh.
2. **Convex enforces every rule.** Hiding a button in the browser is only a convenience. Each query and mutation checks the signed-in person's role again on the server.
3. **The AI never writes report text by itself.** It proposes a change; a person clicks Apply. This is the most important rule in the product.
4. **Long jobs run in the background.** Drafting, chat replies, QA and research run as Convex actions. The browser watches their progress rows and shows them live.
5. **There is one Convex deployment today** (`energized-salamander-237`). Developers and writers use the same one; there is no separate production backend yet.

---

## 2. The life of a project

This is the path a piece of work takes from start to finish. Every later section explains one or more of these steps.

```mermaid
flowchart LR
  classDef step fill:#E3EEFF,stroke:#3567C8,color:#1F1F1F
  classDef ai fill:#F1E6FF,stroke:#7E4BC4,color:#1F1F1F
  classDef human fill:#FFE4E1,stroke:#C0392B,color:#1F1F1F
  classDef blocked fill:#F5F5F5,stroke:#999999,stroke-dasharray:4 3,color:#666666

  subgraph setup["Set up"]
    direction TB
    s1["1. Client<br/>pick or create"]:::step
    s2["2. Project<br/>New project page"]:::step
    s3["3. Evidence<br/>transcripts and files"]:::step
    s1 --> s2 --> s3
  end

  subgraph write["Write"]
    direction TB
    s4["4. Draft<br/>AI writes Lines 242, 244, 246"]:::ai
    s5["5. Edit<br/>editor and chat"]:::human
    s4 --> s5
  end

  subgraph deliver["Review and deliver"]
    direction TB
    s6["6. Internal review<br/>hand off to a reviewer"]:::human
    s7["7. Client review<br/>share link and comments"]:::human
    s8["8. Export<br/>CRA .docx"]:::step
    s9["9. Submitted, Delivered<br/>blocked today"]:::blocked
    s6 --> s7 --> s8 --> s9
  end

  setup --> write --> deliver
```

| Step | Where it happens (page) | Backend module | Main tables |
| --- | --- | --- | --- |
| 1. Client | `/projects` client list, client picker on New project | `convex/clients.ts` | `clients` |
| 2. Project | `/project/new` | `convex/projects.ts`, `convex/intakeDrafts.ts` | `projects`, `intakeDrafts` |
| 3. Evidence | `/project/new`, Files panel on `/project/[id]` | `convex/transcripts.ts`, `convex/documents.ts` | `transcripts`, `projectDocuments` |
| 4. Draft | `/project/[id]` | `convex/generations.ts`, `convex/ai/` | `generations`, `generationSources`, `reports` |
| 5. Edit | `/project/[id]` editor and chat panel | `convex/reports.ts`, `convex/chatV2.ts` | `reports`, `chatProposals`, `reportSnapshots` |
| 6. Internal review | Details panel on `/project/[id]`, Home (`/my-work`) | `convex/workItems.ts`, `convex/projectWorkflow.ts` | `workItems`, `reviewDecisions`, `projectEvents` |
| 7. Client review | `/review/[shareToken]` | `convex/comments.ts`, `convex/projects.ts` (`publishForReview`) | `comments`, `commenters`, `reportViews` |
| 8. Export | Export button on `/project/[id]` | `convex/reports.ts` (preflight, authorize, complete) and `src/lib/exportTemplateDocx.ts` | `reportExports` |
| 9. Submitted, Delivered | Details panel (shown disabled) | `convex/projectWorkflow.ts` refuses both | `reportBranches` and `productionOutcomes` do not exist yet |

---

## 3. The data: what is stored and how it connects

There are 136 tables in `convex/schema.ts`. Most are supporting detail. These are the ones that carry the story:

Read each arrow as "has many". The second line in each box says what the rows are for.

```mermaid
flowchart LR
  classDef core fill:#E2F4EA,stroke:#2E8555,color:#1F1F1F
  classDef child fill:#FFFFFF,stroke:#2E8555,color:#1F1F1F

  clients[("clients")]:::core
  users[("users")]:::core
  projects[("projects")]:::core

  subgraph evidence["Evidence"]
    direction LR
    transcripts["transcripts<br/>interviews"]:::child
    projectDocuments["projectDocuments<br/>supporting files"]:::child
    projectDocumentTexts["projectDocumentTexts<br/>file text, in pieces"]:::child
    projectDocuments --> projectDocumentTexts
  end

  subgraph drafting["Drafting"]
    direction LR
    generations[("generations<br/>draft runs")]:::core
    generationSources["generationSources<br/>frozen evidence"]:::child
    generations --> generationSources
  end

  subgraph report["The report"]
    direction LR
    reports[("reports<br/>the report text")]:::core
    reportSnapshots["reportSnapshots<br/>history"]:::child
    comments["comments<br/>review"]:::child
    agentChatThreads["agentChatThreads<br/>chat"]:::child
    chatProposals["chatProposals<br/>AI suggested edits"]:::child
    reports --> reportSnapshots
    reports --> comments
    reports --> agentChatThreads
    reports --> chatProposals
  end

  subgraph work["Work and records"]
    direction LR
    workItems["workItems<br/>hand-offs, assigned to a user"]:::child
    projectEvents["projectEvents<br/>audit log"]:::child
    aiUsage["aiUsage<br/>AI cost"]:::child
  end

  clients -- "clientId" --> projects
  users -- "ownerId" --> projects
  projects --> evidence
  projects --> drafting
  projects --> report
  projects --> work
```

Users also have `notifications` (their inbox) and the `workItems` assigned to them.

**The report itself** is one row in `reports`, which also records the run that produced it (`reports.generationId`). Its `content` field is the Tiptap editor document stored as a JSON string, with three headings, "Line 242", "Line 244" and "Line 246", that both the backend and the editor rely on (`src/lib/reportSections.ts`). Every save bumps `revisionNumber` and `contentHash`. An editor save names the revision it started from and is refused if the report has moved on; export checks both, so the file matches the text that was reviewed.

**A project has four separate state fields.** They look alike but answer different questions, and the product rules forbid one writing into another:

| Field on `projects` | Answers | Who changes it |
| --- | --- | --- |
| `workflowStage` | Where is the work? (Intake, Drafting, Internal review...) | People, through `projectWorkflow.setWorkflowStage` and `workItems.handOff` |
| `activeGenerationId` pointing to `generations.status` | What is the AI doing right now? | The drafting engine only |
| `generationActivity` | Same as above, copied for dashboard badges | The drafting engine only |
| `status` | Old field (draft, generating, review, client_review, final) | Kept for compatibility; do not build on it |

**A file's text lives apart from its row (2026-10-22).** A `projectDocuments` row keeps facts about its text (length, a fingerprint, word count, an opening preview). The text itself is stored in `projectDocumentTexts`, in pieces of at most 32,000 characters. Every read goes through `convex/lib/documentText.ts`, so lists, uploads and chat read only what they need. Older rows keep their text on the row until the one-off backfill in `convex/documentTextMigration.ts` moves it.

**Earlier text is kept as a version (2026-10-26).** When a server reading replaces a file's text, the text it had is kept first as its next version in `projectDocumentTextVersions`, its text in `projectDocumentTextVersionPieces`, and never changed (`keepDocumentTextVersion` in `convex/lib/documentText.ts`). Versions are deleted with their file and their project. **Drafts refer to stored text (2026-10-27).** A new draft's `generationSources` row for a project file or company file refers to a version of exactly the text it read, stored once in `sourceTextVersions` and their pieces and reused by later drafts; a transcript row refers to its transcript. Every reader goes through `sourceRowText` (`convex/lib/sourceText.ts`), which checks fingerprints and lengths and returns rows in the old shape. Drafts made before keep their own copies. A project's versions go with the project; a company file's go once the file is removed and no draft uses them (`convex/sourceTextSweep.ts`).

**Clients are new (2026-10-14).** Projects now store both `clientName` and `clientId`, and every write keeps the two in step. Grouping on the Projects page still reads `clientName`; nothing groups by `clientId` yet.

**Companies hold their own files (2026-10-26).** A `companyFiles` row belongs to a company (a `clients` row), with its text in `companyFileTexts` and every add, archive, restore, removal and merge move in `companyFileEvents`. Reading, adding and managing them are their own capabilities (`companyFiles.read`, `companyFiles.add`, `companyFiles.manage`), and a company's view of the Projects page has a Files tab. A draft freezes the project's company's files after the project's own, as `company_file` rows; chat finds them only through its search and read tools. Merging companies moves their files, and erasing a project never touches them.

**Tables by area**

| Area | Count | Examples |
| --- | --- | --- |
| People and access | 5 | `users`, `invites`, `userActivity` |
| Clients and projects | 11 | `clients`, `projects`, `projectEvents`, `dashboardCompanies`, `tags`; company files (`companyFiles`, `companyFileTexts`, `companyFileEvents`) |
| Evidence (inputs) | 24 | `transcripts` and their turns, speakers, facts and digests; `projectDocuments`, their text (`projectDocumentTexts`) and its earlier versions (`projectDocumentTextVersions`); search pieces (`documentSearchPieces`); `intakeDrafts`; financial uploads |
| Report and editing | 9 | `reports`, `reportSnapshots`, `comments`, `reportExports`, `reportProvenance` |
| Drafting engine | 33 | `generations`, `generationSources`, `generationSourceUse`, `generationSectionRuns`, `generationBriefs`, `briefPreparations`, `seeds`, `reportCandidates`, `complianceNotes` |
| Chat and research | 13 | `agentChatThreads`, `chatTurns`, `chatProposals`, `researchSessions` |
| Review and QA | 7 | `qaFindings`, `reviewDecisions`, `writerReviews`, `pdReviews`, `comparisons` |
| Brain and learning | 13 | `brainSources`, `learningDigests`, `writerProfiles`, `ingestionItems` |
| Work and notifications | 8 | `workItems`, `workItemEvents`, `workItemOversight`, `notifications` |
| AI usage and models | 10 | `aiUsage`, `modelCatalog`, `modelRoleAssignments`, `modelTracks` |
| Admin and misc | 4 | `appSettings`, `errorReports`, `changelogEntries` |

Convex components keep their own tables outside this count: `betterAuth` (sign-in accounts), `agent` (chat messages), `rag` (Brain vectors), `rateLimiter`, `embedPool` (a work queue for Brain embedding) and `researchWorkflow`.

---

## 4. Inside the browser

### Pages

```mermaid
flowchart TD
  classDef web fill:#E3EEFF,stroke:#3567C8,color:#1F1F1F
  classDef person fill:#FFF4DC,stroke:#B7791F,color:#1F1F1F
  classDef admin fill:#EEEEEE,stroke:#777777,color:#1F1F1F

  root["+layout.svelte<br/>Convex client, sign-in, error boundary, toasts"]:::web
  open["No login needed<br/><br/>/login<br/>/signup/[token]: accept an invite<br/>/review/[shareToken]: client reads and comments"]:::person
  gate["WorkspaceGate<br/>signed out goes to /login"]:::web
  shell["WorkspaceShell<br/>left rail, command palette, shortcuts"]:::web
  daily["Daily work<br/><br/>/my-work: Home, what is with you<br/>/projects: clients and their projects<br/>/project/new: create and upload evidence<br/>/project/[id]: the report page<br/>/project/[id]/financial"]:::web
  other["Everything else<br/><br/>/settings: account, writing, notifications, shortcuts<br/>/team: members and invites, Managers and Admins<br/>/changelog"]:::web
  restricted["Restricted<br/><br/>/admin/*: house rules, Brain, models, usage...<br/>/alerts, /requests: developers only"]:::admin

  root --> open
  root --> gate --> shell
  shell --> daily
  shell --> other
  shell --> restricted
```

- `/` sends you to `/my-work` when signed in, otherwise to `/login`.
- `/dashboard` is the old entry. It redirects to the new pages, or shows the old interface when the URL has `?workspace=current`. The old interface stays in the repo as a rollback.
- There is no `/clients` page. Clients live on `/projects`; `?client=<key>` selects one, and the rail's Companies link points there.
- Admin pages: house-rules, tags, brain, ingestion, models, reviews, learning and usage are on the rail; comparisons, backfill and users open from the command palette.

### How a page gets and changes data

```mermaid
sequenceDiagram
  participant P as Page
  participant C as Convex client
  participant F as Convex function
  participant D as Database
  P->>C: useQuery(getLatestReport)
  C->>F: run query + token
  F->>D: check access, read
  F-->>P: result
  Note over P,D: The subscription stays open
  P->>C: useMutation(updateReportContent)
  C->>F: run mutation
  F->>D: check access, write
  D-->>P: affected queries re-run and push
```

The page asks for data with `useQuery` and keeps listening. When anyone writes with a mutation, every query that read the changed rows runs again and pushes the new result to every open page.

### How sign-in works

1. `/login` calls Better Auth in the browser (`src/lib/authClient.ts`).
2. The request goes to our own site at `/api/auth/*`, which forwards it to Convex (`src/lib/server/authProxy.ts`).
3. Convex Better Auth (`convex/auth.ts`) checks the password and sets a cookie holding a 15-minute token.
4. `src/hooks.server.ts` reads that cookie for the first page load and adds security headers. After that, the Convex client sends the token with every query.
5. New people join only by invite. A Manager or Admin creates the invite on `/team` and copies the link by hand; there is no email service.

### Uploading files

Text is pulled out in the browser before anything is sent: PDFs with pdf.js, Word files with mammoth as Markdown (`src/lib/parseDocument.ts`, `shared/wordMarkdown.ts`; the row's `textFormat` says so), spreadsheets in a Web Worker (`src/lib/spreadsheet.worker.ts`), transcripts in `src/lib/transcriptUpload.ts`. The original file is uploaded separately: `documents.generateUploadUrl`, then a direct POST to Convex storage, then `claimUpload` (`src/lib/uploads/originalUpload.ts`). On the server, `documents.uploadDocument` stores the text as pieces and finds a duplicate (same name, same text) by its fingerprint, without reading other files' text.

When nothing came out of a supported file in the browser (no text, or only a "stopped reading" line), the server reads the stored original once per reader version (`convex/lib/serverReading.ts` decides, `convex/ai/fileReading.ts` reads with `readFileOnServer` from `convex/ai/fileReader.ts`, `convex/documentReading.ts` claims and saves). A file with read text keeps it, except a Word file whose text is not Markdown yet (read by an older browser tab): the server reads it again as Markdown, and its plain text is kept as a version first. The owner's one-off pass `documentReading.queueServerReadings` does the same for existing files. A draft freezes Word Markdown without its bold and italic marks (`frozenFileText` in `convex/lib/briefEvidence.ts`), so quotes are matched exactly as for any other file; the file preview shows it formatted. The OneDrive import (`convex/ingestionSync.ts`) reads its files with the same reader, each PDF in its own action.

Every text write marks a file due for search pieces. A sweep every minute cuts them (`convex/searchPieces.ts`, `convex/ai/searchIndexing.ts`, the rules in `shared/searchPieces.ts`): about 600 tokens each, along pages, sheets, messages and headings, each with the fingerprint of the text its positions refer to. `searchProjectPieces` (`convex/lib/searchPieces.ts`) searches one project's pieces. Cutting a file's pieces marks its labels due; a second sweep asks the `file_labels` model role (Claude Haiku) for its kind, fiscal year, title and summary, with names hidden (`convex/fileLabels.ts`, `convex/ai/fileLabels.ts`). Labels describe files; they are never evidence. The reading helpers both sides use are in `shared/` (`spreadsheetText.ts`, `emailText.ts`, `documentContent.ts`).

---

## 5. The report page

`/project/[id]` is where most of the work happens. The page component is `src/lib/components/project/PreviewProjectPage.svelte`. Each panel talks to its own backend module:

```mermaid
flowchart LR
  classDef web fill:#E3EEFF,stroke:#3567C8,color:#1F1F1F
  classDef server fill:#E2F4EA,stroke:#2E8555,color:#1F1F1F
  classDef human fill:#FFE4E1,stroke:#C0392B,color:#1F1F1F

  page["Report page<br/>PreviewProjectPage.svelte"]:::web

  editor["Editor<br/>Tiptap, autosaves"]:::web
  gen["Draft controls<br/>mode, progress, Seeds"]:::web
  chat["Chat panel<br/>AgentChatPanel"]:::web
  filesp["Files panel<br/>transcripts, documents"]:::web
  hist["Version history"]:::web
  qa["QA panel"]:::web
  details["Details panel<br/>stage, owner, hand-off"]:::web
  share["Share and comments"]:::web
  exp["Export .docx"]:::human

  page --> editor & gen & chat & filesp & hist & qa & details & share & exp

  editor --> m1["reports.updateReportContent"]:::server
  gen --> m2["generations.*<br/>seeds.*"]:::server
  chat --> m3["chatV2.*<br/>research.*"]:::server
  filesp --> m4["transcripts.*<br/>documents.*"]:::server
  hist --> m5["snapshots.*"]:::server
  qa --> m6["generations.requestReportQa"]:::server
  details --> m7["projectWorkflow.setWorkflowStage<br/>workItems.handOff"]:::server
  share --> m8["projects.publishForReview<br/>comments.*"]:::server
  exp --> m9["reports.preflightExport, authorizeExport<br/>then exportTemplateDocx in the browser"]:::server
```

- Chat, version history, QA and the step-by-step stepper load only when opened, so the page starts fast.
- Export builds the file in the browser by filling `static/templates/schedule60.docx` with JSZip. Before that, the server checks the report revision, the Line 206 science code and filing readiness. `exportTemplateDocx` must only be imported in browser-only code.
- CRA limits that the drafting engine and export both enforce: 78 characters per line; Line 242 up to 50 lines or 350 words, Line 244 up to 100 lines or 700 words, Line 246 up to 50 lines or 350 words (`convex/lib/lineLimits.ts`).

---

## 6. Writing a draft

The writer picks one of three modes (`shared/generationModes.ts`):

| Mode | Label in the app | What happens |
| --- | --- | --- |
| `iterative` | Step by step (recommended) | AI suggests ideas (Seeds) per subsection; the writer picks and signs off; then AI writes |
| `single` | Single draft | One full draft goes straight to the editor |
| `compare` | Compare two drafts | Two models each write a draft; the writer keeps the better one |

```mermaid
flowchart TD
  classDef server fill:#E2F4EA,stroke:#2E8555,color:#1F1F1F
  classDef ai fill:#F1E6FF,stroke:#7E4BC4,color:#1F1F1F
  classDef human fill:#FFE4E1,stroke:#C0392B,color:#1F1F1F

  start["Writer clicks Generate<br/>generations.requestGeneration"]:::human
  reserve["Reserve the run<br/>check evidence, rate limits, one run per project<br/>record the evidence in generationSources, its text stored once<br/>freeze the models"]:::server
  mode{"Which mode?"}

  start --> reserve --> mode

  mode -- "Step by step" --> brief1["Brief<br/>storyline, exclusions, glossary"]:::ai
  brief1 --> seeds["Seeds<br/>AI suggests ideas for 13 subsections"]:::ai
  seeds --> signoff["Writer picks, edits and signs off<br/>generations.signOffSeedStage"]:::human
  signoff --> chain

  mode -- "Single or Compare" --> prep["Analyzer + Brief + Brain examples<br/>+ writer style + learning digests"]:::ai
  prep --> chain

  subgraph chain["Section chain, one Line at a time, in the writer's build order"]
    direction LR
    l242["Line 242"]:::ai --> l244["Line 244"]:::ai --> l246["Line 246"]:::ai
  end

  chain --> finalize["Finalize<br/>consistency pass, build the editor document"]:::ai
  finalize --> pick{"Compare mode?"}
  pick -- "yes" --> choose["Writer picks the better draft<br/>selectReportCandidate"]:::human
  pick -- "no" --> save
  choose --> save["Save to reports<br/>plus a 'generated' snapshot"]:::server
  save --> qa["Background QA<br/>findings appear in the QA panel"]:::ai
```

**Inside each Line** (`convex/ai/orderedGeneration.ts`): draft, then remove banned words, then shorten to the CRA limits, then a self-check (fixed rules plus one AI check), then at most one repair. Each Line reads the Lines already written. Notes on which style rules were applied go to `complianceNotes`. In Step by step, a Line whose final check does not fit one request is checked in up to 8 requests sent at once (`planSummarySelfCheckBatches` in `convex/lib/seedRevisions.ts`, 2026-10-26).

**Answer limits** (2026-10-26): a request whose answer limit is over 16,384 tokens streams and is read to its end (`instrumentedAnthropic` in `convex/ai/instrument.ts`), so a long answer is not lost to a request timeout. A cut-off answer from a report-sized step is retried with the model's full output limit (`cutOffRetry` in `convex/ai/structured.ts`, limits from `modelOutputCap` in `shared/generationModels.ts`).

**What a draft freezes** (`selectFrozenEvidence` in `convex/lib/briefEvidence.ts`): the transcripts, then the project's files in upload order (at most 50, each cut at 200,000 characters), then the company's files, up to the first file that would take all frozen text past `FROZEN_TOTAL_BYTES` (about 3 MiB, 2026-10-27). That total is what a Seed attempt has room to read in its 8 MiB read budget after what the budget sets aside and the draft's decisions, so a draft whose first step cannot start is never frozen. Files past it are listed in the Inputs band as not captured: the project's own from the project's file list, the company's from the list the draft records at its start (`companyFilesLeftOut`, 2026-10-28).

**What each step read** (2026-10-26): the analyzer, the Brief, each Seed step and each Line's facts check record how much of each frozen row they sent, once their request has answered (`generationSourceUse`, `convex/lib/generations/sourceUse.ts`). The Brief's Inputs band shows it under each file, for example "Read by the analysis (whole), Seeds (in part, 3 of 13 steps)." A reused Brief and a Summary recovery copy the record of the draft they come from.

**Run status** on the `generations` row (`shared/generationTransitions.ts`):

```mermaid
stateDiagram-v2
  [*] --> reserved
  reserved --> running
  running --> awaiting_input : Step by step
  awaiting_input --> running : writer signs off
  running --> awaiting_selection : Compare
  awaiting_selection --> completed : writer picks
  running --> completed : Single
  running --> failed : error or stuck
  awaiting_selection --> superseded : retry failed drafts
```

`awaiting_input` means Step by step is waiting for the writer to sign off the Seeds. `awaiting_selection` means Compare is waiting for the writer to pick a draft. Any active status can also end in `failed`.

A cron checks every 10 minutes and fails any run with no progress for 30 minutes (`convex/lib/generations/reapers.ts`), so a crash never leaves a project stuck on "Generating".

**Which AI model does what** (`shared/modelCatalog.ts`, `convex/lib/generationSteps.ts`): the writer's chosen model drafts, repairs and shortens; a "planning" model runs the analyzer, Brief and Seeds; a "checking" model runs self-check, consistency and QA. Each role follows a tier (Claude Sonnet, Haiku or Opus), which runs that tier's newest version; the default writing model is the Claude Sonnet tier's (`claude-sonnet-5-5` on 2026-10-22). A run keeps the models frozen at its start; a retry or Summary recovery of a failed run leaves a model its tier was moved back from for the tier's current one, and so does each step the writer starts in a run (a Seeds request, sign-off, "Draft the rest", a QA run): the run's own freeze switches to the tier's current model and records it in `generations.modelMoves`, while the writer's picks and the Summary stay as they are. Work already running finishes on its model; each action reads the freeze once (`convex/ai/generationFreezeRead.ts`). Admins point roles at tiers on `/admin/models`.

**Cost and limits.** Every AI call is recorded in `aiUsage` (see `/admin/usage`). Rate limits live in `convex/lib/aiRateLimits.ts`, for example 12 drafts per person per hour and 6 per project per hour.

---

## 7. Chat: the AI proposes, the writer applies

```mermaid
sequenceDiagram
  participant W as Writer
  participant S as sendMessage
  participant A as Chat agent
  participant P as Proposal card
  W->>S: send a message
  S->>S: save, queue a turn
  S-->>A: start in background
  A->>A: read files, search
  A-->>W: reply streams in
  A->>P: propose an edit, one card per Line
  Note over W,P: The report has not changed yet
  W->>P: click Review
  P-->>W: the report marks the words that change
  W->>P: click Accept
  P->>P: snapshot, apply, revision + 1
  W->>P: Undo, if needed
```

1. `chatV2.sendMessage` saves the message and queues a chat turn.
2. The chat agent (`convex/ai/chatAgentV2.ts`) runs in the background. It can read the project's files and search the web or the Brain, and its reply streams to the screen.
3. When it wants to change the report, it saves proposal cards as `pending`, one per CRA Line the change touches (`convex/lib/reportLines.ts`). An edit inside one Line may carry up to three options. The report is untouched.
4. The writer clicks Review. The report page marks only the words that change, inside the card's Line, and shows a review bar (`ReviewSession` in `src/lib/chat/assistantCards.svelte.ts`, drawn by `Editor.previewProposal` and `ReviewBar.svelte`).
5. The writer clicks Accept, or Accept all for two or more waiting cards from one reply. `chatV2.applyProposal` checks access, snapshots the report, applies the chosen option and bumps the revision. A find/replace card changes only its own Line.
6. Undo reverses an applied card, after taking another snapshot. The Undo bar above the message box holds the latest accept; an opened accepted card always offers Undo.

The chat agent has 13 tools. Only the first three can produce an edit, and each one only creates cards that wait for the writer:

| Tool | What it does |
| --- | --- |
| `proposeEdit` | Suggest replacing one passage |
| `proposeReplacements` | Suggest a find-and-replace across the report |
| `proposeBulkEdits` | Suggest a larger revision, with a report of what changed |
| `highlightPassages` | Point at passages, no edit |
| `askWriter` | Ask the writer one question with 2 or 3 options; it ends the reply, and the options show above the message box |
| `deviationInventory` | List where paragraphs depart from the style rules |
| `compareReferencePd` | Compare with last year's report |
| `readDocument`, `searchDocuments`, `readTranscript` | Read the project's files, its company's files and its transcripts |
| `viewFile` | Look at PDF pages and images |
| `searchWeb` | Web search through OpenRouter, with names removed from the query |
| `searchBrain` | Search approved past reports, only when the writer turns it on |

**Files in a chat turn** (2026-10-26): with the reading tools on, a turn carries the project's files' text only when every file fits whole (each within one file's allowance, at most 12, together at most 80,000 characters). Otherwise it carries none, and the assistant finds and opens them with `searchDocuments` and `readDocument` from the list of files. `searchDocuments` searches a file whose search pieces are current through its pieces and every other file the old way, cuts each excerpt around its match, and places it by the parts `readDocument` opens.

Proposal card states: `pending`, then `applied`, `rejected` or `stale` (the target text was no longer in the report). Undo moves an applied card back to `pending`. A card stores its Line (`section`), its other options (`alternatives`) and, once applied, which option went in (`appliedOption`). A reply that crashes is failed by a cron that runs every 2 minutes.

**Research** (`convex/research.ts`, `convex/ai/research/`) works on a selected passage: web research, deep research and Brain patterns run side by side, a reviewer model merges them, and the result arrives as a proposal card like any other.

---

## 8. Where the AI's style and knowledge come from

```mermaid
flowchart LR
  classDef server fill:#E2F4EA,stroke:#2E8555,color:#1F1F1F
  classDef human fill:#FFE4E1,stroke:#C0392B,color:#1F1F1F
  classDef ai fill:#F1E6FF,stroke:#7E4BC4,color:#1F1F1F

  ev["Frozen evidence<br/>generationSources"]:::server
  house["House rules<br/>set by Admin on /admin/house-rules"]:::human
  writer["Writer profile<br/>/settings/writing"]:::human
  prose["Plain-writing rules and banned words<br/>shared/humanProse.ts, shared/bannedWords.ts"]:::server
  brain["Brain examples<br/>past reports an Admin approved"]:::human
  digest["Learning digests<br/>lessons an Admin published"]:::human

  prompt["Every drafting and chat prompt<br/>convex/ai/prompts.ts"]:::ai

  ev --> prompt
  house --> prompt
  writer --> prompt
  prose --> prompt
  brain --> prompt
  digest --> prompt
```

- **Plain-writing rules** in `shared/humanProse.ts` always apply and cannot be switched off. Change them there, not inside one prompt.
- **House rules** (`shared/houseRules.ts`) are the firm's rulebook. An Admin decides which ones writers may waive.
- **The Brain** is a library of good past reports. Material reaches it three ways, and every way needs an Admin:
  - a writer review scoring 85 or more nominates the report;
  - writer feedback an Admin approves is nominated too;
  - an Admin approves a file imported from OneDrive on `/admin/ingestion` (this one goes straight in).

  Nominations wait as pending until an Admin approves them on `/admin/brain`. Approved material is embedded with Voyage and searched during drafting.
- **Learning digests** are short lessons distilled from writer feedback, QA feedback and edits, refreshed nightly. A digest only reaches prompts after an Admin publishes it. Revoking or removing a Brain source withdraws the feedback it was made from (`brainFeedbackQueue.withdrawnAt`, `convex/lib/learningWithdrawal.ts`): new digests skip it, and a published digest that drew on it is turned off until an Admin publishes one that did not draw on it (2026-10-26). Step-by-step choices (Seed rewordings, Feedback, picks) and review decisions and comments feed the style digest too, as masked copies in `learningSignals` (2026-10-26), and chat reads the published style digest as drafting does. A writer's own saved preferences (`writerMemories`, suggested by the AI from their own work and kept only when they approve, `convex/writerMemory.ts`) join their Writer Profile text wherever it applies (2026-10-27). The release suite's projects are evaluation projects (`projects.evaluation`, `convex/lib/evaluationProjects.ts`), left out of learning, writer memory, edit size and Brain nomination (2026-10-27).
- **Provenance:** each run records which prompt version, digests and Brain sources it used (`generations.promptVersion`, `learningDigestIds`, `brainProvenance`).
- **Edit size:** how much of a draft writers changed is read at candidate selection, milestones, publish, each chat apply and the end of each editing burst (`reportEditDistance`, `convex/lib/editDistance.ts`). The Admin learning health view averages one reading per report per version: prompt version, lesson sets and saved preferences used, read through the generation (2026-10-27).

---

## 9. Workflow, roles and hand-offs

### Stages

```mermaid
stateDiagram-v2
  state "Intake" as intake
  state "Interview complete" as interview_complete
  state "Drafting" as drafting
  state "Internal review" as internal_review
  state "Edits" as edits
  state "Client review" as client_review
  state "Revisions" as revisions
  state "Submitted (blocked)" as ready_for_delivery
  state "Delivered (blocked)" as delivered

  [*] --> intake
  intake --> interview_complete
  interview_complete --> drafting
  drafting --> internal_review
  internal_review --> edits : reviewer returns it
  internal_review --> ready_for_delivery : reviewer approves
  edits --> client_review
  client_review --> revisions
  revisions --> ready_for_delivery
  ready_for_delivery --> delivered
```

- Any stage can move to any other; the diagram shows the usual path. On hold and Abandoned can be reached from anywhere and need a note. Abandoning is refused while work items are open, and only a Manager or Admin can reopen an abandoned project.
- Moving from Internal review to Edits or to Submitted needs a recorded reviewer decision (return or approve), saved in `reviewDecisions` against the exact report revision.
- **Submitted and Delivered are refused for everyone today.** They need report branches and delivery outcomes, which are not built yet (`convex/projectWorkflow.ts`).
- Every stage change goes through one writer (`patchProjectWorkflowStage` in `convex/lib/dashboardProjection.ts`). In the same step it updates the dashboard counts and appends a `projectEvents` row, so the history is never lost.

### Owner and hand-offs

- `createdBy` is who made the project and never changes. `ownerId` is who is accountable and can be transferred. Permissions use the owner, never the creator.
- A **work item** is a request to one person: internal review, revision, interview follow-up, delivery prep, financial or other. It is open, then completed, declined or canceled, and never reopens.
- `projects.currentHandoffId` points to the one open blocking work item, which answers "who has it now". Home (`/my-work`) shows what is with you.
- Handing off (`workItems.handOff`) picks a person and a stage at once, cancels the previous hand-off and notifies the new person.

### Who can do what

Roles are stored on `users.role` (`shared/roles.ts`). "Own" means projects where you are the owner, or where you hold an open work item when editing the report. The full matrix is in `shared/capabilities.ts`.

| Can... | Consultant | Manager | Admin |
| --- | --- | --- | --- |
| Create projects, read all internal projects | Yes | Yes | Yes |
| Edit report text, change stage, transfer owner, create work items | Own | All | All |
| Complete someone else's work item | No | Yes | Yes |
| See financial data | No | Yes | Yes |
| See the team, send invites | No | Yes | Yes |
| Change roles, configure settings, see alerts | No | No | Yes |

Server-side checks live in `convex/lib/auth.ts` (`requireCurrentUser`, `requireInternalProjectAccess`) and `convex/lib/roleCapabilities.ts` (`requireCapability`, `requireReportEditAccess`). A client on a share link can read only the published report and add comments.

---

## 10. Background jobs, outside services and deployment

```mermaid
flowchart TD
  classDef web fill:#E3EEFF,stroke:#3567C8,color:#1F1F1F
  classDef server fill:#E2F4EA,stroke:#2E8555,color:#1F1F1F
  classDef outside fill:#EEEEEE,stroke:#777777,color:#1F1F1F
  classDef ai fill:#F1E6FF,stroke:#7E4BC4,color:#1F1F1F

  gh["GitHub<br/>pull request or push to main"]:::outside
  ci["CI: ci.yml<br/>verify + browser tests"]:::outside
  vercel["Vercel<br/>builds and hosts the web app"]:::web
  cl["publish-changelog.yml<br/>after a production deploy"]:::outside
  browser["Browser"]:::web
  dev["Developer<br/>Convex CLI"]:::outside
  cvx["Convex deployment<br/>energized-salamander-237"]:::server
  outside["Anthropic, OpenRouter, Voyage<br/>Microsoft Graph"]:::ai

  gh --> ci
  gh -- "git integration" --> vercel
  vercel -- "deploy promoted" --> cl
  cl -- "npx convex run" --> cvx
  browser -- "pages" --> vercel
  browser -- "data" --> cvx
  dev -- "pushes functions" --> cvx
  cvx --> outside
```

- The web app deploys through Vercel's git integration (`vercel.json`, adapter in `vite.config.ts`).
- Convex functions are not deployed by CI; nothing in the repo runs `convex deploy`. Backend changes reach the deployment when a developer pushes them with the Convex CLI.
- CI runs `bash scripts/loop-verify.sh` (preflight, Convex typecheck, `npm run check`, `npm test`, test-discovery guard, build, two uploader harnesses) and a separate browser component suite.

**Crons** (`convex/crons.ts`), grouped by purpose:

| Purpose | Jobs |
| --- | --- |
| Unstick crashed work | Draft runs (every 10 min, after 30 min idle), PD reviews and post-draft QA (every 10 min), chat replies (every 2 min), conversation deletes (every 5 min) |
| Clean up | Expire intake drafts (every 15 min), purge failed Brief preparations (hourly), release unreferenced files, prune error reports and notifications older than 30 days, sweep company file text versions no draft uses (daily) |
| Learn | Refresh the QA calibration and draft style digests (daily, 08:00 and 08:15 UTC) |
| Keep views correct | Rebuild the "waiting on others" view and My Work backfills (every 5 min) |
| Models | Refresh the model catalog from OpenRouter (daily but Monday, 08:45 UTC); the same refresh plus each tier's move to its newest version (Monday, 08:45 UTC); move a failing new tier model back (hourly at :15, in the first 7 days after a move) |

**Outside services** and the environment variable names Convex reads (values are never in the repo):

| Service | Used for | Variables |
| --- | --- | --- |
| Anthropic | Drafting, chat, checks | `ANTHROPIC_API_KEY`, `ANTHROPIC_TRANSPORT` |
| OpenRouter | Other models, web search, fallback when Anthropic billing fails | `OPENROUTER_API_KEY`, `OPENROUTER_ANTHROPIC_API_KEY` |
| Voyage | Brain embeddings and reranking | `VOYAGE_API_KEY` |
| Microsoft Graph | OneDrive import | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_DRIVE_ID`, `MS_ROOT_PATH` |
| Upload scripts | `POST /ingestion/upload` | `INGEST_API_KEY` |
| Sign-in | Better Auth | `SITE_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `AUTH_PROXY_SECRET` |

---

## 11. Rules that never bend

If a change breaks one of these, stop and discuss it before merging.

1. **AI proposes, people apply.** No code path lets an AI tool change report text directly. Every AI edit goes through `chatProposals` and `applyProposal`.
2. **Every draft traces to exact inputs.** Evidence is copied into `generationSources` when a run starts, with the prompt version and models frozen.
3. **Workflow and AI state stay apart.** `workflowStage` is for people; `generations.status` is for the engine. Neither writes the other.
4. **`createdBy` is never reused.** Accountability is `ownerId`.
5. **Convex checks every permission.** The browser only hides what you cannot do.
6. **Stage changes and hand-offs leave a trail.** `projectEvents` and `workItemEvents` are append-only.
7. **Nothing enters the Brain or a published digest without an Admin.**
8. **Every AI call is metered** in `aiUsage`.
9. **Never hand-edit `convex/_generated/`.**
10. **New workflow stages, transitions or permissions need a recorded amendment** in `docs/product-domain.md` first.

### Known gaps today

These are real and expected, not bugs to chase:

- Submitted and Delivered cannot be reached (section 9).
- `clientId` is written but not yet used for grouping (section 3).
- Invites are copied by hand; there is no email service.
- One shared Convex deployment and no automated backend deploy (section 10).
- Research saves its proposal cards directly instead of through the chat's `saveProposal` check.
- The old interface (`?workspace=current`) and the old Projects board components are still in the repo as a rollback; the board is not mounted anywhere.

---

## 12. Reviewing a change with this map

When a change comes in, ask four questions:

1. **Which box does it touch?** Use the table below.
2. **Does it add or remove an arrow?** A new route, table, background job, outside service, or a new call between boxes means this file needs an update in the same change.
3. **Does it bend a rule in section 11?** If yes, stop and discuss.
4. **Will a person notice it?** Add a changelog entry (`docs/changelog-guidelines.md`).

| If the change touches... | It is in this box | Read section |
| --- | --- | --- |
| `src/routes/`, `src/lib/components/`, `src/lib/shell/`, `src/lib/workspace/` | Web app | 4, 5 |
| `convex/schema.ts` | Data | 3 |
| `convex/projectWorkflow.ts`, `convex/workItems.ts`, `shared/workflow*.ts`, `shared/capabilities.ts` | Workflow and access | 9 |
| `convex/generations.ts`, `convex/lib/generations/`, `convex/ai/pipeline.ts`, `convex/ai/orderedGeneration.ts`, `convex/ai/iterative.ts`, `convex/seeds.ts`, `convex/briefs.ts` | Drafting engine | 6 |
| `convex/chatV2.ts`, `convex/ai/chatAgentV2.ts`, `convex/research.ts`, `src/lib/components/chat/` | Chat | 7 |
| `convex/brain.ts`, `convex/learning.ts`, `convex/ai/brain*`, `shared/houseRules.ts`, `shared/humanProse.ts`, `convex/ai/prompts.ts` | Style and knowledge | 8 |
| `convex/auth.ts`, `src/lib/server/`, `src/hooks.server.ts`, `convex/lib/auth.ts` | Sign-in and access | 4, 9 |
| `convex/crons.ts`, `convex/http.ts`, `vercel.json`, `.github/workflows/`, `scripts/` | Platform | 10 |

### Where to look when something breaks

| Symptom | First place to look |
| --- | --- |
| Draft stuck on "Generating" | The `generations` row status; the 10-minute cron fails it after 30 idle minutes (`convex/lib/generations/reapers.ts`) |
| Step by step stops after the Seeds | It is waiting for the writer to sign off (`awaiting_input`); see `convex/lib/generations/seedStage.ts` |
| "Sign off and generate PD" is refused as too large | How the final check splits one Line into requests (`planSummarySelfCheckBatches` in `convex/lib/seedRevisions.ts`): refused only past 8 requests or for one check too big for a request. The refusal names the limit and the Line (`SUMMARY_CAPACITY_EXCEEDED`). See the 2026-10-22 and 2026-10-26 (second) entries in `docs/product-domain.md` |
| An AI step's answer is cut off or times out | The step's limit and `cutOffRetry` (`convex/lib/generationSteps.ts`, `convex/ai/structured.ts`); the usage row's stop reason (`max_tokens`, `timeout`, `interrupted`) in `aiUsage` |
| A transcript's verified facts never become ready | `transcriptFactRuns`: a run marked `tooDense` is not tried again until its text changes; drafts read the transcript the usual way (`convex/ai/condense.ts`) |
| Chat reply never arrives | The `chatTurns` row; `convex/chatV2.ts` and `convex/ai/chatAgentV2.ts` |
| Apply on a chat card fails or says stale | The target text changed since the card was made; `chatV2.applyProposal` |
| A stage change is refused | The rule in `shared/workflowTransitions.ts`; Submitted and Delivered are always refused today |
| Someone cannot edit a report | They are not the owner and hold no open work item; `convex/lib/roleCapabilities.ts` |
| Export is refused | Revision mismatch, missing Line 206 science code, or filing readiness; `reports.preflightExport` in `convex/reports.ts` |
| An upload fails | Browser-side text extraction in `src/lib/parseDocument.ts`, then `src/lib/uploads/` |
| A file is not found by search, or has no labels | `projectDocuments.searchPiecesDue` / `searchPiecesTextHash` and `labelsDue` / `labelsAttempts`; the sweeps run every minute (`crons.ts`); the `indexDocument` and `labelFile` log lines |
| A file still shows no text | Whether the server read it: `projectDocuments.serverReader`, `serverReadStartedAt` (claimed) and `serverReadAt` (finished), and the `readStoredDocument` log line (`kept`, `not_better`, `changed`, `failed`); the rules are in `convex/lib/serverReading.ts`. A PDF stopped part way keeps its pages until text versions (Phase B1); a scan has no text until the Azure reader (Phase B3) |
| The old interface appears | The URL has `?workspace=current`, or the access check failed; `src/lib/workspace/WorkspaceGate.svelte` |
| AI cost jumps | `/admin/usage`, backed by `aiUsage` in `convex/aiUsage.ts` |
| A person gets signed out | The 15-minute token cookie and the proxy; `src/lib/server/auth.ts`, `convex/auth.ts` |

---

## 13. Words used in this map

| Word | Meaning |
| --- | --- |
| SR&ED | Canada's Scientific Research and Experimental Development tax credit. The firm writes claims for clients. |
| PD | Project description: the report this app produces, written for the CRA form. |
| Line 242, 244, 246 | The three CRA form sections: technological uncertainty, work performed, and advancement. |
| Evidence | Interview transcripts and supporting files for a project. |
| Generation, run | One attempt by the AI to write a draft, stored in `generations`. |
| Brief | A short guide the AI writes before drafting: storyline, things to leave out, confidence, glossary. |
| Seeds | In Step by step mode, the ideas the AI suggests for each subsection before it writes. |
| Brain | The library of Admin-approved past reports the AI learns style from. |
| Digest | A short lesson distilled from feedback, used in prompts once an Admin publishes it. |
| Snapshot | A saved copy of the report, taken after each draft, before any AI edit, restore or client edit, at milestones, and on request. |
| Work item, hand-off | A request to one person to do the next piece of work on a project. |
| Owner | The person accountable for a project. |
| Share link | The `/review/[shareToken]` link a client uses to read and comment without an account. |
| Query, mutation, action | Convex function types: a query reads, a mutation writes, an action calls outside services such as AI. |
