# Story 1 caller inventory

Verified 2026-08-31 against the current source tree. Every write path listed below reaches `requireInternalProjectAccess` before its first write. This file is planning evidence for Story 1 and must be rechecked if callers change before implementation.

## Public mutations, 60

- `convex/chatV2.ts`: `sendMessage`, `abortStreaming`, `applyProposal`, `markProposalApplied`, `updateProposalWording`, `rejectProposal`
- `convex/comments.ts`: `resolveComment`, `unresolveComment`, `acceptEdit`, `deleteComment`
- `convex/documents.ts`: `uploadDocument`, `setDocumentArchived`, `deleteDocument`
- `convex/financial.ts`: `uploadAndScheduleFinancialData`, `reviewTimesheetEntry`, `deleteUpload`
- `convex/generations.ts`: `requestGeneration`, `retryGeneration`, `retryFailedCandidates`, `requestReportQa`, `approveSectionDraft`, `regenerateSectionDraft`, `cancelIterativeGeneration`, `selectReportCandidate`, `scoreCandidate`
- `convex/pdReviews.ts`: `startPdReview`, `retryPdReview`, `logPdReviewEvent`
- `convex/projectEvidence.ts`: `attachEvidence`
- `convex/projects.ts`: `updateProjectTitles`, `updateProjectIndustry`, `updateProjectScienceCode`, `setProjectNumber`, `setProjectType`, `updateProjectTags`, `updateProjectFiscalYear`, `prepareProjectContentCopy`, `finishProjectContentCopy`, `copyProjectDocuments`, `publishForReview`, `unpublishReview`, `finalizeProject`, `updateProjectTitle`, `deleteProject`
- `convex/reports.ts`: `updateReportContent`, `authorizeExport`, `completeExport`, `failExport`
- `convex/reportViews.ts`: `logWriterView`
- `convex/research.ts`: `startResearch`, `submitFeedback`, `cancelResearch`
- `convex/reviews.ts`: `submitWriterReview`, `saveQaItemFeedback`
- `convex/snapshots.ts`: `createManualSnapshot`, `createMilestoneSnapshot`, `restoreSnapshot`
- `convex/uploadAttempts.ts`: `recordUploadAttempts`, `failUploadAttempt`, `dismissUploadAttempt`

## Public queries, 4

- `convex/chatV2.ts`: `listMessages`
- `convex/projectEvidence.ts`: `getReadiness`
- `convex/reports.ts`: `preflightExport`
- `convex/reviews.ts`: `getMyQaItemFeedback`

## Public actions, 2

- `convex/projectDuplication.ts`: `copyProjectContent`, through `copyProjectContentBetween` and guarded project-copy mutations
- `convex/reviewFromProject.ts`: `createReviewFromProject`, through `createReviewProjectRecord` and `copyProjectContentBetween`; it already has a preceding `requireCapability` active-role check, so Story 1 adds defense-in-depth rather than changing its normal rejection outcome

## Transitive guard nodes

- `convex/lib/auth.ts`: `requireProjectCreator`, `requireProjectCreatorOrAdmin`
- `convex/projects.ts`: `requireDuplicatePair`, project-copy internals
- `convex/generations.ts`: `requireIterativeGeneration`
- `convex/reviews.ts`: `resolveQaTarget`
- `convex/reviewFromProject.ts`: `createReviewProjectRecord`
- `convex/projectDuplication.ts`: `copyProjectContentBetween`

## Explicitly unaffected

- Dashboard queries guarded only by `requireCurrentUser` retain approved role-less read visibility.
- Client-review share-token access through `getProjectAccess` remains separately scoped.
- Functions already guarded by `requireCapability` retain their capability checks; the tightened project helper is an additional active-internal-role boundary.
