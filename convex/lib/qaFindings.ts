import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256 } from "./contracts";
import { checkBecauseClauses, sectionDeterministicFindings } from "../ai/qaChecks";
import { qaScorecardSchema } from "../../shared/qaScorecard";
import { normalizeStyleOverrides, STYLE_OVERRIDE_KEYS, type StyleOverrides } from "../../shared/styleOverrides";
import { extractReportSections } from "./tiptapReport";

function parseOverrides(raw: unknown): StyleOverrides {
  const known: Partial<StyleOverrides> = {};
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      const field = STYLE_OVERRIDE_KEYS.find((candidate) => candidate === key);
      if (field && value === true) known[field] = true;
    }
  }
  return normalizeStyleOverrides(known);
}

export async function reportQaRef(report: Doc<"reports">) {
  return { reportId: report._id, revisionNumber: report.revisionNumber ?? 0,
    contentHash: await sha256(report.content) };
}

async function storeFinding(ctx: MutationCtx, ref: Awaited<ReturnType<typeof reportQaRef>>,
  finding: { section: string; check: string; message: string; blocking: boolean }) {
  const findingKey = JSON.stringify([finding.section, finding.check, finding.message]);
  const existing = await ctx.db.query("qaFindings")
    .withIndex("by_reportId_and_revisionNumber_and_contentHash_and_findingKey", q =>
      q.eq("reportId", ref.reportId).eq("revisionNumber", ref.revisionNumber)
        .eq("contentHash", ref.contentHash).eq("findingKey", findingKey))
    .first();
  if (!existing) await ctx.db.insert("qaFindings", { ...ref, ...finding, findingKey });
}

export async function persistDeterministicFindings(ctx: MutationCtx, reportId: Id<"reports">, initialOutputs?: string) {
  const report = await ctx.db.get(reportId);
  if (!report) return;
  const ref = await reportQaRef(report);
  // Byte-identical content cannot clear an established methodology failure by
  // advancing the revision (including a no-op save or a later restoration).
  for (const message of ["why_how_why_intact", "uncertainties_distinguished"]) {
    const previous = await ctx.db.query("qaFindings")
      .withIndex("by_reportId_and_contentHash_and_check_and_message_and_blocking", q =>
        q.eq("reportId", reportId).eq("contentHash", ref.contentHash)
          .eq("check", "cra_methodology").eq("message", message).eq("blocking", true)).first();
    if (previous) await storeFinding(ctx, ref, { section: "report", check: "cra_methodology", message, blocking: true });
  }
  let overrides = normalizeStyleOverrides(undefined);
  if (report.generationId) {
    const generation = await ctx.db.get(report.generationId);
    try {
      const outputs: unknown = JSON.parse(initialOutputs ?? generation?.agentOutputs ?? "{}");
      if (outputs && typeof outputs === "object" && "styleOverrides" in outputs) {
        overrides = parseOverrides(outputs.styleOverrides);
      }
    } catch { /* Legacy reports use default advisory checks. */ }
  }
  const generationId = report.generationId;
  if (generationId) {
    const brain = await ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", q => q.eq("generationId", generationId).eq("kind", "brain_blocks")).first();
    if (brain) {
      try {
        const parsed: unknown = JSON.parse(brain.content);
        if (parsed && typeof parsed === "object" && "styleOverrides" in parsed) overrides = parseOverrides(parsed.styleOverrides);
      } catch { /* Default advisory checks for malformed legacy artifacts. */ }
    }
  }
  const sections = extractReportSections(report.content);
  for (const section of ["s242", "s244", "s246"] as const) {
    for (const finding of sectionDeterministicFindings(section, sections[section], overrides)) {
      await storeFinding(ctx, ref, { ...finding, section, blocking: finding.check === "because_clause" });
    }
  }
}

export async function persistMethodologyFindings(ctx: MutationCtx, report: Doc<"reports">, qa: unknown) {
  const parsed = qaScorecardSchema.safeParse(qa);
  if (!parsed.success) return;
  const ref = await reportQaRef(report);
  for (const field of ["why_how_why_intact", "uncertainties_distinguished"] as const) {
    if (parsed.data.cra_compliance[field] === false) {
      await storeFinding(ctx, ref, { section: "report", check: "cra_methodology", message: field, blocking: true });
    }
  }
}

export async function hasBlockingQa(ctx: QueryCtx | MutationCtx, report: Doc<"reports">) {
  const sections = extractReportSections(report.content);
  if (checkBecauseClauses(sections.s242).details.some(f => !f.hasBecause)) return true;
  const ref = await reportQaRef(report);
  return (await ctx.db.query("qaFindings")
    .withIndex("by_reportId_and_revisionNumber_and_contentHash_and_blocking", q =>
      q.eq("reportId", ref.reportId).eq("revisionNumber", ref.revisionNumber)
        .eq("contentHash", ref.contentHash).eq("blocking", true)).first()) !== null;
}
