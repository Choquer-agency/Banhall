import { describe, expect, test } from "bun:test";
import type { Id } from "../convex/_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  getProjectAccess,
  requireInternalProjectAccess,
  requireProjectCreator,
} from "../convex/lib/auth";

const ownerId = "owner" as Id<"users">;
const otherId = "other" as Id<"users">;
const managerId = "manager" as Id<"users">;
const adminId = "admin" as Id<"users">;
const projectId = "project" as Id<"projects">;
const missingProjectId = "missing-project" as Id<"projects">;
const sharedReportId = "shared-report" as Id<"reports">;
const validShareToken = "valid-client-token";

type AccessCtx = Parameters<typeof getInternalProjectAccessOrNull>[0];
type UserFixture = {
  _id: Id<"users">;
  role: "writer" | "manager" | "admin";
};
type ProjectFixture = {
  _id: Id<"projects">;
  createdBy: Id<"users">;
  shareToken?: string;
  sharedReportId?: Id<"reports">;
};

const owner = { _id: ownerId, role: "writer" } satisfies UserFixture;
const writer = { _id: otherId, role: "writer" } satisfies UserFixture;
const manager = { _id: managerId, role: "manager" } satisfies UserFixture;
const admin = { _id: adminId, role: "admin" } satisfies UserFixture;
const project: ProjectFixture = {
  _id: projectId,
  createdBy: ownerId,
  shareToken: validShareToken,
  sharedReportId,
};

function contextFor(
  user: UserFixture | null,
  storedProject: ProjectFixture | null = project
): AccessCtx {
  // Better Auth: identity.subject is the component user id, resolved to the
  // app users doc via the by_authId index (convex/lib/auth.ts).
  const authId = user ? `auth-${user._id}` : null;
  return {
    auth: {
      getUserIdentity: async () => (authId ? { subject: authId } : null),
    },
    db: {
      get: async (id: string) => {
        if (storedProject && id === storedProject._id) return storedProject;
        if (user && id === user._id) return user;
        return null;
      },
      query: (table: string) => ({
        withIndex: (_index: string, _range: unknown) => ({
          unique: async () =>
            table === "users" && user ? { ...user, authId } : null,
        }),
      }),
    },
  } as unknown as AccessCtx;
}

describe("internal project access", () => {
  test.each([
    ["owner writer", owner],
    ["non-owner writer", writer],
    ["manager", manager],
    ["admin", admin],
  ] as const)("allows an authenticated internal %s", async (_label, user) => {
    const ctx = contextFor(user);
    const nullableAccess = await getInternalProjectAccessOrNull(ctx, projectId);
    const requiredAccess = await requireInternalProjectAccess(ctx, projectId);

    expect(nullableAccess?.project._id).toBe(projectId);
    expect(nullableAccess?.user._id).toBe(user._id);
    expect(nullableAccess?.user.role).toBe(user.role);
    expect(requiredAccess.project._id).toBe(projectId);
    expect(requiredAccess.user._id).toBe(user._id);
    expect(requiredAccess.user.role).toBe(user.role);
  });

  test("keeps creator-only actions restricted to the owner", async () => {
    const creatorAccess = await requireProjectCreator(
      contextFor(owner),
      projectId
    );
    expect(creatorAccess.project._id).toBe(projectId);
    expect(creatorAccess.user._id).toBe(ownerId);

    for (const user of [writer, manager, admin]) {
      await expect(
        requireProjectCreator(contextFor(user), projectId)
      ).rejects.toMatchObject({
        data: {
          code: "NOT_AUTHORIZED",
          message: "Project creator access required",
        },
      });
    }
  });

  test("denies anonymous internal access", async () => {
    const ctx = contextFor(null);

    await expect(
      getInternalProjectAccessOrNull(ctx, projectId)
    ).resolves.toBeNull();
    await expect(
      requireInternalProjectAccess(ctx, projectId)
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED", message: "Authentication required" },
    });
  });

  test("denies access when the project is missing", async () => {
    const ctx = contextFor(writer);

    await expect(
      getInternalProjectAccessOrNull(ctx, missingProjectId)
    ).resolves.toBeNull();
    await expect(
      requireInternalProjectAccess(ctx, missingProjectId)
    ).rejects.toMatchObject({
      data: { code: "NOT_FOUND", message: "Project not found" },
    });
  });
});

describe("project access resolution", () => {
  test("denies anonymous callers without a valid pinned client token", async () => {
    const anonymousCtx = contextFor(null);
    const unpinnedProject: ProjectFixture = {
      ...project,
      sharedReportId: undefined,
    };

    await expect(
      getProjectAccess(anonymousCtx, projectId)
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      getProjectAccess(anonymousCtx, projectId, "invalid-client-token")
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      getProjectAccess(contextFor(null, unpinnedProject), projectId, validShareToken)
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      getProjectAccess(anonymousCtx, missingProjectId, validShareToken)
    ).resolves.toEqual({ kind: "denied" });
  });

  test("allows an anonymous client only through the matching pinned token", async () => {
    const access = await getProjectAccess(
      contextFor(null),
      projectId,
      validShareToken
    );

    expect(access.kind).toBe("client_review");
    if (access.kind !== "client_review") {
      throw new Error("Expected pinned client review access");
    }
    expect(access.project._id).toBe(projectId);
    expect(access.project.sharedReportId).toBe(sharedReportId);
  });

  test("prefers authenticated internal access over a supplied client token", async () => {
    const access = await getProjectAccess(
      contextFor(writer),
      projectId,
      validShareToken
    );

    expect(access.kind).toBe("internal");
    if (access.kind !== "internal") {
      throw new Error("Expected authenticated internal access");
    }
    expect(access.project._id).toBe(projectId);
    expect(access.user._id).toBe(otherId);
    expect(access.user.role).toBe("writer");
  });
});
