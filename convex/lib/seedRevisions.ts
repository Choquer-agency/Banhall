import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../../shared/pdSubsections";

export const MAX_SEED_SNAPSHOT_ROWS = 128;
export const MAX_SEED_CONTEXT_ROW_UTF8_BYTES = 64_000;
export const MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES = 512_000;
export const MAX_SEED_PROMPT_UTF8_BYTES = 600_000;

export type SeedContextItemKind =
  | "selection"
  | "skip"
  | "feedback"
  | "ownFeedback"
  | "target";

type SeedContextItemBase = {
  roleId: PdSubsectionRoleId;
};

export type SeedSelectionContextItem = SeedContextItemBase & {
  kind: "selection";
  seedId: string;
  bullets: string[];
};

export type SeedSkipContextItem = SeedContextItemBase & {
  kind: "skip";
};

export type SeedFeedbackContextItem = SeedContextItemBase & {
  kind: "feedback" | "ownFeedback";
  feedbackRequestId: string;
  seedId: string;
  text: string;
};

export type SeedTargetContextItem = SeedContextItemBase & {
  kind: "target";
  feedbackRequestId: string;
  seedId: string;
  bullets: string[];
  text: string;
};

export type SeedContextItem =
  | SeedSelectionContextItem
  | SeedSkipContextItem
  | SeedFeedbackContextItem
  | SeedTargetContextItem;

export type SeedContextSnapshot = {
  v: 1;
  items: SeedContextItem[];
};

export type SeedSelectionRevisionItem = {
  seedId: string;
  bullets: readonly string[];
};

export type MaterializedSeedSelection = {
  roleId: PdSubsectionRoleId;
  seedId: string;
  bullets: readonly string[];
  active: boolean;
};

export type MaterializedSeedFeedback = {
  roleId: PdSubsectionRoleId;
  feedbackRequestId: string;
  targetSeedId: string;
  instruction: string;
  status: "active" | "suspendedBySkip" | "withdrawn";
};

export type MaterializedSeedTarget = {
  roleId: PdSubsectionRoleId;
  feedbackRequestId: string;
  targetSeedId: string;
  targetWording: readonly string[];
  instruction: string;
};

export type BuildDispatchSnapshotArgs = {
  targetRoleId: PdSubsectionRoleId;
  selections: readonly MaterializedSeedSelection[];
  skippedRoleIds: readonly PdSubsectionRoleId[];
  feedbackRequests: readonly MaterializedSeedFeedback[];
  target?: MaterializedSeedTarget;
};

const ROLE_ORDER = new Map<PdSubsectionRoleId, number>(
  PD_SUBSECTIONS.map((subsection) => [subsection.roleId, subsection.order])
);

const KIND_ORDER: Readonly<Record<SeedContextItemKind, number>> = {
  selection: 0,
  skip: 1,
  feedback: 2,
  ownFeedback: 3,
  target: 4,
};

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON serialization with recursive lexical object-key ordering. */
export function stableSerialize(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function roleOrder(roleId: PdSubsectionRoleId): number {
  const order = ROLE_ORDER.get(roleId);
  if (order === undefined) {
    throw new Error(`Unknown seed role: ${roleId}`);
  }
  return order;
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  const normalizedLeft = left ?? "";
  const normalizedRight = right ?? "";
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function itemSeedId(item: SeedContextItem): string | undefined {
  return "seedId" in item ? item.seedId : undefined;
}

function itemFeedbackRequestId(item: SeedContextItem): string | undefined {
  return "feedbackRequestId" in item ? item.feedbackRequestId : undefined;
}

export function canonicalizeSeedSnapshot(
  snapshot: SeedContextSnapshot
): SeedContextSnapshot {
  const items = snapshot.items.map((item): SeedContextItem => {
    switch (item.kind) {
      case "selection":
        return { ...item, bullets: [...item.bullets] };
      case "target":
        return { ...item, bullets: [...item.bullets] };
      case "skip":
      case "feedback":
      case "ownFeedback":
        return { ...item };
      default: {
        const exhaustive: never = item;
        return exhaustive;
      }
    }
  });
  items.sort((left, right) => {
    return (
      roleOrder(left.roleId) - roleOrder(right.roleId) ||
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      compareOptional(itemSeedId(left), itemSeedId(right)) ||
      compareOptional(itemFeedbackRequestId(left), itemFeedbackRequestId(right))
    );
  });
  return { v: 1, items };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export class SeedContextLimitError extends Error {
  readonly limit:
    | "rows"
    | "row_utf8_bytes"
    | "snapshot_utf8_bytes"
    | "prompt_utf8_bytes";

  constructor(
    limit: SeedContextLimitError["limit"],
    message: string
  ) {
    super(message);
    this.name = "SeedContextLimitError";
    this.limit = limit;
  }
}

export function assertSeedSnapshotWithinLimits(snapshot: SeedContextSnapshot): void {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  if (canonical.items.length > MAX_SEED_SNAPSHOT_ROWS) {
    throw new SeedContextLimitError(
      "rows",
      `Seed snapshot has more than ${MAX_SEED_SNAPSHOT_ROWS} rows`
    );
  }
  for (const item of canonical.items) {
    if (utf8Bytes(stableSerialize(item)) > MAX_SEED_CONTEXT_ROW_UTF8_BYTES) {
      throw new SeedContextLimitError(
        "row_utf8_bytes",
        `Seed snapshot row for ${item.roleId} exceeds ${MAX_SEED_CONTEXT_ROW_UTF8_BYTES} UTF-8 bytes`
      );
    }
  }
  if (
    utf8Bytes(stableSerialize(canonical)) >
    MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES
  ) {
    throw new SeedContextLimitError(
      "snapshot_utf8_bytes",
      `Seed snapshot exceeds ${MAX_SEED_CONTEXT_SNAPSHOT_UTF8_BYTES} UTF-8 bytes`
    );
  }
}

export function snapshotPromptProjection(snapshot: SeedContextSnapshot): string {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  assertSeedSnapshotWithinLimits(canonical);
  const projection = stableSerialize(canonical);
  if (utf8Bytes(projection) > MAX_SEED_PROMPT_UTF8_BYTES) {
    throw new SeedContextLimitError(
      "prompt_utf8_bytes",
      `Seed prompt projection exceeds ${MAX_SEED_PROMPT_UTF8_BYTES} UTF-8 bytes`
    );
  }
  return projection;
}

export function assertSeedPromptWithinLimit(prompt: string): void {
  if (utf8Bytes(prompt) > MAX_SEED_PROMPT_UTF8_BYTES) {
    throw new SeedContextLimitError(
      "prompt_utf8_bytes",
      `Seed prompt exceeds ${MAX_SEED_PROMPT_UTF8_BYTES} UTF-8 bytes`
    );
  }
}

export function buildDispatchSnapshot(args: BuildDispatchSnapshotArgs): SeedContextSnapshot {
  const targetOrder = roleOrder(args.targetRoleId);
  const skipped = new Set(args.skippedRoleIds);
  const items: SeedContextItem[] = [];

  for (const selection of args.selections) {
    if (
      selection.active &&
      !skipped.has(selection.roleId) &&
      roleOrder(selection.roleId) < targetOrder
    ) {
      items.push({
        kind: "selection",
        roleId: selection.roleId,
        seedId: selection.seedId,
        bullets: [...selection.bullets],
      });
    }
  }
  for (const roleId of skipped) {
    if (roleOrder(roleId) < targetOrder) {
      items.push({ kind: "skip", roleId });
    }
  }
  for (const feedback of args.feedbackRequests) {
    if (feedback.status !== "active" || skipped.has(feedback.roleId)) continue;
    const order = roleOrder(feedback.roleId);
    if (order < targetOrder) {
      items.push({
        kind: "feedback",
        roleId: feedback.roleId,
        feedbackRequestId: feedback.feedbackRequestId,
        seedId: feedback.targetSeedId,
        text: feedback.instruction,
      });
    } else if (feedback.roleId === args.targetRoleId) {
      items.push({
        kind: "ownFeedback",
        roleId: feedback.roleId,
        feedbackRequestId: feedback.feedbackRequestId,
        seedId: feedback.targetSeedId,
        text: feedback.instruction,
      });
    }
  }
  if (args.target) {
    if (args.target.roleId !== args.targetRoleId) {
      throw new Error("Feedback target role does not match the dispatch role");
    }
    items.push({
      kind: "target",
      roleId: args.target.roleId,
      feedbackRequestId: args.target.feedbackRequestId,
      seedId: args.target.targetSeedId,
      bullets: [...args.target.targetWording],
      text: args.target.instruction,
    });
  }

  const snapshot = canonicalizeSeedSnapshot({ v: 1, items });
  assertSeedSnapshotWithinLimits(snapshot);
  return snapshot;
}

export async function contributionHashes(
  snapshot: SeedContextSnapshot
): Promise<ReadonlyMap<PdSubsectionRoleId, string>> {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  const entries = await Promise.all(
    PD_SUBSECTIONS.map(async ({ roleId }) => {
      const roleSnapshot: SeedContextSnapshot = {
        v: 1,
        items: canonical.items.filter(
          (item) => item.roleId === roleId && item.kind !== "target"
        ),
      };
      return [roleId, await sha256Text(stableSerialize(roleSnapshot))] as const;
    })
  );
  return new Map(entries);
}

export async function contextRevision(
  snapshot: SeedContextSnapshot
): Promise<string> {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  assertSeedSnapshotWithinLimits(canonical);
  return await sha256Text(
    stableSerialize({
      v: 1,
      items: canonical.items.filter((item) => item.kind !== "target"),
    })
  );
}

export async function selectionRevision(
  items: readonly SeedSelectionRevisionItem[]
): Promise<string> {
  const canonical = items
    .map((item) => ({ seedId: item.seedId, bullets: [...item.bullets] }))
    .sort((left, right) => compareOptional(left.seedId, right.seedId));
  return await sha256Text(stableSerialize(canonical));
}

export const EMPTY_CONTEXT_REVISION =
  "47554e39810a156dac952dd31d88a8fcd8760cf91d73b5b844b4eccb2a9a06e4";
export const EMPTY_SELECTION_REVISION =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

export async function emptyContextRevision(): Promise<string> {
  return await contextRevision({ v: 1, items: [] });
}

export async function emptySelectionRevision(): Promise<string> {
  return await selectionRevision([]);
}

export type EncodedSeedBatchContextRow = {
  roleId: PdSubsectionRoleId;
  sourceRoleId: PdSubsectionRoleId;
  kind: SeedContextItemKind;
  seedId?: string;
  feedbackRequestId?: string;
  bullets?: string[];
  text?: string;
  order: number;
  contributionHash: string;
};

export async function encodeBatchContext(
  snapshot: SeedContextSnapshot,
  args: { targetRoleId: PdSubsectionRoleId }
): Promise<EncodedSeedBatchContextRow[]> {
  const canonical = canonicalizeSeedSnapshot(snapshot);
  assertSeedSnapshotWithinLimits(canonical);
  const hashes = await contributionHashes(canonical);
  return canonical.items.map((item, order) => {
    const base = {
      roleId: args.targetRoleId,
      sourceRoleId: item.roleId,
      kind: item.kind,
      order,
      contributionHash: hashes.get(item.roleId) ?? "",
    };
    switch (item.kind) {
      case "selection":
        return { ...base, seedId: item.seedId, bullets: [...item.bullets] };
      case "skip":
        return base;
      case "feedback":
      case "ownFeedback":
        return {
          ...base,
          feedbackRequestId: item.feedbackRequestId,
          seedId: item.seedId,
          text: item.text,
        };
      case "target":
        return {
          ...base,
          feedbackRequestId: item.feedbackRequestId,
          seedId: item.seedId,
          bullets: [...item.bullets],
          text: item.text,
        };
      default: {
        const exhaustive: never = item;
        return exhaustive;
      }
    }
  });
}

type SeedBatchContextRowLike = EncodedSeedBatchContextRow & {
  _creationTime?: number;
};

export function decodeBatchContext(
  rows: readonly SeedBatchContextRowLike[]
): SeedContextSnapshot {
  const ordered = [...rows].sort(
    (left, right) =>
      left.order - right.order ||
      (left._creationTime ?? 0) - (right._creationTime ?? 0)
  );
  const items = ordered.map((row): SeedContextItem => {
    switch (row.kind) {
      case "selection":
        if (!row.seedId || !row.bullets) {
          throw new Error("Malformed selection seed context row");
        }
        return {
          kind: row.kind,
          roleId: row.sourceRoleId,
          seedId: row.seedId,
          bullets: [...row.bullets],
        };
      case "skip":
        return { kind: row.kind, roleId: row.sourceRoleId };
      case "feedback":
      case "ownFeedback":
        if (!row.feedbackRequestId || !row.seedId || row.text === undefined) {
          throw new Error("Malformed feedback seed context row");
        }
        return {
          kind: row.kind,
          roleId: row.sourceRoleId,
          feedbackRequestId: row.feedbackRequestId,
          seedId: row.seedId,
          text: row.text,
        };
      case "target":
        if (
          !row.feedbackRequestId ||
          !row.seedId ||
          !row.bullets ||
          row.text === undefined
        ) {
          throw new Error("Malformed target seed context row");
        }
        return {
          kind: row.kind,
          roleId: row.sourceRoleId,
          feedbackRequestId: row.feedbackRequestId,
          seedId: row.seedId,
          bullets: [...row.bullets],
          text: row.text,
        };
      default: {
        const exhaustive: never = row.kind;
        return exhaustive;
      }
    }
  });
  const snapshot = canonicalizeSeedSnapshot({ v: 1, items });
  assertSeedSnapshotWithinLimits(snapshot);
  return snapshot;
}

export function contributionHashesFromRows(
  rows: readonly SeedBatchContextRowLike[]
): ReadonlyMap<PdSubsectionRoleId, string> {
  const hashes = new Map<PdSubsectionRoleId, string>();
  for (const row of rows) {
    const existing = hashes.get(row.sourceRoleId);
    if (existing !== undefined && existing !== row.contributionHash) {
      throw new Error(`Conflicting contribution hash for ${row.sourceRoleId}`);
    }
    hashes.set(row.sourceRoleId, row.contributionHash);
  }
  return hashes;
}
