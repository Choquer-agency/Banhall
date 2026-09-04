import { persistDeterministicFindings, hasBlockingQa } from "./lib/qaFindings";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  getFilingReadiness,
  requireFilingReady,
  requireInternalProjectAccess,
  requireProjectCreatorOrAdmin,
  requireCurrentUser,
  requireRole,
} from "./lib/auth";
import {
  getTeamRosterMemberOrNull,
  resolveLiveUserLabel,
  userDisplayLabel,
} from "./lib/teamRoster";
import { domainError, projectTypeValidator, sha256 } from "./lib/contracts";
import { effectiveProjectType } from "../shared/projectTypes";
import { requireCapability } from "./lib/roleCapabilities";
import { workflowStageRank } from "../shared/workflowStages";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { deriveStoredProcessing } from "../shared/documentStatus";
import { canUseIndustry, industrySlug } from "../shared/industries";
import { findActiveGeneration } from "./lib/activeGeneration";
import {
  projectDashboardProjectionPatch,
  stageCountBucket,
  syncProjectDashboardFields,
  upsertDashboardCompany,
} from "./lib/dashboardProjection";
import {
  dashboardCompanyKey,
  dashboardFiscalYearRank,
} from "../shared/dashboardProjection";
import {
  MAX_TOTAL_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPTS_PER_PROJECT,
  copyTranscriptRow,
  insertTranscriptRow,
  projectTranscriptPromptText,
} from "./lib/transcripts";

type TranscriptInput =
  | { content: string; label?: string }
  | { fromTranscriptId: Id<"transcripts">; label?: string };

type ResolvedTranscript =
  | { kind: "content"; content: string; label?: string }
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
    resolved.push({ kind: "content", content: input.content, label: input.label });
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
    await requireInternalProjectAccess(ctx, args.projectId);
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
    await requireInternalProjectAccess(ctx, args.projectId);
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
    await requireInternalProjectAccess(ctx, args.projectId);
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
  // the pair reads 1a/1b instead of 1/1b (owner direction 2026-08-19).
  if (bareSibling) {
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
      if (!project.projectNumber) continue;
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
    const { project } = await requireInternalProjectAccess(ctx, args.projectId);
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
    await requireInternalProjectAccess(ctx, args.projectId);
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
    await requireInternalProjectAccess(ctx, args.projectId);
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
      if (!project) {
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

export const getProjectByShareToken = query({
  args: { shareToken: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
      .unique();
    if (!project?.sharedReportId) return null;
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
        v.object({ content: v.string(), label: v.optional(v.string()) }),
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

async function copyProjectInputRows(
  ctx: MutationCtx,
  args: {
    fromProjectId: Id<"projects">;
    toProjectId: Id<"projects">;
    targetTranscriptId?: Id<"transcripts">;
  }
) {
  const { user } = await requireDuplicatePair(
    ctx,
    args.fromProjectId,
    args.toProjectId
  );
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

  const sourceReport = await ctx.db
    .query("reports")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
    .order("desc")
    .first();
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

  const reviews = await ctx.db
    .query("pdReviews")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
    .take(100);
  let pdReviewsCopied = 0;
  for (const review of reviews) {
    const documentId = docIdMap.get(review.documentId);
    if (!documentId) continue;
    await ctx.db.insert("pdReviews", {
      projectId: args.toProjectId,
      documentId,
      sourceFileName: review.sourceFileName,
      status: review.status,
      ...(review.result ? { result: review.result } : {}),
      ...(review.model ? { model: review.model } : {}),
      ...(review.error ? { error: review.error } : {}),
      createdBy: review.createdBy,
      createdAt: now,
      ...(review.completedAt ? { completedAt: review.completedAt } : {}),
    });
    pdReviewsCopied += 1;
  }

  return {
    documents: copies,
    evidenceCopied,
    pdReviewsCopied,
    ...(reportId ? { reportId } : {}),
  };
}

// Called by projectDuplication:copyProjectContent. This mutation creates the
// destination rows atomically; the action then clones any original file bytes.
export const prepareProjectContentCopy = mutation({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
    targetTranscriptId: v.optional(v.id("transcripts")),
  },
  handler: async (ctx, args) => {
    return await copyProjectInputRows(ctx, args);
  },
});

export const finishProjectContentCopy = mutation({
  args: {
    toProjectId: v.id("projects"),
    storageCopies: v.array(
      v.object({
        documentId: v.id("projectDocuments"),
        storageId: v.id("_storage"),
      })
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
    return null;
  },
});

/** Legacy text-only entry point retained for older clients during rollout. */
export const copyProjectDocuments = mutation({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const result = await copyProjectInputRows(ctx, args);
    return {
      copied: result.documents.length,
      evidenceCopied: result.evidenceCopied,
      pdReviewsCopied: result.pdReviewsCopied,
    };
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
    const { project } = await requireInternalProjectAccess(ctx, args.projectId);
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
    await requireInternalProjectAccess(ctx, args.projectId);

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

export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { project } = await requireProjectCreatorOrAdmin(ctx, args.projectId);
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

    // Delete related records
    const transcripts = await ctx.db
      .query("transcripts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const t of transcripts) await ctx.db.delete(t._id);

    const reports = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const r of reports) {
      await ctx.db.delete(r._id);
      await ctx.scheduler.runAfter(0, internal.projects.cleanupDeletedReportQaFindings, { reportId: r._id });
    }

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);

    const generations = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const g of generations) await ctx.db.delete(g._id);

    const commenters = await ctx.db
      .query("commenters")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const c of commenters) await ctx.db.delete(c._id);

    const pdReviews = await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const r of pdReviews) await ctx.db.delete(r._id);

    const pdReviewEvents = await ctx.db
      .query("pdReviewEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const e of pdReviewEvents) await ctx.db.delete(e._id);

    await ctx.db.delete(args.projectId);
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
