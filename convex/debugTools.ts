/**
 * TEMPORARY forensic helpers for the 3G Marine stuck-generation investigation
 * (Jul 17 meeting / Larry's 29-document stress test). Internal-only; remove
 * after the investigation. No auth — internal functions are not callable from
 * clients, only via CLI/dashboard.
 */
import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const findProjectsByClient = internalQuery({
  args: { needle: v.string() },
  handler: async (ctx, args) => {
    const needle = args.needle.toLowerCase();
    const projects = await ctx.db.query("projects").collect();
    return projects
      .filter(
        (p) =>
          p.clientName.toLowerCase().includes(needle) ||
          p.title.toLowerCase().includes(needle)
      )
      .map((p) => ({
        _id: p._id,
        title: p.title,
        clientName: p.clientName,
        status: p.status,
        createdAt: new Date(p.createdAt).toISOString(),
        activeGenerationId: p.activeGenerationId ?? null,
      }));
  },
});

export const generationPostmortem = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    const documents = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    const transcript = await ctx.db
      .query("transcripts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first();
    return {
      project: {
        title: project.title,
        status: project.status,
        createdAt: new Date(project.createdAt).toISOString(),
      },
      transcriptChars: transcript?.content.length ?? 0,
      documents: documents.map((d) => ({
        fileName: d.fileName,
        fileType: d.fileType,
        contentChars: d.content.length,
        category: d.category ?? null,
        hasStoredFile: Boolean(d.storageId),
      })),
      documentTotals: {
        count: documents.length,
        totalContentChars: documents.reduce((n, d) => n + d.content.length, 0),
      },
      generations: generations.map((g) => ({
        _id: g._id,
        status: g.status,
        candidateMode: g.candidateMode ?? "compare",
        requestedAt: new Date(g.requestedAt ?? g._creationTime).toISOString(),
        completedAt: g.completedAt ? new Date(g.completedAt).toISOString() : null,
        error: g.error ?? null,
        currentStep: g.currentStep ?? null,
        candidatesDone: g.candidatesDone ?? null,
        candidatesFailed: g.candidatesFailed ?? null,
        progressLog: g.progressLog ?? [],
      })),
    };
  },
});

export const recentFailures = internalQuery({
  args: { sinceIso: v.string() },
  handler: async (ctx, args) => {
    const since = Date.parse(args.sinceIso);
    const generations = await ctx.db.query("generations").collect();
    const failed = generations.filter(
      (g) => (g.requestedAt ?? g._creationTime) >= since
    );
    const out = [];
    for (const g of failed) {
      const p = await ctx.db.get(g.projectId);
      out.push({
        project: p ? `${p.clientName} — ${p.title}` : "(project deleted)",
        projectExists: Boolean(p),
        status: g.status,
        mode: g.candidateMode ?? "compare",
        requestedAt: new Date(g.requestedAt ?? g._creationTime).toISOString(),
        error: g.error ?? null,
        currentStep: g.currentStep ?? null,
        progressTail: (g.progressLog ?? []).slice(-4),
      });
    }
    return out;
  },
});

export const recentErrorReports = internalQuery({
  args: { sinceIso: v.string() },
  handler: async (ctx, args) => {
    const since = Date.parse(args.sinceIso);
    const reports = await ctx.db.query("errorReports").order("desc").take(200);
    return reports
      .filter((r) => r.createdAt >= since)
      .map((r) => ({
        createdAt: new Date(r.createdAt).toISOString(),
        kind: r.kind,
        message: r.message.slice(0, 300),
        url: r.url,
        userEmail: r.userEmail ?? null,
        note: r.userNote?.slice(0, 200) ?? null,
        breadcrumbTail: r.breadcrumbs.slice(-5).map((b) => `${b.type}:${b.label}`),
      }));
  },
});

export const bigDocProjects = internalQuery({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    const out = [];
    for (const p of projects) {
      const docs = await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", p._id))
        .collect();
      if (docs.length >= 10) {
        out.push({
          project: `${p.clientName} — ${p.title}`,
          status: p.status,
          createdAt: new Date(p.createdAt).toISOString(),
          docCount: docs.length,
          totalChars: docs.reduce((n, d) => n + d.content.length, 0),
          emptyDocs: docs.filter((d) => !d.content.trim()).length,
        });
      }
    }
    return out;
  },
});

export const usageWindow = internalQuery({
  args: { fromIso: v.string(), toIso: v.string() },
  handler: async (ctx, args) => {
    const from = Date.parse(args.fromIso);
    const to = Date.parse(args.toIso);
    const rows = await ctx.db
      .query("aiUsage")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", from).lt("createdAt", to))
      .collect();
    const byCallSite = new Map<string, number>();
    for (const r of rows) {
      byCallSite.set(r.callSite, (byCallSite.get(r.callSite) ?? 0) + 1);
    }
    return {
      calls: rows.length,
      byCallSite: Object.fromEntries(byCallSite),
      firstAt: rows[0] ? new Date(rows[0].createdAt).toISOString() : null,
      lastAt: rows.at(-1) ? new Date(rows.at(-1)!.createdAt).toISOString() : null,
    };
  },
});
