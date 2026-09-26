import { terminateSeedAttempts } from "./seedRuns";
import { persistDeterministicFindings, hasBlockingQa } from "./lib/qaFindings";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { GenericDatabaseWriter, GenericDataModel, GenericDocument } from "convex/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  PROJECT_ERASURE_REGISTRY_VERSION,
  PROJECT_SCOPED_TABLES,
  PROJECT_SELF_REFERENCE,
  type ProjectScopedChild,
  type ProjectScopedTable,
} from "./lib/projectScopedTables";
import { deleteStorageIfUnreferenced, STORAGE_REFERENCE_FIELDS } from "./lib/storage";
import {
  getInternalProjectAccessOrNull,
  getFilingReadiness,
  requireFilingReady,
  requireInternalProjectAccess,
  requireProjectCreatorOrAdmin,
  requireCurrentUser,
  requireInternalActor,
  requireRole,
} from "./lib/auth";
import {
  getTeamRosterMemberOrNull,
  isTeamRosterMember,
  resolveLiveUserLabel,
  userDisplayLabel,
} from "./lib/teamRoster";
import { domainError, projectTypeValidator, sha256 } from "./lib/contracts";
import { effectiveProjectType } from "../shared/projectTypes";
import {
  getEffectiveCapabilityLevel,
  getReportEditAccessOrNull,
  requireCapability,
  requireProjectMetadataAccess,
} from "./lib/roleCapabilities";
import {
  userInitials,
  validCurrentHandoff,
  workflowAuthorities,
} from "./projectWorkflow";
import { WORKFLOW_TRANSITIONS } from "../shared/workflowTransitions";
import { workflowStageRank } from "../shared/workflowStages";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { deriveProcessingStatus, deriveStoredProcessing } from "../shared/documentStatus";
import { previousYearReportHeader } from "../shared/previousYear";
import { extractPlainText } from "./lib/reportEdits";
import { canUseIndustry, industrySlug } from "../shared/industries";
import { findActiveGeneration } from "./lib/activeGeneration";
import { transitionGeneration } from "./lib/generationTransitions";
import { createPurgeGuard, type PurgeGuard } from "./lib/purgeBudget";
import {
  projectDashboardProjectionPatch,
  stageCountBucket,
  syncProjectDashboardFields,
  upsertDashboardCompany,
} from "./lib/dashboardProjection";
import {
  dashboardCompanyKey,
  dashboardFiscalYear,
  dashboardFiscalYearRank,
  normalizeDashboardText,
} from "../shared/dashboardProjection";
import {
  MAX_TOTAL_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPTS_PER_PROJECT,
  copyTranscriptRow,
  insertTranscriptRow,
  listProjectTranscripts,
  projectTranscriptPromptText,
  requireTranscriptTextWithinCap,
  validatedOriginalStorage,
} from "./lib/transcripts";
import { transcriptSourceFormatValidator } from "./lib/transcriptValidators";
import type { TranscriptSourceFormat } from "../shared/transcriptParse";

type TranscriptInput =
  | {
      content: string;
      label?: string;
      sourceFormat?: TranscriptSourceFormat;
      originalStorageId?: Id<"_storage">;
    }
  | { fromTranscriptId: Id<"transcripts">; label?: string };

type ResolvedTranscript =
  | {
      kind: "content";
      content: string;
      label?: string;
      sourceFormat?: TranscriptSourceFormat;
      originalStorageId?: Id<"_storage">;
    }
  | { kind: "copy"; source: Doc<"transcripts"> };

/**
 * Turns the caller's transcript list into the rows a new project may write.
 * `fromTranscriptId` is a caller-supplied cross-project read, so every source
 * row's project is authorized before anything is written. A source deleted
 * between the wizard's prefill and the submit is skipped rather than sinking
 * the whole creation, and so is an entry with no text.
 */
async function resolveTranscriptInputs(
  ctx: MutationCtx,
  inputs: TranscriptInput[]
): Promise<ResolvedTranscript[]> {
  if (inputs.length > MAX_TRANSCRIPTS_PER_PROJECT) {
    domainError(
      "INVALID_INPUT",
      `A project may carry at most ${MAX_TRANSCRIPTS_PER_PROJECT} transcripts`
    );
  }
  const resolved: ResolvedTranscript[] = [];
  const originals = new Set<string>();
  for (const input of inputs) {
    if ("fromTranscriptId" in input) {
      const source = await ctx.db.get(input.fromTranscriptId);
      if (!source) continue;
      if (!(await getInternalProjectAccessOrNull(ctx, source.projectId))) {
        domainError("NOT_AUTHORIZED", "Transcript is not readable");
      }
      if (source.content.trim() === "") continue;
      resolved.push({ kind: "copy", source });
      continue;
    }
    if (input.content.trim() === "") continue;
    // 2026-09-24: one transcript may not exceed the frozen slice, and the
    // same text twice is refused rather than stored twice.
    requireTranscriptTextWithinCap(input.content);
    if (
      resolved.some((item) =>
        item.kind === "content" ? item.content === input.content : item.source.content === input.content
      )
    ) {
      domainError("INVALID_INPUT", `${input.label ?? "This transcript"} is already added`);
    }
    if (input.originalStorageId) {
      // One file backs one transcript; no row holds it yet either.
      if (originals.has(input.originalStorageId)) {
        domainError("INVALID_INPUT", "The uploaded transcript file is already in use. Upload it again.");
      }
      originals.add(input.originalStorageId);
    }
    resolved.push({
      kind: "content",
      content: input.content,
      label: input.label,
      ...(input.sourceFormat ? { sourceFormat: input.sourceFormat } : {}),
      ...(input.originalStorageId
        ? { originalStorageId: await validatedOriginalStorage(ctx, input.originalStorageId) }
        : {}),
    });
  }
  const totalChars = resolved.reduce(
    (total, item) =>
      total +
      (item.kind === "copy" ? item.source.content.length : item.content.length),
    0
  );
  if (totalChars > MAX_TOTAL_TRANSCRIPT_CHARS) {
    domainError("INVALID_INPUT", "Combined transcript text is too large");
  }
  return resolved;
}

async function validatedIndustry(
  ctx: MutationCtx,
  value: string | undefined
): Promise<string | undefined> {
  const industry = value ? industrySlug(value) : "";
  if (!industry) return undefined;
  const existingProject = await ctx.db
    .query("projects")
    .withIndex("by_industry", (q) => q.eq("industry", industry))
    .first();
  const user = await requireCurrentUser(ctx);
  if (!canUseIndustry(user.role, industry, Boolean(existingProject))) {
    domainError("NOT_AUTHORIZED", "Only admins can add a new industry");
  }
  return industry;
}
async function validateProjectTagIds(
  ctx: MutationCtx,
  tagIds: Id<"tags">[]
): Promise<Id<"tags">[]> {
  const uniqueTagIds = [...new Set(tagIds)];
  for (const tagId of uniqueTagIds) {
    if (!(await ctx.db.get(tagId))) {
      domainError("NOT_FOUND", "One or more selected tags no longer exist");
    }
  }
  return uniqueTagIds;
}


export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const projects = await ctx.db.query("projects").order("desc").collect();
    return await Promise.all(
      projects.map(async (project) => {
        const activeGeneration = await findActiveGeneration(ctx, project, [
          "reserved",
          "running",
          "awaiting_selection",
          "awaiting_input",
        ]);
        const generationActivity: "generating" | "awaiting_selection" | "awaiting_input" | null =
          activeGeneration?.status === "reserved" || activeGeneration?.status === "running"
            ? "generating"
            : activeGeneration?.status === "awaiting_selection" ||
                activeGeneration?.status === "awaiting_input"
              ? activeGeneration.status
              : null;
        return {
          ...project,
          writer: await resolveLiveUserLabel(ctx, project.writer, project.createdBy),
          interviewer: await resolveLiveUserLabel(
            ctx,
            project.interviewer,
            project.interviewerUserId
          ),
          generationActivity,
        };
      })
    );
  },
});

/**
 * Distinct industry strings already used on projects. Feeds the creatable
 * industry picker so ad-hoc industries typed by one writer become options
 * for everyone.
 */
/** Title comparison for the duplicate-name check: the dashboard's text
 * normalization with punctuation and symbols removed. */
export function sameProjectTitleKey(title: string): string {
  return normalizeDashboardText(title)
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * E6: an existing project with the same client, title and fiscal year, so New
 * project can warn before a second copy is made. Internal read (D1: internal
 * projects are readable across the workspace). Reads one company and year
 * through the dashboard index; projects being deleted are skipped.
 */
export const findSameProject = query({
  args: {
    clientName: v.string(),
    title: v.string(),
    fiscalYearEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireInternalActor(ctx);
    const titleKey = sameProjectTitleKey(args.title);
    if (!titleKey || !args.clientName.trim()) return null;
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_dashboardCompanyKey_and_dashboardFiscalYearRank", (q) =>
        q
          .eq("dashboardCompanyKey", dashboardCompanyKey(args.clientName))
          .eq("dashboardFiscalYearRank", dashboardFiscalYearRank(args.fiscalYearEnd))
      )
      .take(200);
    const match = rows.find(
      (row) => row.deletionStartedAt === undefined && sameProjectTitleKey(row.title) === titleKey
    );
    if (!match) return null;
    const owner = match.ownerId ? await ctx.db.get(match.ownerId) : null;
    return {
      projectId: match._id,
      title: match.title,
      clientName: match.clientName,
      workflowStage: match.workflowStage ?? null,
      ownerName: owner ? userDisplayLabel(owner) : null,
      updatedAt: match.updatedAt,
    };
  },
});

export const listIndustries = query({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const projects = await ctx.db.query("projects").collect();
    return [
      ...new Set(
        projects
          .map((p) => p.industry)
          .filter((i): i is string => Boolean(i && i.trim()))
      ),
    ].sort();
  },
});

/** BNH-23: edit the internal and/or formal SR&ED title on an existing project. */
export const updateProjectTitles = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    sredTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectMetadataAccess(ctx, args.projectId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined && args.title.trim()) {
      patch.title = args.title.trim();
    }
    if (args.sredTitle !== undefined) {
      patch.sredTitle = args.sredTitle.trim() || undefined;
    }
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/**
 * 2026-09-10 writer flag: the client (company) name was fixed after project
 * creation, so a misnamed review-mode project was stuck. Single-project
 * counterpart of bulkUpdateProjects' clientName branch — same trim/empty
 * rule, same dashboard sync (the company row move lives in
 * syncProjectDashboardFields). Access mirrors updateProjectTitles. Like the
 * bulk edit, an existing projectNumber travels with the project unchanged;
 * numbering is only de-duplicated when a number is set.
 */
export const updateProjectClientName = mutation({
  args: {
    projectId: v.id("projects"),
    clientName: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProjectMetadataAccess(ctx, args.projectId);
    const clientName = args.clientName.trim();
    if (!clientName) {
      domainError("INVALID_INPUT", "Company name cannot be empty");
    }
    const patch = { clientName, updatedAt: Date.now() };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/** BNH-36: set/clear the client's fiscal year-end on an existing project. */
/**
 * BNH-10: industry scopes Brain retrieval to same-industry exemplars. Optional —
 * without it the Brain still retrieves best PDs across all industries. Values
 * must match the Brain's industry strings (see docs/the-brain.md).
 */
export const updateProjectIndustry = mutation({
  args: {
    projectId: v.id("projects"),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectMetadataAccess(ctx, args.projectId);
    const industry = await validatedIndustry(ctx, args.industry);
    const patch = { industry, updatedAt: Date.now() };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/** BNH-54: set/clear the CRA T4088 line 206 science/technology code. */
export const updateProjectScienceCode = mutation({
  args: {
    projectId: v.id("projects"),
    scienceCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectMetadataAccess(ctx, args.projectId);
    const scienceCode = normalizeCraScienceCode(args.scienceCode);
    if (args.scienceCode?.trim() && !scienceCode) {
      domainError("INVALID_INPUT", "Select a valid CRA science code");
    }
    const patch = { scienceCode, updatedAt: Date.now() };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/**
 * 2026-08-11 amendment — per-company project numbering. Accepts "1".."20"
 * (final, sequential per company) or a single letter "A".."Z" (uncertain/
 * draft identity, convertible to a number later — a label-only change).
 * Empty/omitted clears the field. Stored trimmed and lowercased. Not part
 * of the dashboard projection (mirrors updateProjectTags: patch + updatedAt
 * only; no dashboardSearchText/projection field derives from it).
 * Shared by setProjectNumber and createProject (flag 2026-08-14: the number
 * should be settable in the creation form, not only after generation).
 */
function normalizeProjectNumberInput(
  input: string | undefined
): string | undefined {
  const raw = input?.trim().toLowerCase() ?? "";
  if (!raw) return undefined;
  // 1–20, a letter a–z, or a combined form like 2a/14b (owner
  // clarification 2026-08-11: numbering and lettering compose; stored
  // lowercase since 2026-08-19).
  if (!/^(?:[1-9][0-9]?[a-z]?|[a-z])$/.test(raw)) {
    domainError(
      "INVALID_INPUT",
      "Project number must be 1–20, a letter a–z, or combined like 2a"
    );
  }
  const numericPart = raw.match(/^[0-9]+/)?.[0];
  if (numericPart && Number(numericPart) > 20) {
    domainError(
      "INVALID_INPUT",
      "Numbered projects are capped at 20 per company"
    );
  }
  return raw;
}

/**
 * Auto-letter duplicate numbers (meeting 2026-08-18): applying a bare "1"
 * where a "1" (or "1B", …) already exists in the same client + fiscal year
 * stores the next free letter — the existing bare "1" reads as "1A", the new
 * one becomes "1B". Explicit lettered input ("1C") is stored as typed. Scope
 * is company+fiscal-year so a legitimate rollover "1" next year stays "1".
 */
async function resolveProjectNumberCollision(
  ctx: MutationCtx,
  scope: {
    dashboardCompanyKey: string | undefined;
    dashboardFiscalYearRank: number | undefined;
    excludeProjectId?: Id<"projects">;
  },
  normalized: string | undefined
): Promise<string | undefined> {
  if (!normalized || !/^[0-9]+$/.test(normalized)) return normalized;
  if (scope.dashboardCompanyKey === undefined || scope.dashboardFiscalYearRank === undefined) {
    return normalized;
  }
  const siblings = await ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey_and_dashboardFiscalYearRank", (q) =>
      q
        .eq("dashboardCompanyKey", scope.dashboardCompanyKey!)
        .eq("dashboardFiscalYearRank", scope.dashboardFiscalYearRank!)
    )
    .take(200);
  const usedLetters = new Set<string>();
  let bareSibling: (typeof siblings)[number] | null = null;
  let collides = false;
  for (const sibling of siblings) {
    if (sibling._id === scope.excludeProjectId) continue;
    const number = sibling.projectNumber?.toLowerCase();
    if (!number) continue;
    const match = number.match(/^([0-9]+)([a-z]?)$/);
    if (!match || match[1] !== normalized) continue;
    collides = true;
    if (match[2]) {
      usedLetters.add(match[2]);
    } else {
      bareSibling = sibling;
      usedLetters.add("a"); // the bare number becomes the "a" slot below
    }
  }
  if (!collides) return normalized;
  // The existing bare sibling is renamed to "<n>a" in the same transaction so
  // the pair reads 1a/1b instead of 1/1b (owner direction 2026-08-19), but
  // only when the caller may edit that project's details (security wave 1,
  // a2 P3-2). Otherwise the sibling keeps its bare number, which already
  // reads as the "a" slot, and the caller's project still takes the next
  // free letter.
  if (bareSibling && (await getReportEditAccessOrNull(ctx, bareSibling._id))) {
    await ctx.db.patch(bareSibling._id, {
      projectNumber: `${normalized}a`,
      updatedAt: Date.now(),
    });
  }
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);
    if (!usedLetters.has(letter)) return `${normalized}${letter}`;
  }
  domainError(
    "INVALID_INPUT",
    `Every letter for project number ${normalized} is taken in this fiscal year`
  );
}

/**
 * One-time backfill for the 2026-08-19 auto-lettering amendment: find groups
 * of projects sharing the same bare number within a client + fiscal year and
 * letter them — earliest createdAt keeps the bare number ("1A" slot), later
 * ones get the next free letter. Existing lettered numbers are respected and
 * never rewritten. Dry-run by default:
 *   npx convex run projects:backfillProjectNumberLetters '{"apply":false}'
 */
export const backfillProjectNumberLetters = internalMutation({
  args: { apply: v.boolean() },
  returns: v.array(
    v.object({
      projectId: v.id("projects"),
      title: v.string(),
      clientName: v.string(),
      from: v.string(),
      to: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const projects = await ctx.db.query("projects").take(4000);
    const changes: Array<{
      projectId: Id<"projects">;
      title: string;
      clientName: string;
      from: string;
      to: string;
    }> = [];
    const record = async (
      project: (typeof projects)[number],
      to: string
    ) => {
      if (project.projectNumber === to) return;
      changes.push({
        projectId: project._id,
        title: project.title,
        clientName: project.clientName,
        from: project.projectNumber!,
        to,
      });
      if (args.apply) {
        await ctx.db.patch(project._id, { projectNumber: to, updatedAt: Date.now() });
      }
    };

    const groups = new Map<string, typeof projects>();
    for (const project of projects) {
      if (project.deletionStartedAt !== undefined || !project.projectNumber) continue;
      const lower = project.projectNumber.toLowerCase();
      const match = lower.match(/^([0-9]+)([a-z]?)$/);
      if (!match) {
        // Single letters and anything else: just normalize the casing.
        await record(project, lower);
        continue;
      }
      const key = `${project.dashboardCompanyKey ?? "?"}::${project.dashboardFiscalYearRank ?? "?"}::${match[1]}`;
      const group = groups.get(key) ?? [];
      group.push(project);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const bare = group
        .filter((project) => /^[0-9]+$/i.test(project.projectNumber!))
        .sort((a, b) => a.createdAt - b.createdAt);
      const lettered = group.filter(
        (project) => !/^[0-9]+$/i.test(project.projectNumber!)
      );
      const usedLetters = new Set<string>(
        lettered
          .map((project) => project.projectNumber!.toLowerCase().match(/([a-z])$/)?.[1])
          .filter((letter): letter is string => Boolean(letter))
      );
      // Lowercase any lettered numbers stored in the old uppercase form.
      for (const project of lettered) {
        await record(project, project.projectNumber!.toLowerCase());
      }
      // No collision: a lone bare number stays bare.
      if (bare.length <= 1 && (bare.length === 0 || lettered.length === 0)) continue;
      // Collision (or bare + lettered siblings): the earliest bare project
      // takes the explicit "a" slot; later bares get the next free letters.
      for (const [index, project] of bare.entries()) {
        const numeric = project.projectNumber!.toLowerCase();
        if (index === 0) {
          if (!usedLetters.has("a")) {
            usedLetters.add("a");
            await record(project, `${numeric}a`);
          }
          continue;
        }
        let assigned: string | null = null;
        for (let i = 0; i < 26; i++) {
          const letter = String.fromCharCode(97 + i);
          if (!usedLetters.has(letter)) {
            usedLetters.add(letter);
            assigned = letter;
            break;
          }
        }
        if (!assigned) continue; // >26 duplicates: leave for a human
        await record(project, `${numeric}${assigned}`);
      }
    }
    return changes;
  },
});

export const setProjectNumber = mutation({
  args: {
    projectId: v.id("projects"),
    projectNumber: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { project } = await requireProjectMetadataAccess(ctx, args.projectId);
    const projectNumber = await resolveProjectNumberCollision(
      ctx,
      {
        dashboardCompanyKey: project.dashboardCompanyKey,
        dashboardFiscalYearRank: project.dashboardFiscalYearRank,
        excludeProjectId: project._id,
      },
      normalizeProjectNumberInput(args.projectNumber)
    );
    await ctx.db.patch(args.projectId, {
      projectNumber,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** BNH-35: replace the project's applied tags. */
export const updateProjectTags = mutation({
  args: {
    projectId: v.id("projects"),
    tagIds: v.array(v.id("tags")),
  },
  handler: async (ctx, args) => {
    await requireProjectMetadataAccess(ctx, args.projectId);
    const tagIds = await validateProjectTagIds(ctx, args.tagIds);
    await ctx.db.patch(args.projectId, {
      tagIds,
      updatedAt: Date.now(),
    });
  },
});

export const updateProjectFiscalYear = mutation({
  args: {
    projectId: v.id("projects"),
    fiscalYearEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProjectMetadataAccess(ctx, args.projectId);
    const patch = {
      fiscalYearEnd: args.fiscalYearEnd,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/**
 * Bulk edit from the dashboard selection: set the company name and/or
 * set/clear the fiscal year-end across many projects at once.
 *
 * Scope follows the role matrix: a Consultant (writer) edits only projects
 * they currently own (projects.ownerId); Manager and Admin edit all. Rows
 * outside the actor's scope are counted as skipped and never touched.
 * projects.createdBy is not consulted.
 */
export const bulkUpdateProjects = mutation({
  args: {
    projectIds: v.array(v.id("projects")),
    clientName: v.optional(v.string()),
    // Omitted = leave untouched; null = clear the fiscal year-end.
    fiscalYearEnd: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["writer", "manager", "admin"]);
    const clientName = args.clientName?.trim();
    if (args.clientName !== undefined && !clientName) {
      domainError("INVALID_INPUT", "Company name cannot be empty");
    }
    if (clientName === undefined && args.fiscalYearEnd === undefined) {
      domainError("INVALID_INPUT", "Nothing to update");
    }
    const projectIds = [...new Set(args.projectIds)];
    if (projectIds.length === 0) {
      domainError("INVALID_INPUT", "No projects selected");
    }
    if (projectIds.length > 200) {
      domainError("INVALID_INPUT", "Too many projects selected — 200 max per edit");
    }
    const now = Date.now();
    let updated = 0;
    let skipped = 0;
    const editsAll = user.role === "manager" || user.role === "admin";
    for (const projectId of projectIds) {
      const project = await ctx.db.get(projectId);
      if (!project || project.deletionStartedAt !== undefined) {
        skipped++;
        continue;
      }
      if (!editsAll && project.ownerId !== user._id) {
        skipped++;
        continue;
      }
      const patch: Record<string, unknown> = { updatedAt: now };
      if (clientName !== undefined) patch.clientName = clientName;
      if (args.fiscalYearEnd !== undefined) {
        patch.fiscalYearEnd = args.fiscalYearEnd ?? undefined;
      }
      await ctx.db.patch(projectId, patch);
      await syncProjectDashboardFields(ctx, projectId, patch);
      updated++;
    }
    return { updated, skipped };
  },
});

export const getProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;
    return {
      ...access.project,
      writer: await resolveLiveUserLabel(
        ctx,
        access.project.writer,
        access.project.createdBy
      ),
      interviewer: await resolveLiveUserLabel(
        ctx,
        access.project.interviewer,
        access.project.interviewerUserId
      ),
    };
  },
});

/**
 * Whether a duplicate can bring the original's report in as last year's
 * report (owner decision 35, 2026-09-25): the latest report's version and
 * whether it has readable text. The report itself stays on the server.
 */
export const getDuplicateSourceReport = query({
  args: { projectId: v.id("projects") },
  returns: v.union(v.null(), v.object({ version: v.number(), hasText: v.boolean() })),
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;
    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (!report) return null;
    return {
      version: report.version ?? 1,
      hasText: extractPlainText(report.content).trim().length > 0,
    };
  },
});

/**
 * Owner decision (2026-09-15): the project pages only offer metadata
 * controls to people the single-project metadata mutations will accept —
 * the Owner, a collaborator with an open work item, a Manager or an Admin
 * (`requireProjectMetadataAccess`). Same decision as the Brief's `canEdit`;
 * an outsider, a roleless user or an anonymous caller gets `false`, never
 * an error, so the page can render plain values instead of failing on save.
 */
export const getProjectEditAccess = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return {
      canEditDetails:
        (await getReportEditAccessOrNull(ctx, args.projectId)) !== null,
    };
  },
});

/**
 * The report page's Details panel (story 5-6 owner amendment, 2026-09-24;
 * ui-design-final section 8). One bounded read: the project, its Owner, the
 * validated current handoff and its assignee, plus at most 100 open work
 * items for the edit decision. `editedAt` is the later of `updatedAt` and
 * `workflowUpdatedAt`, because stage and handoff writes do not bump
 * `updatedAt`. Permissions mirror the mutations they front:
 * `requireProjectMetadataAccess` for details, the transition matrix for
 * stage changes, and Owner/Manager/Admin plus `workItem.create` for Hand off.
 * An outsider, a roleless user or an anonymous caller gets `null`.
 */
export const getProjectDetailsPanel = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;
    const { project, user } = access;
    if (getEffectiveCapabilityLevel(user.role, "project.readInternal") === "none") {
      return null;
    }
    const stage = project.workflowStage ?? "intake";
    const [ownerDoc, handoff, authorities, editAccess] = await Promise.all([
      project.ownerId ? ctx.db.get(project.ownerId) : Promise.resolve(null),
      validCurrentHandoff(ctx, project),
      workflowAuthorities(ctx, project, user),
      getReportEditAccessOrNull(ctx, project._id),
    ]);
    const owner = isTeamRosterMember(ownerDoc) ? ownerDoc : null;
    const assignee = handoff ? await ctx.db.get(handoff.assigneeId) : null;
    const createLevel = getEffectiveCapabilityLevel(user.role, "workItem.create");
    const canCreateWork =
      createLevel === "all" || (createLevel === "own" && project.ownerId === user._id);
    return {
      stage,
      workflowVersion: project.workflowVersion ?? 0,
      industry: project.industry ?? null,
      fiscalYearEnd: project.fiscalYearEnd ?? null,
      scienceCode: project.scienceCode ?? null,
      projectNumber: project.projectNumber ?? null,
      owner: owner
        ? {
            userId: owner._id,
            label: userDisplayLabel(owner),
            initials: userInitials(owner),
            isYou: owner._id === user._id,
          }
        : null,
      createdAt: project.createdAt,
      editedAt: Math.max(project.updatedAt, project.workflowUpdatedAt ?? 0),
      currentHandoff: handoff
        ? {
            workItemId: handoff._id,
            assigneeId: handoff.assigneeId,
            assigneeLabel: assignee ? userDisplayLabel(assignee) : "Unknown team member",
            initials: assignee ? userInitials(assignee) : "?",
            isYou: handoff.assigneeId === user._id,
            note: handoff.instructions,
          }
        : null,
      permissions: {
        canEditDetails: editAccess !== null,
        canChangeStage: WORKFLOW_TRANSITIONS.some(
          (transition) =>
            transition.from === stage &&
            transition.authorities.some((authority) => authorities.has(authority))
        ),
        canHandOff:
          canCreateWork &&
          (authorities.has("owner") || authorities.has("manager") || authorities.has("admin")),
      },
    };
  },
});

export const getProjectByShareToken = query({
  args: { shareToken: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
      .unique();
    if (!project?.sharedReportId || project.deletionStartedAt !== undefined) return null;
    const report = await ctx.db.get(project.sharedReportId);
    if (!report || report.projectId !== project._id) return null;
    return {
      _id: project._id,
      title: project.title,
      clientName: project.clientName,
      sharedReportId: report._id,
      reportVersion: report.version,
      revisionNumber: report.revisionNumber ?? 0,
    };
  },
});

export const getScienceCodeSuggestionContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;

    const [transcript, report] = await Promise.all([
      projectTranscriptPromptText(ctx, args.projectId),
      ctx.db
        .query("reports")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .first(),
    ]);

    return {
      title: access.project.title,
      sredTitle: access.project.sredTitle,
      industry: access.project.industry,
      transcript,
      report: report?.content,
    };
  },
});

export const createProject = mutation({
  args: {
    title: v.string(),
    sredTitle: v.optional(v.string()),
    clientName: v.string(),
    interviewerUserId: v.optional(v.id("users")),
    // BNH-22: client-side interview participants.
    interviewees: v.optional(v.array(v.string())),
    // BNH-35: initial tags applied at creation.
    tagIds: v.optional(v.array(v.id("tags"))),
    fiscalYearEnd: v.optional(v.number()),
    // BNH-10: routes Brain retrieval — must match the Brain namespace strings
    // (software / manufacturing / life-sciences, see docs/the-brain.md).
    industry: v.optional(v.string()),
    // BNH-54: CRA T4088 line 206 field of science or technology code.
    scienceCode: v.optional(v.string()),
    // Flag 2026-08-14 (Michael): settable at creation for both Generate PD
    // and Review PD, not only after generation. Same rules as
    // setProjectNumber.
    projectNumber: v.optional(v.string()),
    // BNH-39: review mode reviews an existing written PD instead of generating.
    mode: v.optional(v.union(v.literal("generate"), v.literal("review"))),
    projectType: v.optional(projectTypeValidator),
    // The project's transcripts in list order: text typed or extracted in the
    // browser, or an existing row copied by reference so a duplicate never
    // round-trips a megabyte of interview through the client.
    transcripts: v.array(
      v.union(
        v.object({
          content: v.string(),
          label: v.optional(v.string()),
          // 2026-09-24: the detected format and the uploaded original file.
          sourceFormat: v.optional(transcriptSourceFormatValidator),
          originalStorageId: v.optional(v.id("_storage")),
        }),
        v.object({
          fromTranscriptId: v.id("transcripts"),
          label: v.optional(v.string()),
        })
      )
    ),
    ownerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const writer = await requireCurrentUser(ctx);
    await requireCapability(ctx, "project.create");
    if (writer.isAnonymous === true || !writer.role) {
      domainError("NOT_AUTHORIZED", "An active internal role is required to create a project");
    }
    // Compatibility: older clients may still submit ownerId. New projects are
    // always owned by their authenticated creator; never silently accept a
    // stale client assigning initial ownership to someone else.
    if (args.ownerId && args.ownerId !== writer._id) {
      domainError(
        "NOT_AUTHORIZED",
        "New projects are initially owned by the person creating them"
      );
    }
    const interviewer = args.interviewerUserId
      ? await getTeamRosterMemberOrNull(ctx, args.interviewerUserId)
      : null;
    if (args.interviewerUserId && !interviewer) {
      domainError("INVALID_INPUT", "Interviewer must be a current team member");
    }
    const tagIds = args.tagIds
      ? await validateProjectTagIds(ctx, args.tagIds)
      : [];
    const scienceCode = normalizeCraScienceCode(args.scienceCode);
    if (args.scienceCode?.trim() && !scienceCode) {
      domainError("INVALID_INPUT", "Select a valid CRA science code");
    }
    const projectNumber = await resolveProjectNumberCollision(
      ctx,
      {
        dashboardCompanyKey: dashboardCompanyKey(args.clientName),
        dashboardFiscalYearRank: dashboardFiscalYearRank(args.fiscalYearEnd),
      },
      normalizeProjectNumberInput(args.projectNumber)
    );
    const industry = await validatedIndustry(ctx, args.industry);
    const transcripts = await resolveTranscriptInputs(ctx, args.transcripts);

    const now = Date.now();
    const shareToken = generateShareToken();

    const dashboardProjection = projectDashboardProjectionPatch({
      title: args.title,
      clientName: args.clientName,
      writer: userDisplayLabel(writer),
      interviewer: interviewer ? userDisplayLabel(interviewer) : undefined,
      scienceCode,
      industry,
      fiscalYearEnd: args.fiscalYearEnd,
      workflowStage: "intake",
    });
    const projectId = await ctx.db.insert("projects", {
      title: args.title,
      clientName: args.clientName,
      ...dashboardProjection,
      dashboardCompanyCounted: true,
      ...(args.sredTitle ? { sredTitle: args.sredTitle } : {}),
      writer: userDisplayLabel(writer),
      ...(interviewer
        ? {
            interviewerUserId: interviewer._id,
            interviewer: userDisplayLabel(interviewer),
          }
        : {}),
      ...(args.interviewees?.length ? { interviewees: args.interviewees } : {}),
      ...(tagIds.length ? { tagIds } : {}),
      ...(args.fiscalYearEnd ? { fiscalYearEnd: args.fiscalYearEnd } : {}),
      ...(industry ? { industry } : {}),
      ...(scienceCode ? { scienceCode } : {}),
      ...(projectNumber ? { projectNumber } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
      projectType: args.projectType ?? effectiveProjectType({ mode: args.mode }),
      ownerId: writer._id,
      workflowStage: "intake",
      workflowStageRank: workflowStageRank("intake"),
      workflowUpdatedAt: now,
      workflowVersion: 0,
      status: "draft",
      createdBy: writer._id,
      shareToken,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("projectEvents", {
      projectId,
      type: "ownership_transferred",
      actorId: writer._id,
      to: writer._id,
      note: "creation:initial-owner",
      at: now,
    });
    await ctx.db.insert("projectEvents", {
      projectId,
      type: "stage_changed",
      actorId: writer._id,
      to: "intake",
      note: "creation:initial-stage",
      at: now,
    });

    // New projects are always born at intake; the company row's stage bucket
    // moves in the same transaction (2026-08-06 second amendment).
    await upsertDashboardCompany(
      ctx,
      dashboardProjection.dashboardCompanyKey,
      args.clientName,
      1,
      "intake"
    );

    const transcriptIds: Id<"transcripts">[] = [];
    for (const [position, transcript] of transcripts.entries()) {
      const transcriptId =
        transcript.kind === "copy"
          ? await copyTranscriptRow(ctx, transcript.source, {
              projectId,
              position,
            })
          : await insertTranscriptRow(ctx, {
              projectId,
              content: transcript.content,
              label: transcript.label,
              position,
              ...(transcript.sourceFormat ? { sourceFormat: transcript.sourceFormat } : {}),
              ...(transcript.originalStorageId
                ? { originalStorageId: transcript.originalStorageId }
                : {}),
            });
      if (transcriptId) transcriptIds.push(transcriptId);
    }

    return { projectId, transcriptIds };
  },
});



type ProjectDocumentCopy = {
  sourceId: Id<"projectDocuments">;
  documentId: Id<"projectDocuments">;
  storageId?: Id<"_storage">;
};

/** A copied transcript and the source original file its bytes come from. */
type TranscriptOriginalCopy = {
  transcriptId: Id<"transcripts">;
  storageId: Id<"_storage">;
};

/** Most files a duplicate may leave behind, the same bound as the copy read. */
const MAX_EXCLUDED_DOCUMENTS = 250;

async function requireDuplicatePair(
  ctx: MutationCtx,
  fromProjectId: Id<"projects">,
  toProjectId: Id<"projects">
) {
  const user = await requireCurrentUser(ctx);
  const source = await ctx.db.get(fromProjectId);
  const target = await ctx.db.get(toProjectId);
  if (!source || !target) domainError("NOT_FOUND", "Project not found");
  await requireInternalProjectAccess(ctx, source._id);
  await requireInternalProjectAccess(ctx, target._id);
  return { user, source, target };
}

/**
 * The public duplicate copy writes only into a project the caller has just
 * made (owner decision 35, 2026-09-25): created by them, with no report and
 * no files yet. The wizard copies before it uploads its own staged files, so
 * a fresh duplicate always passes, and running the copy a second time is
 * refused instead of copying every row again.
 */
async function requireFreshCopyTarget(
  ctx: MutationCtx,
  user: Doc<"users">,
  target: Doc<"projects">
) {
  if (target.createdBy !== user._id) {
    domainError("NOT_AUTHORIZED", "Files can only be copied into a project you just created");
  }
  const [report, document, evidence] = await Promise.all([
    ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", target._id))
      .first(),
    ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", target._id))
      .first(),
    ctx.db
      .query("projectIdentityEvidence")
      .withIndex("by_projectId", (q) => q.eq("projectId", target._id))
      .first(),
  ]);
  if (report || document || evidence) {
    domainError(
      "INVALID_STATE",
      "Files can only be copied into a new project that has no report or files yet"
    );
  }
  // A draft already running would read the project half copied, and a
  // copied report would land beside the one it is writing.
  if (
    await findActiveGeneration(ctx, target, [
      "reserved",
      "running",
      "awaiting_selection",
      "awaiting_input",
    ])
  ) {
    domainError(
      "INVALID_STATE",
      "Files can only be copied into a new project that is not drafting yet"
    );
  }
}

/**
 * The transcript the copied report cites must be one of the new project's
 * own, never a row from another project.
 */
async function requireTargetTranscript(
  ctx: MutationCtx,
  toProjectId: Id<"projects">,
  transcriptId: Id<"transcripts"> | undefined
) {
  if (!transcriptId) return;
  const transcript = await ctx.db.get(transcriptId);
  if (!transcript || transcript.projectId !== toProjectId) {
    domainError("INVALID_INPUT", "The transcript is not in the new project");
  }
}

/**
 * What a content copy carries besides the project inputs. Both includes
 * default to true, the full clone the old dashboard's Duplicate and the
 * review-from-project flow rely on. A duplicate made to draft again
 * (2026-09-25, the card Duplicate) passes `includeReport: false` so the new
 * project starts with no report, no copied QA findings and its own draft
 * status, and `includeReviews: false` unless it is a Review PD project.
 *
 * Owner decision 35 (2026-09-25) adds two more. Each can only narrow the
 * copy or add one file the server builds itself; neither can widen what a
 * caller reaches.
 */
const copyScopeArgs = {
  /** The source's latest report (with its QA findings and review status). */
  includeReport: v.optional(v.boolean()),
  /** PD reviews and the written PDs they reviewed (`review_pd` documents). */
  includeReviews: v.optional(v.boolean()),
  /**
   * Source files the writer unticked. A leave-out list, so an empty or
   * missing list copies everything. Ids for files deleted since are ignored;
   * an id from another project is refused.
   */
  excludeDocumentIds: v.optional(v.array(v.id("projectDocuments"))),
  /**
   * Bring the source's latest report in as a Previous-year report. Only for
   * a new project with a later fiscal year than the source, and only when the
   * report itself is not copied.
   */
  previousYearReport: v.optional(v.boolean()),
};

type CopyScope = {
  fromProjectId: Id<"projects">;
  toProjectId: Id<"projects">;
  targetTranscriptId?: Id<"transcripts">;
  includeReport?: boolean;
  includeReviews?: boolean;
  excludeDocumentIds?: Id<"projectDocuments">[];
  previousYearReport?: boolean;
  requireFreshTarget?: boolean;
};

async function excludedDocumentSet(
  ctx: MutationCtx,
  fromProjectId: Id<"projects">,
  ids: Id<"projectDocuments">[] | undefined
) {
  const excluded = new Set<Id<"projectDocuments">>(ids ?? []);
  if (excluded.size > MAX_EXCLUDED_DOCUMENTS) {
    domainError("INVALID_INPUT", "Too many files to leave out");
  }
  for (const id of excluded) {
    const document = await ctx.db.get(id);
    // Deleted in the original while the wizard was open: nothing to skip.
    if (!document) continue;
    if (document.projectId !== fromProjectId) {
      domainError("INVALID_INPUT", "A file to leave out is not in the original project");
    }
  }
  return excluded;
}

/**
 * The previous-year report a year-over-year duplicate brings in: the source's
 * latest report as plain text, filed under Previous-year reports with the
 * same first line the wizard writes above an uploaded previous-year file.
 */
async function insertPreviousYearReport(
  ctx: MutationCtx,
  args: {
    user: Doc<"users">;
    source: Doc<"projects">;
    target: Doc<"projects">;
    includeReport: boolean;
    now: number;
  }
): Promise<Id<"projectDocuments"> | undefined> {
  const { user, source, target } = args;
  if (args.includeReport) {
    domainError(
      "INVALID_INPUT",
      "The old report can come along as the report or as last year's report, not both"
    );
  }
  if ((target.mode ?? "generate") === "review") {
    domainError("INVALID_INPUT", "A Review PD project does not take last year's report");
  }
  const sourceYear = dashboardFiscalYear(source.fiscalYearEnd);
  const targetYear = dashboardFiscalYear(target.fiscalYearEnd);
  if (sourceYear === null || targetYear === null || targetYear <= sourceYear) {
    domainError(
      "INVALID_INPUT",
      "Set a later fiscal year to bring the old report in as last year's report"
    );
  }
  const report = await ctx.db
    .query("reports")
    .withIndex("by_projectId", (q) => q.eq("projectId", source._id))
    .order("desc")
    .first();
  if (!report) return undefined;
  const text = extractPlainText(report.content).trim();
  if (!text) return undefined;

  const fileName = `${source.title} (report v${report.version ?? 1}, FY ${sourceYear}).txt`;
  const content = `${previousYearReportHeader(sourceYear)}\n${text}`;
  const derived = deriveProcessingStatus({
    fileName,
    content,
    extractionFailed: false,
    intake: "file",
  });
  return await ctx.db.insert("projectDocuments", {
    projectId: target._id,
    fileName,
    fileType: "txt",
    content,
    category: "previous_pd",
    // A context file, so Replace on the Files panel treats it like one.
    source: "context_input",
    processingStatus: derived.status,
    processingDetail: derived.detail,
    uploadedBy: userDisplayLabel(user),
    // CAP-3: the acting internal user chose to bring this report in.
    ...(user.role ? { uploaderRole: user.role } : {}),
    createdAt: args.now,
  });
}

/**
 * Copied transcripts carry the text but not the uploaded file. Pair each
 * transcript of the new project that was copied from a row of the source
 * project (`copiedFromTranscriptId`, set by `copyTranscriptRow`) with that
 * row's original, so the action can clone the file too. Pasted text that
 * only matches a source transcript is not a copy and gets no file, and a
 * transcript the writer left unticked was never created, so it has nothing
 * to pair with.
 *
 * Its own query rather than part of prepare, so the copy transaction does
 * not also read every transcript of both projects: only the new project's
 * active rows are read here, plus the one source row each copy came from.
 */
async function transcriptOriginalCopies(
  ctx: QueryCtx,
  fromProjectId: Id<"projects">,
  toProjectId: Id<"projects">
): Promise<TranscriptOriginalCopy[]> {
  const copies: TranscriptOriginalCopy[] = [];
  for (const row of await listProjectTranscripts(ctx, toProjectId)) {
    if (row.originalStorageId || !row.copiedFromTranscriptId) continue;
    const source = await ctx.db.get(row.copiedFromTranscriptId);
    if (!source?.originalStorageId || source.projectId !== fromProjectId) continue;
    // The file must be the one this text came from; `copyTranscriptRow`
    // hashes a source row that predates stored hashes the same way.
    const sourceHash = source.contentHash ?? (await sha256(source.content));
    if (sourceHash !== row.contentHash) continue;
    copies.push({ transcriptId: row._id, storageId: source.originalStorageId });
  }
  return copies;
}

async function copyProjectInputRows(ctx: MutationCtx, args: CopyScope) {
  const { user, source, target } = await requireDuplicatePair(
    ctx,
    args.fromProjectId,
    args.toProjectId
  );
  if (args.requireFreshTarget) await requireFreshCopyTarget(ctx, user, target);
  await requireTargetTranscript(ctx, args.toProjectId, args.targetTranscriptId);
  const includeReport = args.includeReport ?? true;
  const includeReviews = args.includeReviews ?? true;
  const excluded = await excludedDocumentSet(ctx, args.fromProjectId, args.excludeDocumentIds);
  const now = Date.now();
  const documents = await ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
    .take(250);
  const copies: ProjectDocumentCopy[] = [];
  const docIdMap = new Map<Id<"projectDocuments">, Id<"projectDocuments">>();

  // Copy every support document, including archived records and review-mode PDs.
  // Storage ids are filled by the action after it clones the original bytes.
  for (const doc of documents) {
    if (!includeReviews && doc.source === "review_pd") continue;
    // Unticked in the wizard. Evidence and PD reviews tied to it drop out
    // below through `docIdMap`.
    if (excluded.has(doc._id)) continue;
    // A duplicate must report the same truth as its source. Rows that predate
    // PSOS-04 carry no status, so derive it from the copied content — the same
    // function the read-time fallback and the backfill use.
    const processing = doc.processingStatus
      ? { status: doc.processingStatus, detail: doc.processingDetail }
      : deriveStoredProcessing(doc);
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId: args.toProjectId,
      fileName: doc.fileName,
      fileType: doc.fileType,
      content: doc.content,
      ...(doc.mimeType ? { mimeType: doc.mimeType } : {}),
      ...(doc.category ? { category: doc.category } : {}),
      ...(doc.archived !== undefined ? { archived: doc.archived } : {}),
      processingStatus: processing.status,
      ...(processing.detail ? { processingDetail: processing.detail } : {}),
      source: doc.source,
      uploadedBy: userDisplayLabel(user),
      // CAP-3: trust belongs to the content's origin, not to whoever pressed
      // duplicate. Re-deriving from the copier would launder a client file
      // into internal direction.
      ...(doc.uploaderRole ? { uploaderRole: doc.uploaderRole } : {}),
      createdAt: now,
    });
    docIdMap.set(doc._id, documentId);
    copies.push({
      sourceId: doc._id,
      documentId,
      ...(doc.storageId ? { storageId: doc.storageId } : {}),
    });
  }

  const previousYearReportId = args.previousYearReport
    ? await insertPreviousYearReport(ctx, { user, source, target, includeReport, now })
    : undefined;

  const evidence = await ctx.db
    .query("projectIdentityEvidence")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
    .take(250);
  let evidenceCopied = 0;
  for (const row of evidence) {
    const remappedDocId = row.projectDocumentId
      ? docIdMap.get(row.projectDocumentId)
      : undefined;
    if (row.projectDocumentId && !remappedDocId) continue;
    await ctx.db.insert("projectIdentityEvidence", {
      projectId: args.toProjectId,
      subjectName: row.subjectName,
      relationship: row.relationship,
      evidenceKind: row.evidenceKind,
      ...(remappedDocId ? { projectDocumentId: remappedDocId } : {}),
      sourceDescription: `${row.sourceDescription} (copied from source project)`,
      status: row.status,
      ...(row.verifiedBy ? { verifiedBy: row.verifiedBy } : {}),
      ...(row.verifiedAt ? { verifiedAt: row.verifiedAt } : {}),
      ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
      createdAt: now,
      updatedAt: now,
    });
    evidenceCopied += 1;
  }

  const sourceReport = includeReport
    ? await ctx.db
        .query("reports")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
        .order("desc")
        .first()
    : null;
  let reportId: Id<"reports"> | undefined;
  if (sourceReport) {
    const contentHash = sourceReport.contentHash ?? (await sha256(sourceReport.content));
    reportId = await ctx.db.insert("reports", {
      projectId: args.toProjectId,
      content: sourceReport.content,
      version: sourceReport.version,
      generatedAt: now,
      updatedAt: now,
      ...(args.targetTranscriptId
        ? {
            sourceTranscriptId: args.targetTranscriptId,
            sourceTranscriptIds: [args.targetTranscriptId],
          }
        : {}),
      revisionNumber: sourceReport.revisionNumber ?? 0,
      contentHash,
    });
    await persistDeterministicFindings(ctx, reportId);
    await ctx.db.patch(args.toProjectId, {
      status: "review",
      updatedAt: now,
    });
  }

  const reviews = includeReviews
    ? await ctx.db
        .query("pdReviews")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
        .take(100)
    : [];
  let pdReviewsCopied = 0;
  for (const review of reviews) {
    const documentId = docIdMap.get(review.documentId);
    if (!documentId) continue;
    const copiedRunningError = review.status === "running"
      ? "The source review was still running when this project was duplicated. Run the review again in this project."
      : undefined;
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId: args.toProjectId,
      documentId,
      sourceFileName: review.sourceFileName,
      ...(review.revisionNumber !== undefined
        ? { revisionNumber: review.revisionNumber }
        : {}),
      ...(review.contentHash !== undefined
        ? { contentHash: review.contentHash }
        : {}),
      status: review.status === "running" ? "failed" : review.status,
      ...(review.result ? { result: review.result } : {}),
      ...(review.model ? { model: review.model } : {}),
      ...(copiedRunningError
        ? { error: copiedRunningError }
        : review.error ? { error: review.error } : {}),
      createdBy: review.createdBy,
      createdAt: now,
      ...(copiedRunningError
        ? { completedAt: now }
        : review.completedAt ? { completedAt: review.completedAt } : {}),
    });
    if (copiedRunningError) {
      await ctx.db.insert("pdReviewEvents", {
        projectId: args.toProjectId,
        reviewId,
        actor: "system",
        action: "review_failed",
        detail: copiedRunningError,
        at: now,
      });
    }
    pdReviewsCopied += 1;
  }

  return {
    documents: copies,
    evidenceCopied,
    pdReviewsCopied,
    ...(reportId ? { reportId } : {}),
    ...(previousYearReportId ? { previousYearReportId } : {}),
  };
}

// Called only by projectDuplication.copyProjectContentBetween. This mutation
// creates the destination rows atomically; the action then clones any
// original file bytes. Internal since owner decision 35 (2026-09-25): the
// storage ids it hands out must never reach a client.
export const prepareProjectContentCopy = internalMutation({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
    targetTranscriptId: v.optional(v.id("transcripts")),
    ...copyScopeArgs,
    /** Set by the public duplicate action; see requireFreshCopyTarget. */
    requireFreshTarget: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await copyProjectInputRows(ctx, args);
  },
});

// Called only by projectDuplication.copyProjectContentBetween, after
// prepare: which copied transcripts have an original file to clone.
export const planTranscriptOriginalCopies = internalQuery({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.fromProjectId);
    await requireInternalProjectAccess(ctx, args.toProjectId);
    return await transcriptOriginalCopies(ctx, args.fromProjectId, args.toProjectId);
  },
});

// Internal: it attaches storage ids, so only the copy action, which made
// every one of them a moment ago with `ctx.storage.store`, may call it.
export const finishProjectContentCopy = internalMutation({
  args: {
    toProjectId: v.id("projects"),
    storageCopies: v.array(
      v.object({
        documentId: v.id("projectDocuments"),
        storageId: v.id("_storage"),
      })
    ),
    transcriptCopies: v.optional(
      v.array(
        v.object({
          transcriptId: v.id("transcripts"),
          storageId: v.id("_storage"),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.toProjectId);
    for (const copy of args.storageCopies) {
      const document = await ctx.db.get(copy.documentId);
      if (!document || document.projectId !== args.toProjectId) {
        domainError("INVALID_INPUT", "Copied document does not belong to this project");
      }
      await ctx.db.patch(copy.documentId, { storageId: copy.storageId });
    }
    for (const copy of args.transcriptCopies ?? []) {
      const transcript = await ctx.db.get(copy.transcriptId);
      if (!transcript || transcript.projectId !== args.toProjectId) {
        domainError("INVALID_INPUT", "Copied transcript does not belong to this project");
      }
      // One file per transcript: a row that gained an original meanwhile
      // keeps it, and the spare clone is released.
      if (transcript.originalStorageId) {
        await ctx.storage.delete(copy.storageId);
        continue;
      }
      await ctx.db.patch(copy.transcriptId, { originalStorageId: copy.storageId });
    }
    return null;
  },
});

export const publishForReview = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
  },
  handler: async (ctx, args) => {
    // CAP-3 / decision D-2: publishing is authorized by the caller's current
    // role on the project (Owner via ownerId, or any Manager/Admin), never by
    // projects.createdBy. Both checks run before any write.
    const { project } = await requireInternalProjectAccess(ctx, args.projectId);
    await requireCapability(ctx, "project.setStage", {
      ownedBy: project.ownerId ? [project.ownerId] : [],
    });
    const report = await ctx.db.get(args.reportId);
    if (!report || report.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Report does not belong to this project");
    }
    if (await hasBlockingQa(ctx, report)) {
      domainError("QA_BLOCKING", "Current report has unresolved substantive QA findings");
    }
    await ctx.db.patch(args.projectId, {
      sharedReportId: report._id,
      status: "client_review",
      updatedAt: Date.now(),
    });
    // BNH-10 / CAP-2: freeze the post-edit distance at client publish.
    await ctx.scheduler.runAfter(0, internal.reportEditDistance.recordAtPublish, {
      reportId: report._id,
    });
  },
});

export const unpublishReview = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    // Same authority as publishForReview (CAP-3 / D-2): current Owner,
    // Manager, or Admin; createdBy is not consulted.
    const { project } = await requireInternalProjectAccess(ctx, args.projectId);
    await requireCapability(ctx, "project.setStage", {
      ownedBy: project.ownerId ? [project.ownerId] : [],
    });
    await ctx.db.patch(args.projectId, {
      sharedReportId: undefined,
      status: project.status === "client_review" ? "review" : project.status,
      updatedAt: Date.now(),
    });
  },
});

export const finalizeProject = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
  },
  handler: async (ctx, args) => {
    // Marking the project final is a status change: the same authority as
    // publish (project.setStage; current Owner, Manager or Admin). Audit
    // 2026-09-25, a2 P2-3.
    const { project } = await requireInternalProjectAccess(ctx, args.projectId);
    await requireCapability(ctx, "project.setStage", {
      ownedBy: project.ownerId ? [project.ownerId] : [],
    });
    const report = await ctx.db.get(args.reportId);
    if (!report || report.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Report does not belong to this project");
    }
    await requireFilingReady(ctx, project, report);
    await ctx.db.patch(args.projectId, {
      status: "final",
      updatedAt: Date.now(),
    });
  },
});

export const getProjectReadiness = query({
  args: {
    projectId: v.id("projects"),
    reportId: v.optional(v.id("reports")),
  },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;
    const report = args.reportId ? await ctx.db.get(args.reportId) : null;
    if (report && report.projectId !== args.projectId) return null;
    return await getFilingReadiness(ctx, access.project, report);
  },
});

export const updateProjectTitle = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProjectMetadataAccess(ctx, args.projectId);

    const patch = { title: args.title.trim(), updatedAt: Date.now() };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

// Reports are removed by the authorized parent transaction before cleanup runs.
// Keep each cleanup transaction bounded regardless of the report's QA history.
export const cleanupDeletedReportQaFindings = internalMutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.reportId)) return;
    const batchSize = 128;
    const findings = await ctx.db.query("qaFindings")
      .withIndex("by_reportId_and_revisionNumber_and_contentHash_and_findingKey", q =>
        q.eq("reportId", args.reportId))
      .take(batchSize);
    for (const finding of findings) await ctx.db.delete(finding._id);
    if (findings.length === batchSize) {
      await ctx.scheduler.runAfter(0, internal.projects.cleanupDeletedReportQaFindings, args);
    }
  },
});

// ─── Story 0 (AD-19): project erasure ────────────────────────────────────────
// deleteProject is the authorized entry: it refuses while open work exists,
// stamps the deletion barrier, decrements the dashboard bucket once,
// terminalizes live generation work, and hands off to purgeProjectPage,
// which walks PROJECT_SCOPED_TABLES one paginated page per transaction and
// deletes the project row last. Every page is idempotent and resumable: a
// redelivered page re-reads its range and finds the rows it already removed
// gone.

/** Rows read per purge page (spec: `numItems ≤ 100`). */
export const PROJECT_PURGE_PAGE_SIZE = 100;
/**
 * Rows written per purge transaction, across parents and their inline
 * children. A page that hits it stops and reschedules itself with the same
 * cursor; nothing it already deleted is read twice.
 */
export const PROJECT_PURGE_WRITE_BUDGET = 1000;
/**
 * Bytes one purge page may read. Transcripts, reports and snapshots carry
 * whole documents per row, so a 100-row page could otherwise approach the
 * transaction read limit before its continuation is scheduled.
 */
export const PROJECT_PURGE_MAX_BYTES_READ = 4 * 1024 * 1024;
// Everything else a page reads (inline children such as generation
// artifacts, which carry agent outputs, chain payloads and Brain provenance
// since 2026-09-25, and the second read Convex charges for every delete and
// patch) is bounded by the page's read guard (convex/lib/purgeBudget.ts):
// it checks the transaction's real usage before each child read and each row
// delete or patch, and ends the page on the same cursor before any limit is
// reached.
const CHILD_BATCH_SIZE = 100;
/**
 * Terminalization bounds. Generations are read by (projectId, status), so
 * the limit is per live status; runs have no status-scoped index under a
 * generation, so all of a generation's runs are read and filtered. Hitting
 * a limit is logged with counts; rows beyond it stay fenced by the barrier
 * and are purged with everything else (a continuation is deferred).
 */
const LIVE_GENERATION_LIMIT = 50;
const LIVE_RUN_LIMIT = 500;
const PROJECT_DELETED_ERROR = "Project deleted";
/** Child tables whose rows a dedicated cleanup removes (registry `cleanup: "scheduled"`). */
export const SCHEDULED_CHILD_CLEANUP_TABLES = ["qaFindings"] as const;

/**
 * Continuation args. The entry is named by (table, field), never by position
 * alone: a registry edit deployed during an active purge must not make a
 * page skip a table or replay a cursor against another index.
 */
type PurgePosition = {
  registryVersion?: string;
  entryIndex: number;
  table: string;
  field: string;
  cursor: string | null;
};
/** The registry names tables and indexes as strings; the walk reads them generically. */
type ErasureDb = GenericDatabaseWriter<GenericDataModel>;
type ErasureId = Parameters<ErasureDb["delete"]>[0];
const rowId = (row: GenericDocument) => row._id as ErasureId;

/** Args for `PROJECT_SCOPED_TABLES[entryIndex]`, or the final self-reference page past the end. */
export function purgePosition(entryIndex: number, cursor: string | null): PurgePosition {
  const entry =
    entryIndex < PROJECT_SCOPED_TABLES.length
      ? PROJECT_SCOPED_TABLES[entryIndex]
      : PROJECT_SELF_REFERENCE;
  return { registryVersion: PROJECT_ERASURE_REGISTRY_VERSION, entryIndex, table: entry.table, field: entry.field, cursor };
}

/**
 * Resolve a continuation against the registry as deployed now. The cursor is
 * kept only when the named entry still sits at the index it was scheduled
 * for (same table, field and therefore index range). An entry that moved
 * restarts the whole walk; an entry that vanished restarts the whole
 * walk, which is idempotent and only costs re-reading emptied ranges.
 */
function resolvePurgePosition(args: PurgePosition): PurgePosition | "finalize" {
  // Check before the finalization sentinel too. Old scheduled jobs have no
  // version and must restart, as must any changed ordering or cleanup rule.
  if (args.registryVersion !== PROJECT_ERASURE_REGISTRY_VERSION) {
    return purgePosition(0, null);
  }
  if (args.table === PROJECT_SELF_REFERENCE.table && args.field === PROJECT_SELF_REFERENCE.field) {
    return "finalize";
  }
  const byName = PROJECT_SCOPED_TABLES.findIndex(
    (entry) => entry.table === args.table && entry.field === args.field
  );
  if (byName < 0) {
    console.warn("purgeProjectPage: registry entry no longer exists; restarting the walk", {
      table: args.table,
      field: args.field,
    });
    return purgePosition(0, null);
  }
  if (byName !== args.entryIndex) {
    console.warn("purgeProjectPage: registry entry moved; restarting the walk", {
      table: args.table,
      field: args.field,
      scheduledIndex: args.entryIndex,
      currentIndex: byName,
    });
    return purgePosition(0, null);
  }
  return args;
}

async function schedulePurgePage(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  position: PurgePosition
) {
  await ctx.scheduler.runAfter(0, internal.projects.purgeProjectPage, {
    projectId,
    ...position,
  });
}

async function cancelScheduledJob(
  ctx: MutationCtx,
  jobId: Id<"_scheduled_functions"> | undefined
) {
  if (!jobId) return;
  try {
    await ctx.scheduler.cancel(jobId);
  } catch (error) {
    // A job that already ran or was already canceled is not a reason to
    // refuse the deletion.
    console.warn("deleteProject: could not cancel scheduled job", jobId, error);
  }
}

const LIVE_GENERATION_STATUSES = [
  "reserved",
  "running",
  "awaiting_selection",
  "awaiting_input",
] as const;

function warnIfTruncated(
  what: string,
  read: number,
  limit: number,
  context: Record<string, unknown>
) {
  if (read < limit) return;
  console.warn(`deleteProject: ${what} limit reached; rows beyond it stay fenced by the barrier`, {
    ...context,
    read,
    limit,
  });
}

/**
 * Fail every non-terminal generation, candidate run and section run of the
 * project, invalidate a running post-QA attempt, and cancel their scheduled
 * jobs, so no in-flight work outlives the barrier.
 */
async function terminalizeLiveGenerationWork(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  now: number
) {
  for (const status of LIVE_GENERATION_STATUSES) {
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_projectId_and_status", (q) =>
        q.eq("projectId", projectId).eq("status", status)
      )
      .take(LIVE_GENERATION_LIMIT);
    warnIfTruncated("live generation", generations.length, LIVE_GENERATION_LIMIT, { projectId, status });
    for (const generation of generations) {
      await terminateSeedAttempts(ctx, generation._id);
      await cancelScheduledJob(ctx, generation.scheduledJobId);
      await transitionGeneration(ctx, generation, "failed", {
        completedAt: now,
        error: PROJECT_DELETED_ERROR,
        // A post-QA attempt in flight can no longer settle: saveReportQa
        // refuses a non-running attempt (and consults the barrier besides).
        ...(generation.postQaStatus === "running" ? { postQaStatus: "failed" as const } : {}),
      });
      const candidateRuns = await ctx.db
        .query("generationCandidateRuns")
        .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
        .take(LIVE_RUN_LIMIT);
      warnIfTruncated("candidate run", candidateRuns.length, LIVE_RUN_LIMIT, {
        projectId,
        generationId: generation._id,
      });
      for (const run of candidateRuns) {
        if (run.status !== "queued" && run.status !== "running") continue;
        await cancelScheduledJob(ctx, run.scheduledJobId);
        await ctx.db.patch(run._id, {
          status: "failed",
          completedAt: now,
          error: PROJECT_DELETED_ERROR,
        });
      }
      const sectionRuns = await ctx.db
        .query("generationSectionRuns")
        .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
        .take(LIVE_RUN_LIMIT);
      warnIfTruncated("section run", sectionRuns.length, LIVE_RUN_LIMIT, {
        projectId,
        generationId: generation._id,
      });
      for (const run of sectionRuns) {
        if (
          run.status !== "pending" &&
          run.status !== "queued" &&
          run.status !== "running" &&
          run.status !== "awaiting_review"
        ) {
          continue;
        }
        await ctx.db.patch(run._id, {
          status: "failed",
          completedAt: now,
          error: PROJECT_DELETED_ERROR,
        });
      }
    }
  }
}

export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { project } = await requireProjectCreatorOrAdmin(ctx, args.projectId, { allowDeleting: true });
    if (project.deletionStartedAt !== undefined) {
      // The barrier is the idempotency key: the bucket was decremented and
      // live work terminalized when it was set, so a repeat (double-click,
      // retry after a lost continuation) only re-kicks the purge, which is
      // itself a no-op for everything already gone.
      await schedulePurgePage(ctx, args.projectId, purgePosition(0, null));
      return;
    }

    const openWorkItem = await ctx.db
      .query("workItems")
      .withIndex("by_projectId_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "open")
      )
      .first();
    if (openWorkItem) {
      domainError(
        "INVALID_STATE",
        "Complete, decline, or cancel open work before deleting this project"
      );
    }

    const now = Date.now();
    // dashboardCompanyCounted flips off with the barrier: the row now outlives
    // its decrement by a few transactions, and a stage change or client
    // rename landing in that window must not move a bucket it no longer holds.
    await ctx.db.patch(args.projectId, {
      deletionStartedAt: now,
      dashboardCompanyCounted: false,
    });
    if (project.dashboardCompanyCounted === true) {
      // Decrement the exact stage bucket the row occupied (2026-08-06
      // second amendment): workflowStage ?? "legacy".
      await upsertDashboardCompany(
        ctx,
        project.dashboardCompanyKey ?? projectDashboardProjectionPatch(project).dashboardCompanyKey,
        project.clientName,
        -1,
        stageCountBucket(project.workflowStage)
      );
    }
    await terminalizeLiveGenerationWork(ctx, args.projectId, now);
    await schedulePurgePage(ctx, args.projectId, purgePosition(0, null));
  },
});

async function scheduleChildCleanup(
  ctx: MutationCtx,
  child: ProjectScopedChild,
  parentId: string
) {
  switch (child.table) {
    case "qaFindings":
      await ctx.scheduler.runAfter(0, internal.projects.cleanupDeletedReportQaFindings, {
        reportId: parentId as Id<"reports">,
      });
      return;
    default:
      throw new Error(`No scheduled cleanup registered for ${child.table}`);
  }
}

/**
 * Delete one registry row with its inline children, within `budget` writes
 * and the page's read guard. Returns `deleted: false` when a child batch
 * filled up, the guard refused another read or delete, or the write budget
 * ran out; the parent then stays in its index range, so the page that
 * retries from the same cursor picks it up again (children already deleted
 * are gone from its child range).
 */
async function deleteRowWithChildren(
  ctx: MutationCtx,
  entry: ProjectScopedTable,
  row: GenericDocument,
  budget: number,
  guard: PurgeGuard
): Promise<{ deleted: boolean; writes: number }> {
  const db = ctx.db as unknown as ErasureDb;
  let writes = 0;
  for (const child of entry.children ?? []) {
    if (child.cleanup === "scheduled") continue;
    const parentKey = row[child.parentField ?? "_id"];
    if (parentKey === undefined) continue;
    const limit = Math.min(CHILD_BATCH_SIZE, budget - writes);
    if (limit <= 0) return { deleted: false, writes };
    if (!(await guard.canQuery())) return { deleted: false, writes };
    // Read first, then delete: the stream is closed before any delete, and
    // each read reserves room for its own delete.
    const rows: GenericDocument[] = [];
    let complete = false;
    const stream = db
      .query(child.table)
      .withIndex(child.index, (q) => q.eq(child.field, parentKey))
      [Symbol.asyncIterator]();
    try {
      while (await guard.canReadChild()) {
        const next = await stream.next();
        if (next.done) {
          complete = true;
          break;
        }
        // One row past the batch only proves more remain; it is not deleted.
        const willDelete = rows.length < limit;
        guard.noteChildRead(next.value, willDelete);
        if (!willDelete) break;
        rows.push(next.value);
      }
    } finally {
      await stream.return?.();
    }
    for (const childRow of rows) {
      await db.delete(rowId(childRow));
      guard.noteChildDeleted(childRow);
      writes += 1;
    }
    // More children than one batch, or than the page may read: keep the
    // parent for the next page.
    if (!complete) return { deleted: false, writes };
  }
  if (writes >= budget) return { deleted: false, writes };
  const ownsBlob = entry.blob !== undefined && typeof row[entry.blob] === "string";
  if (!(await guard.canTouchRow(row, ownsBlob))) return { deleted: false, writes };
  await db.delete(rowId(row));
  guard.noteRowTouched(row, ownsBlob);
  writes += 1;
  if (entry.blob) {
    const storageId = row[entry.blob];
    // Same transaction as the row delete, so the reference check sees it gone.
    if (typeof storageId === "string") {
      await deleteStorageIfUnreferenced(ctx, storageId as Id<"_storage">);
    }
  }
  for (const child of entry.children ?? []) {
    if (child.cleanup === "scheduled") await scheduleChildCleanup(ctx, child, rowId(row));
  }
  if (entry.componentThread) {
    const agentThreadId = row[entry.componentThread];
    if (typeof agentThreadId === "string") {
      await ctx.scheduler.runAfter(0, internal.projects.deleteAgentChatThread, { agentThreadId });
    }
  }
  return { deleted: true, writes };
}

/**
 * Project erasure's last step for a chat thread (a2 P2-6): the agent
 * component deletes the thread, its messages and streams in its own pages.
 * A thread id the component does not know (a legacy or already deleted
 * thread) is logged and skipped, so erasure never stalls on it.
 */
export const deleteAgentChatThread = internalMutation({
  args: { agentThreadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
        threadId: args.agentThreadId,
      });
    } catch (error) {
      console.warn("deleteAgentChatThread: component refused the thread id", {
        agentThreadId: args.agentThreadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});

/** The final page: detach review projects from the source, then delete the row. */
async function finalizeProjectPurge(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  position: PurgePosition
) {
  const referrers = await ctx.db
    .query(PROJECT_SELF_REFERENCE.table)
    .withIndex(PROJECT_SELF_REFERENCE.index, (q) =>
      q.eq(PROJECT_SELF_REFERENCE.field, projectId)
    )
    .paginate({
      cursor: position.cursor,
      numItems: PROJECT_PURGE_PAGE_SIZE,
      maximumBytesRead: PROJECT_PURGE_MAX_BYTES_READ,
    });
  for (const referrer of referrers.page) {
    await ctx.db.patch(referrer._id, { [PROJECT_SELF_REFERENCE.field]: undefined });
  }
  if (!referrers.isDone) {
    await schedulePurgePage(ctx, projectId, { ...position, cursor: referrers.continueCursor });
    return;
  }
  await ctx.db.delete(projectId);
}

/**
 * One purge page: the registry entry named by `table`/`field` from `cursor`.
 * Runs only behind the barrier; refuses (without writing) on a project that
 * never entered deletion, and is a no-op once the project row is gone.
 */
export const purgeProjectPage = internalMutation({
  args: {
    projectId: v.id("projects"),
    registryVersion: v.optional(v.string()),
    entryIndex: v.number(),
    table: v.string(),
    field: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    if (project.deletionStartedAt === undefined) {
      console.warn("purgeProjectPage: project has no deletion barrier; refusing", args.projectId);
      return null;
    }
    const resolved = resolvePurgePosition(args);
    if (resolved === "finalize") {
      await finalizeProjectPurge(ctx, args.projectId, args);
      return null;
    }
    const position = resolved;
    const entry: ProjectScopedTable = PROJECT_SCOPED_TABLES[position.entryIndex];
    const nextEntry = purgePosition(position.entryIndex + 1, null);
    if (entry.disposition === "keep" || entry.index === undefined) {
      await schedulePurgePage(ctx, args.projectId, nextEntry);
      return null;
    }

    const db = ctx.db as unknown as ErasureDb;
    const page = await db
      .query(entry.table)
      .withIndex(entry.index, (q) => q.eq(entry.field, args.projectId))
      .paginate({
        cursor: position.cursor,
        numItems: PROJECT_PURGE_PAGE_SIZE,
        maximumBytesRead: PROJECT_PURGE_MAX_BYTES_READ,
      });

    let writes = 0;
    let budgetExhausted = false;
    // Covers the whole transaction from here on: the project row and this
    // page are already read, every child read and every delete or patch
    // (Convex reads the row again) is checked before it happens.
    const guard = createPurgeGuard({
      readMetrics: async () => {
        try {
          return await ctx.meta.getTransactionMetrics();
        } catch {
          return null;
        }
      },
      alreadyRead: [project, ...page.page],
      blobCheckFields: STORAGE_REFERENCE_FIELDS.length,
    });
    for (const row of page.page) {
      if (writes >= PROJECT_PURGE_WRITE_BUDGET) {
        budgetExhausted = true;
        break;
      }
      if (entry.disposition === "detach") {
        if (!(await guard.canTouchRow(row, false))) {
          budgetExhausted = true;
          break;
        }
        const patch: Record<string, undefined> = { [entry.field]: undefined };
        for (const sibling of entry.clearWith ?? []) patch[sibling] = undefined;
        await db.patch(rowId(row), patch);
        guard.noteRowTouched(row, false);
        writes += 1;
        continue;
      }
      const result = await deleteRowWithChildren(
        ctx,
        entry,
        row,
        PROJECT_PURGE_WRITE_BUDGET - writes,
        guard
      );
      writes += result.writes;
      if (!result.deleted) {
        budgetExhausted = true;
        break;
      }
    }

    if (budgetExhausted) {
      // Same cursor: everything this page removed has left the range, and a
      // parent kept back for remaining children is still in it.
      await schedulePurgePage(ctx, args.projectId, position);
    } else if (!page.isDone) {
      await schedulePurgePage(ctx, args.projectId, { ...position, cursor: page.continueCursor });
    } else {
      await schedulePurgePage(ctx, args.projectId, nextEntry);
    }
    return null;
  },
});

// Exported for reviewFromProject.createReviewProjectRecord, which mirrors
// this mutation's insert conventions for review projects created from an
// existing project (2026-08-11 second amendment).
export function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // Base64url encoding: URL-safe, 32 characters, 192 bits of entropy
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
