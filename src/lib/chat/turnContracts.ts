/**
 * Phase A turn fields (spec-chat-parity-phase-a, Contracts) as the browser
 * reads them from `chatV2.listTurns`. The backend adds them as optional
 * `chatTurns` fields; until the generated types carry them, this module is
 * the one place that names their shape. Replace these types with the
 * generated `Doc<"chatTurns">` fields once codegen has them.
 */
export type ChatSectionNumber = "242" | "244" | "246";

export type TurnProgress = {
  phase: "reading" | "thinking" | "tool" | "writing" | "retrying";
  tool?: string;
  section?: ChatSectionNumber;
  step: number;
  since: number;
};

export type TurnContinuation = {
  reason: "lines_left" | "step_limit" | "cut_off";
  nextSection?: ChatSectionNumber;
  remaining?: number;
};

export type TurnPhaseFields = {
  progress?: TurnProgress;
  continuation?: TurnContinuation;
  /** The oldest message order the model read for this turn; absent means the whole thread. */
  historyStartOrder?: number;
};

const PHASES = new Set(["reading", "thinking", "tool", "writing", "retrying"]);
const REASONS = new Set(["lines_left", "step_limit", "cut_off"]);
const SECTIONS = new Set(["242", "244", "246"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function section(value: unknown): ChatSectionNumber | undefined {
  return typeof value === "string" && SECTIONS.has(value) ? (value as ChatSectionNumber) : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Read the Phase A fields off a listTurns row, dropping anything malformed. */
export function turnPhaseFields(turn: unknown): TurnPhaseFields {
  const row = record(turn);
  if (!row) return {};
  const fields: TurnPhaseFields = {};

  const progress = record(row.progress);
  const step = finite(progress?.step);
  const since = finite(progress?.since);
  if (progress && typeof progress.phase === "string" && PHASES.has(progress.phase) &&
      step !== undefined && since !== undefined) {
    const tool = typeof progress.tool === "string" && progress.tool ? progress.tool : undefined;
    const line = section(progress.section);
    fields.progress = {
      phase: progress.phase as TurnProgress["phase"],
      step,
      since,
      ...(tool ? { tool } : {}),
      ...(line ? { section: line } : {}),
    };
  }

  const continuation = record(row.continuation);
  if (continuation && typeof continuation.reason === "string" && REASONS.has(continuation.reason)) {
    const next = section(continuation.nextSection);
    const remaining = finite(continuation.remaining);
    fields.continuation = {
      reason: continuation.reason as TurnContinuation["reason"],
      ...(next ? { nextSection: next } : {}),
      ...(remaining !== undefined ? { remaining } : {}),
    };
  }

  const start = finite(row.historyStartOrder);
  if (start !== undefined) fields.historyStartOrder = start;
  return fields;
}
