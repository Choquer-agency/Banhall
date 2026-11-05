/**
 * A company's Activity tab (2026-11-04, the company profile): one list,
 * newest first, of what changed on the company and its projects.
 *
 * Sources, all read by index, newest first, each bounded:
 * - company files added, replaced, archived, restored and removed
 *   (`companyFileEvents`) and website reads (`companyWebsiteReads`: saved,
 *   unchanged or failed), only for viewers who may read company files;
 * - for the company's MAX_ACTIVITY_PROJECTS newest live projects (by when
 *   they were made), for every internal user: projects started (the first
 *   stage, logged with the note "creation:initial-stage"), drafts started
 *   (a move into Drafting from an earlier stage) and other stage moves
 *   (`projectEvents`). Generations are not read: their rows are large and
 *   change on every progress step.
 *
 * Paging: 25 rows a page. Rows are ordered by (time, creation time), which
 * is unique and matches each index's order, and the cursor is the key of
 * the last row given, so rows logged at the same time (a mutation logs a
 * bulk change with one `Date.now()`) are read exactly, never skipped. Each
 * source reads a bounded number of rows per pass. When a source fills its
 * bound, only rows at or after its oldest row are sure to be complete, so
 * the page stops there and the next pass (or page) reads on from that key.
 * Filters (one person, one kind) apply to the rows read; a page may then
 * hold fewer than 25 rows while more remain, and says so with a cursor.
 *
 * Read-only. Contacts are not part of Activity.
 */
import { query, type QueryCtx } from "./_generated/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError, workflowStageValidator } from "./lib/contracts";
import { requireInternalActor } from "./lib/auth";
import { hasCapability, type CapabilityRole } from "../shared/capabilities";
import { activeClientForKey } from "./lib/clients";
import { userDisplayLabel } from "./lib/teamRoster";
import { DASHBOARD_UNNAMED_COMPANY_KEY } from "../shared/dashboardProjection";
import { WORKFLOW_STAGES, type WorkflowStage } from "../shared/workflowStages";

export const COMPANY_ACTIVITY_PAGE_SIZE = 25;
/** The company's newest live projects whose activity is listed. */
export const MAX_ACTIVITY_PROJECTS = 50;
/** Projects read (newest first) to find the newest live ones. */
const PROJECT_SCAN_LIMIT = 100;
/** Rows each source reads per pass. */
const FILE_EVENT_PASS = 50;
const WEBSITE_READ_PASS = 20;
const PROJECT_EVENT_PASS = 10;
/** Website reads one company logs at one time (one per finished read; a few at most). */
const WEBSITE_READS_AT_ONE_TIME = 10;
/** Passes one page may take while filters leave it short. */
const MAX_PASSES = 3;

export const activityKindValidator = v.union(
  v.literal("files"),
  v.literal("projects"),
  v.literal("stages"),
  v.literal("drafts"),
  v.literal("website"),
);
export type ActivityKind = Infer<typeof activityKindValidator>;

const actorValidator = v.union(
  v.null(),
  v.object({ userId: v.id("users"), label: v.string(), initials: v.string() }),
);
const projectRefValidator = v.object({
  id: v.id("projects"),
  title: v.string(),
});

const entryValidator = v.union(
  v.object({
    id: v.string(),
    kind: v.literal("file"),
    at: v.number(),
    actor: actorValidator,
    action: v.union(
      v.literal("added"),
      v.literal("replaced"),
      v.literal("archived"),
      v.literal("restored"),
      v.literal("removed"),
    ),
    fileId: v.id("companyFiles"),
    fileName: v.string(),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("website"),
    at: v.number(),
    actor: actorValidator,
    host: v.string(),
    outcome: v.union(v.literal("read"), v.literal("failed")),
    reason: v.union(v.string(), v.null()),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("project_started"),
    at: v.number(),
    actor: actorValidator,
    project: projectRefValidator,
    fiscalYear: v.union(v.number(), v.null()),
  }),
  v.object({
    id: v.string(),
    kind: v.literal("stage_moved"),
    at: v.number(),
    actor: actorValidator,
    project: projectRefValidator,
    fromStage: v.union(workflowStageValidator, v.null()),
    toStage: workflowStageValidator,
  }),
  v.object({
    id: v.string(),
    kind: v.literal("draft_started"),
    at: v.number(),
    actor: actorValidator,
    project: projectRefValidator,
  }),
);
type Entry = Infer<typeof entryValidator>;
type Actor = Infer<typeof actorValidator>;
/** An entry before its actor is named, with its creation time for ordering. */
type Raw = {
  [K in Entry["kind"]]: Omit<Extract<Entry, { kind: K }>, "actor"> & {
    actorId: Id<"users"> | null;
    ct: number;
  };
}[Entry["kind"]];

/** A row's place in the list: its time, then its creation time. */
type Key = { at: number; ct: number };
type Pass = { rows: Raw[]; full: boolean; oldest: Key | null };

/** Newest first: a positive result puts `a` after `b`. */
function compareKeys(a: Key, b: Key): number {
  return b.at - a.at || b.ct - a.ct;
}

function compareRaw(a: Raw, b: Raw): number {
  return compareKeys(a, b) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

function keyOf(row: { at: number; _creationTime: number }): Key {
  return { at: row.at, ct: row._creationTime };
}

function initials(label: string) {
  const parts = label.split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`
      : label.slice(0, 2)
  ).toUpperCase();
}

function fiscalYearOf(fiscalYearEnd: number | undefined): number | null {
  if (fiscalYearEnd === undefined) return null;
  const year = new Date(fiscalYearEnd).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

function formatCursor(key: Key): string {
  return `${key.at}_${key.ct}`;
}

function parseCursor(cursor: string | null | undefined): Key | null {
  if (!cursor) return null;
  const [at, ct] = cursor.split("_").map(Number);
  if (!Number.isFinite(at) || !Number.isFinite(ct))
    domainError("INVALID_INPUT", "This list moved on. Open Activity again.");
  return { at, ct };
}

/**
 * Rows of one source strictly before `before` in (time, creation time)
 * order, newest first, up to `cap`: the rest of `before`'s time first, then
 * older times.
 */
async function readBefore<T>(
  before: Key | null,
  cap: number,
  sameTime: (at: number, ct: number, take: number) => Promise<T[]>,
  olderThan: (at: number | null, take: number) => Promise<T[]>,
): Promise<T[]> {
  if (!before) return await olderThan(null, cap);
  const tie = await sameTime(before.at, before.ct, cap);
  if (tie.length >= cap) return tie;
  return [...tie, ...(await olderThan(before.at, cap - tie.length))];
}

/** Which sources a role reads: project rows for every internal user, file and website rows with companyFiles.read. */
export function activitySources(role: CapabilityRole | null | undefined): {
  projects: boolean;
  files: boolean;
} {
  return {
    projects: Boolean(role),
    files: hasCapability(role, "companyFiles.read"),
  };
}

/** The company's newest live projects, and whether older live ones exist. */
async function newestLiveProjects(ctx: QueryCtx, key: string) {
  const scanned = await ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey", (q) =>
      q.eq("dashboardCompanyKey", key),
    )
    .order("desc")
    .take(PROJECT_SCAN_LIMIT);
  const live = scanned.filter(
    (project) => project.deletionStartedAt === undefined,
  );
  return {
    projects: live.slice(0, MAX_ACTIVITY_PROJECTS),
    truncated:
      live.length > MAX_ACTIVITY_PROJECTS ||
      (scanned.length === PROJECT_SCAN_LIMIT &&
        live.length < MAX_ACTIVITY_PROJECTS),
  };
}

function fileEntry(event: Doc<"companyFileEvents">): Raw | null {
  const base = {
    id: event._id,
    at: event.at,
    ct: event._creationTime,
    actorId: event.userId,
    fileId: event.companyFileId,
    fileName: event.fileName,
  };
  // Read as a string so this list keeps working whichever event kinds the
  // table holds (the Files tab's Replace file logs `replaced`).
  switch (event.action as string) {
    case "add":
      return { ...base, kind: "file", action: "added" };
    case "replace":
    case "replaced":
      return { ...base, kind: "file", action: "replaced" };
    case "archive":
      return { ...base, kind: "file", action: "archived" };
    case "restore":
      return { ...base, kind: "file", action: "restored" };
    case "remove":
      return { ...base, kind: "file", action: "removed" };
    default:
      // Merge moves are not part of Activity.
      return null;
  }
}

const DRAFTING_RANK = WORKFLOW_STAGES.indexOf("drafting");

/** A move into Drafting from an earlier stage (or none) starts drafting. */
function startsDrafting(
  from: WorkflowStage | undefined,
  to: WorkflowStage,
): boolean {
  return (
    to === "drafting" &&
    (from === undefined || WORKFLOW_STAGES.indexOf(from) < DRAFTING_RANK)
  );
}

function kindOf(raw: Raw): ActivityKind {
  switch (raw.kind) {
    case "file":
      return "files";
    case "website":
      return "website";
    case "project_started":
      return "projects";
    case "stage_moved":
      return "stages";
    case "draft_started":
      return "drafts";
  }
}

export const listCompanyActivity = query({
  args: {
    companyKey: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    personId: v.optional(v.id("users")),
    kind: v.optional(activityKindValidator),
  },
  returns: v.object({
    entries: v.array(entryValidator),
    /** Where the next page starts; null when nothing older is left. */
    continueCursor: v.union(v.string(), v.null()),
    /** The company has more than MAX_ACTIVITY_PROJECTS live projects: older ones are not listed. */
    projectsTruncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // The rule the company page's project reads use; file and website rows
    // also need companyFiles.read.
    const user = await requireInternalActor(ctx);
    const sources = activitySources(user.role);
    const empty = {
      entries: [],
      continueCursor: null,
      projectsTruncated: false,
    };
    if (args.companyKey === DASHBOARD_UNNAMED_COMPANY_KEY) return empty;

    const wants = (kind: ActivityKind) =>
      args.kind === undefined || args.kind === kind;
    const wantsFiles = sources.files && wants("files");
    const wantsWebsite = sources.files && wants("website");
    const wantsProjects =
      sources.projects &&
      (wants("projects") || wants("stages") || wants("drafts"));
    const client =
      wantsFiles || wantsWebsite
        ? await activeClientForKey(ctx, args.companyKey)
        : null;
    const scope = wantsProjects
      ? await newestLiveProjects(ctx, args.companyKey)
      : { projects: [] as Doc<"projects">[], truncated: false };

    /**
     * The `add` events, among these rows, of files a saved website read
     * made: a read logs its file's `add` and then its own row
     * (companyWebsiteReads, same time), and the website row stands for both.
     * Decided per event with one indexed lookup, so the add is left out the
     * same way on every page and under every filter, "Files" included (the
     * file shows there only through its later changes, such as an archive).
     */
    async function savedWebsiteFileAdds(
      clientId: Id<"clients">,
      rows: Doc<"companyFileEvents">[],
    ): Promise<Set<string>> {
      const folded = new Set<string>();
      for (const event of rows) {
        if (event.action !== "add") continue;
        const reads = await ctx.db
          .query("companyWebsiteReads")
          .withIndex("by_clientId_and_at", (q) =>
            q.eq("clientId", clientId).eq("at", event.at),
          )
          .take(WEBSITE_READS_AT_ONE_TIME);
        if (
          reads.some(
            (read) =>
              read.outcome === "saved" &&
              read.companyFileId === event.companyFileId,
          )
        )
          folded.add(event._id);
      }
      return folded;
    }

    function passOf<T extends { at: number; _creationTime: number }>(
      rows: T[],
      cap: number,
      map: (row: T) => Raw[],
    ): Pass {
      const last = rows.at(-1);
      return {
        rows: rows.flatMap(map),
        full: rows.length === cap,
        oldest: last ? keyOf(last) : null,
      };
    }

    async function readPass(before: Key | null): Promise<Pass[]> {
      const passes: Promise<Pass>[] = [];
      if (client && wantsFiles) {
        const clientId = client._id;
        passes.push(
          readBefore(
            before,
            FILE_EVENT_PASS,
            (at, ct, take) =>
              ctx.db
                .query("companyFileEvents")
                .withIndex("by_clientId_and_at", (q) =>
                  q
                    .eq("clientId", clientId)
                    .eq("at", at)
                    .lt("_creationTime", ct),
                )
                .order("desc")
                .take(take),
            (at, take) =>
              ctx.db
                .query("companyFileEvents")
                .withIndex("by_clientId_and_at", (q) =>
                  at === null
                    ? q.eq("clientId", clientId)
                    : q.eq("clientId", clientId).lt("at", at),
                )
                .order("desc")
                .take(take),
          ).then(async (rows) => {
            const folded = await savedWebsiteFileAdds(clientId, rows);
            return passOf(rows, FILE_EVENT_PASS, (event) => {
              const entry = folded.has(event._id) ? null : fileEntry(event);
              return entry ? [entry] : [];
            });
          }),
        );
      }
      if (client && wantsWebsite) {
        const clientId = client._id;
        passes.push(
          readBefore(
            before,
            WEBSITE_READ_PASS,
            (at, ct, take) =>
              ctx.db
                .query("companyWebsiteReads")
                .withIndex("by_clientId_and_at", (q) =>
                  q
                    .eq("clientId", clientId)
                    .eq("at", at)
                    .lt("_creationTime", ct),
                )
                .order("desc")
                .take(take),
            (at, take) =>
              ctx.db
                .query("companyWebsiteReads")
                .withIndex("by_clientId_and_at", (q) =>
                  at === null
                    ? q.eq("clientId", clientId)
                    : q.eq("clientId", clientId).lt("at", at),
                )
                .order("desc")
                .take(take),
          ).then((rows) =>
            passOf(rows, WEBSITE_READ_PASS, (read): Raw[] => {
              return [
                {
                  id: read._id,
                  kind: "website",
                  at: read.at,
                  ct: read._creationTime,
                  actorId: read.userId,
                  host: read.host,
                  outcome: read.outcome === "failed" ? "failed" : "read",
                  reason: read.reason ?? null,
                },
              ];
            }),
          ),
        );
      }
      for (const project of scope.projects) {
        const projectId = project._id;
        const ref = { id: projectId, title: project.title };
        passes.push(
          readBefore(
            before,
            PROJECT_EVENT_PASS,
            (at, ct, take) =>
              ctx.db
                .query("projectEvents")
                .withIndex("by_projectId_and_at", (q) =>
                  q
                    .eq("projectId", projectId)
                    .eq("at", at)
                    .lt("_creationTime", ct),
                )
                .order("desc")
                .take(take),
            (at, take) =>
              ctx.db
                .query("projectEvents")
                .withIndex("by_projectId_and_at", (q) =>
                  at === null
                    ? q.eq("projectId", projectId)
                    : q.eq("projectId", projectId).lt("at", at),
                )
                .order("desc")
                .take(take),
          ).then((rows) =>
            passOf(rows, PROJECT_EVENT_PASS, (event): Raw[] => {
              if (event.type !== "stage_changed") return [];
              const base = {
                id: event._id,
                at: event.at,
                ct: event._creationTime,
                actorId: event.actorId,
                project: ref,
              };
              if (event.note === "creation:initial-stage") {
                return [
                  {
                    ...base,
                    kind: "project_started",
                    fiscalYear: fiscalYearOf(project.fiscalYearEnd),
                  },
                ];
              }
              if (startsDrafting(event.from, event.to))
                return [{ ...base, kind: "draft_started" }];
              return [
                {
                  ...base,
                  kind: "stage_moved",
                  fromStage: event.from ?? null,
                  toStage: event.to,
                },
              ];
            }),
          ),
        );
      }
      return await Promise.all(passes);
    }

    const keep = (raw: Raw) =>
      wants(kindOf(raw)) &&
      (args.personId === undefined || raw.actorId === args.personId);

    let before = parseCursor(args.cursor);
    const picked: Raw[] = [];
    let continueCursor: string | null = null;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const passes = await readPass(before);
      // Rows at or after the newest "oldest row" of a full source are
      // complete in every source; older rows wait for the next pass.
      let frontier: Key | null = null;
      for (const read of passes) {
        if (
          read.full &&
          read.oldest &&
          (frontier === null || compareKeys(read.oldest, frontier) < 0)
        )
          frontier = read.oldest;
      }
      const sure = passes
        .flatMap((read) => read.rows)
        .filter(
          (raw) =>
            (frontier === null || compareKeys(raw, frontier) <= 0) && keep(raw),
        )
        .sort(compareRaw);
      picked.push(...sure);
      if (picked.length >= COMPANY_ACTIVITY_PAGE_SIZE) {
        // The next page starts right after the 25th row, by its exact key.
        const more =
          picked.length > COMPANY_ACTIVITY_PAGE_SIZE || frontier !== null;
        picked.length = COMPANY_ACTIVITY_PAGE_SIZE;
        continueCursor = more
          ? formatCursor(picked[COMPANY_ACTIVITY_PAGE_SIZE - 1])
          : null;
        break;
      }
      if (frontier === null) {
        continueCursor = null;
        break;
      }
      before = frontier;
      continueCursor = formatCursor(frontier);
    }

    // Name the people on this page.
    const userIds = new Set<Id<"users">>();
    for (const raw of picked) if (raw.actorId) userIds.add(raw.actorId);
    const users = new Map<Id<"users">, Doc<"users">>();
    for (const userId of userIds) {
      const member = await ctx.db.get(userId);
      if (member) users.set(userId, member);
    }
    const actorOf = (userId: Id<"users"> | null): Actor => {
      if (!userId) return null;
      const member = users.get(userId);
      const label = member ? userDisplayLabel(member) : "Unknown team member";
      return { userId, label, initials: member ? initials(label) : "?" };
    };
    const entries = picked.map(({ actorId, ct, ...rest }) => {
      void ct;
      return { ...rest, actor: actorOf(actorId) } as Entry;
    });
    return { entries, continueCursor, projectsTruncated: scope.truncated };
  },
});
