import { describe, expect, it } from "vitest";
import { addChips, inviteLink, isInviteEmail, sendLabel, splitEmails } from "./inviteEmails";

describe("invite email chips", () => {
  it("splits on commas, spaces, semicolons and new lines", () => {
    expect(splitEmails(" a@b.co, c@d.co;e@f.co\ng@h.co  ")).toEqual([
      "a@b.co",
      "c@d.co",
      "e@f.co",
      "g@h.co",
    ]);
  });

  it("marks invalid addresses and collapses duplicates in any case", () => {
    const chips = addChips([], ["Ana@Banhall.com", "nope", "ana@banhall.com"]);
    expect(chips).toEqual([
      { value: "Ana@Banhall.com", valid: true },
      { value: "nope", valid: false },
    ]);
    expect(addChips(chips, ["NOPE"])).toHaveLength(2);
    expect(isInviteEmail("x@y")).toBe(false);
  });

  it("labels the send button by count and builds links", () => {
    expect(sendLabel(0)).toBe("Send invite");
    expect(sendLabel(1)).toBe("Send invite");
    expect(sendLabel(2)).toBe("Send 2 invites");
    expect(inviteLink("https://banhall.app", "tok")).toBe("https://banhall.app/signup/tok");
  });
});
