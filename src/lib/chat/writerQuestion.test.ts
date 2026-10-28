import { describe, expect, it } from "vitest";
import type { UIMessage } from "@convex-dev/agent";
import { openWriterQuestion } from "./writerQuestion";

const message = (role: "user" | "assistant", parts: unknown[]) => ({ id: `${role}-${parts.length}`, role, parts }) as unknown as UIMessage;
const ask = (input: unknown, state = "output-available") => ({ type: "tool-askWriter", toolCallId: "call-ask", state, input });

describe("openWriterQuestion", () => {
  it("reads the question and options from the newest reply", () => {
    const messages = [
      message("user", [{ type: "text", text: "Shorten Line 242." }]),
      message("assistant", [
        { type: "text", text: "Line 242 is 35 words over. I can cut from a few places." },
        ask({ question: "What should I cut first?", options: ["The company background", "The repeated door detail"] }),
      ]),
    ];
    expect(openWriterQuestion(messages)).toEqual({
      toolCallId: "call-ask",
      question: "What should I cut first?",
      options: ["The company background", "The repeated door detail"],
    });
  });

  it("is closed once the writer answers", () => {
    const messages = [
      message("assistant", [ask({ question: "Which Line?", options: ["242", "244"] })]),
      message("user", [{ type: "text", text: "242" }]),
    ];
    expect(openWriterQuestion(messages)).toBeNull();
  });

  it("ignores a failed call and a question without two options", () => {
    expect(openWriterQuestion([message("assistant", [ask({ question: "Which?", options: ["A", "B"] }, "output-error")])])).toBeNull();
    expect(openWriterQuestion([message("assistant", [ask({ question: "Which?", options: ["A"] })])])).toBeNull();
    expect(openWriterQuestion([message("assistant", [ask({ question: " ", options: ["A", "B"] })])])).toBeNull();
  });

  it("keeps at most three options", () => {
    const question = openWriterQuestion([
      message("assistant", [ask({ question: "Which?", options: ["A", "B", "C", "D"] })]),
    ]);
    expect(question?.options).toEqual(["A", "B", "C"]);
  });
});
