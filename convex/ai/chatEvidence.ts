// Chat evidence assembly (CAP-4).
//
// Before this module, `streamChatReply` concatenated every piece of client
// evidence onto the system prompt: report prose, analyzer JSON, whole uploaded
// documents and prior edit decisions all arrived with system authority, behind
// ad-hoc headings a document could trivially forge, with no containment, no
// total bound and no record of what was cut.
//
// This module owns the whole request shape instead. The system string keeps
// only policy plus the writer's own style, which makes it byte-stable for a
// given writer across every turn of every thread; ALL evidence moves into one
// ephemeral user-role message whose blocks are delimited, neutralized and
// budgeted by the same primitives the analyzer uses (`./trustedContext`).
//
// This module deliberately runs in the default Convex runtime, with no Node
// directive and no Node built-ins, because `convex/chatV2.ts` (a query module)
// imports the budget shape while `convex/ai/chatAgentV2.ts` imports the
// builder.

import type { ModelMessage } from "ai";
import {
  ANALYZER_CATEGORY_LABELS,
  CHARS_PER_TOKEN,
  CONTEXT_SCAFFOLDS,
  ANALYZER_CATEGORY_ORDER,
  cutToBudget,
  documentTrust,
  effectiveCategory,
  isInternalUploaderRole,
  neutralizeMarkers,
  sanitizeFileName,
  tokensForChars,
  omittedMaterialsNotice,
  truncationNotice,
  type ContextDoc,
  type ContextDocCategory,
  type TrustLevel,
  type TrustedContextReportOf,
  type TrustedContextSource,
} from "./trustedContext";
import { CHAT_EVIDENCE_GUIDANCE, buildChatSystemPromptV2 } from "./prompts";
import { extractPlainText } from "../lib/reportEdits";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";
import {
  NO_STYLE_OVERRIDES,
  hasAnyStyleOverride,
  type StyleOverrides,
} from "../../shared/styleOverrides";

/**
 * One uploaded document as the chat sees it. `category` and `uploaderRole` are
 * stored facts carried through `getChatContextV2`; both are optional because
 * rows written before CAP-3 have neither, and both absences fail closed
 * (`other` category, client trust).
 */
export interface ChatEvidenceDoc {
  fileName: string;
  content: string;
  category?: ContextDocCategory;
  uploaderRole?: string;
}

export interface ChatEvidenceBudget {
  totalTokens: number;
  reportTokens: number;
  analysisTokens: number;
  decisionsTokens: number;
  perDocumentTokens: number;
  maxDocuments: number;
}

/**
 * Starting values, not measured. The per-document cap of 5 000 tokens is
 * 20 000 characters, exactly the literal slice this module replaces, so no
 * document is cut shorter than it already was. The document COUNT is new: chat
 * previously sent every non-archived document, and a project with more than
 * `maxDocuments` of them now loses the lowest-trust ones entirely, reported in
 * the cut log. 12 documents x 5k plus the report and analysis shares sum past
 * the total, so on a document-heavy project the TOTAL binds first.
 */
export const DEFAULT_CHAT_EVIDENCE_BUDGET: ChatEvidenceBudget = {
  totalTokens: 60_000,
  reportTokens: 40_000,
  analysisTokens: 15_000,
  decisionsTokens: 10_000,
  perDocumentTokens: 5_000,
  maxDocuments: 12,
};

/**
 * Marker labels. `PRIOR EDIT DECISIONS` is named verbatim by
 * `buildChatSystemPromptV2`'s iteration rules, so it is a contract, not a
 * caption.
 */
export const EVIDENCE_LABELS = {
  heading: "# EVIDENCE FOR THIS TURN",
  report: "CURRENT REPORT",
  analysis: "TRANSCRIPT ANALYSIS",
  decisions: "PRIOR EDIT DECISIONS",
  documentsHeading: "# ATTACHED CONTEXT DOCUMENTS",
} as const;

/** What the old inline builders emitted when a source was empty. Unchanged. */
export const EMPTY_REPORT_TEXT = "(no report content available)";
export const EMPTY_ANALYSIS_TEXT = "(no transcript analysis available)";

export type ChatEvidenceReport = TrustedContextReportOf<ChatEvidenceBudget>;

export interface ChatEvidenceDecision {
  state: "pending" | "applied" | "rejected" | "stale";
  target: string;
  candidate: string;
}

export interface ChatEvidenceInput {
  reportText: string;
  analysisText: string;
  documents?: ChatEvidenceDoc[];
  decisions?: ChatEvidenceDecision[];
  budget?: ChatEvidenceBudget;
}

/** The raw grounding row `chatV2.getChatContextV2` returns. */
export interface ChatTurnContext {
  reportContent: string | null;
  agentOutputs: string | null;
  documents: ChatEvidenceDoc[];
  decisions: ChatEvidenceDecision[];
  evidenceBudget?: ChatEvidenceBudget;
}

const D = CONTEXT_SCAFFOLDS.documentDelimiters;

/** A block with a label and no file name, delimited like the transcript is. */
function labelledBlock(label: string, body: string): string {
  const line = `${label}${CONTEXT_SCAFFOLDS.labelClose}${D.lineSuffix}`;
  return `${D.beginPrefix}${line}${D.contentPrefix}${body}${D.contentSuffix}${D.endPrefix}${line}`;
}

/** A document block: label plus the sanitized file name in the marker line. */
function documentBlock(doc: ChatEvidenceDoc, body: string): string {
  const label = ANALYZER_CATEGORY_LABELS[docCategory(doc)];
  const line = `${label}${D.categoryToFile}${sanitizeFileName(doc.fileName)}${D.lineSuffix}`;
  return `${D.beginPrefix}${line}${D.contentPrefix}${body}${D.contentSuffix}${D.endPrefix}${line}`;
}

/**
 * Legacy rows carry neither field. Both absences fail closed the same way the
 * analyzer's do: no category means `other`, and any role outside the internal
 * union (including absent) means client trust, so it is dropped rather than
 * widened.
 */
function toContextDoc(doc: ChatEvidenceDoc): ContextDoc {
  return {
    category: doc.category ?? "other",
    fileName: doc.fileName,
    content: doc.content,
    ...(isInternalUploaderRole(doc.uploaderRole)
      ? { uploaderRole: doc.uploaderRole }
      : {}),
  };
}

function docCategory(doc: ChatEvidenceDoc): ContextDocCategory {
  return effectiveCategory(toContextDoc(doc));
}

function docTrust(doc: ChatEvidenceDoc): TrustLevel {
  return documentTrust(doc.category ?? "other", doc.uploaderRole);
}

/**
 * The analyzer's `JSON.parse`-then-pretty-print of `agentOutputs.analyzer`,
 * byte-for-byte the behavior this module inherited. The truthiness check is
 * deliberate and load bearing: a falsy `analyzer` (absent, null, `false`, `0`,
 * an empty string) is no analysis, and must reach the model as the
 * placeholder rather than as a block containing the word `false`. A malformed
 * blob is no analysis either, never a failed turn.
 */
export function analysisTextFrom(agentOutputs: string | null): string {
  if (!agentOutputs) return EMPTY_ANALYSIS_TEXT;
  try {
    const parsed = JSON.parse(agentOutputs);
    if (parsed?.analyzer) return JSON.stringify(parsed.analyzer, null, 2);
  } catch {
    /* not JSON at all: the same "no analysis" outcome */
  }
  return EMPTY_ANALYSIS_TEXT;
}

/** One decision as the model reads it. Dash free, per house prose rules. */
function decisionText(decision: ChatEvidenceDecision, index: number): string {
  return `[Edit ${index + 1}: ${decision.state.toUpperCase()}]\nCanonical target from report: ${decision.target}\nCandidate replacement: ${decision.candidate}`;
}

export function decisionsTextFrom(decisions: ChatEvidenceDecision[]): string {
  return decisions.map(decisionText).join("\n\n");
}

/**
 * The writer's own style preferences. These stay in the SYSTEM string: they
 * are the writer's direction (the waiver footer points at them), not client
 * evidence, and they vary only per writer, so the system string stays
 * byte-stable across turns.
 */
export function writerPreferencesBlock(
  styleOverrides: StyleOverrides,
  customInstructions: string | null | undefined
): string {
  return hasAnyStyleOverride(styleOverrides) && customInstructions
    ? `\n\n# WRITER'S PERSONAL STYLE PREFERENCES (authoritative for the waived house-style areas named in your instructions)\n${customInstructions.slice(0, MAX_INSTRUCTIONS_CHARS)}`
    : "";
}

/**
 * The system string for a chat turn. Depends ONLY on the writer: their style
 * overrides and their personal preferences. Never on the report, thread,
 * documents or decisions, so two turns for the same writer produce identical
 * bytes.
 */
export function buildChatSystem(
  styleOverrides: StyleOverrides = NO_STYLE_OVERRIDES,
  customInstructions?: string | null
): string {
  return `${buildChatSystemPromptV2(styleOverrides)}${writerPreferencesBlock(
    styleOverrides,
    customInstructions
  )}`;
}

interface Spend {
  /**
   * Body to render, or null when there is nothing to render at all: an empty
   * source. A source that WAS supplied and lost everything to the budget
   * renders an omission notice instead of vanishing (see `omissionBody`).
   */
  body: string | null;
  source: TrustedContextSource;
}

/**
 * What a supplied-but-dropped source renders in place of its text. Rendering
 * nothing would present it to the model as never provided, which the guidance
 * explicitly tells it to treat as "do not fabricate" territory, and that is
 * the state that produces invented gaps. Same notice format the analyzer uses.
 */
function omissionBody(source: TrustedContextSource): string | null {
  return source.included || source.originalLength === 0
    ? null
    : truncationNotice(source.originalLength, source.originalLength);
}

/**
 * Charge one source against the remaining total. Neutralization happens BEFORE
 * the cut and before charging: a forged marker grows when its dashes are
 * spaced out, and the budget must bound the bytes actually sent, not the bytes
 * the client wrote.
 */
function spend(
  kind: TrustedContextSource["kind"],
  label: string,
  trust: TrustLevel,
  text: string,
  capChars: number,
  remaining: number,
  extra: Partial<TrustedContextSource> = {}
): Spend {
  const base: TrustedContextSource = {
    kind,
    label,
    trust,
    originalLength: text.length,
    includedLength: 0,
    included: false,
    truncated: false,
    ...extra,
  };
  // An empty source is nothing to contain and nothing to charge. Reachable in
  // production: a `projectDocuments` row whose extraction produced no text
  // (`reference_only`, `could_not_read`) has empty `content`.
  if (!text.length) return { body: null, source: base };
  const allowance = Math.min(capChars, remaining);
  if (allowance <= 0) return { body: null, source: base };
  const safe = neutralizeMarkers(text);
  const kept = cutToBudget(safe, allowance);
  // A one-code-unit allowance in front of a surrogate pair keeps nothing:
  // report that as omitted rather than rendering an empty block.
  if (!kept.length && safe.length > 0) return { body: null, source: base };
  const truncated = kept.length < safe.length;
  // The notice is scaffolding, not source text: only kept characters are charged.
  const body = truncated
    ? `${kept}\n${truncationNotice(safe.length - kept.length, safe.length)}`
    : kept;
  return {
    body,
    source: { ...base, includedLength: kept.length, included: true, truncated },
  };
}

/**
 * Build the single user-role evidence message plus a report of what the budget
 * kept, cut and dropped.
 *
 * Spend order is fixed: report, analysis, prior decisions, then documents in
 * `effectiveCategory` trust order then insertion order. The report goes first
 * because `proposeEdit` requires a verbatim substring of it, so a truncated
 * report silently breaks every edit proposal. Render order puts the documents
 * before the decisions so the decisions sit closest to the writer's turn.
 *
 * Every input source appears exactly once in `report.sources`.
 */
export function buildChatEvidence(input: ChatEvidenceInput): {
  message: string;
  report: ChatEvidenceReport;
} {
  const budget = input.budget ?? DEFAULT_CHAT_EVIDENCE_BUDGET;
  const documents = input.documents ?? [];
  const decisions = input.decisions ?? [];
  const sources: TrustedContextSource[] = [];
  const chars = (tokens: number) => Math.max(0, tokens) * CHARS_PER_TOKEN;

  const totalChars = chars(budget.totalTokens);
  let remaining = totalChars;

  const charge = (s: Spend): Spend => {
    sources.push(s.source);
    remaining -= s.source.includedLength;
    return s;
  };
  /** A single-source block: its text, or the notice that it was dropped. */
  const soloBody = (s: Spend): string | null => s.body ?? omissionBody(s.source);

  // ── Report ────────────────────────────────────────────────────────────────
  const reportBody = soloBody(
    charge(
      spend(
        "report",
        EVIDENCE_LABELS.report,
        "internal",
        input.reportText,
        Math.min(chars(budget.reportTokens), totalChars),
        remaining
      )
    )
  );

  // ── Analysis ──────────────────────────────────────────────────────────────
  const analysisBody = soloBody(
    charge(
      spend(
        "analysis",
        EVIDENCE_LABELS.analysis,
        "client",
        input.analysisText,
        Math.min(chars(budget.analysisTokens), totalChars),
        remaining
      )
    )
  );

  // ── Prior decisions (spent before documents, rendered after) ──────────────
  let decisionsBody: string | null = null;
  if (decisions.length) {
    decisionsBody = soloBody(
      charge(
        spend(
          "decisions",
          EVIDENCE_LABELS.decisions,
          "internal",
          decisionsTextFrom(decisions),
          Math.min(chars(budget.decisionsTokens), totalChars),
          remaining
        )
      )
    );
  }

  // ── Documents, in trust order then insertion order ────────────────────────
  const ordered = documents
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => {
      const trust =
        ANALYZER_CATEGORY_ORDER.indexOf(docCategory(a.doc)) -
        ANALYZER_CATEGORY_ORDER.indexOf(docCategory(b.doc));
      return trust !== 0 ? trust : a.index - b.index;
    });
  const perDocChars = chars(budget.perDocumentTokens);
  const documentBlocks: string[] = [];
  ordered.forEach(({ doc }, rank) => {
    const extra = { category: docCategory(doc) };
    if (rank >= budget.maxDocuments) {
      sources.push({
        kind: "document",
        label: doc.fileName,
        trust: docTrust(doc),
        originalLength: doc.content.length,
        includedLength: 0,
        included: false,
        truncated: false,
        ...extra,
      });
      return;
    }
    // Documents get no per-document omission notice: with a dozen of them
    // that would be a wall of notices. They are covered collectively below,
    // exactly as the analyzer covers its own attached materials.
    const { body } = charge(
      spend(
        "document",
        doc.fileName,
        docTrust(doc),
        doc.content,
        perDocChars,
        remaining,
        extra
      )
    );
    if (body !== null) documentBlocks.push(documentBlock(doc, body));
  });

  // Documents that carried text and lost all of it to the budget. Empty rows
  // are not counted: nothing was omitted to fit anything.
  const droppedDocuments = sources.filter(
    (source) => source.kind === "document" && !source.included && source.originalLength > 0
  ).length;

  /**
   * Some documents rendered and others did not. The guidance says an absent
   * block was never provided, so without this line the model would tell the
   * writer that a document they can see in the project does not exist. One
   * line, not one notice per document: a dozen dropped rows would otherwise
   * be a wall of notices. Chat-only: the analyzer's bytes are frozen.
   */
  const furtherOmittedNotice = (count: number): string =>
    `[${count} further attached document(s) were omitted to fit the context budget.]`;

  // ── Assembly ──────────────────────────────────────────────────────────────
  // The guidance is emitted on EVERY turn, even with nothing else included:
  // it is what makes the markers mean anything at all.
  const parts: string[] = [`${EVIDENCE_LABELS.heading}\n${CHAT_EVIDENCE_GUIDANCE}`];
  if (reportBody !== null) parts.push(labelledBlock(EVIDENCE_LABELS.report, reportBody));
  if (analysisBody !== null) {
    parts.push(labelledBlock(EVIDENCE_LABELS.analysis, analysisBody));
  }
  if (documentBlocks.length) {
    const rendered = documentBlocks.join("\n\n");
    parts.push(
      `${EVIDENCE_LABELS.documentsHeading}\n${rendered}${
        droppedDocuments ? `\n\n${furtherOmittedNotice(droppedDocuments)}` : ""
      }`
    );
  } else if (droppedDocuments) {
    // Documents WERE supplied and the budget kept none of them: keep the
    // heading with a notice rather than implying the project has no documents.
    parts.push(
      `${EVIDENCE_LABELS.documentsHeading}\n${omittedMaterialsNotice(droppedDocuments)}`
    );
  }
  if (decisionsBody !== null) {
    parts.push(labelledBlock(EVIDENCE_LABELS.decisions, decisionsBody));
  }

  const includedChars = sources.reduce((n, s) => n + s.includedLength, 0);
  return {
    message: parts.join("\n\n"),
    report: {
      budget,
      includedTokens: tokensForChars(includedChars),
      sources,
    },
  };
}

export interface ChatTurnRequest {
  system: string;
  messages: ModelMessage[];
  report: ChatEvidenceReport;
}

/**
 * The whole shape of one chat request: a writer-only system string and one
 * ephemeral user-role evidence message. The message is passed as `messages`,
 * never saved: with `promptMessageId` set the agent library saves no input
 * messages, so nothing new lands in thread history or in the UI.
 */
export function buildChatTurnRequest(args: {
  context: ChatTurnContext;
  styleOverrides?: StyleOverrides;
  customInstructions?: string | null;
  budget?: ChatEvidenceBudget;
}): ChatTurnRequest {
  const styleOverrides = args.styleOverrides ?? NO_STYLE_OVERRIDES;
  // A report whose ProseMirror doc extracts to nothing is "no report content",
  // not an empty block. Non-blank text is never trimmed: every proposeEdit
  // target must be a verbatim substring of exactly these bytes.
  const extracted = args.context.reportContent
    ? extractPlainText(args.context.reportContent)
    : "";
  const budget = args.budget ?? args.context.evidenceBudget;
  const { message, report } = buildChatEvidence({
    reportText: extracted.trim() ? extracted : EMPTY_REPORT_TEXT,
    analysisText: analysisTextFrom(args.context.agentOutputs),
    documents: args.context.documents,
    decisions: args.context.decisions,
    ...(budget ? { budget } : {}),
  });
  return {
    system: buildChatSystem(styleOverrides, args.customInstructions),
    messages: [{ role: "user", content: message }],
    report,
  };
}
