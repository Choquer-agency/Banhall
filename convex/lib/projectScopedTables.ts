/**
 * Story 0 (AD-19): the project-scoped table registry.
 *
 * One list of every schema field typed `v.id("projects")` and what deleting
 * a project does with the rows that carry it. `projects.purgeProjectPage`
 * walks it in order, one paginated page per transaction, and
 * `convex/projectErasure.test.ts` walks the schema's validators to fail on
 * any `v.id("projects")` field that has no entry here (or any entry here the
 * schema no longer has). The walk is keyed by validator target, not field
 * name, so optional and differently named references are caught.
 *
 * Runtime-free: type imports only, so tests and tooling can load it without
 * the Convex runtime.
 *
 * Dispositions (sweep 2026-09-17):
 * - `delete`: the row belongs to the project and goes with it. Children
 *   without a project reference of their own are listed on the parent and
 *   removed before it. A `blob` field names storage the row owns; the purge
 *   releases it through `deleteStorageIfUnreferenced` right after the row.
 * - `detach`: the row outlives the project (billing, Brain review queue,
 *   ingestion history, review projects); the reference is cleared.
 * - `keep`: audit and decision rows the product never deletes. Changing one
 *   of these is an ask-first decision, not a code change.
 *
 * Order: children and blobs before parents; leaf event/derived tables before
 * the rows they describe. `projects` itself is not an entry — its own
 * self-reference is `PROJECT_SELF_REFERENCE`, handled by the purge's final
 * page right before the project row is deleted.
 */
import type { TableNames } from "../_generated/dataModel";

export type ProjectScopedDisposition = "delete" | "detach" | "keep";

export type ProjectScopedChild = {
  table: TableNames;
  /** Child field holding the parent's key. */
  field: string;
  /** Index whose first field is `field`. */
  index: string;
  /** Parent field supplying the key; `_id` when absent. */
  parentField?: string;
  /**
   * `scheduled`: rows are removed by a dedicated bounded, self-rescheduling
   * cleanup the purge schedules once per deleted parent (see
   * `projects.scheduleChildCleanup`). Absent means inline, budgeted deletion
   * in the parent's page.
   */
  cleanup?: "scheduled";
};

export type ProjectScopedTable = {
  table: TableNames;
  /** The field typed `v.id("projects")`. */
  field: string;
  disposition: ProjectScopedDisposition;
  /**
   * Index whose first field is `field`; required for `delete` and `detach`
   * so a page is one index range read, never a scan.
   */
  index?: string;
  children?: readonly ProjectScopedChild[];
  /** Field typed `v.id("_storage")` whose bytes the row owns. */
  blob?: "storageId";
  /**
   * `detach` only: sibling fields that describe the cleared reference (a
   * document id or timestamp of the link) and are cleared with it. The
   * registry stays keyed on the project reference itself.
   */
  clearWith?: readonly string[];
};

export const PROJECT_SCOPED_TABLES = [
  // Human-workflow history and oversight projections.
  { table: "projectEvents", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "workItemEvents", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "workItemOversight", field: "projectId", disposition: "delete", index: "by_projectId_and_viewerId" },
  { table: "oversightSyncing", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "oversightRebuilds", field: "projectId", disposition: "delete", index: "by_projectId_and_status" },
  { table: "workItems", field: "projectId", disposition: "delete", index: "by_projectId_and_status" },
  // Transcripts and their digests.
  { table: "transcriptDigests", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "transcripts", field: "projectId", disposition: "delete", index: "by_projectId" },
  // Generation-owned rows, leaves first.
  { table: "sectionEditEvents", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "complianceNotes", field: "projectId", disposition: "delete", index: "by_projectId" },
  // Step-by-step seed-stage rows (AD-33), leaves before their parents.
  { table: "seedDecisionEvents", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "seedProvenance", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "seedSelections", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "summaryItems", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "seedBatchContext", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "seeds", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "seedFeedbackRequests", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "seedStaleEpisodes", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "seedBatches", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "seedSubsections", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "summaryVersions", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "generationBriefEntries", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "generationBriefs", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "generationSources", field: "projectId", disposition: "delete", index: "by_projectId_and_generationId" },
  { table: "generationSectionRuns", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "generationCandidateRuns", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "candidateScores", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "modelSelections", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "reportCandidates", field: "projectId", disposition: "delete", index: "by_projectId" },
  {
    table: "generations",
    field: "projectId",
    disposition: "delete",
    index: "by_projectId",
    children: [
      { table: "generationArtifacts", field: "generationId", index: "by_generationId_and_kind" },
    ],
  },
  // Contextual research.
  { table: "researchClaims", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "researchSources", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "researchRuns", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "researchSessions", field: "projectId", disposition: "delete", index: "by_projectId" },
  // Report chat (agent and legacy).
  { table: "chatAnswerFeedback", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "proposalWordingEditEvents", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "chatProposalItems", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "chatProposals", field: "projectId", disposition: "delete", index: "by_projectId" },
  {
    table: "agentChatThreads",
    field: "projectId",
    disposition: "delete",
    index: "by_projectId",
    children: [
      // App-owned turn timing keyed by the component thread id string; the
      // component's own thread/message rows are not purged here (story 0
      // never touches component-owned rows).
      {
        table: "chatTurns",
        field: "agentThreadId",
        index: "by_agentThreadId_and_order",
        parentField: "agentThreadId",
      },
    ],
  },
  { table: "chatMessages", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "chatThreads", field: "projectId", disposition: "delete", index: "by_projectId" },
  // Report-adjacent rows.
  { table: "comments", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "commenters", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "reportViews", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "reportSnapshots", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "reportExports", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "reportProvenance", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "pdReviewEvents", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "pdReviews", field: "projectId", disposition: "delete", index: "by_projectId" },
  {
    table: "reports",
    field: "projectId",
    disposition: "delete",
    index: "by_projectId",
    children: [
      // QA history can run to hundreds of rows per report, so it keeps its
      // own bounded cleanup (projects.cleanupDeletedReportQaFindings),
      // scheduled once per deleted report as before this story.
      {
        table: "qaFindings",
        field: "reportId",
        index: "by_reportId_and_revisionNumber_and_contentHash_and_findingKey",
        cleanup: "scheduled",
      },
    ],
  },
  // Documents (blob-owning) and their upload receipts.
  { table: "projectDocuments", field: "projectId", disposition: "delete", index: "by_projectId", blob: "storageId" },
  { table: "documentUploadAttempts", field: "projectId", disposition: "delete", index: "by_projectId" },
  // Financials and identity evidence.
  { table: "financialSummaries", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "timesheetEntries", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "financialUploads", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "projectIdentityEvidence", field: "projectId", disposition: "delete", index: "by_projectId" },
  { table: "settingsDocumentAnalyses", field: "projectId", disposition: "delete", index: "by_projectId_and_contentHash_and_classifierVersion" },
  // Rows that outlive the project: clear the reference.
  { table: "aiUsage", field: "projectId", disposition: "detach", index: "by_projectId" },
  { table: "brainFeedbackQueue", field: "projectId", disposition: "detach", index: "by_projectId" },
  {
    table: "ingestionItems",
    field: "portedProjectId",
    disposition: "detach",
    index: "by_portedProjectId",
    // The ported document dies with the project; the port's actor stays as history.
    clearWith: ["portedDocumentId", "portedAt"],
  },
  // Audit and decision rows the product never deletes (ask first to change).
  { table: "writerReviews", field: "projectId", disposition: "keep" },
  { table: "comparisons", field: "projectId", disposition: "keep" },
  { table: "reviewDecisions", field: "projectId", disposition: "keep" },
  { table: "qaItemFeedback", field: "projectId", disposition: "keep" },
  { table: "reportEditDistance", field: "projectId", disposition: "keep" },
  // Brain revoke-and-tombstone on project delete is a separate follow-up.
  { table: "brainSources", field: "sourceProjectId", disposition: "keep" },
] as const satisfies readonly ProjectScopedTable[];

/**
 * `projects.sourceProjectId` (review project → source). Detached by the
 * purge's final page, after every registry entry and before the project row
 * is deleted, so it is not part of the ordered walk above.
 */
export const PROJECT_SELF_REFERENCE = {
  table: "projects",
  field: "sourceProjectId",
  disposition: "detach",
  index: "by_sourceProjectId",
} as const satisfies ProjectScopedTable;

/** Continuations pin the full ordered erasure contract, including child cleanup
 * and the final self-reference pass. No manual version bump can be forgotten. */
export const PROJECT_ERASURE_REGISTRY_VERSION = JSON.stringify({
  entries: PROJECT_SCOPED_TABLES,
  self: PROJECT_SELF_REFERENCE,
});
