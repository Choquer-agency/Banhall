import type Anthropic from "@anthropic-ai/sdk";
import { generateStructured } from "../structured";
import type { GenerationClient } from "../openrouterCore";
import { pseudonymize, type PlaceholderMap } from "../../lib/deidentify";

/**
 * Section-scoped retrieval queries for The Brain, extracted from the raw
 * transcript by a cheap Haiku pre-pass (BNH-10 quality layer).
 *
 * Why: embedding the raw transcript retrieves on surface features — client
 * names, greetings, industry jargon — instead of the structural/rhetorical
 * patterns the drafters actually need (Skill-KNN / STORM finding: embed an
 * LLM-produced task description, never the raw input). Each T661 section also
 * needs DIFFERENT exemplars: how uncertainty is framed (242) is useless to the
 * work-performed narrative (244). One brief → four targeted queries.
 */
export type RetrievalBrief = {
  /** 2–3 sentence technical problem statement — the analyzer's general query. */
  problem: string;
  /** The core technological uncertainty, phrased like a 242 opening. */
  uncertainty: string;
  /** The experimentation/iteration story in brief, phrased like 244 content. */
  work: string;
  /** The advancement sought/achieved, phrased like a 246 claim. */
  advancement: string;
};

export const RETRIEVAL_BRIEF_MODEL = "claude-haiku-4-5-20251001";

/** Transcripts can be huge; the technical meat is captured well within this. */
export const RETRIEVAL_BRIEF_TRANSCRIPT_CAP = 120_000;

export const RETRIEVAL_BRIEF_SYSTEM_PROMPT = `You extract retrieval queries from an SR&ED interview transcript. Your output is used ONLY to search a database of past approved SR&ED reports for similar passages. It is never shown to anyone and never copied into a report.

Write in dense technical language (the database contains polished report prose, so match that register, not conversational speech). No client or person names: describe the technology, not the company.`;

export const RETRIEVAL_BRIEF_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    problem: {
      type: "string",
      description:
        "2-3 sentences: the core technical problem and approach of this project.",
    },
    uncertainty: {
      type: "string",
      description:
        "1-2 sentences: the scientific/technological uncertainty: what could not be known or predicted in advance and why standard practice was insufficient.",
    },
    work: {
      type: "string",
      description:
        "1-2 sentences: the systematic experimental/iterative work performed: hypotheses tested, prototypes built, analyses run.",
    },
    advancement: {
      type: "string",
      description:
        "1-2 sentences: the scientific/technological advancement sought or achieved: the new capability or knowledge gained.",
    },
  },
  required: ["problem", "uncertainty", "work", "advancement"],
};

export const RETRIEVAL_BRIEF_REQUEST = {
  userScaffold: {
    titlePrefix: "Project title: ",
    transcriptPrefix: "\n\nInterview transcript:\n",
    runtimeSentinels: [
      "{{runtime.projectTitle}}",
      "{{runtime.interviewTranscript}}",
    ],
  },
  roleOrder: ["system", "user"],
  toolName: "submit_retrieval_brief",
  toolDescription:
    "Submit the four retrieval queries extracted from the transcript.",
  maxTokens: 1024,
  modelSelector: "frozen-retrieval-brief-role-model",
} as const;

/**
 * One cheap structured Haiku call → four section-scoped queries. Returns null
 * on any failure so callers can fall back to the legacy title+transcript query
 * — brief extraction must never break generation.
 */
export async function buildRetrievalBrief(
  client: GenerationClient | Anthropic,
  title: string,
  transcript: string,
  // The retrieval_brief role's model, frozen on the generation.
  model: string = RETRIEVAL_BRIEF_MODEL
): Promise<RetrievalBrief | null> {
  try {
    const brief = await generateStructured<RetrievalBrief>(client, {
      system: RETRIEVAL_BRIEF_SYSTEM_PROMPT,
      user: `${RETRIEVAL_BRIEF_REQUEST.userScaffold.titlePrefix}${title}${RETRIEVAL_BRIEF_REQUEST.userScaffold.transcriptPrefix}${transcript.slice(0, RETRIEVAL_BRIEF_TRANSCRIPT_CAP)}`,
      toolName: RETRIEVAL_BRIEF_REQUEST.toolName,
      description: RETRIEVAL_BRIEF_REQUEST.toolDescription,
      schema: RETRIEVAL_BRIEF_SCHEMA,
      maxTokens: RETRIEVAL_BRIEF_REQUEST.maxTokens,
      model,
    });
    // Guard against a model returning empty strings — worse than the fallback.
    if (!brief.problem?.trim() || !brief.uncertainty?.trim()) return null;
    return brief;
  } catch (err) {
    console.error("brain retrieval-brief extraction failed; using fallback query", err);
    return null;
  }
}

/** Characters one query part built from facts may hold. */
export const RETRIEVAL_BRIEF_FACT_PART_CHARS = 800;

const PACK_FACT_LINE =
  /^\[F\d{1,3}-\d{1,5}\] \((uncertainty|hypothesis|experiment|result|advancement|context)\) (.+)$/gm;
const PLACEHOLDER_TOKEN = /\[(?:CLIENT|PERSON)_\d+(?:_[A-Z]+)?\]/g;

/**
 * The retrieval brief of a generation that reads fact packs (2026-09-24,
 * plan step 8), built from the frozen packs' own claims with no model call:
 * uncertainty facts give the 242 query, experiments and hypotheses the 244
 * one, advancements (or results) the 246 one. Names are dropped first
 * (owner decision 26): the queries leave the app for the embedding service,
 * and they should match on the technology, never the client. Deterministic
 * in the packs. Null when the packs hold no uncertainty, so the caller makes
 * today's call instead.
 */
export function retrievalBriefFromFacts(
  packs: readonly string[],
  placeholders: PlaceholderMap = []
): RetrievalBrief | null {
  const byType = new Map<string, string[]>();
  for (const pack of packs) {
    for (const match of pack.matchAll(PACK_FACT_LINE)) {
      const claim = pseudonymize(match[2], placeholders)
        .replace(PLACEHOLDER_TOKEN, "")
        .replace(/\s+/g, " ")
        .replace(/\s+([.,;:])/g, "$1")
        .trim();
      if (!claim) continue;
      byType.set(match[1], [...(byType.get(match[1]) ?? []), claim]);
    }
  }
  const of = (type: string) => byType.get(type) ?? [];
  const join = (claims: readonly string[]) => {
    const kept: string[] = [];
    let used = 0;
    for (const claim of claims) {
      if (used + claim.length + 1 > RETRIEVAL_BRIEF_FACT_PART_CHARS) break;
      kept.push(claim);
      used += claim.length + 1;
    }
    return kept.join(" ");
  };
  const uncertainty = join(of("uncertainty"));
  if (!uncertainty) return null;
  return {
    problem: join([...of("uncertainty").slice(0, 2), ...of("experiment").slice(0, 1), ...of("advancement").slice(0, 1)]),
    uncertainty,
    work: join([...of("experiment"), ...of("hypothesis")]) || uncertainty,
    advancement: join(of("advancement")) || join(of("result")) || uncertainty,
  };
}
