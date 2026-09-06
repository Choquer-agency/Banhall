import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PROJECT_INTENT_LENGTH,
  PROJECT_INTENT_HANDOFF_TTL_MS,
  normalizeProjectIntent,
  stashProjectStart,
  takeProjectStart,
} from "./projectIntentHandoff";

describe("project start handoff", () => {
  beforeEach(() => {
    takeProjectStart(0);
  });

  it("normalizes the title and carries transcript intake once", () => {
    stashProjectStart(
      {
        title: "  Solar\n tracker   prototype  ",
        transcriptText: " Interview transcript ",
        transcriptFileName: " Teams interview.docx ",
      },
      1_000
    );
    expect(takeProjectStart(1_100)).toEqual({
      title: "Solar tracker prototype",
      transcriptText: "Interview transcript",
      transcriptFileName: "Teams interview.docx",
    });
    expect(takeProjectStart(1_200)).toEqual({
      title: "",
      transcriptText: "",
      transcriptFileName: null,
    });
  });

  it("bounds titles and round-trips a title-only handoff", () => {
    expect(normalizeProjectIntent("x".repeat(MAX_PROJECT_INTENT_LENGTH + 10))).toHaveLength(
      MAX_PROJECT_INTENT_LENGTH
    );
    stashProjectStart({ title: "Solar tracker prototype" }, 2_000);
    expect(takeProjectStart(2_100).title).toBe("Solar tracker prototype");
  });

  it("admits the full handoff at exactly the TTL boundary", () => {
    stashProjectStart({
      title: "Solar tracker",
      transcriptText: "Interview",
      transcriptFileName: "interview.docx",
    }, 1_000);
    expect(takeProjectStart(1_000 + PROJECT_INTENT_HANDOFF_TTL_MS)).toEqual({
      title: "Solar tracker",
      transcriptText: "Interview",
      transcriptFileName: "interview.docx",
    });
    expect(takeProjectStart(1_000 + PROJECT_INTENT_HANDOFF_TTL_MS)).toEqual({
      title: "", transcriptText: "", transcriptFileName: null,
    });
  });

  it("discards stale and empty values", () => {
    stashProjectStart({ transcriptText: "Interview" }, 1_000);
    expect(takeProjectStart(1_000 + PROJECT_INTENT_HANDOFF_TTL_MS + 1)).toEqual({
      title: "",
      transcriptText: "",
      transcriptFileName: null,
    });

    stashProjectStart({ title: "   ", transcriptText: "   " }, 2_000);
    expect(takeProjectStart(2_001)).toEqual({
      title: "",
      transcriptText: "",
      transcriptFileName: null,
    });
  });
});
