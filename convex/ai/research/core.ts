/**
 * Pure Contextual Research helpers. This module deliberately has no Convex
 * imports so request shaping, redaction, citation parsing, and reviewer-output
 * validation can be unit tested without a deployment.
 */

export const RESEARCH_MODELS = {
  gpt: "openai/gpt-5.6-sol",
  perplexity: "perplexity/sonar-deep-research",
  reviewer: "anthropic/claude-sonnet-5",
} as const;

export type ExternalResearchProvider = "gpt" | "perplexity";
export type ResearchRunProvider = ExternalResearchProvider | "reviewer";

const MAX_SELECTED_TEXT = 12_000;
const MAX_CONTEXT_TEXT = 12_000;
const MAX_INSTRUCTION = 2_000;
const MAX_SOURCE_EXCERPT = 5_000;

function cap(value: string, max: number): string {
  const normalized = value.replace(/\u0000/g, "").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove direct identifiers before a prompt leaves Banhall. Technical language
 * is retained because it is the point of the research request.
 */
export function redactExternalText(value: string, knownNames: string[]): string {
  let redacted = value;
  const names = Array.from(
    new Set(knownNames.map((name) => name.trim()).filter((name) => name.length >= 3))
  ).sort((a, b) => b.length - a.length);
  for (const name of names) {
    redacted = redacted.replace(new RegExp(escapeRegExp(name), "gi"), "[redacted]");
  }
  redacted = redacted
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[redacted phone]")
    .replace(/https?:\/\/[^\s)\]}>,]+/gi, "[redacted URL]");
  return redacted.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export type ExternalBriefInput = {
  selectedText: string;
  surroundingContext: string;
  instruction: string;
  projectTitle?: string;
  industry?: string;
  scienceCode?: string;
  fiscalYear?: string;
  knownNames: string[];
};

export function buildExternalBrief(input: ExternalBriefInput): string {
  const redact = (value: string) => redactExternalText(value, input.knownNames);
  const metadata = [
    input.projectTitle ? `Project topic: ${redact(input.projectTitle)}` : null,
    input.industry ? `Industry: ${redact(input.industry)}` : null,
    input.scienceCode ? `Field of science or technology: ${input.scienceCode}` : null,
    input.fiscalYear ? `Fiscal year: ${input.fiscalYear}` : null,
  ].filter(Boolean);
  const instruction = cap(
    redact(input.instruction) ||
      "Research the missing general scientific, engineering, standards, or industry context needed to evaluate this passage.",
    MAX_INSTRUCTION
  );

  return cap(
    [
      "Research objective:",
      instruction,
      metadata.length ? `\nNon-identifying project context:\n${metadata.join("\n")}` : "",
      `\nSelected report passage:\n${cap(redact(input.selectedText), MAX_SELECTED_TEXT)}`,
      input.surroundingContext.trim()
        ? `\nNearby report context:\n${cap(redact(input.surroundingContext), MAX_CONTEXT_TEXT)}`
        : "",
      "\nBoundary: Research only general external knowledge. Do not infer or assert what the client built, tested, observed, achieved, or concluded.",
    ]
      .filter(Boolean)
      .join("\n"),
    30_000
  );
}

export type ProjectDocumentInput = {
  id: string;
  title: string;
  content: string;
};

export type ProjectEvidenceExcerpt = {
  documentId: string;
  title: string;
  excerpt: string;
  score: number;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "been",
  "before",
  "could",
  "from",
  "have",
  "into",
  "more",
  "other",
  "report",
  "research",
  "should",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "through",
  "using",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
]);

function queryTerms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9-]{2,}/g)
        ?.filter((term) => !STOP_WORDS.has(term)) ?? []
    )
  ).slice(0, 80);
}

/** Bounded full-text query for Convex's project-document search index. */
export function projectEvidenceSearchQuery(value: string): string {
  return queryTerms(value).slice(0, 20).join(" ").slice(0, 800);
}

function documentChunks(content: string): string[] {
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > 2_400) {
      if (current) chunks.push(current);
      current = "";
      for (let start = 0; start < paragraph.length; start += 2_000) {
        chunks.push(paragraph.slice(start, start + 2_400));
      }
    } else if (!current || current.length + paragraph.length + 2 <= 2_400) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Cheap, deterministic project-document retrieval; no extra model/search bill. */
export function selectProjectEvidence(
  documents: ProjectDocumentInput[],
  query: string,
  limit = 6
): ProjectEvidenceExcerpt[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const candidates: ProjectEvidenceExcerpt[] = [];
  for (const document of documents) {
    for (const chunk of documentChunks(document.content)) {
      const lower = chunk.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const matches = lower.split(term).length - 1;
        if (matches > 0) score += Math.min(matches, 4) * (term.length >= 8 ? 2 : 1);
      }
      if (score > 0) {
        candidates.push({
          documentId: document.id,
          title: document.title,
          excerpt: cap(chunk, 2_400),
          score,
        });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const perDocument = new Map<string, number>();
  const selected: ProjectEvidenceExcerpt[] = [];
  for (const candidate of candidates) {
    const count = perDocument.get(candidate.documentId) ?? 0;
    if (count >= 2) continue;
    selected.push(candidate);
    perDocument.set(candidate.documentId, count + 1);
    if (selected.length >= Math.max(1, Math.min(limit, 12))) break;
  }
  return selected;
}

export type ResearchCitation = {
  url: string;
  title: string;
  content?: string;
  startIndex?: number;
  endIndex?: number;
};

export type OpenRouterResearchResult = {
  responseId?: string;
  text: string;
  citations: ResearchCitation[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
    webSearchRequests: number;
  };
};

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function canonicalizeSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function parseCitation(annotation: unknown): ResearchCitation | null {
  if (typeof annotation === "string") {
    const url = canonicalizeSourceUrl(annotation);
    if (!url) return null;
    let title = "Source";
    try {
      title = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* canonicalizeSourceUrl already validated the URL */
    }
    return { url, title };
  }
  if (!annotation || typeof annotation !== "object") return null;
  const record = annotation as Record<string, unknown>;
  const nested =
    record.url_citation && typeof record.url_citation === "object"
      ? (record.url_citation as Record<string, unknown>)
      : record;
  if (record.type !== "url_citation" || typeof nested.url !== "string") return null;
  const url = canonicalizeSourceUrl(nested.url);
  if (!url) return null;
  let domain = "Source";
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* canonicalizeSourceUrl already validated the URL */
  }
  return {
    url,
    title:
      typeof nested.title === "string" && nested.title.trim()
        ? cap(nested.title, 300)
        : domain,
    ...(typeof nested.content === "string" && nested.content.trim()
      ? { content: cap(nested.content, MAX_SOURCE_EXCERPT) }
      : {}),
    ...(typeof nested.start_index === "number" ? { startIndex: nested.start_index } : {}),
    ...(typeof nested.end_index === "number" ? { endIndex: nested.end_index } : {}),
  };
}

/** Parse the stable Chat Completions shape used by OpenRouter server tools. */
export function parseOpenRouterResearchResponse(body: unknown): OpenRouterResearchResult {
  if (!body || typeof body !== "object") {
    throw new Error("OpenRouter returned an invalid response");
  }
  const record = body as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  const message =
    choice?.message && typeof choice.message === "object"
      ? (choice.message as Record<string, unknown>)
      : null;
  if (!message || typeof message.content !== "string" || !message.content.trim()) {
    const error =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>).message
        : null;
    throw new Error(typeof error === "string" ? error : "OpenRouter returned no research text");
  }
  const byUrl = new Map<string, ResearchCitation>();
  const citationCandidates = [
    ...(Array.isArray(message.annotations) ? message.annotations : []),
    ...(Array.isArray(message.citations) ? message.citations : []),
    ...(Array.isArray(record.citations) ? record.citations : []),
  ];
  for (const annotation of citationCandidates) {
    const citation = parseCitation(annotation);
    if (!citation) continue;
    const existing = byUrl.get(citation.url);
    if (!existing) {
      byUrl.set(citation.url, citation);
    } else {
      byUrl.set(citation.url, {
        ...existing,
        title: existing.title === "Source" ? citation.title : existing.title,
        content:
          (citation.content?.length ?? 0) > (existing.content?.length ?? 0)
            ? citation.content
            : existing.content,
      });
    }
  }
  const usage =
    record.usage && typeof record.usage === "object"
      ? (record.usage as Record<string, unknown>)
      : {};
  const serverToolUse =
    usage.server_tool_use && typeof usage.server_tool_use === "object"
      ? (usage.server_tool_use as Record<string, unknown>)
      : {};
  return {
    ...(typeof record.id === "string" ? { responseId: record.id } : {}),
    text: cap(message.content, 100_000),
    citations: Array.from(byUrl.values()).slice(0, 40),
    usage: {
      inputTokens: finiteCount(usage.prompt_tokens ?? usage.input_tokens),
      outputTokens: finiteCount(usage.completion_tokens ?? usage.output_tokens),
      ...(typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0
        ? { costUsd: usage.cost }
        : {}),
      webSearchRequests: finiteCount(serverToolUse.web_search_requests),
    },
  };
}

export const REVIEWER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    evidenceBoundary: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    warnings: { type: "array", items: { type: "string" } },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          evidenceKind: { type: "string", enum: ["external", "project", "mixed"] },
          support: {
            type: "string",
            enum: ["supported", "qualified", "conflicting", "unsupported"],
          },
          sourceKeys: { type: "array", items: { type: "string" } },
        },
        required: ["text", "evidenceKind", "support", "sourceKeys"],
      },
    },
    proposedText: { type: "string" },
    proposalRationale: { type: "string" },
  },
  required: [
    "answer",
    "evidenceBoundary",
    "confidence",
    "warnings",
    "claims",
    "proposedText",
    "proposalRationale",
  ],
} as const;

export type ReviewerResult = {
  answer: string;
  evidenceBoundary: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  claims: Array<{
    text: string;
    evidenceKind: "external" | "project" | "mixed";
    support: "supported" | "qualified" | "conflicting" | "unsupported";
    sourceKeys: string[];
  }>;
  proposedText: string;
  proposalRationale: string;
};

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseReviewerResult(text: string): ReviewerResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const raw = JSON.parse(cleaned) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Reviewer returned an invalid object");
  }
  const claims = (Array.isArray(raw.claims) ? raw.claims : [])
    .slice(0, 20)
    .flatMap((claim) => {
      if (!claim || typeof claim !== "object") return [];
      const c = claim as Record<string, unknown>;
      const claimText = typeof c.text === "string" ? cap(c.text, 2_000) : "";
      if (!claimText) return [];
      return [
        {
          text: claimText,
          evidenceKind: enumValue(c.evidenceKind, ["external", "project", "mixed"], "external"),
          support: enumValue(
            c.support,
            ["supported", "qualified", "conflicting", "unsupported"],
            "unsupported"
          ),
          sourceKeys: Array.from(
            new Set(
              (Array.isArray(c.sourceKeys) ? c.sourceKeys : [])
                .filter((key): key is string => typeof key === "string")
                .map((key) => key.trim())
                .filter(Boolean)
            )
          ).slice(0, 10),
        },
      ];
    });
  const answer = typeof raw.answer === "string" ? cap(raw.answer, 16_000) : "";
  if (!answer) throw new Error("Reviewer returned no answer");
  return {
    answer,
    evidenceBoundary:
      typeof raw.evidenceBoundary === "string"
        ? cap(raw.evidenceBoundary, 4_000)
        : "Project-specific evidence was not established.",
    confidence: enumValue(raw.confidence, ["high", "medium", "low"], "low"),
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : [])
      .filter((warning): warning is string => typeof warning === "string")
      .map((warning) => cap(warning, 1_000))
      .filter(Boolean)
      .slice(0, 10),
    claims,
    proposedText: typeof raw.proposedText === "string" ? cap(raw.proposedText, 12_000) : "",
    proposalRationale:
      typeof raw.proposalRationale === "string" ? cap(raw.proposalRationale, 2_000) : "",
  };
}

export type OpenRouterRequestInput = {
  provider: ResearchRunProvider;
  model: string;
  system: string;
  prompt: string;
};

/**
 * Current OpenRouter request contract. Native search is explicit so these
 * calls never intentionally select a paid third-party search engine.
 */
export function buildOpenRouterRequest(input: OpenRouterRequestInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.prompt },
    ],
    max_tokens: input.provider === "reviewer" ? 6_000 : 8_000,
    usage: { include: true },
  };
  if (input.provider === "gpt") {
    base.tools = [
      {
        type: "openrouter:web_search",
        parameters: { engine: "native", max_total_results: 15 },
      },
    ];
    base.max_tool_calls = 5;
  } else if (input.provider === "perplexity") {
    // Sonar Deep Research performs native multi-step retrieval itself. Its
    // OpenRouter endpoint does not advertise generic function/server tools.
    base.web_search_options = { search_context_size: "medium" };
  } else {
    base.response_format = {
      type: "json_schema",
      json_schema: {
        name: "contextual_research_review",
        strict: true,
        schema: REVIEWER_JSON_SCHEMA,
      },
    };
    base.provider = { require_parameters: true };
  }
  return base;
}
