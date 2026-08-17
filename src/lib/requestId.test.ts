import { describe, expect, it } from "vitest";
import { createRequestId } from "./requestId";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("createRequestId", () => {
  it("prefers the native randomUUID implementation", () => {
    const expected = "11111111-2222-4333-8444-555555555555";
    expect(createRequestId({ randomUUID: () => expected })).toBe(expected);
  });

  it("builds a valid v4 UUID when randomUUID is unavailable on LAN HTTP", () => {
    const id = createRequestId({
      getRandomValues(bytes) {
        bytes.fill(0x2a);
        return bytes;
      },
    });

    expect(id).toMatch(UUID_V4_RE);
    expect(id).toBe("2a2a2a2a-2a2a-4a2a-aa2a-2a2a2a2a2a2a");
  });

  it("retains UUID shape and uniqueness without Web Crypto", () => {
    const first = createRequestId(null);
    const second = createRequestId(null);
    expect(first).toMatch(UUID_V4_RE);
    expect(second).toMatch(UUID_V4_RE);
    expect(second).not.toBe(first);
  });
});
