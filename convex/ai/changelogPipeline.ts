"use node";

/**
 * Jul 20: changelog pipeline. `npm run changelog` (scripts/publish-changelog.mjs)
 * collects commits from git grouped by author date and calls this action once
 * per day. Haiku rewrites the commit log into a non-technical summary +
 * bullet list; the entry is upserted by workDay so re-runs replace rather
 * than duplicate. Writers read the result at /changelog.
 *
 * Internal-only: not callable from browsers; the publish script runs it via
 * `npx convex run` with deploy credentials.
 */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { instrumentedAnthropic } from "./instrument";
import { CANDIDATE_MODELS } from "../../shared/generationModels";

const SUMMARY_MODEL =
  CANDIDATE_MODELS.find((m) => m.id.includes("haiku"))?.id ??
  CANDIDATE_MODELS[0].id;

/** First balanced JSON object in a string, or null. */
function extractJson(text: string): {
  title?: string;
  kind?: string;
  body?: string;
  summary?: string;
  sections?: { new?: string[]; improved?: string[]; fixed?: string[] };
} | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    else if (!inString && ch === "{") depth += 1;
    else if (!inString && ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Structure contract lives in docs/changelog-guidelines.md (2026-08-12):
// standard categorized sections (New / Improved / Fixed), combined bullets,
// kind derived from the sections.
const SYSTEM = `You write release notes for Banhall, an internal tool that turns SR&ED interview transcripts into CRA-ready project description reports. Your readers are SR&ED consultants and writers — smart, busy, NOT programmers.

You receive one day's git commit messages. Produce a JSON object:
1. "title": a short headline for the day (max 70 chars, no dates, no jargon — e.g. "Excel uploads and a faster project setup"). Lead with the most writer-visible change.
2. "summary": one or two plain-language sentences on what the day's work means for writers.
3. "sections": {"new": string[], "improved": string[], "fixed": string[]} — the standard changelog categories:
   - "new": capabilities that did not exist before.
   - "improved": existing behavior that got better (design, speed, clarity, workflow smoothness).
   - "fixed": things that were broken and now work.
   Use empty arrays for categories with nothing to report.

Rules for every bullet:
- Translate, don't transcribe. "Harden bulk uploads: cap extracted text" becomes "Large document uploads no longer get stuck — oversized files are trimmed automatically and one bad file won't sink the project."
- Every bullet describes an effect a writer can see or feel, never the implementation. No file names, function names, schema/table names, model IDs, branch names, or acronyms like SDK/API/UI unless writers use them daily (PD, QA, CRA are fine).
- COMBINE: multiple commits serving one change become ONE bullet. Ten polish commits are one "looks cleaner and reads more consistently" bullet, not ten.
- Skip commits with zero writer-visible effect (refactors, test-only changes, tooling, debug helpers) — at most fold them into a single "Behind-the-scenes reliability work" bullet at the END of "improved".
- Never invent changes that aren't in the commits.`;

export const publishDay = internalAction({
  args: {
    // "2026-07-19"
    workDay: v.string(),
    // "hash|subject|body" lines, newest first.
    commits: v.array(
      v.object({
        hash: v.string(),
        subject: v.string(),
        body: v.optional(v.string()),
      })
    ),
    // Publish timestamp override (defaults to end of the work day, UTC).
    publishedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.workDay)) {
      throw new Error(`workDay must be YYYY-MM-DD, got ${args.workDay}`);
    }
    if (args.commits.length === 0) return { skipped: true as const };

    const log = args.commits
      .map((c) => `- ${c.subject}${c.body?.trim() ? `\n  ${c.body.trim().replace(/\n/g, "\n  ")}` : ""}`)
      .join("\n");

    const client = instrumentedAnthropic(ctx, {
      callSite: "changelog:daily_summary",
      capability: "generation",
    });
    const response = await client.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Commits for ${args.workDay}:\n\n${log}\n\nRespond with ONLY a JSON object: {"title": string, "summary": string, "sections": {"new": string[], "improved": string[], "fixed": string[]}}`,
        },
      ],
    });
    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    // Non-greedy brace matching fails on nested strings; instead scan for the
    // first balanced object. Vague commit subjects ("july 9 changes") can also
    // make the model decline — fall back to a plain listing rather than fail.
    const parsed = extractJson(text);
    const title = parsed?.title?.trim() || `Updates for ${args.workDay}`;
    // Assemble the standard sectioned body (docs/changelog-guidelines.md):
    // summary, then ### New / ### Improved / ### Fixed — empty sections
    // are omitted, never rendered as bare headings.
    const clean = (items?: string[]) =>
      (items ?? []).map((i) => String(i).trim()).filter(Boolean);
    const sections: [string, string[]][] = [
      ["New", clean(parsed?.sections?.new)],
      ["Improved", clean(parsed?.sections?.improved)],
      ["Fixed", clean(parsed?.sections?.fixed)],
    ];
    const sectionMd = sections
      .filter(([, items]) => items.length > 0)
      .map(([label, items]) => `### ${label}\n${items.map((i) => `- ${i}`).join("\n")}`)
      .join("\n\n");
    const summary = parsed?.summary?.trim() ?? "";
    const body =
      [summary, sectionMd].filter(Boolean).join("\n\n") ||
      parsed?.body?.trim() ||
      args.commits.map((c) => `- ${c.subject}`).join("\n");
    // Kind derives from the sections (guidelines): feature = new without
    // fixes, fix = fixes without new, mixed otherwise or on fallback.
    const hasNew = sections[0][1].length > 0;
    const hasFixed = sections[2][1].length > 0;
    const kind = sectionMd
      ? hasNew && !hasFixed
        ? ("feature" as const)
        : hasFixed && !hasNew
          ? ("fix" as const)
          : ("mixed" as const)
      : ("mixed" as const);

    // End of the work day, clamped to now — an entry must never be stamped in
    // the future (it would out-run readers' markSeen watermarks and pin the
    // unseen badge until the timestamp passes).
    const publishedAt = Math.min(
      args.publishedAt ?? Date.parse(`${args.workDay}T23:59:00Z`),
      Date.now()
    );

    await ctx.runMutation(internal.changelog.upsertPipelineEntry, {
      workDay: args.workDay,
      title,
      body,
      kind,
      publishedAt,
      commitHashes: args.commits.map((c) => c.hash),
    });
    return { skipped: false as const, title, kind };
  },
});
