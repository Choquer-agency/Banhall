import type { PdSubsectionRoleId } from "../../shared/pdSubsections";
import { sha256Text, stableSerialize } from "./seedRevisions";

export const SEED_ATTEMPT_REQUESTS_RESERVED = 2;
export const SEED_ATTEMPT_LEASE_MS = 10 * 60 * 1_000;

export type SeedOperation =
  | "open"
  | "prefetch"
  | "retry"
  | "regenerate"
  | "feedback";

export type SeedDedupeClass = "initial" | "command";

export function seedOperationClass(operation: SeedOperation): SeedDedupeClass {
  switch (operation) {
    case "open":
    case "prefetch":
    case "retry":
      return "initial";
    case "regenerate":
    case "feedback":
      return "command";
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

type SeedDedupeKeyArgs = {
  generationId: string;
  roleId: PdSubsectionRoleId;
  operation: SeedOperation;
  contextRevision: string;
  feedbackRequestId?: string;
  commandId: string;
};

/**
 * The initial identity deliberately excludes the command id, so open,
 * prefetch, and retry share one identity at the same consumed revision.
 */
export async function seedDedupeKey(args: SeedDedupeKeyArgs): Promise<string> {
  const dedupeClass = seedOperationClass(args.operation);
  const identity =
    dedupeClass === "initial"
      ? {
          class: dedupeClass,
          contextRevision: args.contextRevision,
          generationId: args.generationId,
          roleId: args.roleId,
        }
      : {
          class: dedupeClass,
          commandId: args.commandId,
          contextRevision: args.contextRevision,
          ...(args.feedbackRequestId
            ? { feedbackRequestId: args.feedbackRequestId }
            : {}),
          generationId: args.generationId,
          roleId: args.roleId,
        };
  return await sha256Text(stableSerialize(identity));
}

type SeedCommandLookupArgs = {
  generationId: string;
  roleId: PdSubsectionRoleId;
  commandId: string;
};

/** A redelivery lookup key that never changes when the context revision does. */
export function seedCommandLookupKey(args: SeedCommandLookupArgs): string {
  return stableSerialize({
    commandId: args.commandId,
    generationId: args.generationId,
    roleId: args.roleId,
  });
}

type SeedCommandPayloadIdentityArgs = {
  operation: Extract<SeedOperation, "regenerate" | "feedback">;
  feedbackRequestId?: string;
  targetSeedId?: string;
};

/**
 * Stored beside a command id so reusing that id for a different operation or
 * feedback target can be rejected before a context-bearing key is computed.
 */
export async function seedCommandPayloadIdentity(
  args: SeedCommandPayloadIdentityArgs
): Promise<string> {
  return await sha256Text(
    stableSerialize({
      ...(args.feedbackRequestId
        ? { feedbackRequestId: args.feedbackRequestId }
        : {}),
      operation: args.operation,
      ...(args.targetSeedId ? { targetSeedId: args.targetSeedId } : {}),
    })
  );
}
