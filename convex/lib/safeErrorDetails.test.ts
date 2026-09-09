import { APICallError } from "ai";
import { expect, it } from "vitest";
import { safeErrorDetails } from "./safeErrorDetails";

it("keeps diagnostic status without an SDK error's request or response material", () => {
  const error = new APICallError({
    message: "PRIVATE_MESSAGE", url: "https://example.test/PRIVATE_URL",
    statusCode: 429, isRetryable: true,
    requestBodyValues: { system: "PRIVATE_PROMPT", documents: ["PRIVATE_CLIENT"] },
    responseBody: "PRIVATE_RESPONSE",
  });
  expect(safeErrorDetails(error)).toEqual({ statusCode: 429, retryable: true });
  expect(JSON.stringify(safeErrorDetails(error))).not.toContain("PRIVATE_");
  expect(safeErrorDetails({ statusCode: "PRIVATE_CODE", isRetryable: "PRIVATE_VALUE" })).toEqual({});
});
