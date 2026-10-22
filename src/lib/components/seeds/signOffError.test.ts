import { describe, expect, it } from "vitest";
import { signOffErrorMessage } from "./signOffError";

const refusal = (data: Record<string, string>) =>
  Object.assign(new Error("Server Error"), {
    data: {
      code: "INVALID_INPUT",
      reason: "SUMMARY_CAPACITY_EXCEEDED",
      message: "Summary Self-check worst-case response exceeds 32768 UTF-8 bytes",
      ...data,
    },
  });

// 2026-10-22 (alerts triage): a writer refused at sign-off saw the server's
// byte-limit message and could not tell what to change.
describe("sign-off refusal message", () => {
  it("names the Section to untick picks in when its checks do not fit", () => {
    const message = signOffErrorMessage(
      refusal({ limit: "summary_self_check_response_utf8_bytes", section: "244" })
    );
    expect(message).toBe(
      "Section 244 (Work performed) has more picks than the final check can read at once. " +
        "Untick a few picks in its steps, then sign off again. Your picks and edits are kept."
    );
    expect(message).not.toMatch(/UTF-8|bytes|[\u2013\u2014]/);
  });

  it("still says what to shorten when the Section is not named", () => {
    expect(signOffErrorMessage(refusal({ limit: "summary_plan_check_input_utf8_bytes" }))).toBe(
      "This Summary has more picks than the final check can read at once. " +
        "Untick a few picks in the steps with the most picks, then sign off again. Your picks and edits are kept."
    );
  });

  it("asks for a report when the Brief, not the picks, is too large", () => {
    const message = signOffErrorMessage(
      refusal({ limit: "summary_self_check_ordinary_count", section: "242" })
    );
    expect(message).toContain("Brief has more Confidence Map entries and Glossary Terms");
    expect(message).toContain("Please report this");
  });

  it("keeps other refusals as the server words them", () => {
    const stale = Object.assign(new Error("Server Error"), {
      data: { code: "STALE_REVISION", message: "Seed decisions changed; refresh and retry" },
    });
    expect(signOffErrorMessage(stale)).toBe("Seed decisions changed; refresh and retry");
    expect(signOffErrorMessage(new Error("[CONVEX M(x)] Server Error"))).toBe(
      "The Summary could not be signed off."
    );
  });
});
