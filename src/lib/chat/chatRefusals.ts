import { userErrorData, userErrorMessage } from "$lib/errors";

/**
 * Plain words for a message the report chat could not send (Phase A, task 1).
 * The four chat refusal codes get their own copy, built from the data the
 * server sends with them; anything else gets the server's own message, never
 * the Convex client's raw "[CONVEX M(...)] [Request ID: ...]" line.
 */
export const SEND_FAILED_FALLBACK = "Your message could not be sent.";

function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export function chatSendErrorMessage(error: unknown): string {
  const data = userErrorData(error);
  switch (data?.code) {
    case "CHAT_TURN_ACTIVE": {
      const sender = typeof data.senderName === "string" ? data.senderName.trim() : "";
      const who = sender ? `still answering ${sender}` : "still answering a message";
      return `The assistant is ${who} in this conversation. Wait for it to finish, or press Stop, then send again.`;
    }
    case "CHAT_SPEND_BUDGET_EXCEEDED": {
      const wait = typeof data.retryAfterMs === "number" && data.retryAfterMs > 0 ? data.retryAfterMs : null;
      return wait === null
        ? "This project has reached its daily AI spending limit, so the assistant is paused. Try again later."
        : `This project has reached its daily AI spending limit, so the assistant is paused. Try again in about ${formatWait(wait)}.`;
    }
    case "CHAT_QUEUE_LIMIT_EXCEEDED":
      return "You have too many messages waiting for a reply. Wait for one to finish, then send again.";
    case "CHAT_MESSAGE_TOO_LONG": {
      const max = typeof data.maxChars === "number" && data.maxChars > 0 ? data.maxChars : null;
      return max === null
        ? "This message is too long to send. Shorten it, then send again."
        : `This message is too long to send. Keep it under ${max.toLocaleString("en-US")} characters.`;
    }
    default:
      return userErrorMessage(error, SEND_FAILED_FALLBACK).trim() || SEND_FAILED_FALLBACK;
  }
}

const STOP_FAILED_FALLBACK = "The reply could not be stopped. Try again.";

/** Plain words for a Stop the server refused or that never reached it. */
export function chatStopErrorMessage(error: unknown): string {
  return userErrorMessage(error, STOP_FAILED_FALLBACK).trim() || STOP_FAILED_FALLBACK;
}
