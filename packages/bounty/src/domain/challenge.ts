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

export function buildChallengeRule(nonce: string | undefined, description: string): string {
  if (!nonce) {
    return `対象（${description}）を撮影してください。C2PA対応カメラでの撮影を推奨します。`;
  }
  return `「${nonce}」を紙に手書きし、対象（${description}）と一緒に撮影してください。手書きの文字が写真内に写っている必要があります。C2PA対応カメラでの撮影を推奨します。`;
}
