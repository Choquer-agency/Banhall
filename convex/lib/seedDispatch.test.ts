import { describe, expect, it } from "vitest";
import {
  seedCommandLookupKey,
  seedCommandPayloadIdentity,
  seedDedupeKey,
  seedOperationClass,
} from "./seedDispatch";

const base = {
  generationId: "generation-1",
  roleId: "experimentation" as const,
  contextRevision: "revision-1",
  commandId: "command-1",
};

describe("seed dispatch identities", () => {
  it("shares one initial identity across open, prefetch, and retry", async () => {
    const keys = await Promise.all(
      (["open", "prefetch", "retry"] as const).map((operation) =>
        seedDedupeKey({ ...base, operation })
      )
    );
    expect(new Set(keys).size).toBe(1);
    expect(seedOperationClass("open")).toBe("initial");
    expect(seedOperationClass("regenerate")).toBe("command");
  });

  it("dedupes a redelivered command but separates deliberate commands", async () => {
    const first = await seedDedupeKey({ ...base, operation: "regenerate" });
    const redelivery = await seedDedupeKey({ ...base, operation: "regenerate" });
    const second = await seedDedupeKey({
      ...base,
      operation: "regenerate",
      commandId: "command-2",
    });
    expect(redelivery).toBe(first);
    expect(second).not.toBe(first);
  });

  it("scopes command lookup independently of context revisions", () => {
    expect(
      seedCommandLookupKey({
        generationId: base.generationId,
        roleId: base.roleId,
        commandId: base.commandId,
      })
    ).toBe(
      seedCommandLookupKey({
        generationId: base.generationId,
        roleId: base.roleId,
        commandId: base.commandId,
      })
    );
  });

  it("binds feedback dedupe and stable payload identity to its target", async () => {
    const left = await seedDedupeKey({
      ...base,
      operation: "feedback",
      feedbackRequestId: "feedback-1",
    });
    const right = await seedDedupeKey({
      ...base,
      operation: "feedback",
      feedbackRequestId: "feedback-2",
    });
    expect(left).not.toBe(right);

    const payload = await seedCommandPayloadIdentity({
      operation: "feedback",
      feedbackRequestId: "feedback-1",
      targetSeedId: "seed-1",
    });
    const changedTarget = await seedCommandPayloadIdentity({
      operation: "feedback",
      feedbackRequestId: "feedback-1",
      targetSeedId: "seed-2",
    });
    expect(changedTarget).not.toBe(payload);
  });
});
