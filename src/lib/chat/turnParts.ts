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
};

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
  searchBrain: {
    running: "Searching The Brain…",
    done: "Searched The Brain",
    // The failure mode is reachability, not a bad search.
    error: "Couldn’t reach The Brain",
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
  "highlightPassages",
]);

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

  // A refinement turn supersedes the previous pending card from the same
  // prompt — only the latest actionable wording belongs in the transcript.
  const latestPendingIndexByPrompt = new Map<string, number>();
  proposals.forEach((proposal, index) => {
    if (proposal.state === "pending" && proposal.promptMessageId) {
      latestPendingIndexByPrompt.set(proposal.promptMessageId, index);
    }
  });

  for (const [index, proposal] of proposals.entries()) {
    if (
      proposal.state === "pending" &&
      proposal.promptMessageId &&
      latestPendingIndexByPrompt.get(proposal.promptMessageId) !== index
    ) {
      continue;
    }

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

/** `0s`, `59s`, `1m 00s` — mono/tabular so a ticking timer doesn't jitter. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * What the turn produced, not how many internal steps it took. A step count is
 * a loop counter a report writer can neither act on nor judge; "2 suggestions"
 * is the same information expressed as an outcome.
 */
function outcomeSuffix(turn: NormalizedTurn): string {
  const suggestions = turn.proposalNodes.filter(
    (node) => node.proposal.kind !== "references"
  ).length;
  if (suggestions) {
    return ` · ${suggestions} ${suggestions === 1 ? "suggestion" : "suggestions"}`;
  }
  const found = turn.proposalNodes.length - suggestions;
  if (found) return " · found passages";
  const searchedBrain = turn.traceNodes.some(
    (node) => node.kind === "tool" && node.toolName === "searchBrain"
  );
  return searchedBrain ? " · checked The Brain" : "";
}

/** Terminal turns report the durable count; a live turn may be ahead of it. */
function resolveStepCount(turn: NormalizedTurn, timing: TurnTiming | undefined, live: boolean) {
  if (!timing) return turn.toolCount;
  return live ? Math.max(timing.stepCount, turn.toolCount) : timing.stepCount || turn.toolCount;
}

/**
 * The single line a finished turn collapses to ("Worked for 12s · 2
 * suggestions"), or the live status while it runs. Returns null when there is
 * nothing worth showing — a plain answer with no tools and no reasoning gets
 * no trace row at all.
 */
export function formatTurnSummary(
  turn: NormalizedTurn,
  timing: TurnTiming | undefined,
  messageStatus: UIMessage["status"] | undefined,
  now: number
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

  if (live) {
    // One stable verb for the whole live phase. Alternating Working/Thinking as
    // reasoning and tools interleave makes the header flicker while the writer
    // is watching it.
    const elapsed =
      timing?.startedAt !== undefined ? formatDuration(now - timing.startedAt) : null;
    return elapsed ? `Working… · ${elapsed}` : "Working…";
  }

  const duration =
    timing?.startedAt !== undefined && timing?.endedAt !== undefined
      ? formatDuration(Math.max(1000, timing.endedAt - timing.startedAt))
      : null;

  const outcome = outcomeSuffix(turn);

  if (status === "aborted") {
    return duration ? `Stopped after ${duration}` : "Stopped";
  }
  if (status === "failed" || messageStatus === "failed") {
    // The answer already carries the apology; the trace stays factual so the
    // failure isn't announced twice.
    return duration ? `Stopped after ${duration}` : "Didn’t start";
  }
  if (!hasTrace) return null;

  // Reasoning with no tool work reads as thought, not work.
  if (steps === 0 && turn.hasReasoning) {
    return duration ? `Thought for ${duration}` : "Thought";
  }
  if (duration) return `Worked for ${duration}${outcome}`;
  return steps > 0 ? `Worked${outcome}` : null;
}
