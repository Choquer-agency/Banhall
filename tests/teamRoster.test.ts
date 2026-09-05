import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { userDisplayLabel } from "../convex/lib/teamRoster";

function user(
  id: string,
  fields: Partial<
    Pick<Doc<"users">, "name" | "email" | "isAnonymous" | "firstName" | "lastName">
  > = {}
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

  test("prefers firstName/lastName over the legacy single name", () => {
    expect(
      userDisplayLabel(
        user("full", { firstName: " Larry ", lastName: " Marks ", name: "old label" })
      )
    ).toBe("Larry Marks");
    // Partial first/last still wins over legacy name.
    expect(
      userDisplayLabel(user("first-only", { firstName: "Emily", name: "old label" }))
    ).toBe("Emily");
    // Blank first/last falls back to the legacy name, then email.
    expect(
      userDisplayLabel(
        user("blank", { firstName: "  ", lastName: "", name: "Legacy Name" })
      )
    ).toBe("Legacy Name");
    expect(
      userDisplayLabel(user("mail", { firstName: " ", email: "t@banhall.ca" }))
    ).toBe("t@banhall.ca");
  });
});
