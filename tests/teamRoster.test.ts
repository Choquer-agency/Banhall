import { describe, expect, test } from "bun:test";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../convex/_generated/server";
import {
  getTeamRosterMemberOrNull,
  isTeamRosterMember,
  listTeamRoster,
  userDisplayLabel,
} from "../convex/lib/teamRoster";

function user(
  id: string,
  fields: Partial<Pick<Doc<"users">, "name" | "email" | "isAnonymous">> = {}
): Doc<"users"> {
  return {
    _id: id as Id<"users">,
    _creationTime: 1,
    ...fields,
  };
}

describe("team roster identity policy", () => {
  test("uses a stable trimmed display-label fallback", () => {
    expect(userDisplayLabel(user("named", { name: "  Alex Chen  ", email: "a@example.ca" }))).toBe(
      "Alex Chen"
    );
    expect(userDisplayLabel(user("email", { name: "  ", email: " staff@example.ca " }))).toBe(
      "staff@example.ca"
    );
    expect(userDisplayLabel(user("unknown"))).toBe("Unknown team member");
  });

  test("excludes anonymous auth records from the selectable roster", async () => {
    const member = user("member", { name: "Team member" });
    const anonymous = user("anonymous", { name: "Guest", isAnonymous: true });
    const ctx = {
      db: {
        query: () => ({ take: async () => [member, anonymous] }),
      },
    } as unknown as QueryCtx;

    expect(isTeamRosterMember(member)).toBe(true);
    expect(isTeamRosterMember(anonymous)).toBe(false);
    expect(isTeamRosterMember(null)).toBe(false);
    expect(await listTeamRoster(ctx)).toEqual([member]);
  });

  test("resolves duplicate names by users-table ID and rejects non-members", async () => {
    const first = user("first", { name: "Sam Lee" });
    const second = user("second", { name: "Sam Lee" });
    const anonymous = user("anonymous", { name: "Sam Lee", isAnonymous: true });
    const users: Record<string, Doc<"users">> = {
      [first._id]: first,
      [second._id]: second,
      [anonymous._id]: anonymous,
    };
    const ctx = {
      db: {
        get: async (id: Id<"users">) => users[id] ?? null,
      },
    } as unknown as MutationCtx;

    expect((await getTeamRosterMemberOrNull(ctx, first._id))?._id).toBe(first._id);
    expect((await getTeamRosterMemberOrNull(ctx, second._id))?._id).toBe(second._id);
    expect(await getTeamRosterMemberOrNull(ctx, anonymous._id)).toBeNull();
  });
});
