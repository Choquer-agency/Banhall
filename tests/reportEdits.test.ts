import { describe, expect, test } from "bun:test";
import { applyReplacements, replaceAll } from "../convex/lib/reportEdits";

describe("replaceAll case preservation", () => {
  test("capitalizes a lowercase replacement when the match was capitalized", () => {
    const r = replaceAll("The system failed.", "the system", "the platform");
    expect(r.text).toBe("The platform failed.");
    expect(r.count).toBe(1);
  });

  test("leaves an already-capitalized replacement untouched (ACuity regression)", () => {
    // Bug: searching for the first /[a-z]/ skipped the capital "A" and
    // uppercased the second letter — "Acuity …" became "ACuity …".
    const r = replaceAll(
      "Acuity Insights operates a live assessment platform.",
      "Acuity Insights operates a live assessment platform.",
      "Acuity Insights operates a situational judgment test platform."
    );
    expect(r.text).toBe(
      "Acuity Insights operates a situational judgment test platform."
    );
    expect(r.count).toBe(1);
  });

  test("lowercase match keeps the replacement as written", () => {
    const r = replaceAll("we tuned the model.", "the model", "the classifier");
    expect(r.text).toBe("we tuned the classifier.");
  });

  test("capitalized replacement after a capitalized match keeps its own casing", () => {
    const r = replaceAll("The team used SJTs.", "The team", "Acuity");
    expect(r.text).toBe("Acuity used SJTs.");
  });
});

describe("applyReplacements doc splice", () => {
  test("replaces a full paragraph without mangling the first word", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Acuity operates a live platform." }],
        },
      ],
    };
    const { doc: updated, count } = applyReplacements(doc, [
      {
        find: "Acuity operates a live platform.",
        replaceWith: "Acuity operates a situational judgment test platform.",
      },
    ]);
    expect(count).toBe(1);
    const text = (updated.content as Array<{ content: Array<{ text: string }> }>)[0]
      .content[0].text;
    expect(text).toBe("Acuity operates a situational judgment test platform.");
  });
});
