import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import {
  chatSendErrorMessage,
  chatStopErrorMessage,
  PROPOSAL_UNDO_CONFLICT_TEXT,
  proposalUndoErrorMessage,
  SEND_FAILED_FALLBACK,
} from "./chatRefusals";

/** The error the Convex client throws for a refused mutation: prefixed text plus data. */
function clientError(data: Record<string, string | number>) {
  const error = new ConvexError(data);
  error.message = `[CONVEX M(chatV2:sendMessage)] [Request ID: 7c1e] Server Error\nUncaught ConvexError: ${JSON.stringify(data)}\n    at handler (../convex/chatV2.ts:455:7)`;
  return error;
}

describe("chatSendErrorMessage", () => {
  it("names who the assistant is answering when a reply is still running", () => {
    expect(chatSendErrorMessage(clientError({ code: "CHAT_TURN_ACTIVE", message: "x", senderName: "Avery" })))
      .toBe("The assistant is still answering Avery in this conversation. Wait for it to finish, or press Stop, then send again.");
    expect(chatSendErrorMessage(clientError({ code: "CHAT_TURN_ACTIVE", message: "x" })))
      .toBe("The assistant is still answering a message in this conversation. Wait for it to finish, or press Stop, then send again.");
  });

  it("says when the spending limit resets", () => {
    expect(chatSendErrorMessage(clientError({ code: "CHAT_SPEND_BUDGET_EXCEEDED", message: "x", retryAfterMs: 3 * 3600_000 - 1 })))
      .toBe("This project has reached its daily AI spending limit, so the assistant is paused. Try again in about 3 hours.");
    expect(chatSendErrorMessage(clientError({ code: "CHAT_SPEND_BUDGET_EXCEEDED", message: "x", retryAfterMs: 90_000 })))
      .toBe("This project has reached its daily AI spending limit, so the assistant is paused. Try again in about 2 minutes.");
    expect(chatSendErrorMessage(clientError({ code: "CHAT_SPEND_BUDGET_EXCEEDED", message: "x" })))
      .toBe("This project has reached its daily AI spending limit, so the assistant is paused. Try again later.");
  });

  it("explains the queue and size limits", () => {
    expect(chatSendErrorMessage(clientError({ code: "CHAT_QUEUE_LIMIT_EXCEEDED", message: "x" })))
      .toBe("You have too many messages waiting for a reply. Wait for one to finish, then send again.");
    expect(chatSendErrorMessage(clientError({ code: "CHAT_MESSAGE_TOO_LONG", message: "x", maxChars: 20_000 })))
      .toBe("This message is too long to send. It can be up to 20,000 characters.");
    expect(chatSendErrorMessage(clientError({ code: "CHAT_MESSAGE_TOO_LONG", message: "x", maxChars: 12_000 })))
      .toBe("The selected text is too long to send. Select up to 12,000 characters.");
  });

  it("does not ask the writer to shorten a message they are resending", () => {
    for (const maxChars of [20_000, 12_000, 128_000]) {
      expect(chatSendErrorMessage(clientError({ code: "CHAT_MESSAGE_TOO_LONG", message: "x", maxChars }), { resend: true }))
        .toBe("The original message is too long to send again. Write a new, shorter message instead.");
    }
    // Other refusals read the same on a resend.
    expect(chatSendErrorMessage(clientError({ code: "CHAT_QUEUE_LIMIT_EXCEEDED", message: "x" }), { resend: true }))
      .toContain("too many messages waiting");
  });

  it("reads the code from the client's log text when the data is gone", () => {
    const text = new Error(clientError({ code: "CHAT_QUEUE_LIMIT_EXCEEDED", message: "x" }).message);
    expect(chatSendErrorMessage(text)).toContain("too many messages waiting");
  });

  it("never shows the raw Convex prefix, and falls back for blank errors", () => {
    const other = clientError({ code: "NOT_FOUND", message: "Thread not found" });
    expect(chatSendErrorMessage(other)).toBe("Thread not found");
    const raw = new Error("[CONVEX M(chatV2:sendMessage)] [Request ID: 7c1e] Server Error");
    expect(chatSendErrorMessage(raw)).toBe(SEND_FAILED_FALLBACK);
    expect(chatSendErrorMessage(new Error(" \n\t "))).toBe(SEND_FAILED_FALLBACK);
    expect(chatSendErrorMessage(new Error("Connection unavailable"))).toBe("Connection unavailable");
  });
});

describe("proposalUndoErrorMessage", () => {
  it("gives the fixed conflict words and plain words for any other failure", () => {
    expect(proposalUndoErrorMessage(clientError({ code: "PROPOSAL_UNDO_CONFLICT", message: "anything" }))).toBe(
      PROPOSAL_UNDO_CONFLICT_TEXT
    );
    expect(PROPOSAL_UNDO_CONFLICT_TEXT).toBe(
      "This passage changed after it was applied, so it can't be undone here. Use Version history to go back."
    );
    expect(proposalUndoErrorMessage(clientError({ code: "NOT_AUTHORIZED", message: "Only the project owner can edit this report" })))
      .toBe("Only the project owner can edit this report");
    expect(proposalUndoErrorMessage(new Error("[CONVEX M(chatV2:undoProposal)] [Request ID: 1] Server Error")))
      .toBe("This suggestion could not be undone. Try again.");
  });
});

describe("chatStopErrorMessage", () => {
  it("uses plain words, never the raw client text", () => {
    expect(chatStopErrorMessage(new Error("[CONVEX M(chatV2:abortStreaming)] [Request ID: 1] Server Error")))
      .toBe("The reply could not be stopped. Try again.");
  });
});
