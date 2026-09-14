# Existing surfaces (codebase map, c55014f)

- Report workspace: `src/routes/project/[id]` → `src/lib/components/project/CurrentProjectPage.svelte`. Editor (`editor/Editor.svelte`) + supporting panels below; right-docked resizable rail (`<aside>`, ~:1353) with `railView` toggle: exactly one of chat | qa in flow. QA rail = `qa/QARailPanel.svelte` hosting `editor/QAScorePanel.svelte` (score gauge → per-section → compliance → flags → gaps → improvements).
- Sections: `src/lib/reportSections.ts` (`s242|s244|s246`, SECTION_ORDER). Editor renders per-section end markers (`.cra-section-end`) with word/line counts (`Editor.svelte:343-402, 637-665`); `locateSectionParagraph(section, paragraph)` exported.
- Generation: `generation/GenerationProgress.svelte` while generating; `IterativeStepper.svelte` (gated per-section approve, `approveSectionDraft`); `CandidateSelection.svelte` (compare mode).
- Chat: `chat/AgentChatPanel.svelte` → `AssistantTurn.svelte` (TurnTrace, then proposal artifacts, then answer); `ProposedEditCard.svelte` (diff, Replace / Reject / Edit wording / Refine / Show in doc / Review one by one); `ChatProposalArtifact.svelte`; primitives: Message, FeedbackBar, Source/SourceTrigger/SourceContent chips, Suggestion, PromptInput.
- New project: `src/routes/project/new/+page.svelte`; transcripts (upload/paste tabs), title, `CONTEXT_CATEGORIES` (previous_pd, scoping_notes, writer_notes [Highest], background, other) via `project-new/CategoryRow.svelte`.
- Writer profile: `src/routes/settings/writing/+page.svelte` (custom instructions + house-style waivers).
- Documents: `shared/documentStatus.ts` statuses (ready, ready_truncated, reference_only, could_not_read, skipped_unsupported, upload_failed); `upload/ProcessingStatusBadge.svelte`; `editor/FilesPanel.svelte`.
- UI kit: `src/lib/components/ui/*` (Button, Badge, StageBadge, Disclosure, GhostPopover, IconAction, Tooltip, PageBar…); no shared Tabs component (ad hoc `$state` toggles). Styleguide `/styleguide`.
- Component tests: `vitest.component.config.ts` (browser mode); Editor, chat (BulkProposal, ChatFeedback…), projectRoute suites exist.
