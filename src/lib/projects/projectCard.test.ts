import { describe, expect, it } from "vitest";
import { cardStatusLine, longDate } from "./projectCard";

describe("project card copy", () => {
  it("writes full dates", () => {
    expect(longDate(new Date(2026, 9, 14, 12).getTime())).toBe("October 14, 2026");
  });

  it("puts AI work first, then who has the next step, else nothing", () => {
    expect(cardStatusLine({ generationActivity: "generating", handoff: undefined })).toEqual({ text: "AI is writing the report", ai: true });
    expect(
      cardStatusLine({ generationActivity: null, handoff: { assigneeLabel: "Maya Chen", kindLabel: "Internal review", dueDate: "Oct 20" } })
    ).toEqual({ text: "With Maya Chen for internal review, due Oct 20", ai: false });
    expect(cardStatusLine({ generationActivity: null, handoff: undefined })).toBeNull();
  });
});
