import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { getEditorExtensions } from "../../tiptapConfig";
import { Schema } from "@tiptap/pm/model";
import {
  buildSearchIndex,
  findAllOccurrencesCI,
  findOccurrencesBatch,
  normalizeForMatch,
  type Range,
} from "./docSearch";

/**
 * PERF-1. The GOLDEN literals below were captured from the pre-move
 * `findAllOccurrencesCI` inside `Editor.svelte` at commit 184d376 (its `src/`
 * tree is byte-identical to 11bfe3e) with the benchmark's module-extraction
 * method, by `.audit/perf-1-parser-timers-editor-index/capture-goldens.mjs`.
 * Asserting the batch only against a freshly extracted per-call function would
 * let both agree on the same regression; these are what the old code returned.
 *
 * The traversal and case-fold counts are the optimisation itself: a batch walks
 * the document once, folds the haystack once, and does neither when it has
 * nothing to search for.
 */

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});

const FIXTURE_PARAGRAPHS = [
  "The system evaluated thermal stability against the measured reference.",
  "The System evaluated thermal stability under a sustained load.",
  "We used “curly quotes” and it’s fine here.",
  "Range 10–20 and em—dash usage appear here.",
  "Repeated   whitespace   collapses\tin matching.",
  "A phrase that starts here",
  "and ends there in the next block.",
  "Duplicate phrase marker.",
  "Duplicate phrase marker again.",
  "Experiment 1: thermal cycling of the coupon.",
  "Experiment 2: fatigue loading of the bracket.",
  "Experiment 3: corrosion exposure of the panel.",
  "Experiment 4: vibration sweep of the housing.",
  "Experiment 5: creep testing of the fastener.",
  "Experiment 6: impact testing of the shell.",
  "Experiment 7: acoustic damping of the mount.",
  "Experiment 8: thermal shock of the seal.",
  "Experiment 9: pressure decay of the vessel.",
  "Experiment 10: flow calibration of the nozzle.",
];

const CORPUS_NEEDLES = [
  "The system evaluated thermal stability",
  "\"curly quotes\"",
  "it's fine",
  "10-20",
  "em-dash usage",
  "Repeated whitespace collapses in matching",
  "starts here and ends there",
  "Duplicate phrase marker",
  "nowhere to be found",
  "the measured reference",
  "Experiment 1:",
  "Experiment 2:",
  "Experiment 3:",
  "Experiment 4:",
  "Experiment 5:",
  "Experiment 6:",
  "Experiment 7:",
  "Experiment 8:",
  "Experiment 9:",
  "Experiment 10:",
];

/** Exactly what the pre-move implementation returned for each corpus needle. */
const GOLDEN: Record<string, Range[]> = {
  ["The system evaluated thermal stability"]: [
    { from: 1, to: 39, text: "The system evaluated thermal stability" },
    { from: 73, to: 111, text: "The System evaluated thermal stability" },
  ],
  ["\"curly quotes\""]: [
    { from: 145, to: 159, text: "“curly quotes”" },
  ],
  ["it's fine"]: [
    { from: 164, to: 173, text: "it’s fine" },
  ],
  ["10-20"]: [
    { from: 187, to: 192, text: "10–20" },
  ],
  ["em-dash usage"]: [
    { from: 197, to: 210, text: "em—dash usage" },
  ],
  ["Repeated whitespace collapses in matching"]: [
    { from: 225, to: 270, text: "Repeated   whitespace   collapses\tin matching" },
  ],
  ["starts here and ends there"]: [
    { from: 287, to: 314, text: "starts here and ends there" },
  ],
  ["Duplicate phrase marker"]: [
    { from: 335, to: 358, text: "Duplicate phrase marker" },
    { from: 361, to: 384, text: "Duplicate phrase marker" },
  ],
  ["nowhere to be found"]: [],
  ["the measured reference"]: [
    { from: 48, to: 70, text: "the measured reference" },
  ],
  ["Experiment 1:"]: [
    { from: 393, to: 406, text: "Experiment 1:" },
  ],
  ["Experiment 2:"]: [
    { from: 439, to: 452, text: "Experiment 2:" },
  ],
  ["Experiment 3:"]: [
    { from: 486, to: 499, text: "Experiment 3:" },
  ],
  ["Experiment 4:"]: [
    { from: 534, to: 547, text: "Experiment 4:" },
  ],
  ["Experiment 5:"]: [
    { from: 581, to: 594, text: "Experiment 5:" },
  ],
  ["Experiment 6:"]: [
    { from: 627, to: 640, text: "Experiment 6:" },
  ],
  ["Experiment 7:"]: [
    { from: 671, to: 684, text: "Experiment 7:" },
  ],
  ["Experiment 8:"]: [
    { from: 717, to: 730, text: "Experiment 8:" },
  ],
  ["Experiment 9:"]: [
    { from: 759, to: 772, text: "Experiment 9:" },
  ],
  ["Experiment 10:"]: [
    { from: 804, to: 818, text: "Experiment 10:" },
  ],
  [""]: [],
  ["   "]: [],
};

function fixtureDoc() {
  return schema.node(
    "doc",
    null,
    FIXTURE_PARAGRAPHS.map((t) => schema.node("paragraph", null, schema.text(t)))
  );
}

/** Count full-document walks on this doc instance, not on the prototype:
 * `findAllInDoc` in Editor.svelte walks for its own reasons, so a prototype
 * spy could not attribute a traversal to the batch. */
function countingDoc() {
  const doc = fixtureDoc();
  const walk = doc.descendants.bind(doc);
  const counter = { traversals: 0 };
  doc.descendants = (...args: Parameters<typeof walk>) => {
    counter.traversals++;
    return walk(...args);
  };
  return { doc, counter };
}

/** Count case-folds of the whole haystack, ignoring the per-needle folds. */
function countHaystackFolds(hayLength: number, run: () => void) {
  const original = String.prototype.toLowerCase;
  let folds = 0;
  String.prototype.toLowerCase = function (this: string) {
    if (this.length === hayLength) folds++;
    return original.call(this);
  };
  try {
    run();
  } finally {
    String.prototype.toLowerCase = original;
  }
  return folds;
}

describe("docSearch golden behaviour", () => {
  it("findAllOccurrencesCI returns the pre-move ranges for every corpus needle", () => {
    const doc = fixtureDoc();
    for (const needle of [...CORPUS_NEEDLES, "", "   "]) {
      expect(findAllOccurrencesCI(doc, needle), `needle: ${JSON.stringify(needle)}`).toEqual(
        GOLDEN[needle]
      );
    }
  });

  it("every findOccurrencesBatch slot equals the pre-move ranges", () => {
    const doc = fixtureDoc();
    const finds = [...CORPUS_NEEDLES, "", "   "];
    expect(findOccurrencesBatch(doc, finds)).toEqual(finds.map((n) => GOLDEN[n]));
  });

  it("two identical needles in one batch return equal arrays", () => {
    const doc = fixtureDoc();
    const [a, b] = findOccurrencesBatch(doc, ["Duplicate phrase marker", "Duplicate phrase marker"]);
    expect(a).toEqual(b);
    expect(a).toEqual(GOLDEN["Duplicate phrase marker"]);
  });

  it("normalizeForMatch and buildSearchIndex keep normalized offsets aligned", () => {
    const doc = fixtureDoc();
    const { hay, posMap } = buildSearchIndex(doc);
    expect(hay.length).toBe(posMap.length);
    expect(normalizeForMatch("a\u2018b\u201Cc\u2013d   e")).toBe("a'b\"c-d e");
  });

  it("preserves blank and duplicate slots among ordinary needles", () => {
    const finds = ["", "Duplicate phrase marker", "   ", "10-20", "Duplicate phrase marker"];
    expect(findOccurrencesBatch(fixtureDoc(), finds)).toEqual(finds.map((n) => GOLDEN[n]));
  });

  it("keeps non-overlapping ranges and positions across empty paragraphs", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("aaaa")),
      schema.node("paragraph"),
      schema.node("paragraph"),
      schema.node("paragraph", null, schema.text("End")),
    ]);
    expect(findOccurrencesBatch(doc, ["aa", "aaaa\n\nEnd"])).toEqual([
      [{ from: 1, to: 3, text: "aa" }, { from: 3, to: 5, text: "aa" }],
      [{ from: 1, to: 14, text: "aaaa   End" }],
    ]);
  });

  it("retains the trimmed needle if reading the matched text fails", () => {
    const doc = fixtureDoc();
    doc.textBetween = () => { throw new Error("unavailable text"); };
    expect(findAllOccurrencesCI(doc, "  10-20  ")).toEqual([
      { from: 187, to: 192, text: "10-20" },
    ]);
  });
});

describe("docSearch batch cost", () => {
  it("does not walk the document for an empty batch", () => {
    const { doc, counter } = countingDoc();
    const hayLength = buildSearchIndex(fixtureDoc()).hay.length;
    const folds = countHaystackFolds(hayLength, () => {
      expect(findOccurrencesBatch(doc, [])).toEqual([]);
    });
    expect(counter.traversals).toBe(0);
    expect(folds).toBe(0);
  });

  it("does not walk the document when every needle normalises to empty", () => {
    const { doc, counter } = countingDoc();
    const hayLength = buildSearchIndex(fixtureDoc()).hay.length;
    const folds = countHaystackFolds(hayLength, () => {
      expect(findOccurrencesBatch(doc, ["", "   "])).toEqual([[], []]);
    });
    expect(counter.traversals).toBe(0);
    expect(folds).toBe(0);
  });

  it("walks the document once for a 20-needle batch", () => {
    const { doc, counter } = countingDoc();
    expect(CORPUS_NEEDLES).toHaveLength(20);
    findOccurrencesBatch(doc, CORPUS_NEEDLES);
    expect(counter.traversals).toBe(1);
  });

  it("walks the document once for 19 real needles plus a whitespace needle", () => {
    const { doc, counter } = countingDoc();
    const finds = [...CORPUS_NEEDLES.slice(0, 19), "   "];
    const result = findOccurrencesBatch(doc, finds);
    expect(counter.traversals).toBe(1);
    expect(result[19]).toEqual([]);
    expect(result.slice(0, 19)).toEqual(finds.slice(0, 19).map((n) => GOLDEN[n]));
  });

  it("case-folds the whole haystack once for a 20-needle batch", () => {
    const doc = fixtureDoc();
    const hayLength = buildSearchIndex(doc).hay.length;
    // The counter distinguishes this fixture haystack from the shorter needles.
    expect(CORPUS_NEEDLES.every((needle) => normalizeForMatch(needle).length < hayLength)).toBe(true);
    const folds = countHaystackFolds(hayLength, () => {
      findOccurrencesBatch(doc, CORPUS_NEEDLES);
    });
    expect(folds).toBe(1);
  });
});


describe.each([true, false])("actual editor schema (editable=%s)", (editable) => {
  const actualSchema = getSchema(getEditorExtensions({ editable }));
  const text = (value: string) => actualSchema.text(value);
  const br = () => actualSchema.node("hardBreak");
  const paragraph = (content: Parameters<typeof actualSchema.node>[2] = []) =>
    actualSchema.node("paragraph", null, content);
  const document = (content: Parameters<typeof actualSchema.node>[2]) => {
    const doc = actualSchema.node("doc", null, content);
    doc.check();
    return doc;
  };

  it.each(["İ target tail", "İ target"])("maps expansion before target in %s", (value) => {
    expect(findAllOccurrencesCI(document([paragraph([text(value)])]), "target")).toEqual([
      { from: 3, to: 9, text: "target" },
    ]);
  });

  it("keeps the first non-overlapping original span after repeated expansion", () => {
    const doc = document([paragraph([text("İİİİİ")])]);
    expect(findAllOccurrencesCI(doc, "\u0307i")).toEqual([
      { from: 1, to: 3, text: "İİ" },
      { from: 3, to: 5, text: "İİ" },
    ]);
    expect(findAllOccurrencesCI(doc, "i")).toEqual(
      [1, 2, 3, 4, 5].map((from) => ({ from, to: from + 1, text: "İ" }))
    );
  });

  it("continues one folded unit after rejected overlap to keep later valid spans", () => {
    const doc = document([paragraph([text("İİİİİİ")])]);
    expect(findAllOccurrencesCI(doc, "\u0307i\u0307i")).toEqual([
      { from: 1, to: 4, text: "İİİ" },
      { from: 4, to: 7, text: "İİİ" },
    ]);
  });

  it("retains hard-break boundaries in headings, list items and blockquotes", () => {
    const content = () => [text("alpha"), br(), text("beta")];
    const doc = document([
      actualSchema.node("heading", { level: 2 }, content()),
      actualSchema.node("bulletList", null, [
        actualSchema.node("listItem", null, [paragraph(content())]),
      ]),
      actualSchema.node("blockquote", null, [paragraph(content())]),
    ]);
    expect(findOccurrencesBatch(doc, ["alphabeta", "alpha beta"])).toEqual([
      [], [
        { from: 1, to: 11, text: "alpha beta" },
        { from: 15, to: 25, text: "alpha beta" },
        { from: 30, to: 40, text: "alpha beta" },
      ],
    ]);
  });

  it("never splits supplementary characters for malformed surrogate needles", () => {
    const doc = document([paragraph([text("😀😀")])]);
    for (const needle of ["\ud83d", "\ude00"]) {
      expect(findAllOccurrencesCI(doc, needle)).toEqual([
        { from: 1, to: 3, text: "😀" }, { from: 3, to: 5, text: "😀" },
      ]);
    }
    expect(findAllOccurrencesCI(doc, "\ude00\ud83d")).toEqual([
      { from: 1, to: 5, text: "😀😀" },
    ]);
  });

  it("retains contextual sigma across hard breaks and paragraphs", () => {
    const doc = document([
      paragraph([text("ΟΣ"), br(), text("Α")]),
      paragraph([text("ΟΣ")]), paragraph([text("Α")]),
    ]);
    expect(findAllOccurrencesCI(doc, "ΟΣ Α")).toEqual([
      { from: 1, to: 5, text: "ΟΣ Α" },
      { from: 7, to: 12, text: "ΟΣ Α" },
    ]);
    expect(findAllOccurrencesCI(doc, "οσ α")).toEqual([]);
  });

  it("maps expanded units and supplementary letters to complete original spans", () => {
    const doc = document([paragraph([text("İ 😀 𐐀Z")])]);
    expect(findOccurrencesBatch(doc, ["İ", "i", "\u0307", "😀", "𐐨z", "i\u0307 😀", "", "İ"])).toEqual([
      [{ from: 1, to: 2, text: "İ" }],
      [{ from: 1, to: 2, text: "İ" }],
      [{ from: 1, to: 2, text: "İ" }],
      [{ from: 3, to: 5, text: "😀" }],
      [{ from: 6, to: 9, text: "𐐀Z" }],
      [{ from: 1, to: 5, text: "İ 😀" }],
      [],
      [{ from: 1, to: 2, text: "İ" }],
    ]);
  });

  it("retains whole-string final sigma context across marks", () => {
    const doc = document([paragraph([
      text("İ Ο"), actualSchema.text("Σ", [actualSchema.mark("bold")]), text(" ΟΣΑ"),
    ])]);
    expect(findOccurrencesBatch(doc, ["ΟΣ", "οσ", "ΟΣΑ"])).toEqual([
      [{ from: 3, to: 5, text: "ΟΣ" }],
      [{ from: 6, to: 8, text: "ΟΣ" }],
      [{ from: 6, to: 9, text: "ΟΣΑ" }],
    ]);
  });

  it("separates hard breaks and returns their whitespace representation", () => {
    const doc = document([paragraph([text("alpha"), br(), text("beta")])]);
    expect(buildSearchIndex(doc)).toEqual({ hay: "alpha beta", posMap: [1, 2, 3, 4, 5, 7, 7, 8, 9, 10] });
    expect(findOccurrencesBatch(doc, ["alphabeta", "alpha beta", "alpha\nbeta"])).toEqual([
      [], [{ from: 1, to: 11, text: "alpha beta" }], [{ from: 1, to: 11, text: "alpha beta" }],
    ]);
  });

  it("collapses repeated boundaries without leading or trailing spans", () => {
    const doc = document([
      paragraph([br(), text(" alpha "), br(), br()]), paragraph(),
      paragraph([br(), text(" beta "), br()]),
    ]);
    expect(buildSearchIndex(doc).hay).toBe("alpha beta");
    expect(findOccurrencesBatch(doc, [" alpha beta ", "beta", "alphabeta"])).toEqual([
      [{ from: 3, to: 21, text: "alpha       beta" }],
      [{ from: 17, to: 21, text: "beta" }], [],
    ]);
  });

  it("preserves horizontal-rule extraction and ordinary casing", () => {
    const doc = document([paragraph([text("Alpha")]), actualSchema.node("horizontalRule"), paragraph([text("Beta")])]);
    expect(findAllOccurrencesCI(doc, "alpha beta")).toEqual([{ from: 1, to: 13, text: "Alpha Beta" }]);
  });

  it("folds a single expanding code point only once for the haystack", () => {
    const doc = document([paragraph([text("İ")])]);
    const original = String.prototype.toLowerCase;
    let haystackFolds = 0;
    String.prototype.toLowerCase = function (this: string) {
      if (String(this) === "İ") haystackFolds++;
      return original.call(this);
    };
    try {
      expect(findAllOccurrencesCI(doc, "i\u0307")).toEqual([{ from: 1, to: 2, text: "İ" }]);
    } finally {
      String.prototype.toLowerCase = original;
    }
    expect(haystackFolds).toBe(1);
  });

  it("walks once for mixed boundary batches and never for blank batches", () => {
    const doc = document([paragraph([text("İ alpha"), br(), text("beta")])]);
    const walk = doc.descendants.bind(doc);
    let traversals = 0;
    doc.descendants = (...args: Parameters<typeof walk>) => { traversals++; return walk(...args); };
    expect(findOccurrencesBatch(doc, ["", " "])).toEqual([[], []]);
    expect(traversals).toBe(0);
    const finds = Array.from({ length: 20 }, () => "alpha beta");
    expect(findOccurrencesBatch(doc, finds)).toEqual(finds.map(() => [{ from: 3, to: 13, text: "alpha beta" }]));
    expect(traversals).toBe(1);
  });
});
