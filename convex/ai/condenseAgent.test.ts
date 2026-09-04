import { describe, expect, it } from "vitest";
import {
  CONDENSE_CONCURRENCY,
  CONDENSE_SCHEMA,
  CONDENSE_SYSTEM_PROMPT,
  CONDENSE_TIMEOUT_MS,
  condenseUserMessage,
  fitsCondenseBudget,
  joinDigestParts,
  renderDigest,
  splitIntoWindows,
  type TranscriptDigest,
} from "./condenseAgent";
import { sha256 } from "../lib/contracts";
import { CONDENSE_VERSION } from "../lib/transcripts";

const emptyDigest: TranscriptDigest = {
  participants: [],
  timeline: [],
  technologicalUncertainties: [],
  hypotheses: [],
  experiments: [],
  resultsAndNumbers: [],
  namesAndSystems: [],
  keyQuotes: [],
};

describe("splitIntoWindows (AC4)", () => {
  it("returns the text untouched when it fits one window", () => {
    expect(splitIntoWindows("short body", 100)).toEqual(["short body"]);
    const exact = "x".repeat(100);
    expect(splitIntoWindows(exact, 100)).toEqual([exact]);
  });

  it("cuts at paragraph boundaries, never mid-paragraph", () => {
    const paragraphs = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];
    const windows = splitIntoWindows(paragraphs.join("\n\n"), 90);
    expect(windows).toEqual([`${paragraphs[0]}\n\n${paragraphs[1]}`, paragraphs[2]]);
    for (const window of windows) expect(window.length).toBeLessThanOrEqual(90);
  });

  it("keeps every character of the original", () => {
    const text = Array.from({ length: 20 }, (_, i) => `${i}`.repeat(30)).join("\n\n");
    expect(splitIntoWindows(text, 100).join("\n\n")).toBe(text);
  });

  it("hard-splits a single paragraph longer than the window", () => {
    const windows = splitIntoWindows("y".repeat(25), 10);
    expect(windows).toEqual(["y".repeat(10), "y".repeat(10), "y".repeat(5)]);
  });

  it("rejects a window size below one character", () => {
    expect(() => splitIntoWindows("body", 0)).toThrow(/at least 1/);
  });
});

describe("renderDigest and the part markers (AC4)", () => {
  it("renders every populated section, and only those, in a fixed order", () => {
    const digest: TranscriptDigest = {
      ...emptyDigest,
      participants: ["Dana Osei, CTO, Northwind Robotics"],
      technologicalUncertainties: ["Whether the gripper could hold at 4 kg"],
      experiments: [
        {
          problem: "Slip above 3 kg",
          approach: "Raised clamp pressure in 5 kPa steps",
          result: "Slip at 3.4 kg",
          conclusion: "Pressure alone is not enough",
          dates: "2026-03-04 to 2026-03-18",
        },
      ],
      keyQuotes: ["we had no idea whether the seal would hold at all"],
    };
    expect(renderDigest(digest)).toBe(
      "## Participants\n- Dana Osei, CTO, Northwind Robotics\n\n" +
        "## Technological uncertainties\n- Whether the gripper could hold at 4 kg\n\n" +
        "## Experiments\n### Experiment 1\n" +
        "- Problem: Slip above 3 kg\n" +
        "- Approach: Raised clamp pressure in 5 kPa steps\n" +
        "- Result: Slip at 3.4 kg\n" +
        "- Conclusion: Pressure alone is not enough\n" +
        "- Dates: 2026-03-04 to 2026-03-18\n\n" +
        "## Key quotes\n- we had no idea whether the seal would hold at all"
    );
  });

  it("keeps quotes verbatim so a claim can still be located in the digest", () => {
    const quote = 'He said: "the 4.2 ms latency was the wall we kept hitting"';
    expect(renderDigest({ ...emptyDigest, keyQuotes: [quote] })).toContain(quote);
  });

  it("says so rather than rendering nothing when a window carried no content", () => {
    expect(renderDigest(emptyDigest)).toBe("(no SR&ED content found)");
  });

  it("passes a single window through and marks a multi-window digest", () => {
    expect(joinDigestParts(["only"])).toBe("only");
    expect(joinDigestParts(["one", "two", "three"])).toBe(
      "--- part 1 of 3 ---\none\n\n" +
        "--- part 2 of 3 ---\ntwo\n\n" +
        "--- part 3 of 3 ---\nthree"
    );
  });
});

describe("condenseUserMessage", () => {
  it("names the transcript, and the window only when there is more than one", () => {
    const single = condenseUserMessage({
      text: "body",
      label: "Kickoff.docx",
      part: 1,
      totalParts: 1,
    });
    expect(single).toBe('Interview transcript "Kickoff.docx":\n\nbody');
    expect(single).not.toContain("window");

    const windowed = condenseUserMessage({
      text: "body",
      label: "Kickoff.docx",
      part: 2,
      totalParts: 3,
    });
    expect(windowed).toContain('"Kickoff.docx", window 2 of 3');
    expect(windowed.endsWith("body")).toBe(true);
  });
});

describe("fitsCondenseBudget", () => {
  const perCallMs = CONDENSE_TIMEOUT_MS;
  const concurrency = CONDENSE_CONCURRENCY;

  it("passes when there is nothing to condense", () => {
    expect(
      fitsCondenseBudget({ windows: 0, concurrency, perCallMs, remainingMs: 0 })
    ).toBe(true);
  });

  it("is exact at the boundary: one wave fits its own timeout, not a ms less", () => {
    expect(
      fitsCondenseBudget({
        windows: concurrency,
        concurrency,
        perCallMs,
        remainingMs: perCallMs,
      })
    ).toBe(true);
    expect(
      fitsCondenseBudget({
        windows: concurrency,
        concurrency,
        perCallMs,
        remainingMs: perCallMs - 1,
      })
    ).toBe(false);
  });

  it("charges a partial wave in full", () => {
    expect(
      fitsCondenseBudget({
        windows: concurrency + 1,
        concurrency,
        perCallMs,
        remainingMs: 2 * perCallMs,
      })
    ).toBe(true);
    expect(
      fitsCondenseBudget({
        windows: concurrency + 1,
        concurrency,
        perCallMs,
        remainingMs: 2 * perCallMs - 1,
      })
    ).toBe(false);
  });

  it("refuses work it could never start", () => {
    expect(
      fitsCondenseBudget({ windows: 1, concurrency: 0, perCallMs, remainingMs: 1e9 })
    ).toBe(false);
    expect(
      fitsCondenseBudget({ windows: 1, concurrency, perCallMs, remainingMs: -1 })
    ).toBe(false);
  });
});

describe("the condense contract is pinned to CONDENSE_VERSION", () => {
  /**
   * Stored digests are reused on `(transcriptId, sourceContentHash,
   * condenseVersion)` alone, so a changed prompt or schema with the old version
   * would serve digests built under a contract that no longer exists.
   *
   * If this fails, you changed the condense prompt or its schema. Bump
   * CONDENSE_VERSION in convex/lib/transcripts.ts and update BOTH literals
   * below in the same commit (transcripts-7-condense-digests).
   */
  it("fails loud when the prompt or the schema changes without a version bump", async () => {
    const hash = await sha256(
      `${CONDENSE_SYSTEM_PROMPT}\n${JSON.stringify(CONDENSE_SCHEMA)}`
    );
    expect(CONDENSE_VERSION).toBe("1");
    expect(hash).toBe("2e3bb9ecf542a5320359ce3944a528dfac703c03536ad0525999fb03019f04c3");
  });
});
