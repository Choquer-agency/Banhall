/**
 * Truthful owner display for the workspace projects table.
 *
 * Canonical `ownerId` is durable accountability (docs/product-domain.md). The
 * table must never present the legacy free-text writer as if it were the
 * canonical Owner:
 * - `ownerId` present + resolved label → canonical.
 * - `ownerId` present + no resolved label → "Owner unavailable" (never a
 *   silent legacy-writer substitution).
 * - no `ownerId` + legacy writer text → legacy writer, explicitly qualified.
 * - neither → none.
 */
export type ProjectsTableOwner =
  | { kind: "canonical"; label: string }
  | { kind: "canonical_unresolved" }
  | { kind: "legacy_writer"; label: string }
  | { kind: "none" };

export function resolveOwnerDisplay(args: {
  ownerId: string | null | undefined;
  resolvedLabel: string | null | undefined;
  legacyWriter: string | null | undefined;
}): ProjectsTableOwner {
  if (args.ownerId) {
    const label = args.resolvedLabel?.trim();
    return label ? { kind: "canonical", label } : { kind: "canonical_unresolved" };
  }
  const writer = args.legacyWriter?.trim();
  return writer ? { kind: "legacy_writer", label: writer } : { kind: "none" };
}

