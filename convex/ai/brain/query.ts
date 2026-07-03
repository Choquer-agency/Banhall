import type Anthropic from "@anthropic-ai/sdk";
import { generateStructured } from "../structured";

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

const BRIEF_MODEL = "claude-haiku-4-5-20251001";

/** Transcripts can be huge; the technical meat is captured well within this. */
const TRANSCRIPT_CAP = 120_000;

const BRIEF_SYSTEM = `You extract retrieval queries from an SR&ED interview transcript. Your output is used ONLY to search a database of past approved SR&ED reports for similar passages — it is never shown to anyone and never copied into a report.

Write in dense technical language (the database contains polished report prose, so match that register, not conversational speech). No client or person names — describe the technology, not the company.`;

const BRIEF_SCHEMA: Anthropic.Tool.InputSchema = {
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
        "1-2 sentences: the scientific/technological uncertainty — what could not be known or predicted in advance and why standard practice was insufficient.",
    },
    work: {
      type: "string",
      description:
        "1-2 sentences: the systematic experimental/iterative work performed — hypotheses tested, prototypes built, analyses run.",
    },
    advancement: {
      type: "string",
      description:
        "1-2 sentences: the scientific/technological advancement sought or achieved — the new capability or knowledge gained.",
    },
  },
  required: ["problem", "uncertainty", "work", "advancement"],
};

/**
 * One cheap structured Haiku call → four section-scoped queries. Returns null
 * on any failure so callers can fall back to the legacy title+transcript query
 * — brief extraction must never break generation.
 */
export async function buildRetrievalBrief(
  client: Anthropic,
  title: string,
  transcript: string
): Promise<RetrievalBrief | null> {
  try {
    const brief = await generateStructured<RetrievalBrief>(client, {
      system: BRIEF_SYSTEM,
      user: `Project title: ${title}\n\nInterview transcript:\n${transcript.slice(0, TRANSCRIPT_CAP)}`,
      toolName: "submit_retrieval_brief",
      description:
        "Submit the four retrieval queries extracted from the transcript.",
      schema: BRIEF_SCHEMA,
      maxTokens: 1024,
      model: BRIEF_MODEL,
    });
    // Guard against a model returning empty strings — worse than the fallback.
    if (!brief.problem?.trim() || !brief.uncertainty?.trim()) return null;
    return brief;
  } catch (err) {
    console.error("brain retrieval-brief extraction failed; using fallback query", err);
    return null;
  }
}
