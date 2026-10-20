import { describe, expect, it } from "vitest";
import {
  CITATION_KEY_MARK,
  citationKey,
  citationNumber,
  citationSources,
  markCitations,
  turnWebSources,
  webSearchesByOrder,
  webSearchTraceLabel,
  withWebSearchLabels,
  type TurnWebSearch,
} from "./webSources";

const K = (n: number) => `${CITATION_KEY_MARK}${n}`;
const source = (n: number, domain = "example.org") => ({ n, url: `https://${domain}/${n}`, title: `Title ${n}`, domain });
const search = (promptMessageId: string, ns: number[], extra: Partial<TurnWebSearch> = {}): TurnWebSearch => ({
  promptMessageId,
  query: "What is a Kalman filter?",
  status: "ok",
  sources: ns.map((n) => source(n)),
  ...extra,
});

describe("markCitations", () => {
  const numbers = new Set([1, 2, 3]);

  it("keys this turn's numbers in single, grouped and adjacent citations", () => {
    expect(markCitations("A filter estimates state [1].", numbers)).toBe(`A filter estimates state [${K(1)}].`);
    expect(markCitations("Both say so [1, 2].", numbers)).toBe(`Both say so [${K(1)} ${K(2)}].`);
    expect(markCitations("Both say so [1][3].", numbers)).toBe(`Both say so [${K(1)} ${K(3)}].`);
    expect(markCitations("Both say so [2] [3].", numbers)).toBe(`Both say so [${K(2)} ${K(3)}].`);
  });

  it("leaves gaps, inventory ids, other numbers, links and code exactly as written", () => {
    const untouched = [
      "[GAP: need 2 load results]",
      "Item [r-242-3] and [c-1] stay.",
      "A number the turn never gave [9].",
      "A link [1](https://example.org) and a reference [text][2].",
      "[1]: https://example.org",
      "Inline `[1]` code.",
      "```\nconst a = [1];\n```",
      "An escaped \\[2] bracket.",
      "No brackets at all.",
    ];
    for (const text of untouched) expect(markCitations(text, numbers), text).toBe(text);
    // With no sources nothing is touched at all.
    expect(markCitations("Cited [1].", new Set())).toBe("Cited [1].");
  });

  it("drops a number the turn never gave from a group that also cites a real one", () => {
    expect(markCitations("See [1, 9].", numbers)).toBe(`See [${K(1)}].`);
  });

  it("marks citations around code without touching the code", () => {
    expect(markCitations("Use `x[1]` here [2].\n```js\nlet y = [3];\n```\nDone [3].", numbers)).toBe(
      `Use \`x[1]\` here [${K(2)}].\n\`\`\`js\nlet y = [3];\n\`\`\`\nDone [${K(3)}].`
    );
  });
});

describe("citation keys and sources", () => {
  it("round-trips a number and refuses any other key", () => {
    expect(citationNumber(citationKey(4))).toBe(4);
    expect(citationNumber("4")).toBeNull();
    expect(citationNumber("GAP:")).toBeNull();
  });

  it("keys Streamdown sources so a bare number never matches", () => {
    const sources = citationSources([source(1), source(2)]);
    expect(Object.keys(sources)).toEqual([K(1), K(2)]);
    expect(sources["1"]).toBeUndefined();
  });
});

describe("grouping", () => {
  it("groups searches by their turn's order and lists one source per number", () => {
    const searches = [search("p1", [1, 2]), search("p2", [1]), search("p1", [2, 3]), search("gone", [1])];
    const grouped = webSearchesByOrder(searches, [
      { order: 4, promptMessageId: "p1" },
      { order: 7, promptMessageId: "p2" },
    ]);
    expect([...grouped.keys()]).toEqual([4, 7]);
    expect(turnWebSources(grouped.get(4)!).map((s) => s.n)).toEqual([1, 2, 3]);
  });
});

describe("withWebSearchLabels", () => {
  const node = (toolCallId: string, state = "output-available") => ({
    kind: "tool", toolName: "searchWeb", toolCallId, state, label: "Searched the web",
  });

  it("names a search that ran by its query and leaves the rest", () => {
    const nodes = [
      node("call-ok"),
      node("call-failed"),
      node("call-refused"),
      node("call-running", "input-available"),
      { kind: "tool", toolName: "searchBrain", toolCallId: "call-ok", state: "output-available", label: "Searched The Brain" },
      { kind: "reasoning", text: "…" },
    ];
    const labelled = withWebSearchLabels(nodes, [
      search("p", [1], { toolCallId: "call-ok", query: "Coriolis meter drift" }),
      search("p", [], { toolCallId: "call-failed", status: "failed" }),
      search("p", [2], { toolCallId: "call-running" }),
    ]);
    expect(labelled.map((n) => (n as { label?: string }).label)).toEqual([
      webSearchTraceLabel("Coriolis meter drift"),
      "Searched the web",
      "Searched the web",
      "Searched the web",
      "Searched The Brain",
      undefined,
    ]);
    expect(webSearchTraceLabel("Coriolis meter drift")).toBe("Searched the web: Coriolis meter drift");
  });
});
