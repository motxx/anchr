import { randomBytes } from "node:crypto";

// Characters that avoid visual ambiguity (no O/0, I/1, S/5, etc.)
const NONCE_CHARS = "ABCDEFGHJKLMNPQRTUVWXY2346789";

export function generateNonce(length = 6): string {
  const charCount = NONCE_CHARS.length;
  // Rejection sampling: discard values >= largest multiple of charCount
  // that fits in a byte to eliminate modulo bias.
  const limit = 256 - (256 % charCount);
  let result = "";
  while (result.length < length) {
    const bytes = randomBytes(length - result.length);
    for (const b of bytes) {
      if (b < limit && result.length < length) {
        result += NONCE_CHARS[b % charCount];
      }
    }
  }
  return result;
}
