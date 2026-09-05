import { formatBrainExemplars } from "../../../convex/ai/brain/retrieve";
import { describe, it, expect } from "vitest";
import type { UIMessage } from "@convex-dev/agent";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
  correlateProposals,
  associateTurnPrompts,
  canRegenerateTurn,
  formatDuration,
  formatTurnSummary,
  normalizeTurnParts,
  toolLabel,
  type TurnTiming,
} from "./turnParts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPart = any;

function assistant(parts: AnyPart[], overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: "m1",
    key: "m1",
    role: "assistant",
    parts,
    order: 1,
    stepOrder: 0,
    status: "success",
    text: "",
    _creationTime: 1000,
    ...overrides,
  } as unknown as UIMessage;
}

// `_id` is a branded Id<"chatProposals">; tests pass plain strings as fixtures.
type ProposalOverrides = Partial<Omit<Doc<"chatProposals">, "_id">> & { _id?: string };

function proposal(overrides: ProposalOverrides = {}): Doc<"chatProposals"> {
  return {
    _id: "p1",
    _creationTime: 1000,
    agentThreadId: "t1",
    projectId: "proj1",
    reportId: "rep1",
    kind: "edit",
    targetText: "old",
    newText: "new",
    state: "pending",
    createdAt: 1000,
    ...overrides,
  } as unknown as Doc<"chatProposals">;
}

const textPart = (text: string, state: "streaming" | "done" = "done") => ({
  type: "text",
  text,
  state,
});

const toolPart = (over: Record<string, unknown> = {}) => ({
  type: "tool-searchBrain",
  toolCallId: "call-1",
  state: "output-available",
  input: { query: "uncertainty framing" },
  output: "3 exemplars found",
  ...over,
});

describe("normalizeTurnParts — text", () => {
  it("joins and coalesces adjacent text parts in order", () => {
    const turn = normalizeTurnParts(
      assistant([textPart("Hello "), textPart("world"), textPart("!")])
    );
    expect(turn.text).toBe("Hello world!");
    expect(turn.nodes.filter((n) => n.kind === "text")).toHaveLength(1);
  });

  it("ignores step-start markers", () => {
    const turn = normalizeTurnParts(
      assistant([{ type: "step-start" }, textPart("hi"), { type: "step-start" }])
    );
    expect(turn.nodes).toHaveLength(1);
    expect(turn.text).toBe("hi");
  });

  it("returns an empty turn for a missing message", () => {
    const turn = normalizeTurnParts(undefined);
    expect(turn.nodes).toEqual([]);
    expect(turn.text).toBe("");
    expect(turn.toolCount).toBe(0);
  });
});

describe("normalizeTurnParts — reasoning", () => {
  it("coalesces reasoning and tracks streaming state", () => {
    const turn = normalizeTurnParts(
      assistant([
        { type: "reasoning", text: "First ", state: "done" },
        { type: "reasoning", text: "second", state: "streaming" },
      ])
    );
    const [node] = turn.traceNodes;
    expect(node.kind).toBe("reasoning");
    expect(node.kind === "reasoning" && node.text).toBe("First second");
    expect(node.state).toBe("streaming");
    expect(turn.hasReasoning).toBe(true);
  });

  it("drops redacted reasoning blocks, which carry no text", () => {
    const turn = normalizeTurnParts(
      assistant([{ type: "reasoning", text: "", state: "done" }, textPart("answer")])
    );
    expect(turn.traceNodes).toHaveLength(0);
    expect(turn.hasReasoning).toBe(false);
    // And so cannot claim the turn "Thought" when nothing was shown.
    expect(
      formatTurnSummary(
        turn,
        { status: "completed", startedAt: 1_000, endedAt: 6_000, stepCount: 0 },
        "success",
        0
      )
    ).toBeNull();
  });

  it("keeps reasoning out of the answer text", () => {
    const turn = normalizeTurnParts(
      assistant([{ type: "reasoning", text: "hidden" }, textPart("shown")])
    );
    expect(turn.text).toBe("shown");
  });
});

describe("normalizeTurnParts — tools", () => {
  it("speaks of suggestions, matching the card the writer acts on", () => {
    expect(toolLabel("proposeEdit", "input-available")).toBe("Writing a suggestion…");
    expect(toolLabel("proposeEdit", "output-available")).toBe("Suggested an edit");
    expect(toolLabel("proposeEdit", "output-error")).toBe(
      "Couldn’t write that suggestion"
    );
    expect(toolLabel("proposeReplacements", "input-streaming")).toBe(
      "Writing suggestions…"
    );
    expect(toolLabel("proposeReplacements", "output-available")).toBe(
      "Suggested replacements"
    );
    expect(toolLabel("highlightPassages", "input-available")).toBe(
      "Looking through the report…"
    );
    expect(toolLabel("highlightPassages", "output-available")).toBe("Found passages");
    expect(toolLabel("searchBrain", "input-available")).toBe("Searching The Brain…");
    expect(toolLabel("searchBrain", "output-available")).toBe("Searched The Brain");
    expect(toolLabel("searchBrain", "output-error")).toBe("Couldn’t reach The Brain");
  });

  it("maps each state to a plain-language accessible status", () => {
    const states = [
      ["input-streaming", "Starting"],
      ["input-available", "Running"],
      ["output-available", "Done"],
      ["output-error", "Didn’t finish"],
    ] as const;
    for (const [state, expected] of states) {
      const turn = normalizeTurnParts(assistant([toolPart({ state })]));
      const [node] = turn.traceNodes;
      expect(node.kind === "tool" && node.accessibleStatus).toBe(expected);
    }
  });

  it("does not duplicate proposal payloads that render as a card", () => {
    for (const [type, input] of [
      ["tool-proposeEdit", { targetText: "old wording", newText: "new wording" }],
      [
        "tool-proposeReplacements",
        { replacements: [{ find: "we", replaceWith: "the team" }] },
      ],
      ["tool-highlightPassages", { references: ["first", "second"] }],
    ] as const) {
      const turn = normalizeTurnParts(assistant([toolPart({ type, input })]));
      const node = turn.traceNodes[0];
      // The card / "Jump to" chips below the trace already show this, better.
      expect(node.kind === "tool" && node.input).toBeUndefined();
      expect(node.kind === "tool" && node.output).toBeUndefined();
    }
  });

  it("shows what The Brain was asked", () => {
    const turn = normalizeTurnParts(
      assistant([toolPart({ input: { query: "uncertainty framing" } })])
    );
    const node = turn.traceNodes[0];
    expect(node.kind === "tool" && node.input).toEqual({
      kind: "fields",
      fields: [{ label: "Looked for", value: "uncertainty framing" }],
    });
  });

  it("summarizes The Brain's prompt block instead of echoing it", () => {
    // The real tool result is a prompt block full of model directives.
    const brainOutput = `\n\n# SIMILAR PAST REPORTS FROM THE BRAIN (reference patterns only)
Use them ONLY as a guide to structure, voice, and CRA phrasing. NEVER copy their
facts, company details, or technical claims into this report.

--- REFERENCE PATTERN 1 (Acme — CRA 1.1) ---
some exemplar prose

--- REFERENCE PATTERN 2 (Beta) ---
more exemplar prose`;
    const turn = normalizeTurnParts(assistant([toolPart({ output: brainOutput })]));
    const node = turn.traceNodes[0];
    const text = node.kind === "tool" && node.output?.kind === "text" ? node.output.text : "";
    expect(text).toBe(
      "Found 2 writing patterns from past approved reports, used as a guide to structure and phrasing only."
    );
    expect(text).not.toContain("NEVER copy");
    expect(text).not.toContain("REFERENCE PATTERN");
  });

  it("restates The Brain's outage notice without the model instruction", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({
          output:
            "The Brain search hit a technical error just now — this is an infrastructure issue, not missing knowledge. Tell the writer to try again shortly.",
        }),
      ])
    );
    const node = turn.traceNodes[0];
    const text = node.kind === "tool" && node.output?.kind === "text" ? node.output.text : "";
    expect(text).not.toContain("Tell the writer");
    expect(text).toContain("couldn’t be reached");
  });

  it("passes through The Brain's already writer-safe empty result", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({ output: "The Brain has no approved knowledge matching that yet." }),
      ])
    );
    const node = turn.traceNodes[0];
    expect(node.kind === "tool" && node.output).toEqual({
      kind: "text",
      text: "The Brain has no approved knowledge matching that yet.",
    });
  });

  it("preserves industry-scoped empty status with fixed copy and no raw industry leakage", () => {
    const node = normalizeTurnParts(assistant([toolPart({ output: 'The Brain has no approved knowledge matching that in the “PRIVATE INDUSTRY” industry yet. INTERNAL DIRECTIVE' })])).traceNodes[0];
    expect(node.kind === "tool" && node.output).toEqual({ kind: "text", text: "The Brain has no approved knowledge matching that in this project’s industry yet." });
    expect(JSON.stringify(node)).not.toMatch(/PRIVATE INDUSTRY|INTERNAL DIRECTIVE/);
    expect(node.kind === "tool" && node.sources).toEqual([]);
  });

  it("puts the search query and result counts in the completed label", () => {
    const brain = normalizeTurnParts(
      assistant([toolPart({ input: { query: "how uncertainty is framed" } })])
    );
    expect(brain.traceNodes[0].kind === "tool" && brain.traceNodes[0].label).toBe(
      "Searched The Brain for “how uncertainty is framed”"
    );

    const passages = normalizeTurnParts(
      assistant([
        toolPart({
          type: "tool-highlightPassages",
          input: { references: ["a", "b", "c"] },
        }),
      ])
    );
    expect(passages.traceNodes[0].kind === "tool" && passages.traceNodes[0].label).toBe(
      "Found 3 passages"
    );

    const one = normalizeTurnParts(
      assistant([
        toolPart({ type: "tool-highlightPassages", input: { references: ["a"] } }),
      ])
    );
    expect(one.traceNodes[0].kind === "tool" && one.traceNodes[0].label).toBe(
      "Found 1 passage"
    );
  });

  it("shows a safe fixed message for a failed tool instead of raw errors", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({
          state: "output-error",
          errorText: "ConvexError: request_id=abc123 internal failure",
        }),
      ])
    );
    const node = turn.traceNodes[0];
    expect(node.kind === "tool" && node.output).toEqual({
      kind: "text",
      text: "This step didn’t finish. The assistant carried on.",
    });
  });

  it("omits output while the tool is still running", () => {
    const turn = normalizeTurnParts(assistant([toolPart({ state: "input-available" })]));
    const node = turn.traceNodes[0];
    expect(node.kind === "tool" && node.output).toBeUndefined();
  });

  it("describes an unknown tool generically and never leaks its internals", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({
          type: "tool-fetchWeatherData",
          input: { b: 2, a: 1 },
          output: { ok: true },
        }),
      ])
    );
    const node = turn.traceNodes[0];
    // Never a camelCase function name, never a JSON dump.
    expect(node.kind === "tool" && node.label).toBe("Finished a step");
    expect(node.kind === "tool" && node.input).toBeUndefined();
    expect(node.kind === "tool" && node.output).toBeUndefined();
  });

  it("never renders a tool result written for the model", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({
          type: "tool-proposeEdit",
          input: { targetText: "a", newText: "b" },
          output:
            "Edit proposed — the writer sees it as a card with Replace, Refine, or Reject.",
        }),
      ])
    );
    const node = turn.traceNodes[0];
    expect(node.kind === "tool" && node.output).toBeUndefined();
  });

  it("de-duplicates a repeated toolCallId, keeping position and latest state", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({ state: "input-streaming", output: undefined }),
        textPart("between"),
        toolPart({ state: "output-available", output: "done" }),
      ])
    );
    expect(turn.toolCount).toBe(1);
    expect(turn.nodes[0].kind).toBe("tool");
    const node = turn.nodes[0];
    expect(node.kind === "tool" && node.state).toBe("output-available");
  });

  it("never regresses a tool to an earlier state", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({ state: "output-available", output: "done" }),
        toolPart({ state: "input-streaming", output: undefined }),
      ])
    );
    const node = turn.traceNodes[0];
    expect(node.kind === "tool" && node.state).toBe("output-available");
  });

  it("counts unique tool calls", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({ toolCallId: "a" }),
        toolPart({ toolCallId: "b", type: "tool-proposeEdit" }),
        toolPart({ toolCallId: "a" }),
      ])
    );
    expect(turn.toolCount).toBe(2);
  });

  it("supports dynamic-tool parts", () => {
    const turn = normalizeTurnParts(
      assistant([
        {
          type: "dynamic-tool",
          toolName: "searchBrain",
          toolCallId: "d1",
          state: "output-available",
          input: { query: "x" },
          output: "ok",
        },
      ])
    );
    const node = turn.traceNodes[0];
    expect(node.kind === "tool" && node.label).toBe("Searched The Brain for “x”");
  });
});

describe("normalizeTurnParts — proposals", () => {
  it("splices a proposal immediately after its owning tool call", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({ type: "tool-proposeEdit", toolCallId: "call-9" }),
        textPart("Here is the edit."),
      ]),
      [proposal({ toolCallId: "call-9" })]
    );
    expect(turn.nodes.map((n) => n.kind)).toEqual(["tool", "proposal", "text"]);
    expect(turn.proposalNodes[0].association).toBe("toolCallId");
  });

  it("appends legacy proposals with no matching tool call", () => {
    const turn = normalizeTurnParts(assistant([textPart("answer")]), [
      proposal({ toolCallId: undefined }),
    ]);
    expect(turn.nodes.map((n) => n.kind)).toEqual(["text", "proposal"]);
    expect(turn.proposalNodes[0].association).toBe("legacy");
  });

  it("orders cards by their owning tool call, not by proposal row order", () => {
    const turn = normalizeTurnParts(
      assistant([
        toolPart({ type: "tool-proposeEdit", toolCallId: "first" }),
        toolPart({ type: "tool-proposeEdit", toolCallId: "second" }),
      ]),
      // Arrives reversed, as parallel tool execution can produce.
      [
        proposal({ _id: "p-second", toolCallId: "second" }),
        proposal({ _id: "p-first", toolCallId: "first" }),
      ]
    );
    expect(turn.proposalNodes.map((n) => n.proposal._id)).toEqual([
      "p-first",
      "p-second",
    ]);
  });

  it("emits each proposal exactly once", () => {
    const turn = normalizeTurnParts(
      assistant([toolPart({ type: "tool-proposeEdit", toolCallId: "c1" })]),
      [proposal({ _id: "p1", toolCallId: "c1" }), proposal({ _id: "p2", toolCallId: "c1" })]
    );
    expect(turn.nodes.filter((n) => n.kind === "proposal")).toHaveLength(2);
    expect(new Set(turn.proposalNodes.map((n) => n.key)).size).toBe(2);
  });
});

describe("correlateProposals", () => {
  const reply = assistant([toolPart({ toolCallId: "tc1" })], { id: "a1", order: 2 });

  it("prefers exact toolCallId ownership", () => {
    const { byMessageId, orphans } = correlateProposals(
      [reply],
      [proposal({ toolCallId: "tc1" })]
    );
    expect(byMessageId.get("a1")).toHaveLength(1);
    expect(orphans).toHaveLength(0);
  });

  it("falls back to the assistant reply sharing the prompt's order", () => {
    const prompt = assistant([], { id: "u1", role: "user", order: 2 } as Partial<UIMessage>);
    const { byMessageId } = correlateProposals(
      [prompt, reply],
      [proposal({ toolCallId: undefined, promptMessageId: "u1" })]
    );
    expect(byMessageId.get("a1")).toHaveLength(1);
  });

  it("falls back to the legacy messageId", () => {
    const { byMessageId } = correlateProposals(
      [reply],
      [proposal({ toolCallId: undefined, messageId: "a1" })]
    );
    expect(byMessageId.get("a1")).toHaveLength(1);
  });

  it("falls back to the nearest earlier assistant message", () => {
    const { byMessageId } = correlateProposals(
      [reply],
      [proposal({ toolCallId: undefined, createdAt: 5000 })]
    );
    expect(byMessageId.get("a1")).toHaveLength(1);
  });

  it("leaves unmatched proposals as orphans", () => {
    const { orphans } = correlateProposals(
      [],
      [proposal({ toolCallId: undefined, createdAt: 5000 })]
    );
    expect(orphans).toHaveLength(1);
  });

  it("suppresses superseded pending refinements from the same prompt", () => {
    const { byMessageId } = correlateProposals(
      [reply],
      [
        proposal({ _id: "old", messageId: "a1", promptMessageId: "u1", state: "pending" }),
        proposal({ _id: "new", messageId: "a1", promptMessageId: "u1", state: "pending" }),
      ]
    );
    const owned = byMessageId.get("a1") ?? [];
    expect(owned).toHaveLength(1);
    expect(owned[0]._id).toBe("new");
  });

  it("keeps non-pending history from the same prompt", () => {
    const { byMessageId } = correlateProposals(
      [reply],
      [
        proposal({ _id: "applied", messageId: "a1", promptMessageId: "u1", state: "applied" }),
        proposal({ _id: "pending", messageId: "a1", promptMessageId: "u1", state: "pending" }),
      ]
    );
    expect(byMessageId.get("a1")).toHaveLength(2);
  });
});

describe("formatDuration", () => {
  it("formats boundaries", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59_400)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(61_000)).toBe("1m 01s");
    expect(formatDuration(3_600_000)).toBe("60m 00s");
  });
});

describe("formatTurnSummary", () => {
  const withTools = normalizeTurnParts(
    assistant([toolPart({ toolCallId: "a" }), toolPart({ toolCallId: "b" })])
  );
  const withSuggestions = normalizeTurnParts(
    assistant([toolPart({ type: "tool-proposeEdit", toolCallId: "edit-1" })]),
    [proposal({ toolCallId: "edit-1" })]
  );
  const plain = normalizeTurnParts(assistant([textPart("just an answer")]));
  const timing = (over: Partial<TurnTiming>): TurnTiming => ({
    status: "completed",
    startedAt: 1_000,
    endedAt: 13_000,
    stepCount: 2,
    ...over,
  });

  it("shows nothing for a plain answer with no trace", () => {
    expect(formatTurnSummary(plain, timing({ stepCount: 0 }), "success", 0)).toBeNull();
  });

  it("says it is starting before any work begins", () => {
    expect(
      formatTurnSummary(withTools, timing({ status: "queued", startedAt: undefined }), "pending", 0)
    ).toBe("Starting…");
  });

  it("ticks while running", () => {
    expect(
      formatTurnSummary(withTools, timing({ status: "running", endedAt: undefined }), "streaming", 6_000)
    ).toBe("Working… · 5s");
  });

  it("keeps one stable verb while live, even as reasoning streams", () => {
    // Alternating Working/Thinking would make the header flicker mid-turn.
    const thinking = normalizeTurnParts(
      assistant([{ type: "reasoning", text: "…", state: "streaming" }])
    );
    expect(
      formatTurnSummary(
        thinking,
        timing({ status: "running", stepCount: 0, endedAt: undefined }),
        "streaming",
        4_000
      )
    ).toBe("Working… · 3s");
  });

  it("reports the outcome, not an internal step count", () => {
    expect(formatTurnSummary(withSuggestions, timing({ stepCount: 1 }), "success", 0)).toBe(
      "Worked for 12s · 1 suggestion"
    );
    expect(formatTurnSummary(withTools, timing({}), "success", 0)).toBe(
      "Worked for 12s · checked The Brain"
    );
  });

  it("pluralizes suggestions", () => {
    const two = normalizeTurnParts(
      assistant([
        toolPart({ type: "tool-proposeEdit", toolCallId: "e1" }),
        toolPart({ type: "tool-proposeEdit", toolCallId: "e2" }),
      ]),
      [proposal({ _id: "p1", toolCallId: "e1" }), proposal({ _id: "p2", toolCallId: "e2" })]
    );
    expect(formatTurnSummary(two, timing({ stepCount: 2 }), "success", 0)).toBe(
      "Worked for 12s · 2 suggestions"
    );
  });

  it("reports located passages as a found outcome", () => {
    const refs = normalizeTurnParts(
      assistant([toolPart({ type: "tool-highlightPassages", toolCallId: "h1" })]),
      [proposal({ kind: "references", references: ["a"], toolCallId: "h1" })]
    );
    expect(formatTurnSummary(refs, timing({ stepCount: 1 }), "success", 0)).toBe(
      "Worked for 12s · found passages"
    );
  });

  it("reports reasoning-only turns as thought", () => {
    const thought = normalizeTurnParts(
      assistant([{ type: "reasoning", text: "…", state: "done" }])
    );
    expect(
      formatTurnSummary(thought, timing({ stepCount: 0, endedAt: 6_000 }), "success", 0)
    ).toBe("Thought for 5s");
  });

  it("never claims a sub-second turn took 0s", () => {
    expect(
      formatTurnSummary(withTools, timing({ startedAt: 1_000, endedAt: 1_200 }), "success", 0)
    ).toBe("Worked for 1s · checked The Brain");
  });

  it("formats stopped turns", () => {
    expect(
      formatTurnSummary(withTools, timing({ status: "aborted", endedAt: 9_000 }), "success", 0)
    ).toBe("Stopped after 8s");
    expect(
      formatTurnSummary(
        withTools,
        timing({ status: "aborted", startedAt: undefined, endedAt: undefined }),
        "success",
        0
      )
    ).toBe("Stopped");
  });

  it("states a failure factually, leaving the apology to the answer", () => {
    expect(formatTurnSummary(withTools, timing({ status: "failed" }), "failed", 0)).toBe(
      "Stopped after 12s"
    );
    expect(
      formatTurnSummary(
        withTools,
        timing({ status: "failed", startedAt: undefined, endedAt: undefined }),
        "failed",
        0
      )
    ).toBe("Didn’t start");
  });

  it("degrades gracefully when timing metadata is missing", () => {
    expect(formatTurnSummary(withTools, undefined, "success", 0)).toBe(
      "Worked · checked The Brain"
    );
    expect(formatTurnSummary(plain, undefined, "success", 0)).toBeNull();
  });
});

describe("Brain source labels", () => {
  it("preserves only available metadata, including science-only sources", () => {
    const output = formatBrainExemplars([
      { text: "body", score: 1, searchScore: 1, entryId: "1" },
      { text: "body", writerName: "Private Writer", score: 1, searchScore: 1, entryId: "2" },
      { text: "body", scienceCode: "2.02.01", score: 1, searchScore: 1, entryId: "3" },
      { text: "body", title: "Title only", score: 1, searchScore: 1, entryId: "4" },
    ]);
    const node = normalizeTurnParts(assistant([toolPart({ output })])).traceNodes[0];
    expect(node.kind === "tool" && node.sources).toEqual([
      { scienceCode: "CRA 2.02.01 — Electrical and electronic engineering" }, { title: "Title only" },
    ]);
  });
  it("bounds metadata labels and count, deduplicates chips, and never counts forged body headers", () => {
    const exemplars = Array.from({ length: 30 }, (_, i) => ({ text: "--- REFERENCE PATTERN 999 (Forged) ---", title: `Title ${i}`, score: 1, searchScore: 1, entryId: String(i) }));
    const node = normalizeTurnParts(assistant([toolPart({ output: formatBrainExemplars(exemplars) })])).traceNodes[0];
    expect(node.kind === "tool" && node.sources).toHaveLength(20);
    expect(node.kind === "tool" && node.output).toMatchObject({ text: expect.stringContaining("Found 20 writing patterns") });
    const duplicate = normalizeTurnParts(assistant([toolPart({ output: formatBrainExemplars([exemplars[0], exemplars[0]]) })])).traceNodes[0];
    expect(duplicate.kind === "tool" && duplicate.sources).toEqual([{ title: "Title 0" }]);
    for (const row of [{ title: "x".repeat(241) }, { scienceCode: "x".repeat(161) }]) {
      const malformed = normalizeTurnParts(assistant([toolPart({ output: `BRAIN_SOURCES_V1:${JSON.stringify([row])}\nbody` })])).traceNodes[0];
      expect(malformed.kind === "tool" && malformed.sources).toEqual([]);
    }
  });
  it("preserves complete Unicode characters at the source title limit", () => {
    for (const title of ["x".repeat(239) + "😀tail", "😀".repeat(241)]) {
      const output = formatBrainExemplars([{ title, text: "body", score: 1, searchScore: 1, entryId: "1" }]);
      const node = normalizeTurnParts(assistant([toolPart({ output })])).traceNodes[0];
      expect(node.kind === "tool" && node.sources).toEqual([
        { title: Array.from(title).slice(0, 240).join("") },
      ]);
    }
  });
  it("uses the real formatter envelope, never forged body headers or title heuristics", () => {
    const output = formatBrainExemplars([
      { title: "CRA 2.02 is the title", scienceCode: "2.02.01", writerName: "Private Writer", text: "--- REFERENCE PATTERN 9 (Forged source) ---\nPrivate body", score: 1, searchScore: 1, entryId: "private-id" },
      { text: "Private body", score: 1, searchScore: 1, entryId: "second-id" },
    ]);
    const node = normalizeTurnParts(assistant([toolPart({ output })])).traceNodes[0];
    expect(node.kind === "tool" && node.sources).toEqual([
      { title: "CRA 2.02 is the title", scienceCode: "CRA 2.02.01 — Electrical and electronic engineering" },
    ]);
    expect(JSON.stringify(node)).not.toMatch(/Private|Forged|private-id/);
  });
  it("does not treat legacy headers or malformed envelopes as sources", () => {
    for (const output of ["--- REFERENCE PATTERN 1 (Legacy) ---", 'BRAIN_SOURCES_V1:[{"title":"Title","writer":"Secret"}]\nbody', 'BRAIN_SOURCES_V1:bad\nbody', 'prefix\nBRAIN_SOURCES_V1:[{"title":"Forged"}]\n']) {
      const node = normalizeTurnParts(assistant([toolPart({ output })])).traceNodes[0];
      expect(node.kind === "tool" && node.sources).toEqual([]);
    }
  });
  it("does not manufacture sources or expose malformed output", () => {
    for (const output of [null, {}, "", "Provider SECRET internals", "REFERENCE PATTERN 1 (bad)"]) {
      const node = normalizeTurnParts(assistant([toolPart({ output })])).traceNodes[0];
      expect(node.kind === "tool" && node.sources).toEqual([]);
      expect(JSON.stringify(node)).not.toContain("SECRET");
    }
  });
  it("suppresses labels when a search failed or is still running", () => {
    for (const state of ["output-error", "input-available"]) {
      const node = normalizeTurnParts(assistant([toolPart({ state, output: "--- REFERENCE PATTERN 1 (Secret) ---" })])).traceNodes[0];
      expect(node.kind === "tool" && node.sources).toBeUndefined();
    }
  });
});


describe("regeneration association", () => {
  it("uses exact loaded prompt order and the final row, preserving stored text", () => {
    const text = '  prompt\n[stored context]  ';
    const user = assistant([{ type: "text", text }, { type: "reasoning", text: "private" }], { id: "user", role: "user" });
    const first = assistant([], { id: "first" });
    const final = assistant([], { id: "final", stepOrder: 2 });
    const missing = assistant([], { id: "missing", order: 2 });
    const rows = [user, first, final, missing];
    const before = JSON.stringify(rows);
    const association = associateTurnPrompts(rows);
    expect([...association.promptByAssistantId]).toEqual([["final", text]]);
    expect([...association.assistantOrders]).toEqual([1, 2]);
    expect(association.promptByOrder.get(2)).toBeUndefined();
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("does not offer a blank or unloaded prompt", () => {
    expect(associateTurnPrompts([assistant([])]).promptByAssistantId.size).toBe(0);
    expect(associateTurnPrompts([assistant([{ type: "text", text: " " }], { role: "user" }), assistant([])]).promptByAssistantId.size).toBe(0);
  });
  it.each(["queued", "running", "aborted"] as const)("suppresses durable %s even with a successful row", status => {
    expect(canRegenerateTurn("success", { status, stepCount: 0 })).toBe(false);
  });
  it.each(["streaming", "pending"] as const)("suppresses %s even with completed timing", status => {
    expect(canRegenerateTurn(status, { status: "completed", stepCount: 0 })).toBe(false);
  });
  it.each(["success", "failed"] as const)("supports terminal %s without timing", status => {
    expect(canRegenerateTurn(status, undefined)).toBe(true);
  });
});
