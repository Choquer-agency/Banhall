import { describe, expect, it } from "vitest";
import { generationActivityLabel } from "./generationActivity";

describe("dashboard generation activity", () => {
  it("scopes every active generation label as AI or an explicit action", () => {
    expect(generationActivityLabel("generating")).toBe("AI · Generating");
    expect(generationActivityLabel("awaiting_selection")).toBe(
      "Action needed · Choose draft"
    );
    expect(generationActivityLabel("awaiting_input")).toBe(
      "Action needed · Review section"
    );
  });

  it("renders no secondary activity when generation is inactive", () => {
    expect(generationActivityLabel(null)).toBeNull();
    expect(generationActivityLabel(undefined)).toBeNull();
  });
});
