/**
 * Normalizes one assistant turn into an ordered list of render nodes.
 *
 * The AI SDK hands us a `UIMessage.parts` array that mixes text, reasoning,
 * tool calls, and step markers. Every Svelte renderer used to re-derive that
 * structure itself (and the old panel simply threw everything but text away —
 * see the `messageText` it replaces). Doing it once, here, in plain TypeScript
 * keeps tool naming, status mapping, proposal ownership, and step counting
 * testable without mounting a component.
 *
 * IMPORTANT: everything here is read-only over `message.parts`. The parts flow
 * into the AI SDK's `structuredClone`-based stream assembly, and deep Svelte
 * proxies are not cloneable — see the `$state.raw` notes in
 * `uiMessages.svelte.ts`. Never mutate, wrap, or proxy the values we read.
 */
import type { UIMessage } from "@convex-dev/agent";
import type { Doc } from "../../../convex/_generated/dataModel";
import { proposalReferences } from "../../../shared/chatProposals";
import type { TurnPhaseFields, TurnProgress } from "./turnContracts";

export type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export type AccessibleStatus = "Starting" | "Running" | "Done" | "Didn’t finish";

/** Shape-tagged tool payloads so renderers never re-inspect raw tool JSON. */
export type ToolDetail =
  | { kind: "fields"; fields: { label: string; value: string }[] }
  | { kind: "text"; text: string };

export type TextRenderNode = {
  kind: "text";
  key: string;
  text: string;
  state: "streaming" | "done";
};

export type ReasoningRenderNode = {
  kind: "reasoning";
  key: string;
  text: string;
  state: "streaming" | "done";
};

export type BrainSourceLabel = { title?: string; scienceCode?: string };

export type ToolRenderNode = {
  kind: "tool";
  key: string;
  toolName: string;
  toolCallId: string;
  state: ToolPartState;
  label: string;
  accessibleStatus: AccessibleStatus;
  /** Absent when the payload is internals or is already shown as an artifact. */
  input?: ToolDetail;
  output?: ToolDetail;
  sources?: BrainSourceLabel[];
};

export type ProposalRenderNode = {
  kind: "proposal";
  key: string;
  proposal: Doc<"chatProposals">;
  toolCallId?: string;
  association: "toolCallId" | "legacy";
};

export type TurnRenderNode =
  | TextRenderNode
  | ReasoningRenderNode
  | ToolRenderNode
  | ProposalRenderNode;

export type TraceRenderNode = ReasoningRenderNode | ToolRenderNode;

export type TurnStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export type TurnTiming = {
  status: TurnStatus;
  startedAt?: number;
  endedAt?: number;
  stepCount: number;
} & TurnPhaseFields;

export type NormalizedTurn = {
  nodes: TurnRenderNode[];
  text: string;
  traceNodes: TraceRenderNode[];
  proposalNodes: ProposalRenderNode[];
  toolCount: number;
  hasReasoning: boolean;
};

// ─── Tool copy ───────────────────────────────────────────────────────────────
// Present-progressive while the step runs, past tense once it lands — the
// convention every mainstream assistant UI uses, so the transcript reads as a
// history rather than a stuck progress list.

type ToolCopy = { running: string; done: string; error: string };

// "Suggestion" is the writer-facing noun everywhere in the product (see
// ProposedEditCard) — "propose" is engineer vocabulary. The trace matches the
// card the writer actually acts on.
const TOOL_COPY: Record<string, ToolCopy> = {
  proposeEdit: {
    running: "Writing a suggestion…",
    done: "Suggested an edit",
    error: "Couldn’t write that suggestion",
  },
  proposeReplacements: {
    running: "Writing suggestions…",
    done: "Suggested replacements",
    error: "Couldn’t write those suggestions",
  },
  highlightPassages: {
    running: "Looking through the report…",
    done: "Found passages",
    error: "Couldn’t find those passages",
  },
  proposeBulkEdits: {
    running: "Writing a coordinated suggestion…",
    done: "Suggested a coordinated revision",
    error: "Couldn’t write that suggestion",
  },
  // Read-only steps. The writer asked what the draft departs from, so the copy
  // says what was read, never that anything was changed.
  deviationInventory: {
    running: "Checking every paragraph…",
    done: "Listed the deviations",
    error: "Couldn’t list the deviations",
  },
  compareReferencePd: {
    running: "Comparing with the reference PD…",
    done: "Compared with the reference PD",
    error: "Couldn’t compare with the reference PD",
  },
  searchBrain: {
    running: "Searching The Brain…",
    done: "Searched The Brain",
    // The failure mode is reachability, not a bad search.
    error: "Couldn’t reach The Brain",
  },
  // 2026-10-19: web search, when the writer turned it on for the message.
  searchWeb: {
    running: "Searching the web…",
    done: "Searched the web",
    error: "Couldn’t reach web search",
  },
  // Chat parity Phase B (2026-10-20): the reading tools. The trace names the
  // kind of step only, never the file or what it said.
  readDocument: {
    running: "Reading a project file…",
    done: "Read a project file",
    error: "Couldn’t read that file",
  },
  searchDocuments: {
    running: "Searching project files…",
    done: "Searched project files",
    error: "Couldn’t search the project files",
  },
  readTranscript: {
    running: "Reading a transcript…",
    done: "Read a transcript",
    error: "Couldn’t read that transcript",
  },
  // Phase C (2026-10-20): viewFile looks at a PDF's pages or an image.
  viewFile: {
    running: "Looking at a project file…",
    done: "Looked at a project file",
    error: "Couldn’t show that file",
  },
};

// A tool we have no copy for is described generically. Pasting a camelCase
// function name into the transcript exposes internals and never reads well.
const GENERIC_TOOL_COPY: ToolCopy = {
  running: "Working…",
  done: "Finished a step",
  error: "A step didn’t finish",
};

function toolCopy(toolName: string): ToolCopy {
  return TOOL_COPY[toolName] ?? GENERIC_TOOL_COPY;
}

/**
 * The completed label carries the one detail worth reading at a glance: what
 * was searched for, or how much was found. It's what tells a writer the
 * assistant understood them, without opening anything.
 */
function detailedDoneLabel(toolName: string, input: unknown, fallback: string): string {
  const record = asRecord(input);
  if (!record) return fallback;
  if (toolName === "searchBrain") {
    const query = asString(record.query);
    return query ? `Searched The Brain for “${query}”` : fallback;
  }
  if (toolName === "highlightPassages" && Array.isArray(record.references)) {
    const count = record.references.length;
    if (count) return `Found ${count} ${count === 1 ? "passage" : "passages"}`;
  }
  if (toolName === "proposeReplacements" && Array.isArray(record.replacements)) {
    const count = record.replacements.length;
    if (count) {
      return `Suggested ${count} ${count === 1 ? "replacement" : "replacements"}`;
    }
  }
  // The number the writer is actually tracking on a coordinated revision is the
  // item count of their own list, not the edit count.
  if (toolName === "proposeBulkEdits" && Array.isArray(record.findings)) {
    const count = record.findings.length;
    // DW-135: a zero-edit call recorded findings and suggested nothing; the
    // label must match the "Nothing to apply" card below it.
    if (count && Array.isArray(record.edits) && record.edits.length === 0) {
      return `Recorded ${count} ${count === 1 ? "finding" : "findings"}, nothing to apply`;
    }
    if (count) {
      return `Suggested one revision covering ${count} ${count === 1 ? "item" : "items"}`;
    }
  }
  if (toolName === "compareReferencePd") {
    const fileName = asString(record.fileName);
    return fileName ? `Compared with “${fileName}”` : fallback;
  }
  return fallback;
}

export function toolLabel(
  toolName: string,
  state: ToolPartState,
  input?: unknown
): string {
  const copy = toolCopy(toolName);
  if (state === "output-error") return copy.error;
  if (state === "output-available") {
    return detailedDoneLabel(toolName, input, copy.done);
  }
  return copy.running;
}

function accessibleStatus(state: ToolPartState): AccessibleStatus {
  switch (state) {
    case "input-streaming":
      return "Starting";
    case "input-available":
      return "Running";
    case "output-available":
      return "Done";
    case "output-error":
      return "Didn’t finish";
  }
}

/** Later states win when a tool part is superseded mid-stream. */
const STATE_RANK: Record<ToolPartState, number> = {
  "input-streaming": 0,
  "input-available": 1,
  "output-available": 2,
  "output-error": 2,
};

function normalizeToolState(raw: unknown): ToolPartState {
  switch (raw) {
    case "input-streaming":
    case "input-available":
    case "output-available":
    case "output-error":
      return raw;
    // Approval flows are out of scope; degrade to a failed step rather than
    // rendering an unknown state as if the tool had succeeded.
    default:
      return raw === undefined || raw === null ? "input-streaming" : "output-error";
  }
}

// ─── Tool payload formatting ─────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Tools whose result already renders as a first-class artifact below the
 * trace: the proposal card shows the same wording as an actionable diff, and
 * highlights become "Jump to" chips. Repeating those payloads in a scrolling
 * well would push the real control below the fold in the narrow rail, so
 * these steps stay a single labelled line.
 */
const ARTIFACT_TOOLS = new Set([
  "proposeEdit",
  "proposeReplacements",
  // Its whole payload becomes one proposal card below the trace, exactly like
  // the other two edit tools.
  "proposeBulkEdits",
  "highlightPassages",
]);
// `deviationInventory` and `compareReferencePd` are deliberately NOT artifact
// tools: they produce no card. Their results are written for the model (they
// carry retry instructions and DATA framing), so they are summarized by their
// label alone and never echoed; see `toolOutputDetail`.

function toolInputDetail(toolName: string, input: unknown): ToolDetail | undefined {
  if (ARTIFACT_TOOLS.has(toolName)) return undefined;

  const record = asRecord(input);
  if (!record) return undefined;

  if (toolName === "searchBrain") {
    const query = asString(record.query);
    return query
      ? { kind: "fields", fields: [{ label: "Looked for", value: query }] }
      : undefined;
  }

  // An unknown tool's raw arguments are internals; the label already says a
  // step ran. Never dump JSON at a report writer.
  return undefined;
}

/**
 * Tool errors are rendered as a fixed, user-safe line. Raw provider/Convex
 * exception text can carry request ids and internals, and the writer can act
 * on none of it.
 */
// A failed step is not the writer's problem to retry — the assistant usually
// recovers on a later step — so this states what happened, not an instruction.
const SAFE_TOOL_ERROR = "This step didn’t finish. The assistant carried on.";

/** Only the formatter's bounded first-line envelope can supply source labels. */
function brainSourceEnvelope(output: unknown): BrainSourceLabel[] | undefined {
  const prefix = "BRAIN_SOURCES_V1:";
  if (typeof output !== "string" || !output.startsWith(prefix)) return undefined;
  const end = output.indexOf("\n");
  if (end < prefix.length || end > 50000) return undefined;
  try {
    const data: unknown = JSON.parse(output.slice(prefix.length, end));
    if (!Array.isArray(data) || data.length > 20) return undefined;
    const sources: BrainSourceLabel[] = [];
    for (const row of data) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) return undefined;
      if (Object.keys(row).some(key => key !== "title" && key !== "scienceCode")) return undefined;
      const title: unknown = "title" in row ? row.title : undefined;
      const scienceCode: unknown = "scienceCode" in row ? row.scienceCode : undefined;
      if (title !== undefined && (typeof title !== "string" || !title.trim() || Array.from(title).length > 240)) return undefined;
      if (scienceCode !== undefined && (typeof scienceCode !== "string" || !scienceCode.trim() || Array.from(scienceCode).length > 160)) return undefined;
      sources.push({
        ...(typeof title === "string" ? { title } : {}),
        ...(typeof scienceCode === "string" ? { scienceCode } : {}),
      });
    }
    return sources;
  } catch { return undefined; }
}

export function brainSourceLabels(output: unknown): BrainSourceLabel[] {
  const seen = new Set<string>();
  return (brainSourceEnvelope(output) ?? []).filter(source => {
    if (!source.title && !source.scienceCode) return false;
    const key = JSON.stringify(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every tool result in this agent is written FOR THE MODEL, not the writer:
 * they address it in the second person, name UI controls that don't exist,
 * carry retry instructions, and The Brain's result is a whole prompt block of
 * "NEVER copy their facts" directives wrapped around the exemplars. None of it
 * is safe to show verbatim, so results are summarized, never echoed.
 */
function toolOutputDetail(
  toolName: string,
  state: ToolPartState,
  output: unknown
): ToolDetail | undefined {
  if (state === "output-error") return { kind: "text", text: SAFE_TOOL_ERROR };
  if (state !== "output-available") return undefined;

  if (toolName !== "searchBrain") return undefined;
  if (typeof output !== "string" || !output.length) return undefined;

  if (output.startsWith("The Brain has no approved knowledge matching that")) {
    return { kind: "text", text: output.startsWith("The Brain has no approved knowledge matching that in the ")
      ? "The Brain has no approved knowledge matching that in this project’s industry yet."
      : "The Brain has no approved knowledge matching that yet." };
  }

  const envelope = brainSourceEnvelope(output);
  const patterns = envelope?.length ?? (output.startsWith("BRAIN_SOURCES_V1:")
    ? 0 : (output.match(/--- REFERENCE PATTERN /g) ?? []).length);
  if (patterns) {
    return {
      kind: "text",
      text: `Found ${patterns} writing ${patterns === 1 ? "pattern" : "patterns"} from past approved reports, used as a guide to structure and phrasing only.`,
    };
  }
  // The outage notice instructs the model to relay it ("Tell the writer…").
  // That wording earns its keep in the prompt — it stops the model claiming
  // The Brain is empty during an outage — so it's restated here instead.
  if (output.includes("technical error")) {
    return {
      kind: "text",
      text: "The Brain couldn’t be reached just now. This is a temporary problem, not an empty library — try again shortly.",
    };
  }
  return { kind: "text", text: "The Brain search finished without source details." };
}

// ─── Part normalization ──────────────────────────────────────────────────────

type LoosePart = {
  type?: unknown;
  text?: unknown;
  state?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
};

function textState(raw: unknown): "streaming" | "done" {
  return raw === "streaming" ? "streaming" : "done";
}

function normalizeParts(message: UIMessage | undefined): {
  nodes: (TextRenderNode | ReasoningRenderNode | ToolRenderNode)[];
  toolIndexById: Map<string, number>;
} {
  const nodes: (TextRenderNode | ReasoningRenderNode | ToolRenderNode)[] = [];
  const toolIndexById = new Map<string, number>();
  const parts = (message?.parts ?? []) as LoosePart[];

  for (const part of parts) {
    const type = typeof part?.type === "string" ? part.type : "";

    // `step-start` is deliberately ignored: the agent component reconstructs it
    // inconsistently on reload (only before stored tool calls), so it is not a
    // trustworthy step marker. Unique toolCallIds are the step count instead.
    if (!type || type === "step-start") continue;

    if (type === "text") {
      const text = typeof part.text === "string" ? part.text : "";
      const state = textState(part.state);
      const last = nodes.at(-1);
      if (last?.kind === "text") {
        // Coalesce so a provider that chunks into many text parts still
        // renders as one markdown block.
        last.text += text;
        last.state = state;
        continue;
      }
      nodes.push({ kind: "text", key: `text-${nodes.length}`, text, state });
      continue;
    }

    if (type === "reasoning") {
      const text = typeof part.text === "string" ? part.text : "";
      const state = textState(part.state);
      const last = nodes.at(-1);
      if (last?.kind === "reasoning") {
        last.text += text;
        last.state = state;
        continue;
      }
      nodes.push({ kind: "reasoning", key: `reasoning-${nodes.length}`, text, state });
      continue;
    }

    const isStaticTool = type.startsWith("tool-");
    const isDynamicTool = type === "dynamic-tool";
    if (!isStaticTool && !isDynamicTool) continue;

    const toolName = isDynamicTool
      ? (asString(part.toolName) ?? "tool")
      : type.slice("tool-".length);
    const toolCallId = asString(part.toolCallId) ?? `${toolName}-${nodes.length}`;
    const state = normalizeToolState(part.state);
    const outputSource = state === "output-error" ? part.errorText : part.output;
    const output = toolOutputDetail(toolName, state, outputSource);
    const input = toolInputDetail(toolName, part.input);

    const node: ToolRenderNode = {
      kind: "tool",
      key: `tool-${toolCallId}`,
      toolName,
      toolCallId,
      state,
      label: toolLabel(toolName, state, part.input),
      accessibleStatus: accessibleStatus(state),
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(toolName === "searchBrain" && state === "output-available"
        ? { sources: brainSourceLabels(outputSource) } : {}),
    };

    const existingIndex = toolIndexById.get(toolCallId);
    if (existingIndex === undefined) {
      toolIndexById.set(toolCallId, nodes.length);
      nodes.push(node);
      continue;
    }
    // A repeated toolCallId is the same call advancing state. Keep its original
    // position in the timeline and take the more advanced snapshot.
    const existing = nodes[existingIndex];
    if (existing?.kind === "tool" && STATE_RANK[state] >= STATE_RANK[existing.state]) {
      nodes[existingIndex] = node;
    }
  }

  return { nodes, toolIndexById };
}

// ─── Proposal correlation ────────────────────────────────────────────────────

/** A proposal's targets with whitespace collapsed; blank targets dropped. */
function passageKeys(proposal: Doc<"chatProposals">): string[] {
  return proposalReferences(proposal)
    .map((target) => target.replace(/\s+/g, " ").trim())
    .filter((target) => target.length > 0);
}

/**
 * Whether each target names exactly one passage: a proposeEdit target or a
 * coordinated revision's targets. A proposeReplacements find replaces every
 * occurrence, so it names a term, not a passage.
 */
function hasUniqueTargets(proposal: Doc<"chatProposals">): boolean {
  return proposal.kind === "edit" || proposal.requireUniqueTargets === true;
}

/**
 * Two targets name one passage when they are equal, or, when both name exactly
 * one passage, when either contains the other (a widened or narrowed
 * refinement). A short find-all term such as "utilize" never stands for the
 * longer passage that merely contains it.
 */
function samePassage(
  left: string,
  leftUnique: boolean,
  right: string,
  rightUnique: boolean
): boolean {
  if (left === right) return true;
  return leftUnique && rightUnique && (left.includes(right) || right.includes(left));
}

/**
 * Pending cards a later pending card from the same prompt supersedes: only
 * the latest actionable wording for a passage belongs in the transcript. A
 * card with one target is superseded by any later card for that passage. A
 * card with several targets (a coordinated revision) is superseded only when
 * the later cards together cover every one of its targets; otherwise it stays,
 * so a later refinement of one passage never hides the others, their Apply
 * button or the findings recorded with them (2026-10-01, first, PR #24 P1).
 */
function supersededProposals(proposals: readonly Doc<"chatProposals">[]): Set<number> {
  const superseded = new Set<number>();
  proposals.forEach((proposal, index) => {
    if (proposal.state !== "pending" || !proposal.promptMessageId) return;
    const targets = passageKeys(proposal);
    if (targets.length === 0) return;
    const unique = hasUniqueTargets(proposal);
    const later = proposals
      .slice(index + 1)
      .filter(
        (other) =>
          other.state === "pending" && other.promptMessageId === proposal.promptMessageId
      )
      .map((other) => ({ keys: passageKeys(other), unique: hasUniqueTargets(other) }));
    const covered = targets.filter((own) =>
      later.some((other) => other.keys.some((key) => samePassage(own, unique, key, other.unique)))
    );
    if (covered.length === targets.length) superseded.add(index);
  });
  return superseded;
}

/**
 * Map chatProposals rows onto the assistant message that produced them.
 *
 * Exact `toolCallId` is authoritative. The remaining fallbacks exist for rows
 * written before tool-call association was recorded and are ordered
 * most-precise-first: shared prompt order, legacy messageId, then the nearest
 * earlier assistant message by creation time.
 */
export function correlateProposals(
  messages: readonly UIMessage[],
  proposals: readonly Doc<"chatProposals">[]
): {
  byMessageId: Map<string, Doc<"chatProposals">[]>;
  orphans: Doc<"chatProposals">[];
} {
  const byMessageId = new Map<string, Doc<"chatProposals">[]>();
  const orphans: Doc<"chatProposals">[] = [];

  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const toolOwners = new Map<string, UIMessage>();
  for (const message of assistantMessages) {
    for (const part of (message.parts ?? []) as LoosePart[]) {
      const toolCallId = asString(part?.toolCallId);
      if (toolCallId) toolOwners.set(toolCallId, message);
    }
  }
  const messageById = new Map(messages.map((message) => [message.id, message]));

  // A later pending card for the same passage supersedes an earlier one; see
  // supersededProposals for how a split revision keeps its cards.
  const superseded = supersededProposals(proposals);

  for (const [index, proposal] of proposals.entries()) {
    if (superseded.has(index)) continue;

    let owner = proposal.toolCallId ? toolOwners.get(proposal.toolCallId) : undefined;
    if (!owner && proposal.promptMessageId) {
      const prompt = messageById.get(proposal.promptMessageId);
      if (prompt) {
        owner = assistantMessages.find((message) => message.order === prompt.order);
      }
    }
    if (!owner && proposal.messageId) owner = messageById.get(proposal.messageId);
    if (!owner) {
      owner = [...assistantMessages]
        .reverse()
        .find((message) => message._creationTime <= proposal.createdAt);
    }
    if (!owner) {
      orphans.push(proposal);
      continue;
    }
    const list = byMessageId.get(owner.id) ?? [];
    list.push(proposal);
    byMessageId.set(owner.id, list);
  }

  return { byMessageId, orphans };
}

// ─── Turn assembly ───────────────────────────────────────────────────────────

export function normalizeTurnParts(
  message: UIMessage | undefined,
  proposals: readonly Doc<"chatProposals">[] = []
): NormalizedTurn {
  const { nodes: partNodes, toolIndexById } = normalizeParts(message);

  const allProposalNodes: ProposalRenderNode[] = [];
  const spliced = new Map<number, ProposalRenderNode[]>();
  for (const proposal of proposals) {
    const index = proposal.toolCallId ? toolIndexById.get(proposal.toolCallId) : undefined;
    const node: ProposalRenderNode = {
      kind: "proposal",
      key: `proposal-${proposal._id}`,
      proposal,
      ...(proposal.toolCallId ? { toolCallId: proposal.toolCallId } : {}),
      association: index === undefined ? "legacy" : "toolCallId",
    };
    allProposalNodes.push(node);
    if (index === undefined) continue;
    const bucket = spliced.get(index) ?? [];
    bucket.push(node);
    spliced.set(index, bucket);
  }

  const nodes: TurnRenderNode[] = [];
  partNodes.forEach((node, index) => {
    nodes.push(node);
    const attached = spliced.get(index);
    if (attached) nodes.push(...attached);
  });
  for (const node of allProposalNodes) {
    if (node.association === "legacy") nodes.push(node);
  }

  // Taken from the assembled timeline, so cards follow their owning tool call
  // rather than the order the proposal rows happened to arrive in.
  const proposalNodes = nodes.filter(
    (node): node is ProposalRenderNode => node.kind === "proposal"
  );

  const traceNodes = partNodes.filter(
    (node): node is TraceRenderNode =>
      node.kind === "tool" ||
      // Redacted thinking arrives as a reasoning part with no text. Rendering
      // it would offer an empty "Reasoning" disclosure onto nothing.
      (node.kind === "reasoning" && node.text.trim().length > 0)
  );

  return {
    nodes,
    text: partNodes
      .filter((node): node is TextRenderNode => node.kind === "text")
      .map((node) => node.text)
      .join(""),
    traceNodes,
    proposalNodes,
    toolCount: toolIndexById.size,
    hasReasoning: traceNodes.some((node) => node.kind === "reasoning"),
  };
}

// ─── Summary line ────────────────────────────────────────────────────────────

/** "4s", "1m 28s": how long a finished turn took. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Terminal turns report the durable count; a live turn may be ahead of it. */
function resolveStepCount(turn: NormalizedTurn, timing: TurnTiming | undefined, live: boolean) {
  if (!timing) return turn.toolCount;
  return live ? Math.max(timing.stepCount, turn.toolCount) : timing.stepCount || turn.toolCount;
}

/**
 * The first line of a turn's thought block, as Claude shows it (owner,
 * 2026-10-21): the live label while it runs, with no timer, then how long it
 * took ("Thought for 4s", "Worked for 1m 28s"). Returns null when there is
 * nothing worth showing: a plain answer with no tools and no reasoning gets
 * no thought block at all.
 */
export function formatTurnSummary(
  turn: NormalizedTurn,
  timing: TurnTiming | undefined,
  messageStatus: UIMessage["status"] | undefined
): string | null {
  const status = timing?.status;
  const live =
    status === "queued" ||
    status === "running" ||
    (status === undefined &&
      (messageStatus === "streaming" || messageStatus === "pending"));

  if (status === "queued") return "Starting…";

  const steps = resolveStepCount(turn, timing, live);
  const hasTrace = turn.traceNodes.length > 0 || steps > 0;

  // Phase A: the server writes the turn's phase (`chatTurns.progress`) from
  // turn state and fixed tool fields, never model text. TurnTrace holds each
  // label for at least LABEL_HOLD_MS so a fast phase change never flickers.
  if (live) return progressLabel(timing?.progress);

  const duration =
    timing?.startedAt !== undefined && timing?.endedAt !== undefined
      ? formatDuration(Math.max(1000, timing.endedAt - timing.startedAt))
      : null;

  if (status === "aborted") return duration ? `Stopped after ${duration}` : "Stopped";
  if (status === "failed" || messageStatus === "failed") {
    // The answer already carries the apology; the header stays factual so the
    // failure isn't announced twice.
    return duration ? `Stopped after ${duration}` : "Didn’t start";
  }
  if (!hasTrace) return null;

  // The steps are folded, so one that did not finish is named here too.
  const failed = turn.traceNodes.filter((node) => node.kind === "tool" && node.state === "output-error").length;
  const failedNote = failed ? ` · ${failed} ${failed === 1 ? "step" : "steps"} didn’t finish` : "";
  // Reasoning with no tool work reads as thought, not work.
  if (steps === 0 && turn.hasReasoning) return duration ? `Thought for ${duration}` : "Thought";
  return `${duration ? `Worked for ${duration}` : "Worked"}${failedNote}`;
}

/**
 * Owner, 2026-10-21: item ids (`r-244-4-2`) are internal and never shown. A
 * reply written before the prompt said so, or the model's own reasoning, may
 * still carry one; it shows as the place it names ("Line 244, paragraph 4";
 * paragraph 0 is unanchored, so the Line alone).
 */
export function humanizeItemIds(text: string): string {
  return text
    .replace(/\b[rcx]-(242|244|246)-(\d+)-\d+\b/g, (_match, section: string, paragraph: string) =>
      Number(paragraph) > 0 ? `Line ${section}, paragraph ${Number(paragraph)}` : `Line ${section}`
    )
    // Owner, 2026-10-21: the bare token "[GAP]" (no colon, no text) is the
    // model talking about gap notes, never a placeholder ("[GAP: ...]"),
    // which keeps its brackets; it reads as "gap" ("the gap note").
    .replace(/\[GAP\](?!:)/g, "gap");
}

/**
 * The thinking shown in the thought block is Anthropic's summary, which the
 * chat's prose rules cannot reach. Owner, 2026-10-21: it follows the same
 * dash rule as everything else on screen, so a dash used as a pause (an em
 * or en dash, a bar, a double hyphen or a hyphen with spaces round it) reads
 * as a comma. Ranges and compounds (10-20, wall-to-batch) keep their hyphen.
 */
export function plainReasoningDashes(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013\u2015]\s*/g, ", ")
    .replace(/\s+-{1,2}\s+/g, ", ")
    .replace(/,\s*,/g, ",");
}

/** Tool names as the writer would say them, singular and plural. */
const TOOL_WORDS: Record<string, [string, string]> = {
  proposeEdit: ["edit", "edits"],
  proposeBulkEdits: ["coordinated edit", "coordinated edits"],
  proposeReplacements: ["replacement", "replacements"],
  highlightPassages: ["highlight", "highlights"],
  deviationInventory: ["deviation list", "deviation lists"],
  compareReferencePd: ["comparison with the reference PD", "comparisons with the reference PD"],
  searchBrain: ["Brain search", "Brain searches"],
  searchWeb: ["web search", "web searches"],
  readDocument: ["file reading", "file readings"],
  searchDocuments: ["file search", "file searches"],
  readTranscript: ["transcript reading", "transcript readings"],
  viewFile: ["file view", "file views"],
};
const TOOL_NAME_RE = new RegExp(`\\b(${Object.keys(TOOL_WORDS).join("|")})\\b(\\s+(calls?|tools?))?`, "g");

/**
 * Owner, 2026-10-21: the thinking names its tools ("I'll prepare the
 * proposeEdit calls"); on screen they read as plain words ("the edits").
 */
export function plainToolNames(text: string): string {
  return text.replace(TOOL_NAME_RE, (_match, tool: string, _suffix: string | undefined, noun: string | undefined) => {
    const [one, many] = TOOL_WORDS[tool];
    return noun === "calls" || noun === "tools" ? many : one;
  });
}

/**
 * The thinking as the open thought block reads it: item ids as places, tool
 * names as words, and a dash pause as a comma.
 */
export function readableReasoning(text: string): string {
  return plainReasoningDashes(plainToolNames(humanizeItemIds(text)));
}

/**
 * Tool steps whose result is a card under the reply (owner, 2026-10-21): the
 * card already shows the edit, so a "Suggested an edit" row in the thought
 * block only repeats it. A failed one stays, since it has no card.
 */
const CARD_TOOLS = new Set(["proposeEdit", "proposeReplacements", "proposeBulkEdits"]);

/** The steps a thought block shows: its reasoning and every step without a card. */
export function thoughtTraceNodes<T extends TraceRenderNode>(nodes: readonly T[]): T[] {
  return nodes.filter(
    (node) => !(node.kind === "tool" && CARD_TOOLS.has(node.toolName) && node.state !== "output-error")
  );
}

/** The longest second line of a thought block, in characters. */
const HEADLINE_MAX_CHARS = 64;

/**
 * Where a sentence's first clause ends: a comma before a joining word, a
 * semicolon, a colon, an opening bracket or a spaced hyphen.
 */
const CLAUSE_BREAK = /,\s+(?:but|so|and|because|since|which|while|though|then)\b|;|:|\s\(|\s-\s/;

/**
 * A short headline from a reasoning sentence (owner, 2026-10-21): its first
 * clause, when that clause says something on its own (three words or more),
 * then no longer than HEADLINE_MAX_CHARS, cut at a word.
 */
function shortHeadline(sentence: string): string {
  const first = sentence.split(CLAUSE_BREAK)[0]?.trim() ?? "";
  // A cut clause loses its trailing comma; a whole sentence keeps its stop.
  const clause = first.length < sentence.length ? first.replace(/[,;:]+$/, "") : first;
  const text = clause.split(/\s+/).length >= 3 ? clause : sentence;
  if (text.length <= HEADLINE_MAX_CHARS) return text;
  const cut = text.slice(0, HEADLINE_MAX_CHARS - 1);
  const atWord = cut.lastIndexOf(" ") > HEADLINE_MAX_CHARS / 2 ? cut.slice(0, cut.lastIndexOf(" ")) : cut;
  return `${atWord.replace(/[,.;:]+$/, "").trimEnd()}…`;
}

/**
 * The line beside a clock at the top of an open thought block, as Claude
 * shows it (owner, 2026-10-21): the newest heading of the model's reasoning
 * summary ("Drafting the Line 244 revision"), at most 64 characters, or,
 * with no reasoning, the label of the newest step. A summary with no heading
 * gives no line: its first sentence already opens the reasoning below it,
 * and repeating it was noise (owner, 2026-10-21).
 */
export function turnHeadline(nodes: readonly (ReasoningRenderNode | ToolRenderNode)[]): string | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node.kind !== "reasoning" || !node.text.trim()) continue;
    const headings = [...node.text.matchAll(/\*\*([^*\n]+)\*\*/g)].map((match) => match[1].trim()).filter(Boolean);
    // A heading still streaming in ("**Planning the ed") counts as the newest.
    const opening = /^\*\*([^*\n]+)$/.exec(node.text.split("\n").at(-1)?.trim() ?? "");
    if (opening) headings.push(opening[1].trim());
    const heading = headings.at(-1);
    return heading ? shortHeadline(readableReasoning(heading)) : null;
  }
  const lastTool = [...nodes].reverse().find((node) => node.kind === "tool");
  return lastTool ? lastTool.label : null;
}

// ─── Live progress (Phase A) ────────────────────────────────────────────────

/** The shortest time a live label stays up before the next one replaces it. */
export const LABEL_HOLD_MS = 1500;

/** One thinking phase this long earns the quiet "ask for one Line" hint. */
export const THINKING_HINT_AFTER_MS = 60_000;

export const THINKING_HINT =
  "Big requests can take a few minutes. You can stop and ask for one Line at a time.";

const EDIT_TOOLS = new Set(["proposeEdit", "proposeReplacements", "proposeBulkEdits"]);

/**
 * The live label for a turn's server-written phase. Built from the phase,
 * the tool name and the Line only; "Working…" when there is no phase yet.
 */
export function progressLabel(progress: TurnProgress | undefined): string {
  if (!progress) return "Working…";
  const line = progress.section ? `Line ${progress.section}` : null;
  switch (progress.phase) {
    case "reading":
      return "Reading the report…";
    case "thinking":
      return "Thinking…";
    case "writing":
      return "Writing the reply…";
    case "retrying":
      return "Trying again…";
    case "tool": {
      const tool = progress.tool ?? "";
      if (tool === "deviationInventory") {
        return line ? `Listing the deviations in ${line}…` : "Listing the deviations…";
      }
      if (tool === "compareReferencePd") {
        return line ? `Comparing ${line} with the reference PD…` : toolCopy(tool).running;
      }
      if (EDIT_TOOLS.has(tool) && line) return `Writing suggestions for ${line}…`;
      return toolCopy(tool).running;
    }
  }
}

/**
 * The hint under a live turn that has been in one thinking phase for a
 * minute or more, or null. `seenAt` is the browser time when this phase
 * (its `progress.since`) was first seen: `since` is server time, and a
 * browser clock that runs ahead or behind must not move the hint (review P3).
 * Without `seenAt` there is no hint.
 */
export function thinkingHint(timing: TurnTiming | undefined, now: number, seenAt: number | undefined): string | null {
  const progress = timing?.progress;
  if (timing?.status !== "running" || progress?.phase !== "thinking" || seenAt === undefined) return null;
  return now - seenAt >= THINKING_HINT_AFTER_MS ? THINKING_HINT : null;
}

export type HeldLabel = { shown: string; shownAt: number };

/**
 * Hold a live label for at least `holdMs`. Returns the label to show now and,
 * when the newest label must wait, how long until it may replace it.
 */
export function holdLabel(
  held: HeldLabel | null,
  next: string,
  now: number,
  holdMs = LABEL_HOLD_MS
): { held: HeldLabel; waitMs: number } {
  if (held && held.shown === next) return { held, waitMs: 0 };
  if (!held || now - held.shownAt >= holdMs) return { held: { shown: next, shownAt: now }, waitMs: 0 };
  return { held, waitMs: holdMs - (now - held.shownAt) };
}

/**
 * Where the context-loss divider goes (Phase A, task 8): the order of the
 * first loaded message the model still reads, when anything above it is no
 * longer read; otherwise null. The newest turn that recorded a history start
 * decides, since the window only moves forward.
 */
export function contextBoundaryOrder(
  turns: readonly ({ order: number } & TurnPhaseFields)[],
  messageOrders: readonly number[],
  hasOlderPages: boolean
): number | null {
  let newest: ({ order: number } & TurnPhaseFields) | undefined;
  for (const turn of turns) {
    if (turn.historyStartOrder === undefined) continue;
    if (!newest || turn.order > newest.order) newest = turn;
  }
  const start = newest?.historyStartOrder;
  if (start === undefined) return null;
  const firstRead = messageOrders.filter((order) => order >= start);
  if (!firstRead.length) return null;
  const boundary = Math.min(...firstRead);
  // Something above must be unread: a loaded older message, or (when the
  // loaded window starts exactly at the boundary) an older page.
  const hiddenLoaded = messageOrders.some((order) => order < start);
  return hiddenLoaded || (hasOlderPages && boundary === start) ? boundary : null;
}

/** The Continue offer's button label: "Continue with Line 244", or "Continue". */
export function continueLabel(continuation: TurnPhaseFields["continuation"]): string | null {
  if (!continuation) return null;
  return continuation.nextSection ? `Continue with Line ${continuation.nextSection}` : "Continue";
}

/** The writer message the Continue offer sends through the ordinary send path. */
export function continueMessage(continuation: TurnPhaseFields["continuation"]): string | null {
  const label = continueLabel(continuation);
  return label ? `${label}.` : null;
}

/** Associate loaded rows from one selected thread by exact prompt order only.
 * The final assistant row owns the action, including empty and tool-only rows.
 */
export function associateTurnPrompts(messages: readonly UIMessage[]) {
  const promptByOrder = new Map<number, string>();
  const finalAssistantByOrder = new Map<number, UIMessage>();
  for (const message of messages) {
    if (message.role === "user") {
      const text = normalizeTurnParts(message).text;
      if (text.trim()) promptByOrder.set(message.order, text);
    } else if (message.role === "assistant") {
      finalAssistantByOrder.set(message.order, message);
    }
  }
  const promptByAssistantId = new Map<string, string>();
  for (const [order, message] of finalAssistantByOrder) {
    const prompt = promptByOrder.get(order);
    if (prompt !== undefined) promptByAssistantId.set(message.id, prompt);
  }
  return { promptByOrder, promptByAssistantId, assistantOrders: new Set(finalAssistantByOrder.keys()) };
}

/**
 * Explicit live state always wins over a terminal snapshot. Phase C (W2): a
 * stopped turn may be regenerated once it is no longer streaming.
 */
export function canRegenerateTurn(
  status: UIMessage["status"] | undefined,
  timing: TurnTiming | undefined,
): boolean {
  if (status === "streaming" || status === "pending" ||
      timing?.status === "queued" || timing?.status === "running") return false;
  return status === "success" || status === "failed" ||
    timing?.status === "completed" || timing?.status === "failed" || timing?.status === "aborted";
}
