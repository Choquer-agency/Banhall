import { describe, expect, it } from "vitest";
import { inFlight, type UploadPhase } from "./uploads";

describe("inFlight", () => {
  it("lets a file be stopped only before its save is sent", () => {
    const phases: UploadPhase[] = ["waiting", "reading", "uploading", "saving", "done", "failed", "too_large"];
    expect(phases.filter((phase) => inFlight({ phase }))).toEqual(["waiting", "reading", "uploading"]);
  });
});
