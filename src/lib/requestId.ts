/**
 * Generate a UUID-shaped client request ID without requiring a secure origin.
 *
 * `crypto.randomUUID()` is unavailable in some browsers when the app is opened
 * over a LAN HTTP address. `getRandomValues()` remains the preferred fallback;
 * the final timestamp/counter path exists only for unusually constrained
 * runtimes and still preserves the UUID format required by the backend.
 */
type RequestIdCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

let fallbackSequence = 0;

function fillFallback(bytes: Uint8Array) {
  const now = Date.now();
  const sequence = (fallbackSequence = (fallbackSequence + 1) >>> 0);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  for (let index = 0; index < 6; index += 1) {
    bytes[index] ^= Math.floor(now / 2 ** (index * 8)) & 0xff;
  }
  for (let index = 0; index < 4; index += 1) {
    bytes[12 + index] ^= (sequence >>> (index * 8)) & 0xff;
  }
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export function createRequestId(source: RequestIdCrypto | null | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === "function") {
    try {
      return source.randomUUID.call(source);
    } catch {
      // A partially exposed Web Crypto implementation can still reject this
      // method on an insecure origin. Continue to the byte-based path.
    }
  }

  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function") {
    try {
      source.getRandomValues.call(source, bytes);
    } catch {
      fillFallback(bytes);
    }
  } else {
    fillFallback(bytes);
  }

  // RFC 4122 version 4 + variant bits. The backend intentionally validates
  // this shape before accepting upload attempt keys.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}
