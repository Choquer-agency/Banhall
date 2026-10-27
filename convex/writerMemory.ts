/**
 * 2026-10-27 (Phase E, E1a; part 5 of the first 2026-10-26 entry): a
 * writer's saved preferences. Private to their writer: every public function
 * reads and changes only the caller's own rows, with no Admin or Manager
 * path. The AI may suggest a preference from the writer's own edits,
 * Feedback, choices and chat (convex/ai/writerMemory.ts); only the writer's
 * approval makes it one. Every text saved passes the style-only check
 * (convex/lib/preferenceCheck.ts) and the model's style-only check.
 */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCurrentUser } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { firmNames } from "./lib/firmNames";
import { deidentify, pseudonymize, type PlaceholderMap } from "./lib/deidentify";
import { projectPlaceholderMap } from "./lib/transcriptPlaceholders";
import { listProjectTranscripts } from "./lib/transcripts";
import {
  appVocabulary,
  checkPreferenceText,
  PREFERENCE_REFUSAL_WORDS,
  preferenceTextKey,
} from "./lib/preferenceCheck";

/** At most this many approved preferences (on or off) per writer. */
export const MAX_SAVED_PREFERENCES = 30;
/** At most this many open suggestions per writer. */
export const MAX_OPEN_SUGGESTIONS = 5;
/** A dismissed suggestion's text is kept this long, seen by nobody, so it is not suggested again. */
export const DISMISSED_TEXT_KEPT_MS = 90 * 24 * 60 * 60 * 1000;
/** At most this many of a writer's signals, and characters, one suggestion run reads. */
export const MAX_RUN_SIGNALS = 40;
export const MAX_RUN_CHARS = 12_000;
/** A run's lease, and how soon after a Seed sign-off one may run again. */
const RUN_LEASE_MS = 10 * 60 * 1000;
const SIGN_OFF_RUN_GAP_MS = 24 * 60 * 60 * 1000;

type Ctx = QueryCtx | MutationCtx;

/** The writer, when they may hold preferences: a signed-in internal user. */
function activeWriter(user: Doc<"users"> | null): user is Doc<"users"> {
  return user !== null && user.isAnonymous !== true && user.role !== undefined;
}

/**
 * Names no preference may hold: every company and its former names, the
 * firm's own names, and the companies and people of the given projects. A
 * one-word name that is also a word of writing ("Client") is left out, so
 * the check never refuses ordinary words.
 */
export async function preferenceNames(ctx: Ctx, projects: ReadonlyArray<Doc<"projects">>): Promise<string[]> {
  const names = new Set<string>(await firmNames(ctx));
  for (const company of await ctx.db.query("clients").take(2_000)) {
    names.add(company.name);
    for (const former of company.formerNames ?? []) names.add(former);
  }
  for (const project of projects) {
    names.add(project.clientName);
    if (project.interviewer) names.add(project.interviewer);
    for (const person of project.interviewees ?? []) names.add(person);
  }
  const vocabulary = appVocabulary();
  return [...names].filter((name) => {
    const trimmed = name.trim();
    return trimmed.length >= 3 && !(!/\s/.test(trimmed) && vocabulary.has(trimmed.toLowerCase()));
  });
}

/** The writer's recent projects, for checking a text they write themselves. */
async function writersRecentProjects(ctx: Ctx, userId: Id<"users">): Promise<Doc<"projects">[]> {
  const owned = await ctx.db
    .query("projects")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", userId))
    .order("desc")
    .take(50);
  return owned.filter((project) => project.deletionStartedAt === undefined);
}

async function ownRow(ctx: Ctx, userId: Id<"users">, memoryId: Id<"writerMemories">): Promise<Doc<"writerMemories">> {
  const row = await ctx.db.get(memoryId);
  // Another writer's row reads as missing: nobody learns it exists.
  if (!row || row.userId !== userId) domainError("NOT_FOUND", "Preference not found");
  return row;
}

async function sourcesOf(ctx: Ctx, memoryId: Id<"writerMemories">) {
  return await ctx.db
    .query("writerMemorySources")
    .withIndex("by_memoryId", (q) => q.eq("memoryId", memoryId))
    .take(MAX_RUN_SIGNALS + 1);
}

async function deleteSources(ctx: MutationCtx, memoryId: Id<"writerMemories">): Promise<void> {
  for (const source of await sourcesOf(ctx, memoryId)) await ctx.db.delete(source._id);
}

/** Whether an open suggestion still has every request text it was made from. */
async function suggestionIntact(ctx: Ctx, row: Doc<"writerMemories">): Promise<boolean> {
  if (row.state !== "suggested" || row.origin !== "suggested") return true;
  return (await sourcesOf(ctx, row._id)).length === (row.sourceCount ?? 0);
}

async function countState(ctx: Ctx, userId: Id<"users">, state: Doc<"writerMemories">["state"]): Promise<number> {
  return (
    await ctx.db
      .query("writerMemories")
      .withIndex("by_userId_and_state", (q) => q.eq("userId", userId).eq("state", state))
      .take(MAX_SAVED_PREFERENCES + MAX_OPEN_SUGGESTIONS + 1)
  ).length;
}

/** The caller's own suggestions and saved preferences. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const read = (state: Doc<"writerMemories">["state"]) =>
      ctx.db
        .query("writerMemories")
        .withIndex("by_userId_and_state", (q) => q.eq("userId", user._id).eq("state", state))
        .take(MAX_SAVED_PREFERENCES + MAX_OPEN_SUGGESTIONS);
    const [suggested, on, off] = await Promise.all([read("suggested"), read("on"), read("off")]);
    const suggestions = [];
    for (const row of suggested) {
      if (await suggestionIntact(ctx, row)) suggestions.push({ _id: row._id, text: row.text, support: row.support ?? 0 });
    }
    const saved = [...on, ...off]
      .sort((a, b) => (a.decidedAt ?? a.createdAt) - (b.decidedAt ?? b.createdAt))
      .map((row) => ({ _id: row._id, text: row.text, on: row.state === "on", origin: row.origin }));
    return { suggestions, saved, limit: MAX_SAVED_PREFERENCES };
  },
});

/**
 * Approves a suggestion as written. Its request is checked again first. A
 * suggestion whose work was erased is withdrawn instead ("withdrawn"): an
 * error would roll its removal back.
 */
export const approve = mutation({
  args: { memoryId: v.id("writerMemories") },
  returns: v.union(v.literal("approved"), v.literal("withdrawn")),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const row = await ownRow(ctx, user._id, args.memoryId);
    if (row.state !== "suggested") domainError("INVALID_STATE", "This suggestion was already decided");
    const sources = await sourcesOf(ctx, row._id);
    if (sources.length !== (row.sourceCount ?? 0)) {
      await deleteSources(ctx, row._id);
      await ctx.db.delete(row._id);
      return "withdrawn" as const;
    }
    if (row.checkedTextKey !== row.textKey) domainError("INVALID_STATE", "This suggestion was not checked");
    const projects = (await Promise.all([...new Set(sources.map((source) => source.projectId))].map((id) => ctx.db.get(id)))).filter(
      (project): project is Doc<"projects"> => project !== null
    );
    const check = checkPreferenceText(row.text, {
      names: await preferenceNames(ctx, projects),
      request: sources.map((source) => ({ text: source.text, company: source.company })),
    });
    if (!check.ok) domainError("INVALID_INPUT", PREFERENCE_REFUSAL_WORDS[check.reason]);
    if ((await countState(ctx, user._id, "on")) + (await countState(ctx, user._id, "off")) >= MAX_SAVED_PREFERENCES) {
      domainError("INVALID_STATE", `You can keep at most ${MAX_SAVED_PREFERENCES} saved preferences`);
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { state: "on", decidedAt: now, updatedAt: now });
    await deleteSources(ctx, row._id);
    return "approved" as const;
  },
});

/** Dismisses a suggestion. Its text is kept, seen by nobody, for 90 days so it is not suggested again. */
export const dismiss = mutation({
  args: { memoryId: v.id("writerMemories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const row = await ownRow(ctx, user._id, args.memoryId);
    if (row.state !== "suggested") domainError("INVALID_STATE", "This suggestion was already decided");
    const now = Date.now();
    await ctx.db.patch(row._id, { state: "dismissed", decidedAt: now, updatedAt: now });
    await deleteSources(ctx, row._id);
    return null;
  },
});

/** Turns a saved preference on or off. */
export const setOn = mutation({
  args: { memoryId: v.id("writerMemories"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const row = await ownRow(ctx, user._id, args.memoryId);
    if (row.state !== "on" && row.state !== "off") domainError("INVALID_STATE", "Only a saved preference can be turned on or off");
    await ctx.db.patch(row._id, { state: args.on ? "on" : "off", updatedAt: Date.now() });
    return null;
  },
});

/** Deletes a saved preference or a suggestion, at once. Drafts already made keep what they used. */
export const remove = mutation({
  args: { memoryId: v.id("writerMemories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const row = await ownRow(ctx, user._id, args.memoryId);
    await deleteSources(ctx, row._id);
    await ctx.db.delete(row._id);
    return null;
  },
});

/** Deletes every saved preference, suggestion and dismissed suggestion of the caller. */
export const removeAll = mutation({
  args: {},
  returns: v.object({ removed: v.number(), more: v.boolean() }),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return await removeAllFor(ctx, user._id);
  },
});

async function removeAllFor(ctx: MutationCtx, userId: Id<"users">): Promise<{ removed: number; more: boolean }> {
  let removed = 0;
  for (const state of ["suggested", "on", "off", "dismissed"] as const) {
    const rows = await ctx.db
      .query("writerMemories")
      .withIndex("by_userId_and_state", (q) => q.eq("userId", userId).eq("state", state))
      .take(200);
    for (const row of rows) {
      await deleteSources(ctx, row._id);
      await ctx.db.delete(row._id);
      removed += 1;
    }
  }
  const more = (await ctx.db.query("writerMemories").withIndex("by_userId_and_state", (q) => q.eq("userId", userId)).first()) !== null;
  if (more) await ctx.scheduler.runAfter(0, internal.writerMemory.removeAllForWriter, { userId });
  return { removed, more };
}

/** The rest of a writer's deletion, when it did not fit one step. */
export const removeAllForWriter = internalMutation({
  args: { userId: v.id("users") },
  returns: v.object({ removed: v.number(), more: v.boolean() }),
  handler: async (ctx, args) => await removeAllFor(ctx, args.userId),
});

/** The signed-in writer's id, for the action that checks a text. */
export const currentWriterId = internalQuery({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
      .unique();
    return activeWriter(user) ? user._id : null;
  },
});

/**
 * What a text the writer saves is checked against: every company and the
 * firm's names, the writer's recent projects, and, when they edit an open
 * suggestion, its request.
 */
export const checkContextFor = internalQuery({
  args: { userId: v.id("users"), memoryId: v.optional(v.id("writerMemories")) },
  handler: async (ctx, args) => {
    const projects = await writersRecentProjects(ctx, args.userId);
    let request: Array<{ text: string; company: string }> | undefined;
    if (args.memoryId) {
      const row = await ownRow(ctx, args.userId, args.memoryId);
      if (row.state === "suggested") {
        const sources = await sourcesOf(ctx, row._id);
        request = sources.map((source) => ({ text: source.text, company: source.company }));
        for (const projectId of new Set(sources.map((source) => source.projectId))) {
          const project = await ctx.db.get(projectId);
          if (project) projects.push(project);
        }
      }
    }
    return { names: await preferenceNames(ctx, projects), ...(request ? { request } : {}) };
  },
});

/**
 * Saves a text the writer wrote or edited, once the action's checks passed:
 * a new preference, an edit of a saved one, or an edited suggestion (which
 * approves it). The deterministic check runs again here.
 */
export const saveCheckedText = internalMutation({
  args: {
    userId: v.id("users"),
    memoryId: v.optional(v.id("writerMemories")),
    text: v.string(),
    checkedTextKey: v.string(),
  },
  returns: v.id("writerMemories"),
  handler: async (ctx, args) => {
    const text = args.text.trim();
    const textKey = preferenceTextKey(text);
    if (textKey !== args.checkedTextKey) domainError("INVALID_STATE", "The text changed after it was checked");
    const projects = await writersRecentProjects(ctx, args.userId);
    const check = checkPreferenceText(text, { names: await preferenceNames(ctx, projects) });
    if (!check.ok) domainError("INVALID_INPUT", PREFERENCE_REFUSAL_WORDS[check.reason]);
    const now = Date.now();
    const same = await ctx.db
      .query("writerMemories")
      .withIndex("by_userId_and_textKey", (q) => q.eq("userId", args.userId).eq("textKey", textKey))
      .first();
    if (same && same._id !== args.memoryId && (same.state === "on" || same.state === "off")) {
      domainError("INVALID_INPUT", "You already have this preference");
    }
    if (args.memoryId) {
      const row = await ownRow(ctx, args.userId, args.memoryId);
      if (row.state === "dismissed") domainError("INVALID_STATE", "This suggestion was dismissed");
      const approving = row.state === "suggested";
      if (approving && (await countState(ctx, args.userId, "on")) + (await countState(ctx, args.userId, "off")) >= MAX_SAVED_PREFERENCES) {
        domainError("INVALID_STATE", `You can keep at most ${MAX_SAVED_PREFERENCES} saved preferences`);
      }
      await ctx.db.patch(row._id, {
        text,
        textKey,
        checkedTextKey: textKey,
        ...(approving ? { state: "on" as const, decidedAt: now } : {}),
        updatedAt: now,
      });
      if (approving) await deleteSources(ctx, row._id);
      return row._id;
    }
    if ((await countState(ctx, args.userId, "on")) + (await countState(ctx, args.userId, "off")) >= MAX_SAVED_PREFERENCES) {
      domainError("INVALID_STATE", `You can keep at most ${MAX_SAVED_PREFERENCES} saved preferences`);
    }
    return await ctx.db.insert("writerMemories", {
      userId: args.userId,
      text,
      textKey,
      state: "on",
      origin: "written",
      checkedTextKey: textKey,
      createdAt: now,
      decidedAt: now,
      updatedAt: now,
    });
  },
});

// ─── Suggestion runs (convex/ai/writerMemory.ts) ─────────────────────────────

/** Takes the writer's run lease. A sign-off run waits a day after the last run. */
export const leaseRun = internalMutation({
  args: { userId: v.id("users"), reason: v.union(v.literal("sign_off"), v.literal("nightly")) },
  returns: v.union(v.object({ since: v.number() }), v.null()),
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await ctx.db.query("writerMemoryRuns").withIndex("by_userId", (q) => q.eq("userId", args.userId)).unique();
    if (row && row.leaseUntil > now) return null;
    if (row && args.reason === "sign_off" && row.lastRunAt !== undefined && now - row.lastRunAt < SIGN_OFF_RUN_GAP_MS) return null;
    if (row) await ctx.db.patch(row._id, { leaseUntil: now + RUN_LEASE_MS });
    else await ctx.db.insert("writerMemoryRuns", { userId: args.userId, leaseUntil: now + RUN_LEASE_MS });
    return { since: row?.lastRunAt ?? 0 };
  },
});

export const finishRun = internalMutation({
  args: { userId: v.id("users"), ranAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("writerMemoryRuns").withIndex("by_userId", (q) => q.eq("userId", args.userId)).unique();
    if (row) await ctx.db.patch(row._id, { leaseUntil: 0, lastRunAt: args.ranAt });
    return null;
  },
});

export type RunSignal = { ref: string; projectId: Id<"projects">; company: string; text: string };

/** A masker per project: the names the app knows become placeholders, then the record's names go. */
function maskers(ctx: QueryCtx) {
  const cache = new Map<Id<"projects">, { project: Doc<"projects">; map: PlaceholderMap } | null>();
  return async (projectId: Id<"projects">, texts: readonly string[]) => {
    if (!cache.has(projectId)) {
      const project = await ctx.db.get(projectId);
      cache.set(
        projectId,
        project && project.deletionStartedAt === undefined
          ? { project, map: await projectPlaceholderMap(ctx, project, await listProjectTranscripts(ctx, projectId), texts) }
          : null
      );
    }
    const entry = cache.get(projectId);
    if (!entry) return null;
    return {
      project: entry.project,
      mask: (text: string) => deidentify(pseudonymize(text, entry.map), entry.project).trim().slice(0, 1_500),
    };
  };
}

function companyKey(project: Doc<"projects">): string {
  return project.clientId ?? project.clientName.trim().toLowerCase();
}

/**
 * One writer's own signals since their last run, newest first, masked: Seed
 * rewordings, Feedback and choices (learning signals, masked when written),
 * chat card rewordings, section edits and the messages they typed in chat.
 * Evaluation projects are never read (E3). Also what the run must not
 * repeat, and the names its suggestions are checked against.
 */
export const gatherForWriter = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!activeWriter(user)) return { active: false as const };
    const mask = maskers(ctx);
    const signals: RunSignal[] = [];
    let chars = 0;
    const push = (signal: RunSignal) => {
      if (signals.length >= MAX_RUN_SIGNALS || chars + signal.text.length > MAX_RUN_CHARS) return;
      signals.push(signal);
      chars += signal.text.length;
    };
    const learning = await ctx.db
      .query("learningSignals")
      .withIndex("by_producerId_and_at", (q) => q.eq("producerId", args.userId).gt("at", args.since))
      .order("desc")
      .take(MAX_RUN_SIGNALS * 2);
    for (const row of learning) {
      if (row.kind !== "seed_rewording" && row.kind !== "seed_feedback" && row.kind !== "seed_choices") continue;
      const project = await ctx.db.get(row.projectId);
      if (!project || project.deletionStartedAt !== undefined) continue;
      const text =
        row.kind === "seed_rewording"
          ? `Seed rewording. AI idea: ${row.payload.before ?? ""}\nWriter's rewording: ${row.payload.after ?? ""}`
          : row.kind === "seed_feedback"
            ? `Seed Feedback. Idea: ${row.payload.about ?? ""}\nWriter's instruction: ${row.payload.instruction ?? ""}`
            : `Seed choices, per idea style: ${(row.payload.tags ?? []).map((tag) => `${tag.tag} ${tag.chosen} of ${tag.offered}`).join(", ")}; asked for new ideas ${row.payload.newIdeas ?? 0} times`;
      push({ ref: `learningSignal:${row._id}`, projectId: row.projectId, company: companyKey(project), text });
    }
    const cards = await ctx.db
      .query("proposalWordingEditEvents")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
    for (const row of cards) {
      if (row.createdAt <= args.since) continue;
      const masked = await mask(row.projectId, [row.originalText, row.editedText]);
      if (!masked) continue;
      push({
        ref: `proposalWordingEdit:${row._id}`,
        projectId: row.projectId,
        company: companyKey(masked.project),
        text: `Chat card rewording. Assistant: ${masked.mask(row.originalText)}\nWriter's rewording: ${masked.mask(row.editedText)}`,
      });
    }
    const sections = await ctx.db
      .query("sectionEditEvents")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", args.userId).gt("createdAt", args.since))
      .order("desc")
      .take(10);
    for (const row of sections) {
      if (!(row.editRatio >= 0.05)) continue;
      const masked = await mask(row.projectId, [row.draftText, row.approvedText]);
      if (!masked) continue;
      push({
        ref: `sectionEdit:${row._id}`,
        projectId: row.projectId,
        company: companyKey(masked.project),
        text: `Section edit. Draft: ${masked.mask(row.draftText)}\nWriter's approved text: ${masked.mask(row.approvedText)}`,
      });
    }
    const turns = await ctx.db
      .query("chatTurns")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", args.userId).eq("status", "completed"))
      .order("desc")
      .take(20);
    const recentTurns = turns.filter((turn) => (turn.startedAt ?? turn._creationTime) > args.since);
    if (recentTurns.length > 0) {
      const messages = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: recentTurns.map((turn) => turn.promptMessageId),
      });
      for (const [index, turn] of recentTurns.entries()) {
        const message = messages[index];
        const content = message?.message?.role === "user" ? message.message.content : null;
        const typed = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join(" ") : "";
        if (!typed.trim()) continue;
        const thread = await ctx.db
          .query("agentChatThreads")
          .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", turn.agentThreadId))
          .unique();
        if (!thread) continue;
        const masked = await mask(thread.projectId, [typed]);
        if (!masked) continue;
        push({
          ref: `chatTurn:${turn._id}`,
          projectId: thread.projectId,
          company: companyKey(masked.project),
          text: `Chat message the writer typed: ${masked.mask(typed)}`,
        });
      }
    }
    const existing = await ctx.db
      .query("writerMemories")
      .withIndex("by_userId_and_state", (q) => q.eq("userId", args.userId))
      .take(500);
    const profile = await ctx.db.query("writerProfiles").withIndex("by_userId", (q) => q.eq("userId", args.userId)).unique();
    const projects = (
      await Promise.all([...new Set(signals.map((signal) => signal.projectId))].map((id) => ctx.db.get(id)))
    ).filter((project): project is Doc<"projects"> => project !== null);
    return {
      active: true as const,
      signals,
      existing: existing.filter((row) => row.text).map((row) => ({ text: row.text, state: row.state })),
      openSuggestions: existing.filter((row) => row.state === "suggested").length,
      profileText: (profile?.customInstructions ?? "").slice(0, 2_000),
      names: await preferenceNames(ctx, projects),
    };
  },
});

/**
 * Saves a run's suggestions that passed both checks, each with its whole
 * request kept while it is open. A suggestion the writer has, had or
 * dismissed is skipped, and so is one whose projects were erased meanwhile.
 */
export const saveSuggestions = internalMutation({
  args: {
    userId: v.id("users"),
    suggestions: v.array(v.object({ text: v.string(), support: v.number(), checkedTextKey: v.string() })),
    request: v.array(v.object({ ref: v.string(), projectId: v.id("projects"), company: v.string(), text: v.string() })),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!activeWriter(user)) return 0;
    for (const projectId of new Set(args.request.map((entry) => entry.projectId))) {
      const project = await ctx.db.get(projectId);
      if (!project || project.deletionStartedAt !== undefined) return 0;
    }
    let open = await countState(ctx, args.userId, "suggested");
    let saved = 0;
    const now = Date.now();
    for (const suggestion of args.suggestions) {
      if (open >= MAX_OPEN_SUGGESTIONS) break;
      const text = suggestion.text.trim();
      const textKey = preferenceTextKey(text);
      if (textKey !== suggestion.checkedTextKey) continue;
      const known = await ctx.db
        .query("writerMemories")
        .withIndex("by_userId_and_textKey", (q) => q.eq("userId", args.userId).eq("textKey", textKey))
        .first();
      if (known) continue;
      const memoryId = await ctx.db.insert("writerMemories", {
        userId: args.userId,
        text,
        textKey,
        state: "suggested",
        origin: "suggested",
        support: suggestion.support,
        sourceCount: args.request.length,
        checkedTextKey: textKey,
        createdAt: now,
        updatedAt: now,
      });
      for (const entry of args.request) {
        await ctx.db.insert("writerMemorySources", { memoryId, userId: args.userId, ...entry });
      }
      open += 1;
      saved += 1;
    }
    return saved;
  },
});

/** Nightly: a suggestion run for each writer with new Step-by-step signals since yesterday. */
export const scheduleNightlyRuns = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const since = Date.now() - 26 * 60 * 60 * 1000;
    const writers = new Set<Id<"users">>();
    for (const kind of ["seed_rewording", "seed_feedback", "seed_choices"] as const) {
      const rows = await ctx.db
        .query("learningSignals")
        .withIndex("by_kind_and_at", (q) => q.eq("kind", kind).gt("at", since))
        .take(2_000);
      for (const row of rows) writers.add(row.producerId);
    }
    let delay = 0;
    for (const userId of writers) {
      await ctx.scheduler.runAfter(delay, internal.ai.writerMemory.suggestForWriter, { userId, reason: "nightly" });
      delay += 30_000;
    }
    return writers.size;
  },
});

/** Daily: clears the text of suggestions dismissed more than 90 days ago, keeping only their key. */
export const clearDismissedTexts = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("writerMemories")
      .withIndex("by_state_and_decidedAt", (q) => q.eq("state", "dismissed").lt("decidedAt", Date.now() - DISMISSED_TEXT_KEPT_MS))
      .take(500);
    let cleared = 0;
    for (const row of rows) {
      if (!row.text) continue;
      await ctx.db.patch(row._id, { text: "" });
      cleared += 1;
    }
    return cleared;
  },
});
