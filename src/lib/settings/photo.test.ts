import { describe, expect, it } from "vitest";
import { PHOTO_MAX_BYTES, photoProblem } from "./photo";

describe("photoProblem", () => {
  it("accepts PNG and JPG up to 5 MB", () => {
    expect(photoProblem({ type: "image/png", size: 1024 })).toBeNull();
    expect(photoProblem({ type: "image/jpeg", size: PHOTO_MAX_BYTES })).toBeNull();
  });

  it("refuses other types and larger files with plain copy", () => {
    expect(photoProblem({ type: "image/gif", size: 10 })).toBe("Use a PNG or JPG file.");
    expect(photoProblem({ type: "application/pdf", size: 10 })).toBe("Use a PNG or JPG file.");
    expect(photoProblem({ type: "image/png", size: PHOTO_MAX_BYTES + 1 })).toBe(
      "That photo is over 5 MB."
    );
  });
});
