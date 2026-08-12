import { describe, expect, it } from "vitest";
import { resolveOwnerDisplay } from "./ownerDisplay";

describe("resolveOwnerDisplay", () => {
  it("shows the canonical owner label when ownerId resolves", () => {
    expect(
      resolveOwnerDisplay({ ownerId: "u1", resolvedLabel: "Olivia Owner", legacyWriter: "Wendy Writer" })
    ).toEqual({ kind: "canonical", label: "Olivia Owner" });
  });

  it("never substitutes the legacy writer when ownerId exists but is unresolved", () => {
    expect(
      resolveOwnerDisplay({ ownerId: "u1", resolvedLabel: null, legacyWriter: "Wendy Writer" })
    ).toEqual({ kind: "canonical_unresolved" });
    expect(
      resolveOwnerDisplay({ ownerId: "u1", resolvedLabel: "   ", legacyWriter: "Wendy Writer" })
    ).toEqual({ kind: "canonical_unresolved" });
  });

  it("falls back to the qualified legacy writer only when ownerId is absent", () => {
    expect(
      resolveOwnerDisplay({ ownerId: undefined, resolvedLabel: null, legacyWriter: "Wendy Writer" })
    ).toEqual({ kind: "legacy_writer", label: "Wendy Writer" });
    expect(resolveOwnerDisplay({ ownerId: null, resolvedLabel: null, legacyWriter: "  " })).toEqual({
      kind: "none",
    });
    expect(resolveOwnerDisplay({ ownerId: null, resolvedLabel: null, legacyWriter: null })).toEqual({
      kind: "none",
    });
  });
});
