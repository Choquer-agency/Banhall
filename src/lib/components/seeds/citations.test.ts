import { describe, expect, it } from "vitest";
import { citationSpeakerLine } from "./citations";

describe("citationSpeakerLine", () => {
  const base = { sourceId: "s", exactExcerpt: "x" };
  it("names only what the citation carries", () => {
    expect(citationSpeakerLine({ ...base, speaker: "Priya", line: 18 })).toBe("Priya, line 18");
    expect(citationSpeakerLine({ ...base, speaker: "Priya" })).toBe("Priya");
    expect(citationSpeakerLine({ ...base, line: 4 })).toBe("Line 4");
    expect(citationSpeakerLine({ ...base, speaker: "  ", line: 0 })).toBeNull();
    expect(citationSpeakerLine(base)).toBeNull();
  });
});
