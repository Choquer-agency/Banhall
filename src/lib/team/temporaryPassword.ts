// Unambiguous characters only (no 0/O, 1/l/I), 18 of them from the browser's
// secure random source. Same alphabet as the /admin/users generator.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

export function generateTemporaryPassword(length = 18): string {
  const random = new Uint8Array(length);
  crypto.getRandomValues(random);
  return Array.from(random, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}
