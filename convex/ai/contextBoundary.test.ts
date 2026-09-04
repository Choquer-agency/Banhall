import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANALYZER_CATEGORY_LABELS,
  CONTEXT_SCAFFOLDS,
  buildTrustedContext,
} from "./trustedContext";
import {
  EVIDENCE_LABELS,
  buildChatEvidence,
  buildChatTurnRequest,
  type ChatTurnContext,
} from "./chatEvidence";
import { CHAT_EVIDENCE_GUIDANCE, CONTEXT_INPUTS_GUIDANCE } from "./prompts";

/**
 * CAP-5: one corpus of realistic injection payloads driven through BOTH
 * containment pipelines, asserting the same property of each.
 *
 * `trustedContext.test.ts` and `chatEvidence.test.ts` each test their own
 * builder against hand-written strings. Neither notices if one pipeline is
 * re-opened while the other stays closed, because no input is shared between
 * them. This file is that shared input: every `.txt` under
 * `__fixtures__/injection/` is discovered from disk and pushed through every
 * entry of `slots` below — three generation, six chat — and every one of them
 * must contain it the same way.
 *
 * `node:fs` is fine here for the same reason it is fine in
 * `convex/chatEvidenceBoundary.test.ts`: Convex never bundles a file whose
 * basename carries more than one dot, `*.test.ts` included, and the fixture
 * directory holds no `.ts` at all.
 *
 * Read-only over production code by construction: this file imports the two
 * builders and the two guidance constants and touches nothing else.
 */

// --- Corpus discovery -------------------------------------------------------

const FIXTURE_DIR = new URL("./__fixtures__/injection/", import.meta.url);

/**
 * Renaming or deleting a fixture must fail the suite rather than silently
 * shrinking its coverage, so the named families are asserted explicitly while
 * discovery itself stays open: a new `.txt` is enrolled in every slot with no
 * edit to this file.
 */
const REQUIRED_FIXTURES = [
  "instruction-override.txt",
  "marker-forgery.txt",
  "role-spoof.txt",
  "tool-call-request.txt",
];

/** A canary of plain uppercase and single hyphens survives neutralization. */
const CANARY = /^CANARY-[A-Z0-9-]+$/gm;

/**
 * The one extraction, shared by the fixtures and by the benign control, so
 * the control is validated through the identical path. Loud at import time:
 * every assertion below is expressed on the canary, so a payload without one
 * would quietly assert nothing.
 *
 * The contract the README states is enforced here rather than trusted, because
 * every violation of it surfaces later as a confusing containment failure
 * rather than as a clear authoring error:
 *
 * - Exactly one canary line. A second one would go unextracted, so its half of
 *   the payload would be asserted by nothing at all.
 * - No dash run of three and no BEGIN/END keyword inside the token, because
 *   `neutralizeMarkers` rewrites exactly those and the canary is the one thing
 *   in the payload that must survive every transform byte for byte.
 */
function canaryOf(content: string, what: string): string {
  const found = content.match(CANARY) ?? [];
  if (found.length !== 1) {
    throw new Error(
      `Injection payload ${what} must carry exactly one CANARY line, found ${found.length}`
    );
  }
  const canary = found[0];
  if (/[-\u2010-\u2015\u2212]{3,}/.test(canary) || /BEGIN|END/.test(canary)) {
    throw new Error(
      `Canary ${canary} in ${what} would be rewritten by neutralizeMarkers; keep it dash-run free and marker-keyword free`
    );
  }
  return canary;
}

interface Fixture {
  name: string;
  content: string;
  canary: string;
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".txt"))
  .sort()
  .map((name) => {
    const content = readFileSync(new URL(name, FIXTURE_DIR), "utf8");
    return { name, content, canary: canaryOf(content, name) };
  });

// --- Slots ------------------------------------------------------------------

/**
 * Ordinary prose in place of a payload. The marker-count assertion is only
 * meaningful against a control built in the identical slot: a forgery that
 * opened a block would add marker lines relative to this.
 */
const BENIGN =
  "The team rebuilt the ingest pipeline over three sprints.\n" +
  "Throughput improved and the retry path was simplified.\n" +
  "CANARY-BENIGN-CONTROL-0AA\n" +
  "Remaining work is tracked in the backlog.";

/**
 * Derived, never restated: a literal copy would silently stop matching the
 * moment the control payload is edited, and every containment assertion below
 * would then fail on `indexOf === -1` rather than on the property under test.
 */
const BENIGN_CANARY = canaryOf(BENIGN, "the benign control payload");

/** Ordinary text for the field of a paired source that is not the payload. */
const BENIGN_COUNTERPART = "The retry path was simplified in the same sprint.";

/** A ProseMirror document, which is what `reportContent` actually carries. */
function proseMirrorDoc(text: string): string {
  return JSON.stringify({
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  });
}

const emptyChatContext: ChatTurnContext = {
  reportContent: null,
  agentOutputs: null,
  documents: [],
  decisions: [],
};

interface Built {
  message: string;
  /** The chat system string; `null` for the generation pipeline, which has none. */
  system: string | null;
}

interface Slot {
  name: string;
  pipeline: "generation" | "chat";
  guidance: string;
  /**
   * The marker label the payload must land inside. "Inside a block" and
   * "inside the block this source is supposed to occupy" are different claims,
   * and only the second one rules out a payload surfacing under a neighbouring
   * source's header, where the model would read it under that source's trust.
   */
  blockLabel: string;
  /** A heading the block must sit under, where the pipeline emits one. */
  headingBefore?: string;
  /**
   * Whether this build returns a chat system string. Declared per slot rather
   * than derived from `system !== null`, so a builder that started returning
   * `null` fails the assertion instead of skipping it.
   */
  hasSystem: boolean;
  build: (payload: string) => Built;
}

const chat = (context: Partial<ChatTurnContext>): Built => {
  const request = buildChatTurnRequest({
    context: { ...emptyChatContext, ...context },
  });
  // Every assertion below runs against this one string. If the builder ever
  // prepends a message or switches to a content-parts array, the cast would
  // silently point them at the wrong bytes, so the shape is checked first.
  expect(request.messages).toHaveLength(1);
  expect(request.messages[0].role).toBe("user");
  expect(typeof request.messages[0].content).toBe("string");
  return {
    message: request.messages[0].content as string,
    system: request.system,
  };
};

/**
 * The system string as the builder returned it, never as this file wrote it.
 * A hardcoded `system: null` in a slot would make the systemless branch of the
 * leak check assert the test's own literal: a builder that grew a system
 * string would keep passing until a human edited the slot by hand. Reading the
 * property off the result instead gives that branch a subject.
 */
function systemOf(result: object): string | null {
  if (!("system" in result)) return null;
  return (result as { system: string | null }).system ?? null;
}

/** `buildChatEvidence`'s own inputs, one level below the turn assembler. */
const chatEvidence = (reportText: string, analysisText: string): Built => {
  const built = buildChatEvidence({ reportText, analysisText });
  return { message: built.message, system: systemOf(built) };
};

const slots: Slot[] = [
  {
    name: "generation: writer_notes document from an internal uploader",
    pipeline: "generation",
    guidance: CONTEXT_INPUTS_GUIDANCE,
    blockLabel: ANALYZER_CATEGORY_LABELS.writer_notes,
    headingBefore: CONTEXT_SCAFFOLDS.contextHeading.trim(),
    hasSystem: false,
    build: (payload) => {
      const built = buildTrustedContext({
        documents: [
          {
            category: "writer_notes",
            fileName: "client-notes.txt",
            content: payload,
            uploaderRole: "writer",
          },
        ],
      });
      return { message: built.userMessage, system: systemOf(built) };
    },
  },
  {
    name: "generation: other document",
    pipeline: "generation",
    guidance: CONTEXT_INPUTS_GUIDANCE,
    blockLabel: ANALYZER_CATEGORY_LABELS.other,
    headingBefore: CONTEXT_SCAFFOLDS.contextHeading.trim(),
    hasSystem: false,
    build: (payload) => {
      const built = buildTrustedContext({
        documents: [
          { category: "other", fileName: "appendix.txt", content: payload },
        ],
      });
      return { message: built.userMessage, system: systemOf(built) };
    },
  },
  {
    name: "generation: sole transcript part",
    pipeline: "generation",
    guidance: CONTEXT_INPUTS_GUIDANCE,
    blockLabel: CONTEXT_SCAFFOLDS.transcriptLabel,
    hasSystem: false,
    build: (payload) => {
      const built = buildTrustedContext({
        transcriptParts: [{ label: "Interview transcript", content: payload }],
      });
      return { message: built.userMessage, system: systemOf(built) };
    },
  },
  {
    name: "chat: attached context document",
    pipeline: "chat",
    guidance: CHAT_EVIDENCE_GUIDANCE,
    blockLabel: ANALYZER_CATEGORY_LABELS.other,
    headingBefore: EVIDENCE_LABELS.documentsHeading,
    hasSystem: true,
    build: (payload) =>
      chat({
        documents: [
          { fileName: "appendix.txt", content: payload, category: "other" },
        ],
      }),
  },
  {
    name: "chat: current report",
    pipeline: "chat",
    guidance: CHAT_EVIDENCE_GUIDANCE,
    blockLabel: EVIDENCE_LABELS.report,
    hasSystem: true,
    build: (payload) => chat({ reportContent: proseMirrorDoc(payload) }),
  },
  {
    name: "chat: transcript analysis",
    pipeline: "chat",
    guidance: CHAT_EVIDENCE_GUIDANCE,
    blockLabel: EVIDENCE_LABELS.analysis,
    hasSystem: true,
    build: (payload) =>
      chat({ agentOutputs: JSON.stringify({ analyzer: payload }) }),
  },
  /**
   * `buildChatTurnRequest` reaches the report and analysis blocks only through
   * `extractPlainText` and `JSON.stringify`, which reflow the payload and (for
   * the analysis) collapse it onto one escaped line. The two slots below hand
   * `buildChatEvidence` the raw multi-line strings its own signature takes, so
   * a forgery that needs a line of its own is exercised in these blocks rather
   * than only in the document and transcript ones.
   */
  {
    name: "chat evidence: raw report text",
    pipeline: "chat",
    guidance: CHAT_EVIDENCE_GUIDANCE,
    blockLabel: EVIDENCE_LABELS.report,
    hasSystem: false,
    build: (payload) => chatEvidence(payload, BENIGN_COUNTERPART),
  },
  {
    name: "chat evidence: raw analysis text",
    pipeline: "chat",
    guidance: CHAT_EVIDENCE_GUIDANCE,
    blockLabel: EVIDENCE_LABELS.analysis,
    hasSystem: false,
    build: (payload) => chatEvidence(BENIGN_COUNTERPART, payload),
  },
  {
    // The fourth chat evidence source. Its `target` is report text and its
    // `candidate` is prior model output, so both are attacker-influenceable.
    // Only `target` carries the payload: putting it in both fields would put
    // the canary in the block twice and defeat the uniqueness clause of
    // `expectContained`, which is what proves the payload did not escape and
    // reappear somewhere else in the message.
    name: "chat: prior edit decisions",
    pipeline: "chat",
    guidance: CHAT_EVIDENCE_GUIDANCE,
    blockLabel: EVIDENCE_LABELS.decisions,
    hasSystem: true,
    build: (payload) =>
      chat({
        decisions: [
          { state: "pending", target: payload, candidate: BENIGN_COUNTERPART },
        ],
      }),
  },
];

// --- The containment predicate ----------------------------------------------

/**
 * Anything a model reading the prompt could take for one of our delimiters:
 * a run of three or more dashes (hyphen-minus, the Unicode dash block, or the
 * minus sign) followed by BEGIN or END and an opening bracket, in any case,
 * anywhere on a line. Deliberately as tolerant as `neutralizeMarkers` itself
 * rather than as strict as the scaffolds we emit, because the claim under test
 * is that no forgery survives in a shape a model would honour. A stricter
 * regex here would count a lower-case or em-dash forgery as ordinary prose and
 * quietly bless it.
 */
const MARKER_LINE =
  /[-\u2010-\u2015\u2212]{3,}[ \t]*(BEGIN|END)[ \t]*\[([^\]\n]*)\]?[^\n]*/gi;

interface Marker {
  text: string;
  kind: string;
  /** What the marker claims to delimit: the text between its brackets. */
  label: string;
  index: number;
}

function markerLines(message: string): Marker[] {
  return [...message.matchAll(MARKER_LINE)].map((m) => ({
    text: m[0],
    kind: m[1].toUpperCase(),
    label: m[2],
    index: m.index ?? -1,
  }));
}

/**
 * The whole suite in one function: a canary appears exactly once, and the
 * nearest marker line above it opens a block rather than closing one. A
 * forgery that closed its wrapper early would leave the canary after an END,
 * which is precisely what this rejects.
 */
function expectContained(message: string, canary: string, label: string): void {
  const at = message.indexOf(canary);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(message.indexOf(canary, at + 1)).toBe(-1);
  const markers = markerLines(message);
  const before = markers.filter((m) => m.index < at).at(-1);
  const after = markers.find((m) => m.index > at);
  // The enclosing block is the one this source is supposed to occupy, and it
  // closes under the same label it opened: a payload sitting between
  // `BEGIN [A]` and `END [B]` is inside no block anyone can reason about.
  // Asserted as one interpolated string so a failure names the canary and what
  // actually enclosed it rather than reporting `undefined is not "BEGIN"`.
  expect(`${canary} in ${before?.kind}:${before?.label}..${after?.kind}:${after?.label}`).toBe(
    `${canary} in BEGIN:${label}..END:${label}`
  );
}

/**
 * Containment of the payload, not only of its canary.
 *
 * The canary is one token; the assertions built on it prove where that token
 * landed and nothing about the rest of the payload. Two of the four attack
 * families — role spoofing and the tool-call fence — are made of lines the
 * marker oracle deliberately does not recognise (`System:`, `<|im_start|>`,
 * a ```` ```function_call ```` fence), so "the fixture opened no marker" is
 * satisfied for them without anything having looked at those lines at all.
 * This closes that: every payload line the assembled message still carries
 * verbatim must sit inside a block, under the block's own label.
 *
 * Lines the pipeline rewrote (a neutralized forgery) or escaped (the analysis
 * block's `JSON.stringify`) are simply absent and cannot be located, so the
 * floor below keeps the check from passing on an empty set.
 */
function expectPayloadLinesContained(
  message: string,
  content: string,
  label: string
): void {
  const markers = markerLines(message);
  let found = 0;
  for (const line of significantLines(content)) {
    // Every occurrence, not the first: a line rendered both inside its block
    // and again outside it would otherwise be cleared by the in-block one.
    for (const at of occurrences(message, line)) {
      found += 1;
      const before = markers.filter((m) => m.index < at).at(-1);
      expect(`${line} => ${before?.kind}:${before?.label}`).toBe(
        `${line} => BEGIN:${label}`
      );
    }
  }
  expect(found).toBeGreaterThan(0);
}

/**
 * A piece of scaffolding is present AND emitted outside every delimited block.
 *
 * A bare `toContain` searches the payload too, so a fixture that quotes the
 * scaffolding back — a realistic attack, since restating the policy or the
 * section heading is how a payload makes itself look authoritative — would
 * keep the assertion green even if the builder had stopped emitting the real
 * thing. Scaffolding the client cannot reach is exactly the text that sits
 * outside the markers, so that is what is asserted: an occurrence whose
 * nearest preceding marker is an END, or which has no marker before it at all.
 *
 * Returns those outside offsets, so a caller that also cares where the
 * scaffolding sits relative to the payload reasons about the real occurrence
 * rather than about one quoted from inside a block.
 */
function expectOutsideBlocks(message: string, scaffold: string): number[] {
  const markers = markerLines(message);
  expect(occurrences(message, scaffold).length).toBeGreaterThan(0);
  const outside = occurrences(message, scaffold).filter((at) => {
    const before = markers.filter((m) => m.index < at).at(-1);
    return before === undefined || before.kind === "END";
  });
  expect(outside.length).toBeGreaterThan(0);
  return outside;
}

/** Every offset at which `needle` occurs, not merely the first. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

/** Fixture lines long enough that an incidental match would be meaningless. */
function significantLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);
}

// --- Tests ------------------------------------------------------------------

describe("injection corpus", () => {
  it("discovers a non-empty corpus containing every named attack family", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    const names = fixtures.map((f) => f.name);
    for (const required of REQUIRED_FIXTURES) expect(names).toContain(required);
  });

  /**
   * `REQUIRED_FIXTURES` pins the file names and `canaryOf` pins the canaries,
   * but until this case nothing pinned the attack. A fixture edited down to
   * ordinary prose plus a canary kept the whole suite green, and with it went
   * the only coverage anywhere in the repo of a mid-line forgery driven
   * through the chat builder — the exact regression the story's own AC2
   * names. Assertion 4 below is only ever as strong as the forgeries the
   * corpus actually carries, so the corpus is required to carry some.
   */
  it("keeps at least one marker forgery, at least one of them mid-line", () => {
    const forged = fixtures.flatMap((fixture) =>
      markerLines(fixture.content).map((marker) => ({ fixture, marker }))
    );
    expect(forged.length).toBeGreaterThan(0);
    const midLine = forged.filter(
      ({ fixture, marker }) =>
        marker.index > fixture.content.lastIndexOf("\n", marker.index) + 1
    );
    // Column 0 is the easy case: line-anchoring `neutralizeMarkers` still
    // catches it. A forgery sharing a line with ordinary prose is what makes
    // that mutation fail, so one has to survive every future fixture edit.
    expect(midLine.length).toBeGreaterThan(0);
  });

  it("gives every fixture a unique canary on a line of its own", () => {
    const canaries = fixtures.map((f) => f.canary);
    expect(new Set(canaries).size).toBe(canaries.length);
    for (const fixture of fixtures) {
      expect(fixture.content.split(fixture.canary)).toHaveLength(2);
    }
  });
});

describe.each(slots)("$name", (slot) => {
  const control = slot.build(BENIGN);

  it("contains the benign control payload", () => {
    expectContained(control.message, BENIGN_CANARY, slot.blockLabel);
    expectPayloadLinesContained(control.message, BENIGN, slot.blockLabel);
    expectOutsideBlocks(control.message, slot.guidance);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    "contains %s",
    (_name, fixture) => {
      const built = slot.build(fixture.content);

      // 1. The payload lands inside the delimited data block this source is
      //    supposed to occupy, and every payload line the message still
      //    carries verbatim lands there with it.
      expectContained(built.message, fixture.canary, slot.blockLabel);
      expectPayloadLinesContained(built.message, fixture.content, slot.blockLabel);

      // 2. That block sits under the heading its pipeline files it under —
      //    the heading the builder emitted, not one the fixture quoted from
      //    inside its own block.
      if (slot.headingBefore !== undefined) {
        const headings = expectOutsideBlocks(built.message, slot.headingBefore);
        expect(Math.min(...headings)).toBeLessThan(
          built.message.indexOf(fixture.canary)
        );
      }

      // 3. The guidance that makes the markers mean something is present as
      //    scaffolding, not merely quoted back from inside a block.
      expectOutsideBlocks(built.message, slot.guidance);

      // 4. The payload opened and closed no marker of its own: the assembled
      //    message carries exactly the markers the benign control does.
      expect(markerLines(built.message).map((m) => m.text)).toEqual(
        markerLines(control.message).map((m) => m.text)
      );

      // 5. Turn assembly only: the system string has one source, never a
      //    fixture byte. `buildChatEvidence` returns no system string at all.
      if (slot.hasSystem) {
        expect(built.system).not.toBeNull();
        expect(built.system).not.toContain(fixture.canary);
        const lines = significantLines(fixture.content);
        // A fixture of only short lines would make the loop below iterate
        // zero times and assert nothing at all.
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(built.system).not.toContain(line);
        }
      } else {
        // Declared systemless. If the builder ever grows a system string, it
        // must be enrolled in the leak check above rather than skipped here.
        expect(built.system).toBeNull();
      }
    }
  );
});

/**
 * The predicate is the whole suite, so nothing above can tell the difference
 * between "every slot contains its payload" and "the predicate cannot fail".
 * These two cases pin it down permanently, where the mutation runs that
 * proved it at review time cannot.
 */
describe("the containment predicate itself", () => {
  const contained = `--- BEGIN [X] ---\n${BENIGN}\n--- END [X] ---`;

  it("rejects a payload that no block encloses", () => {
    expect(() => expectContained(BENIGN, BENIGN_CANARY, "X")).toThrow();
    expect(() =>
      expectContained(`${contained}\n${BENIGN_CANARY}`, BENIGN_CANARY, "X")
    ).toThrow();
  });

  it("rejects payload lines outside their block, or with nothing to check", () => {
    // No block at all, then the right block under the wrong label, then a
    // payload whose every line is too short to be located: the floor exists
    // so that last one cannot pass by finding nothing.
    expect(() => expectPayloadLinesContained(BENIGN, BENIGN, "X")).toThrow();
    expect(() => expectPayloadLinesContained(contained, BENIGN, "Y")).toThrow();
    // Contained once and leaked once: checking only the first occurrence would
    // clear this, which is why every occurrence is enumerated.
    expect(() =>
      expectPayloadLinesContained(`${contained}\n${BENIGN}`, BENIGN, "X")
    ).toThrow();
    expect(() =>
      expectPayloadLinesContained(contained, "short\nlines\n", "X")
    ).toThrow();
  });

  it("rejects a payload enclosed by the wrong block, and guidance inside one", () => {
    expect(() => expectContained(contained, BENIGN_CANARY, "Y")).toThrow();
    expect(() =>
      expectOutsideBlocks(
        `--- BEGIN [X] ---\n${CHAT_EVIDENCE_GUIDANCE}\n--- END [X] ---`,
        CHAT_EVIDENCE_GUIDANCE
      )
    ).toThrow();
  });
});

describe("determinism", () => {
  it("builds byte-identical output for the same corpus twice", () => {
    const payloads = [...fixtures.map((f) => f.content), BENIGN];
    for (const slot of slots) {
      for (const payload of payloads) {
        const first = slot.build(payload);
        const second = slot.build(payload);
        expect(second.message).toBe(first.message);
        expect(second.system).toBe(first.system);
      }
    }
  });
});
