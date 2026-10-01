import { describe, expect, it } from "vitest";
import { sectionForText } from "./proposalSection";
import { buildTiptapDocument } from "../../../convex/lib/tiptapReport";

const content = JSON.stringify(
  buildTiptapDocument(
    "Title",
    "The team could not predict the load response.",
    "Trials varied one condition at a time.\n\nEach trial recorded the response.",
    "The work clarified how load affects stability."
  )
);

describe("sectionForText", () => {
  it("names the Section that holds the targeted wording", () => {
    expect(sectionForText(content, "could not predict the load")).toBe("242");
    expect(sectionForText(content, "Each  trial recorded\nthe response.")).toBe("244");
    expect(sectionForText(content, "clarified how load")).toBe("246");
  });

  it("returns null when the wording is missing, ambiguous or there is no report", () => {
    expect(sectionForText(content, "not in the report")).toBeNull();
    expect(sectionForText(content, "the")).toBeNull();
    expect(sectionForText(null, "trial")).toBeNull();
    expect(sectionForText(content, "")).toBeNull();
  });
});
