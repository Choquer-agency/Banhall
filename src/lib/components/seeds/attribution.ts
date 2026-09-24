import { sourceChipLabel, type SourceKind } from "$lib/brief";

/** Readable frozen-source names for Seed provenance, with the state of the read
 * that produced them. A missing name is never presented as attributed: the
 * label says whether the read is still loading, failed, left names out, or
 * completed without that source on record. */
export type SeedSourceAttributionStatus =
  | "loading"
  | "error"
  | "incomplete"
  | "complete";

export type SeedSourceAttribution = {
  /** Names keyed by `generationSources` id, including recovered names. */
  labels: ReadonlyMap<string, string>;
  status: SeedSourceAttributionStatus;
  /** Ids whose names a bounded recovery read could not retrieve. */
  unrecoverableSourceIds: ReadonlySet<string>;
  /** Honest refusal text when the recovery path itself failed. */
  recoveryError: string | null;
};

export const EMPTY_SOURCE_ATTRIBUTION: SeedSourceAttribution = {
  labels: new Map(),
  status: "loading",
  unrecoverableSourceIds: new Set(),
  recoveryError: null,
};

export type SeedSourceDescription = {
  label: string;
  /** True only when the label is the source's recorded name. */
  attributed: boolean;
};

export function describeSource(
  attribution: SeedSourceAttribution,
  sourceId: string
): SeedSourceDescription {
  const label = attribution.labels.get(sourceId);
  if (label !== undefined) return { label, attributed: true };
  switch (attribution.status) {
    case "loading":
      return { label: "Source name loading…", attributed: false };
    case "error":
      return { label: "Source name unavailable", attributed: false };
    case "incomplete":
      return {
        label: attribution.unrecoverableSourceIds.has(sourceId)
          ? "Source name not retrieved"
          : "Source name pending retrieval",
        attributed: false,
      };
    default:
      return { label: "Source not on record", attributed: false };
  }
}

/** Cited source ids that have no name yet and are still worth retrieving. */
export function missingSourceIds(
  attribution: SeedSourceAttribution,
  citedSourceIds: Iterable<string>
): string[] {
  if (attribution.status !== "incomplete") return [];
  const missing = new Set<string>();
  for (const sourceId of citedSourceIds) {
    if (!attribution.labels.has(sourceId) && !attribution.unrecoverableSourceIds.has(sourceId)) {
      missing.add(sourceId);
    }
  }
  return [...missing];
}

/** The shared source chip label, without the middle-dot separator the seed
 * screens' copy rules do not allow ("Interview 2 (digest)"). */
export function seedSourceLabel(source: { label: string; kind: SourceKind }) {
  return sourceChipLabel({ source }).replace(/ · digest$/, " (digest)");
}

/** Attribution from one `seeds:getSourceAttribution` read, for surfaces that
 * have no recovery path of their own (the Summary). */
export function attributionFromRead(
  read: { generationId: string; complete: boolean; sources: ReadonlyArray<{ sourceId: string; label: string; kind: SourceKind }> } | null | undefined,
  generationId: string,
  failed: boolean
): SeedSourceAttribution {
  const owned = read && read.generationId === generationId ? read : null;
  const labels = new Map<string, string>();
  for (const source of owned?.sources ?? []) labels.set(String(source.sourceId), seedSourceLabel(source));
  return {
    labels,
    status: failed ? "error" : owned ? (owned.complete ? "complete" : "incomplete") : "loading",
    unrecoverableSourceIds: new Set(),
    recoveryError: null,
  };
}
