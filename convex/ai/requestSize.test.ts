import { describe, expect, it } from "vitest";
import { requestSize } from "./requestSize";

/** F1, step 1 (2026-10-27): what counts as a request's characters. */
describe("requestSize", () => {
  it("counts system blocks, thinking and nested document content; images and redacted thinking count as none", () => {
    expect(
      requestSize({
        system: [{ type: "text", text: "abcd" }, { type: "text", text: "ef" }],
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=".repeat(40) } },
              { type: "document", source: { type: "content", content: [{ type: "text", text: "12345" }, { type: "text", text: "678" }] } },
            ],
          },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "hmm", signature: "sig" },
              { type: "redacted_thinking", data: "opaque" },
              { type: "text", text: "ok" },
            ],
          },
        ],
      })
    ).toEqual({ requestChars: 6 + 8 + 3 + 2, evidenceChars: 8 });
  });

  it("counts a tool result given as a string, and nothing for what is not a request", () => {
    expect(
      requestSize({ messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "result" }] }] })
    ).toEqual({ requestChars: 6, evidenceChars: 6 });
    expect(requestSize(null)).toEqual({ requestChars: 0, evidenceChars: 0 });
    expect(requestSize("text")).toEqual({ requestChars: 0, evidenceChars: 0 });
  });
});
